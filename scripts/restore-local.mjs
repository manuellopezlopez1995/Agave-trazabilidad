// Offline restore drill only; never connects to a cloud Storage or database.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export function localDatabase(value){
 const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash||!/^\/agave_restore_[a-z0-9_]+$/.test(url.pathname))
  throw Error('Se exige PostgreSQL local, sin opciones de conexión, y base agave_restore_* exclusivamente de ensayo');
 const password=decodeURIComponent(url.password);url.password='';
 return {url:url.toString(),password};
}
export function relativeObject(bucket,path){
 if(typeof bucket!=='string'||typeof path!=='string'||!bucket||!path||[bucket,...path.split('/')].some(p=>!p||p==='.'||p==='..'||/[\\\0]/.test(p))||bucket.includes('/'))
  throw Error('Ruta de respaldo inválida');
 return join('objects',bucket,...path.split('/'));
}
export function verifyBytes(bytes,item){
 if(!Number.isSafeInteger(item.size)||bytes.length!==item.size||!/^\w{64}$/.test(item.sha256)||createHash('sha256').update(bytes).digest('hex')!==item.sha256)
  throw Error('Tamaño o SHA-256 de respaldo incorrecto');
}
export async function restoreLocal(folder,env=process.env){
 const connection=localDatabase(env.LOCAL_RESTORE_DATABASE_URL??'');
 const databaseName=new URL(connection.url).pathname.slice(1);
 if(env.LOCAL_RESTORE_ACK!==`RESTORE-LOCAL-ONLY:${databaseName}`)throw Error('Confirma únicamente la base temporal mediante LOCAL_RESTORE_ACK');
 const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
 if(manifest.formatVersion!==2||manifest.aclIncluded!==true||manifest.database?.file!=='database.dump'||!Array.isArray(manifest.objects))throw Error('Se exige exportación v2 con ACL y manifiesto de originales');
 const dump=await readFile(join(folder,'database.dump'));verifyBytes(dump,manifest.database);
 // Verify every original before any database import.
 for(const item of manifest.objects)verifyBytes(await readFile(join(folder,relativeObject(item.bucket,item.path))),item);
 const privateEnv={...env,PGPASSWORD:connection.password};
 const run=(binary,args)=>{const result=spawnSync(binary,args,{env:privateEnv,encoding:'utf8'});if(result.status!==0)throw Error(`${binary} no disponible o ejecución fallida; restauración no aprobada`);return result.stdout.trim()};
 const preflight=run('psql',['--dbname',connection.url,'--no-psqlrc','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--command',"select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m'))=0 and (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','supabase_auth_admin','supabase_storage_admin'))=5"]);
 if(preflight!=='t')throw Error('La base local necesita public vacío y roles Supabase compatibles; no se borrará ningún objeto');
 run('pg_restore',['--dbname',connection.url,'--exit-on-error','--single-transaction','--no-owner',join(folder,'database.dump')]);
 const target=await mkdtemp(join(tmpdir(),'agave-restored-'));
 for(const item of manifest.objects){const bytes=await readFile(join(folder,relativeObject(item.bucket,item.path)));const path=join(target,relativeObject(item.bucket,item.path));await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,bytes,{flag:'wx',mode:0o600});verifyBytes(await readFile(path),item)}
 const result={database:databaseName,originals:manifest.objects.length,originalHashesVerified:true,storageApiVerified:false,recoveryApproved:false,pending:['Recuentos y hashes de filas','Relaciones y ACL','Pruebas RLS','Lectura mediante API Storage local'],restoredFiles:target};
 await writeFile(join(target,'verification.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 console.log('Importación local y originales copiados. Recuperación integral sigue pendiente de cotejos y pruebas API/RLS.');
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(!process.argv[2])throw Error('Indica el directorio privado de respaldo');await restoreLocal(resolve(process.argv[2]))}
 catch(error){console.error(error.message);process.exitCode=1}
}
