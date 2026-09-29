import {supabase} from './backend';

export type PendingEvidence={id:string;queuedAt?:string;kind:'harvest'|'delivery'|'weighing'|'safety';photoKind?:'PPE'|'TRUCK';agaveLotId?:string;agaveLotEvidencePath?:string;organizationId:string;entityId:string;userId:string;bucket:string;path:string;mimeType:string;blob:Blob;bytes?:ArrayBuffer;capturedAt:string;latitude?:number;longitude?:number;legibilityConfirmed:boolean;weighing?:{gross:number;tare:number;ticketNumber:string;weighingType:string;ocrReading?:Record<string,unknown>;correctedFields?:string[];ticketSha256?:string;weighedAt?:string}};
const name='agave-pending-evidence';
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function operation<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,resolve:(v:T)=>void,reject:(error:unknown)=>void)=>void):Promise<T>{const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('pending',mode);let value:T;tx.oncomplete=()=>{database.close();resolve(value)};tx.onerror=tx.onabort=()=>{database.close();reject(tx.error)};run(tx.objectStore('pending'),v=>{value=v},error=>{tx.abort();reject(error)})})}

export async function queueEvidence(item:PendingEvidence){const bytes=item.bytes??await item.blob.arrayBuffer();if(!bytes.byteLength)throw Error('La fotografía original está vacía');await operation<void>('readwrite',(store,resolve,reject)=>{const request=store.add({...item,blob:undefined,bytes:bytes.slice(0),queuedAt:item.queuedAt??new Date().toISOString()});request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}
export async function pendingEvidence():Promise<PendingEvidence[]>{const items=await operation<PendingEvidence[]>('readonly',(store,resolve,reject)=>{const request=store.getAll();request.onsuccess=()=>resolve(request.result as PendingEvidence[]);request.onerror=()=>reject(request.error)});return items.map(item=>item.bytes?{...item,blob:new Blob([item.bytes],{type:item.mimeType})}:item)}
async function removeEvidence(id:string){await operation<void>('readwrite',(store,resolve,reject)=>{const request=store.delete(id);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)})}

// Un identificador y ruta estables vuelven seguro reintentar después de una respuesta perdida.
export async function syncEvidence(organizationId:string,userId:string,onProgress?:(remaining:number)=>void,onlyId?:string){
 if(!supabase||!navigator.onLine)throw Error('Necesitas conexión para sincronizar');
 const items=await pendingEvidence();let synced=0;
 for(const item of items){
  if(item.userId!==userId||item.organizationId!==organizationId||onlyId&&item.id!==onlyId)continue;
  const table=item.kind==='harvest'?'harvest_evidence':item.kind==='delivery'?'delivery_evidence':item.kind==='safety'?'trip_arrival_safety_evidence':'weighings';
  const column=item.kind==='weighing'?'ticket_storage_path':'storage_path';
  const {data:existing,error:readError}=await supabase.from(table).select('id').eq(column,item.path).maybeSingle();if(readError)throw readError;
  if(!existing){
   const {error:uploadError}=await supabase.storage.from(item.bucket).upload(item.path,item.blob,{contentType:item.mimeType,upsert:false});
   if(uploadError){const {data:alreadyThere,error:downloadError}=await supabase.storage.from(item.bucket).download(item.path);if(downloadError||!alreadyThere||alreadyThere.size!==item.blob.size)throw uploadError;const hash=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))).join(',');if(await hash(alreadyThere)!==await hash(item.blob))throw Error('La fotografía existente no coincide con el original')}
   const common={storage_bucket:item.bucket,storage_path:item.path,captured_at:item.capturedAt,latitude:item.latitude,longitude:item.longitude};
   let data:Record<string,unknown>;
   if(item.kind==='harvest'){
    let lotId=item.agaveLotId??null;
    if(item.agaveLotEvidencePath){const {data:source,error:sourceError}=await supabase.from('harvest_evidence').select('agave_lot_id').eq('storage_path',item.agaveLotEvidencePath).single();if(sourceError||!source?.agave_lot_id)throw sourceError??Error('El lote pendiente aún no está sincronizado');lotId=source.agave_lot_id}
    data={...common,harvest_order_id:item.entityId,agave_lot_id:lotId,evidence_type:'PHOTO',mime_type:item.mimeType,file_size_bytes:item.blob.size,uploaded_by:item.userId};
   }
   else if(item.kind==='delivery')data={...common,delivery_id:item.entityId,evidence_type:'PHOTO',mime_type:item.mimeType,file_size_bytes:item.blob.size,uploaded_by:item.userId,legibility_confirmed:item.legibilityConfirmed};
   else if(item.kind==='safety')data={organization_id:item.organizationId,trip_id:item.entityId,uploaded_by:item.userId,storage_bucket:item.bucket,storage_path:item.path,mime_type:item.mimeType,file_size_bytes:item.blob.size,captured_at:item.capturedAt,equipment_confirmed:true,photo_kind:item.photoKind??'PPE'};
   else {if(!item.weighing)throw Error('Pesaje pendiente sin medición');data={...common,trip_id:item.entityId,weighing_type:item.weighing.weighingType,gross_weight_kg:item.weighing.gross,tare_weight_kg:item.weighing.tare,net_weight_kg:item.weighing.gross-item.weighing.tare,ticket_number:item.weighing.ticketNumber,recorded_by:item.userId,legibility_confirmed:item.legibilityConfirmed,ticket_storage_path:item.path,ocr_reading:item.weighing.ocrReading??null,ocr_corrected_fields:item.weighing.correctedFields??[],ticket_sha256:item.weighing.ticketSha256??null,confirmed_at:new Date().toISOString(),...(item.weighing.weighedAt?{weighed_at:item.weighing.weighedAt}:{})};delete data.storage_path}
   // La clave de IndexedDB es la ruta; el identificador de la tabla es el UUID
   // estable del archivo al final de esa ruta. Así también se recuperan las
   // fotos que ya estaban pendientes antes de esta corrección.
   const fileId=item.path.split('/').pop()?.replace(/\.(jpg|png)$/i,'');
   if(!fileId||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId))throw Error('La fotografía pendiente no tiene identificador válido');
   data.id=fileId;
   const {error:insertError}=await supabase.from(table).insert(data);if(insertError){const {data:retry,error:retryError}=await supabase.from(table).select('id').eq(column,item.path).maybeSingle();if(retryError||!retry)throw insertError}
  }
  await removeEvidence(item.id);synced++;onProgress?.(items.length-synced);
 }
 return synced;
}
