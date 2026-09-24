export const DEFAULT_VARIANCE_KG=10;
export const DEFAULT_VARIANCE_PERCENT=2;
export type BuyerGroup={name:string;key:string;trips:any[];links:any[];lots:any[];weighings:any[];deliveries:any[];images:any[]};
export const buyerKey=(s:string)=>s.trim().replace(/\s+/g,' ').toLocaleLowerCase('es-MX');
export function partitionByBuyer(data:{trips:any[];links:any[];lots:any[];weighings:any[];deliveries:any[];images:any[]}){
 const groups=new Map<string,BuyerGroup>();
 for(const trip of data.trips){
  const receipts=data.deliveries.filter(d=>d.trip_id===trip.id);
  const names=[...new Set(receipts.map(d=>buyerKey(d.recipient_company||'')).filter(Boolean))];
  if(names.length>1)throw Error(`El viaje ${trip.trace_code} tiene entregas para varios compradores; requiere separar las cargas antes de exportar.`);
  const name=receipts[0]?.recipient_company?.trim()||trip.destination_name?.trim()||'Sin comprador asignado';
  const key=buyerKey(name);let group=groups.get(key);
  if(!group){group={name,key,trips:[],links:[],lots:[],weighings:[],deliveries:[],images:[]};groups.set(key,group)}
  group.trips.push(trip);
 }
 for(const group of groups.values()){
  const tripIds=new Set(group.trips.map(t=>t.id));
  group.links=data.links.filter(l=>tripIds.has(l.trip_id));
  const lotIds=new Set(group.links.map(l=>l.agave_lot_id));
  group.lots=data.lots.filter(l=>lotIds.has(l.id));
  group.weighings=data.weighings.filter(w=>tripIds.has(w.trip_id));
  group.deliveries=data.deliveries.filter(d=>tripIds.has(d.trip_id));
  const ticketIds=new Set(group.weighings.map(w=>w.id));
  const deliveryCodes=group.deliveries.map(d=>d.trace_code);
  group.images=data.images.filter(i=>i.kind==='harvest'||i.kind==='ticket'&&ticketIds.has(i.label)||i.kind==='delivery'&&deliveryCodes.some(code=>i.label===`Entrega ${code}`));
 }
 if(!groups.size)groups.set('sin comprador asignado',{name:'Sin comprador asignado',key:'sin comprador asignado',trips:[],links:[],lots:data.lots,weighings:[],deliveries:[],images:data.images.filter(i=>i.kind==='harvest')});
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'));
}
export function variance(fieldKg:number|null,originKg:number|null,destinationKg:number|null,acceptedKg:number|null,rejectedKg:number|null,limitKg=DEFAULT_VARIANCE_KG,limitPercent=DEFAULT_VARIANCE_PERCENT){
 const threshold=originKg==null?limitKg:Math.max(limitKg,Math.abs(originKg)*limitPercent/100);
 const originDifference=fieldKg!=null&&originKg!=null?fieldKg-originKg:null;
 const transitDifference=originKg!=null&&destinationKg!=null?originKg-destinationKg:null;
 const receiptDifference=destinationKg!=null&&acceptedKg!=null&&rejectedKg!=null?destinationKg-acceptedKg-rejectedKg:null;
 return {threshold,originDifference,transitDifference,receiptDifference,exceeded:[originDifference,transitDifference,receiptDifference].some(v=>v!==null&&Math.abs(v)>threshold)};
}
