import {supabase} from './backend';

export type PendingEvidence={id:string;kind:'harvest'|'delivery'|'weighing';organizationId:string;entityId:string;userId:string;bucket:string;path:string;mimeType:string;blob:Blob;capturedAt:string;latitude?:number;longitude?:number;legibilityConfirmed:boolean;weighing?:{gross:number;tare:number;ticketNumber:string;weighingType:string}};
const name='agave-pending-evidence';
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function operation<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,resolve:(v:T)=>void,reject:(error:unknown)=>void)=>void):Promise<T>{const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('pending',mode);tx.oncomplete=()=>database.close();tx.onerror=()=>reject(tx.error);run(tx.objectStore('pending'),resolve,reject)})}
export async function queueEvidence(item:PendingEvidence){await operation<void>('readwrite',(store,resolve,reject)=>{const request=store.add(item);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}
export async function pendingEvidence():Promise<PendingEvidence[]>{return operation('readonly',(store,resolve,reject)=>{const request=store.getAll();request.onsuccess=()=>resolve(request.result as PendingEvidence[]);request.onerror=()=>reject(request.error)})}
async function removeEvidence(id:string){await operation<void>('readwrite',(store,resolve,reject)=>{const request=store.delete(id);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}

// Un identificador y ruta estables vuelven seguro reintentar después de una respuesta perdida.
export async function syncEvidence(organizationId:string,userId:string,onProgress?:(remaining:number)=>void){
 if(!supabase||!navigator.onLine)throw Error('Necesitas conexión para sincronizar');
 const items=await pendingEvidence();let synced=0;
 for(const item of items){
  if(item.userId!==userId||item.organizationId!==organizationId)continue;
  const table=item.kind==='harvest'?'harvest_evidence':item.kind==='delivery'?'delivery_evidence':'weighings';
  const column=item.kind==='weighing'?'ticket_storage_path':'storage_path';
  const {data:existing,error:readError}=await supabase.from(table).select('id').eq(column,item.path).maybeSingle();if(readError)throw readError;
  if(!existing){
   const {error:uploadError}=await supabase.storage.from(item.bucket).upload(item.path,item.blob,{contentType:item.mimeType,upsert:false});
   if(uploadError){const {data:alreadyThere,error:downloadError}=await supabase.storage.from(item.bucket).download(item.path);if(downloadError||!alreadyThere||alreadyThere.size!==item.blob.size)throw uploadError}
   const common={storage_bucket:item.bucket,storage_path:item.path,captured_at:item.capturedAt,latitude:item.latitude,longitude:item.longitude};
   let data:Record<string,unknown>;
   if(item.kind==='harvest')data={...common,harvest_order_id:item.entityId,evidence_type:'PHOTO',mime_type:item.mimeType,file_size_bytes:item.blob.size,uploaded_by:item.userId};
   else if(item.kind==='delivery')data={...common,delivery_id:item.entityId,evidence_type:'PHOTO',mime_type:item.mimeType,file_size_bytes:item.blob.size,uploaded_by:item.userId,legibility_confirmed:item.legibilityConfirmed};
   else {if(!item.weighing)throw Error('Pesaje pendiente sin medición');data={...common,trip_id:item.entityId,weighing_type:item.weighing.weighingType,gross_weight_kg:item.weighing.gross,tare_weight_kg:item.weighing.tare,net_weight_kg:item.weighing.gross-item.weighing.tare,ticket_number:item.weighing.ticketNumber,recorded_by:item.userId,legibility_confirmed:item.legibilityConfirmed,ticket_storage_path:item.path};delete data.storage_path}
   const {error:insertError}=await supabase.from(table).insert(data);if(insertError){const {data:retry,error:retryError}=await supabase.from(table).select('id').eq(column,item.path).maybeSingle();if(retryError||!retry)throw insertError}
  }
  await removeEvidence(item.id);synced++;onProgress?.(items.length-synced);
 }
 return synced;
}
