// Restaura exclusivamente en un proyecto y base de prueba distintos del origen.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const folder=resolve(process.argv[2]||'');
const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
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
const restored=spawnSync('pg_restore',['--dbname',database,'--clean','--if-exists','--no-owner','--no-acl',join(folder,manifest.database.file)],{stdio:'inherit'});
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
console.log(`Restauración y lectura de ${manifest.objects.length} imágenes verificadas en proyecto de prueba`);
