/** Los kilos entregados incluyen lo aceptado y lo rechazado en recepción. */
export function weightSummary(lots:{id:string;agave_count:number|null}[],deliveries:{accepted_weight_kg:number|null;rejected_weight_kg:number|null}[]){
 const agaves=lots.length&&lots.every(l=>Number.isInteger(l.agave_count)&&Number(l.agave_count)>0)
  ?lots.reduce((sum,l)=>sum+Number(l.agave_count),0):null;
 const complete=deliveries.length>0&&deliveries.every(d=>d.accepted_weight_kg!=null&&d.rejected_weight_kg!=null);
 const accepted=complete?deliveries.reduce((sum,d)=>sum+Number(d.accepted_weight_kg),0):null;
 const rejected=complete?deliveries.reduce((sum,d)=>sum+Number(d.rejected_weight_kg),0):null;
 const delivered=accepted!=null&&rejected!=null?accepted+rejected:null;
 return {agaves,accepted,rejected,delivered,kgPerAgave:delivered!=null&&agaves?delivered/agaves:null,acceptedMinusRejected:accepted!=null&&rejected!=null?accepted-rejected:null};
}
