// Restaura exclusivamente en un proyecto y base de prueba distintos del origen.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const folder=resolve(process.argv[2]||'');
const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
if(manifest.formatVersion!==2||manifest.aclIncluded!==true)throw Error('El respaldo antiguo omite permisos. Crea una nueva exportación antes de restaurar');
const target=process.env.TEST_SUPABASE_URL?.replace(/\/$/,'');
const key=process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const database=process.env.TEST_DATABASE_URL;
if(!target||!key||!database)throw Error('Configura TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY y TEST_DATABASE_URL');
if(!/^https:\/\/[\w.-]+\.supabase\.co$/.test(target)||target===manifest.projectUrl)throw Error('El destino debe ser otro proyecto Supabase de prueba');
const sourceRef=new URL(manifest.projectUrl).hostname.split('.')[0],targetRef=new URL(target).hostname.split('.')[0];
if(database.includes(sourceRef)||database.includes(targetRef)||database===process.env.DATABASE_URL)throw Error('Usa una base PostgreSQL aislada, distinta del proyecto de origen y del Storage de prueba');
if(!process.env.TEST_RESTORE_ACK?.startsWith('RESTORE-TO-TEST-ONLY'))throw Error('Define TEST_RESTORE_ACK=RESTORE-TO-TEST-ONLY antes de restaurar');
const verify=(buf,expected)=>{if(createHash('sha256').update(buf).digest('hex')!==expected)throw Error('SHA-256 de respaldo incorrecto')};
const dump=await readFile(join(folder,manifest.database.file));verify(dump,manifest.database.sha256);
if(!Array.isArray(manifest.buckets)||!Array.isArray(manifest.objects))throw Error('El manifiesto no enumera buckets y archivos; crea un nuevo respaldo completo');
for(const item of manifest.objects){const bytes=await readFile(join(folder,'objects',item.bucket,...item.path.split('/')));verify(bytes,item.sha256);if(bytes.length!==item.size)throw Error('Tamaño incorrecto')}
// Never clean an existing database. Require an empty application schema and
// compatible Supabase roles supplied by the separate test environment.
const preflight=spawnSync('psql',['--dbname',database,'--no-psqlrc','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--command',"select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m'))=0 and (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','supabase_auth_admin','supabase_storage_admin'))=5"],{encoding:'utf8'});
if(preflight.status!==0||preflight.stdout.trim()!=='t')throw Error('El destino necesita esquema public vacío y roles Supabase compatibles. No se borrará ninguna base existente');
const restored=spawnSync('pg_restore',['--dbname',database,'--exit-on-error','--single-transaction','--no-owner',join(folder,manifest.database.file)],{stdio:'inherit'});
if(restored.status!==0)throw Error('La restauración de la base de prueba falló');
for(const bucket of manifest.buckets){
 const response=await fetch(`${target}/storage/v1/bucket/${encodeURIComponent(bucket.id)}`,{headers:{Authorization:`Bearer ${key}`,apikey:key}});
 if(response.status===404){const created=await fetch(`${target}/storage/v1/bucket`,{method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({id:bucket.id,name:bucket.name||bucket.id,public:false,file_size_limit:bucket.file_size_limit,allowed_mime_types:bucket.allowed_mime_types})});if(!created.ok)throw Error(`No se creó el bucket privado ${bucket.id}`)}
 else if(!response.ok)throw Error(`No se verificó el bucket ${bucket.id}`);
 else if((await response.json()).public)throw Error(`El bucket ${bucket.id} del destino es público; se exige un destino privado`);
}
for(const item of manifest.objects){
 const bytes=await readFile(join(folder,'objects',item.bucket,...item.path.split('/')));
 const response=await fetch(`${target}/storage/v1/object/${item.bucket}/${item.path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':item.path.endsWith('.png')?'image/png':'image/jpeg','x-upsert':'false'},body:bytes});
 if(!response.ok)throw Error(`Restauración de Storage falló: ${item.bucket}/${item.path} (${response.status})`);
 const downloaded=await fetch(`${target}/storage/v1/object/authenticated/${item.bucket}/${item.path.split('/').map(encodeURIComponent).join('/')}`,{headers:{Authorization:`Bearer ${key}`,apikey:key}});
 if(!downloaded.ok)throw Error(`No se pudo leer archivo restaurado (${downloaded.status})`);
 verify(Buffer.from(await downloaded.arrayBuffer()),item.sha256);
}
console.log(`Importación y hashes de ${manifest.objects.length} archivos verificados. Recuperación NO aprobada: faltan cotejo de registros/relaciones/ACL y pruebas RLS en la base restaurada.`);
