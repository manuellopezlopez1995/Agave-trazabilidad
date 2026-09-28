import {supabase} from './backend';
import {pendingEvidence,syncEvidence,PendingEvidence} from './offlineEvidence';
export function offlineErrorMessage(error:unknown){
 if(error instanceof Error)return error.message;
 if(error&&typeof error==='object'){
  const detail=error as {message?:unknown;details?:unknown;hint?:unknown;code?:unknown};
  const parts=[detail.message,detail.details,detail.hint,detail.code].filter(x=>typeof x==='string'&&x.trim());
  if(parts.length)return parts.join(' · ');
 }
 return typeof error==='string'?error:'Error desconocido; los pendientes siguen guardados';
}
// Installed PWAs reopen at start_url without query parameters. Remember the
// chosen workspace per named session; this preference grants no access.
export const practiceMode=(()=>{if(typeof window==='undefined')return false;const params=new URLSearchParams(window.location.search),explicit=params.get('practice'),key=`agave-workspace:${params.get('session')??'default'}`;try{if(explicit==='0'||explicit==='1')localStorage.setItem(key,explicit);return (explicit??localStorage.getItem(key))==='1'}catch{return explicit==='1'}})();
export async function prepareOfflineShell(){
 if(!navigator.onLine)throw Error('Prepara el dispositivo antes de perder señal');
 if(!('serviceWorker' in navigator)||typeof caches==='undefined')throw Error('Este navegador no permite preparar la aplicación sin señal');
 let timer:ReturnType<typeof setTimeout>;
 const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('La aplicación aún no está lista para abrir sin señal. Vuelve a preparar con conexión.')),20000)})]).finally(()=>clearTimeout(timer!));
 const scripts=Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map(x=>x.src).filter(x=>x.startsWith(registration.scope));
 if(!scripts.length)throw Error('No se encontró la versión de la aplicación para conservar');
 const styles=Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map(x=>x.href).filter(x=>x.startsWith(registration.scope));
 const assets=[registration.scope,...scripts,...styles,new URL('manifest.json',registration.scope).href,new URL('icon-192.png',registration.scope).href];
 const cache=await caches.open('agave-shell-v2');await cache.addAll(assets);
 for(const url of assets){const response=await cache.match(url);if(!response?.ok)throw Error(`Falta un archivo de la aplicación para usarla sin señal: ${url.split('/').pop()}`)}
 if(navigator.storage?.persist)await navigator.storage.persist();
}
export async function verifyOfflineShell(){
 if(!('serviceWorker' in navigator)||typeof caches==='undefined')return false;
 const registration=await navigator.serviceWorker.getRegistration();if(!registration?.active)return false;
 const cache=await caches.open('agave-shell-v2');
 const assets=[registration.scope,...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map(x=>x.src).filter(x=>x.startsWith(registration.scope)),...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map(x=>x.href).filter(x=>x.startsWith(registration.scope))];
 return assets.length>1&&(await Promise.all(assets.map(x=>cache.match(x)))).every(response=>response?.ok);
}

