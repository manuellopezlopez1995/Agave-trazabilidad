/** Nuevas entregas usan el neto del ticket DESTINATION; los cierres históricos conservan sus pesos de recepción. */
export function weightSummary(lots:{id:string;agave_count:number|null}[],deliveries:{trip_id?:string;status?:string;accepted_weight_kg:number|null;rejected_weight_kg:number|null}[],weighings:{trip_id:string;weighing_type:string;net_weight_kg:number}[]=[]){
 const agaves=lots.length&&lots.every(l=>Number.isInteger(l.agave_count)&&Number(l.agave_count)>0)
  ?lots.reduce((sum,l)=>sum+Number(l.agave_count),0):null;
 const complete=deliveries.length>0&&deliveries.every(d=>d.accepted_weight_kg!=null&&d.rejected_weight_kg!=null);
 const accepted=complete?deliveries.reduce((sum,d)=>sum+Number(d.accepted_weight_kg),0):null;
 const rejected=complete?deliveries.reduce((sum,d)=>sum+Number(d.rejected_weight_kg),0):null;
 const delivered=deliveries.length&&deliveries.every(d=>d.status==='COMPLETED'||d.status==null)&&deliveries.every(d=>d.accepted_weight_kg!=null&&d.rejected_weight_kg!=null||weighings.some(w=>w.trip_id===d.trip_id&&w.weighing_type==='DESTINATION'&&w.net_weight_kg>0))
  ?deliveries.reduce((sum,d)=>sum+(d.accepted_weight_kg!=null&&d.rejected_weight_kg!=null?Number(d.accepted_weight_kg)+Number(d.rejected_weight_kg):Number(weighings.find(w=>w.trip_id===d.trip_id&&w.weighing_type==='DESTINATION')!.net_weight_kg)),0):null;
 return {agaves,accepted,rejected,delivered,kgPerAgave:delivered!=null&&agaves?delivered/agaves:null,acceptedMinusRejected:accepted!=null&&rejected!=null?accepted-rejected:null};
}
