import {supabase} from './backend';

export type PendingTripArrival={tripId:string;eventId:string;actorId:string;capturedAt:string;latitude:number|null;longitude:number|null};
const storageKey='agave-traza-pending-field-arrivals-v1';

export function pendingTripArrivals():PendingTripArrival[]{
 if(typeof window==='undefined')return [];
 try{const data=JSON.parse(window.localStorage.getItem(storageKey)||'[]');return Array.isArray(data)?data:[]}
 catch{return []}
}
export function queueTripArrival(arrival:PendingTripArrival){
 if(typeof window==='undefined')throw Error('La cola sólo está disponible en este dispositivo');
 const items=pendingTripArrivals();if(!items.some(x=>x.eventId===arrival.eventId))items.push(arrival);
 window.localStorage.setItem(storageKey,JSON.stringify(items));
}
export async function syncTripArrivals(actorId:string){
 if(!supabase)throw Error('Falta configurar Supabase');
 for(const item of pendingTripArrivals()){
  if(item.actorId!==actorId)continue;
  const {data,error}=await supabase.rpc('mark_trip_at_field',{p_trip_id:item.tripId,p_event_id:item.eventId,
   p_captured_at:item.capturedAt,p_latitude:item.latitude,p_longitude:item.longitude});
  if(error)throw Error(`${item.tripId}: ${error.message}`);
  if(data!=='AT_FIELD')throw Error('El servidor no confirmó la llegada al predio');
  window.localStorage.setItem(storageKey,JSON.stringify(pendingTripArrivals().filter(x=>x.eventId!==item.eventId)));
 }
 return pendingTripArrivals().filter(x=>x.actorId===actorId).length;
}