export type OfflineOperation={id:string;actorId:string;organizationId:string;kind:'harvest'|'lot'|'trip'|'field_arrival';entityId:string;capturedAt:string;queuedAt:string;payload:Record<string,unknown>;blob?:Blob;bytes?:ArrayBuffer;mimeType?:string;error?:string};
export type OfflineDraft={id:string;actorId:string;organizationId:string;entityId:string;kind:'ticket'|'brix';type?:'ORIGIN'|'DESTINATION';blob?:Blob;bytes?:ArrayBuffer;mimeType:string;capturedAt:string;latitude?:number;longitude?:number};
type Store='operations'|'snapshots'|'drafts';
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('agave-offline-journal',1);r.onupgradeneeded=()=>{for(const name of ['operations','snapshots','drafts'])r.result.createObjectStore(name,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function transaction<T>(name:Store,mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest):Promise<T>{
 const database=await open();return new Promise((resolve,reject)=>{const tx=database.transaction(name,mode);let value:T;const request=run(tx.objectStore(name));request.onsuccess=()=>{value=request.result};tx.oncomplete=()=>{database.close();resolve(value)};tx.onerror=tx.onabort=()=>{database.close();reject(tx.error??request.error??Error('No se pudo guardar en el dispositivo'))}});
}
export async function operations(actor:string,org?:string){return (await transaction<OfflineOperation[]>('operations','readonly',s=>s.getAll())).filter(x=>x.actorId===actor&&(!org||x.organizationId===org)).map(x=>x.bytes?{...x,blob:new Blob([x.bytes],{type:x.mimeType??'image/jpeg'})}:x).sort((a,b)=>a.queuedAt.localeCompare(b.queuedAt)||a.id.localeCompare(b.id))}
export async function enqueueOperation(op:OfflineOperation){const bytes=op.bytes??await op.blob?.arrayBuffer();await transaction('operations','readwrite',s=>s.add({...op,blob:undefined,bytes:bytes?.slice(0),mimeType:op.blob?.type??op.mimeType}))}
export async function drafts(actor:string,org:string){return (await transaction<OfflineDraft[]>('drafts','readonly',s=>s.getAll())).filter(x=>x.actorId===actor&&x.organizationId===org)}
export async function saveDraft(draft:OfflineDraft){
 // Safari may retain an IndexedDB Blob reference after its backing object has
 // disappeared. Store owned image bytes instead, before acknowledging the draft.
 const bytes=draft.bytes??await draft.blob?.arrayBuffer();
 if(!bytes?.byteLength)throw Error('No se pudieron conservar los bytes originales de la fotografía');
 await transaction('drafts','readwrite',s=>s.put({...draft,blob:undefined,bytes:bytes.slice(0)}));
}
export async function removeDraft(id:string){await transaction('drafts','readwrite',s=>s.delete(id))}
const cacheId=(actor:string)=>`${actor}:${practiceMode?'practice':'operations'}`;
export async function saveOfflineView(actor:string,view:Record<string,any>){await transaction('snapshots','readwrite',s=>s.put({id:cacheId(actor),savedAt:new Date().toISOString(),view}))}
export async function readOfflineView(actor:string):Promise<{savedAt:string;view:Record<string,any>}|undefined>{return transaction('snapshots','readonly',s=>s.get(cacheId(actor)))}
export async function originalUpload(bucket:string,path:string,blob:Blob){
 if(!supabase)throw Error('Falta configurar Supabase');
 const {error}=await supabase.storage.from(bucket).upload(path,blob,{contentType:blob.type,upsert:false});
 if(!error)return;
 const {data,error:readError}=await supabase.storage.from(bucket).download(path);
 if(readError||!data||data.size!==blob.size)throw error;
 const digest=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))).join(',');
 if(await digest(data)!==await digest(blob))throw Error('El archivo existente no coincide con la fotografía original');
}
const running=new Map<string,Promise<void>>();
export async function syncJournal(actor:string,org:string){
 const key=`${actor}:${org}`;const active=running.get(key);if(active)return active;
 const run=async()=>{
  if(!supabase||!navigator.onLine)throw Error('Sin conexión. Los pendientes siguen guardados.');
  const commands=await operations(actor,org),photos=(await pendingEvidence()).filter(x=>x.userId===actor&&x.organizationId===org);
  const work=[...commands.map(op=>({at:op.queuedAt,id:op.id,op})),...photos.map(photo=>({at:photo.queuedAt??photo.capturedAt,id:photo.id,photo}))].sort((a,b)=>Number('op' in a&&a.op.kind==='trip'&&a.op.payload.expected==='LOADING')-Number('op' in b&&b.op.kind==='trip'&&b.op.payload.expected==='LOADING')||a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  for(const item of work){
   if('photo' in item){try{await syncEvidence(org,actor,undefined,item.id)}catch(error){throw Error(`Fotografía pendiente conservada (${item.photo.kind}): ${offlineErrorMessage(error)}`)}continue}
   const op=item.op;
   try{
    if(op.kind==='lot'){if(!op.blob)throw Error('Falta la foto original de °Brix');await originalUpload('harvest-evidence',String(op.payload.path),op.blob)}
    const {data,error}=await supabase.rpc('apply_offline_operation',{p_event_id:op.id,p_kind:op.kind,p_entity_id:op.entityId,p_captured_at:op.capturedAt,p_payload:op.payload});
    if(error)throw error;if(!data)throw Error('El servidor no confirmó el evento');
    await transaction('operations','readwrite',s=>s.delete(op.id));
   }catch(error){op.error=offlineErrorMessage(error);await transaction('operations','readwrite',s=>s.put(op));throw Error(`Pendiente conservado: ${op.error}`)}
  }
 };
 const promise=(async()=>{if(typeof navigator!=='undefined'&&navigator.locks)await navigator.locks.request(`agave-sync:${key}`,run);else await run()})().finally(()=>running.delete(key));running.set(key,promise);return promise;
}
// Pending data are visibly provisional. Only the server can confirm state transitions.
export function projectOfflineView(view:Record<string,any>,ops:OfflineOperation[],photos:PendingEvidence[]){
 const v=structuredClone(view);v.harvests??=[];v.lots??=[];v.trips??=[];v.harvestPhotos??=[];v.tripLots??=[];
 for(const op of ops){
  if(op.kind==='harvest'){
   const h=v.harvests.find((h:any)=>h.id===op.entityId);if(h){h.status=op.payload.expected==='ASSIGNED'?'IN_PROGRESS':'HARVESTED';h.pending=true;
    if(h.status==='HARVESTED'){for(const l of v.lots.filter((l:any)=>l.harvest_order_id===h.id)){l.status='HARVESTED';const t=v.trips.find((t:any)=>t.harvest_order_id===h.id);if(t&&!v.tripLots.some((tl:any)=>tl.trip_id===t.id&&tl.agave_lot_id===l.id))v.tripLots.push({trip_id:t.id,agave_lot_id:l.id,loaded_weight_kg:null})}}
   }
  }else if(op.kind==='lot'){
   const id=op.payload.lot_id||op.id,h=v.harvests.find((h:any)=>h.id===op.entityId),existing=v.lots.find((l:any)=>l.id===id);
   const l={id,trace_code:existing?.trace_code??'LOTE PENDIENTE',harvest_order_id:op.entityId,farm_id:h?.farm_id,status:'OPEN',agave_count:op.payload.count,average_brix:op.payload.brix,actual_weight_kg:null,pending:true};
   if(existing)Object.assign(existing,l);else v.lots.push(l);
   v.harvestPhotos.push({id:op.id,harvest_order_id:op.entityId,agave_lot_id:id,storage_bucket:'harvest-evidence',storage_path:op.payload.path,pending:true});
  }else{const t=v.trips.find((t:any)=>t.id===op.entityId);if(t){t.status=op.kind==='field_arrival'?'AT_FIELD':'LOADING';t.pending=true}}
 }
 for(const p of photos){if(p.kind==='harvest'&&!v.harvestPhotos.some((x:any)=>x.storage_path===p.path))v.harvestPhotos.push({id:p.id,harvest_order_id:p.entityId,agave_lot_id:p.agaveLotId??null,storage_bucket:p.bucket,storage_path:p.path,pending:true})}
 return v;
}
