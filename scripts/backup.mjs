// Ejecución privada: DATABASE_URL y SUPABASE_SERVICE_ROLE_KEY nunca se incluyen en la PWA.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';

const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const database=process.env.DATABASE_URL;
const target=resolve(process.argv[2]||`backup-${new Date().toISOString().replace(/[:.]/g,'-')}`);
if(!base||!key||!database)throw Error('Configura SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y DATABASE_URL en el entorno privado');
if(!/^https:\/\/[\w.-]+\.supabase\.co$/.test(base))throw Error('URL de Supabase no reconocida');
await mkdir(join(target,'objects'),{recursive:true});
const dump=spawnSync('pg_dump',['--format=custom','--no-owner','--no-acl','--file',join(target,'database.dump'),database],{stdio:'inherit'});
if(dump.status!==0)throw Error('pg_dump falló; no se aceptará un respaldo parcial');
const request=async(path,options={})=>{
 const response=await fetch(`${base}/storage/v1${path}`,{...options,headers:{Authorization:`Bearer ${key}`,apikey:key,...options.headers}});
 if(!response.ok)throw Error(`Storage respondió ${response.status} para ${path.split('?')[0]}`);
 return response;
};
const files=[];
const buckets=await (await request('/bucket')).json();
if(!Array.isArray(buckets)||buckets.some(bucket=>!bucket.id||typeof bucket.id!=='string'))throw Error('No se pudo enumerar de forma completa los buckets de Storage');
async function list(bucket,prefix=''){
 for(let offset=0;;offset+=100){
  const response=await request(`/object/list/${bucket}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}})});
  const rows=await response.json();
  for(const row of rows){
   if(row.id===null||!row.metadata){await list(bucket,`${prefix}${row.name}/`);continue}
   const path=`${prefix}${row.name}`;
   const object=await request(`/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`);
   const bytes=Buffer.from(await object.arrayBuffer());
   const file=join(target,'objects',bucket,...path.split('/'));
   await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});
   files.push({bucket,path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  if(rows.length<100)break;
 }
}
for(const bucket of buckets)await list(bucket.id);
const dumpBytes=await readFile(join(target,'database.dump'));
const manifest={createdAt:new Date().toISOString(),projectUrl:base,database:{file:'database.dump',size:dumpBytes.length,sha256:createHash('sha256').update(dumpBytes).digest('hex')},buckets:buckets.map(({id,name,public:publicAccess,file_size_limit,allowed_mime_types})=>({id,name,public:publicAccess,file_size_limit,allowed_mime_types})),objects:files};
await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
console.log(`Respaldo completo: ${files.length} archivos; manifiesto ${join(target,'manifest.json')}`);
