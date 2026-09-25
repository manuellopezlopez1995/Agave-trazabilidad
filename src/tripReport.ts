import {weightSummary} from './weightSummary';

type Lot={id:string;trace_code:string;agave_count:number|null;average_brix:number|null;harvest_order_id:string};
type Harvest={id:string;trace_code:string;status:string;scheduled_date:string|null;started_at?:string|null;completed_at?:string|null;notes?:string|null;crew_id:string|null};
type Delivery={trace_code:string;status:string;recipient_company:string;accepted_weight_kg:number|null;rejected_weight_kg:number|null;received_by_name:string|null;received_at?:string|null;rejection_reason?:string|null};
type Note={created_at:string;field_name:string;corrected_value:string;reason:string;created_by:string};
export type TripReportData={folio:string;internalCode:string;status:string;buyer:string|null;driver:string|null;plate:string|null;departedAt:string|null;arrivedAt:string|null;deliveredAt:string|null;farm:{plantation_id:string|null;name:string;code:string;municipality?:string|null;state?:string|null}|undefined;crewNames:Record<string,string>;lots:Lot[];harvests:Harvest[];deliveries:Delivery[];corrections:Note[];approvedAt?:string|null;approvedBy?:string|null;generatedAt:string;photoCount:number};
const value=(v:unknown)=>v==null||v===''?'Pendiente':String(v);
const kg=(n:number|null)=>n==null?'Pendiente':`${n.toLocaleString('es-MX',{maximumFractionDigits:2})} kg`;
export function buildTripReportLines(data:TripReportData):string[]{
 const totals=weightSummary(data.lots,data.deliveries);
 const lines=[`AGAVE / TRAZA | FOLIO ${data.folio}`,'EXPEDIENTE DE TRAZABILIDAD POR VIAJE',`Generado: ${data.generatedAt}`,`Estado documental: ${data.approvedAt?'CONCILIADO':'BORRADOR / EN PROCESO'}`,'',
 'ORIGEN Y COSECHA',`ID de plantacion: ${value(data.farm?.plantation_id)}`,`Predio: ${value(data.farm?.name)} (${value(data.farm?.code)})`,`Municipio / estado: ${value(data.farm?.municipality)} / ${value(data.farm?.state)}`];
 for(const harvest of data.harvests)lines.push(`Jima: ${harvest.trace_code} | cuadrilla: ${value(harvest.crew_id&&data.crewNames[harvest.crew_id])}`,`Fecha programada: ${value(harvest.scheduled_date)} | inicio: ${value(harvest.started_at)} | cierre: ${value(harvest.completed_at)}`,`Estado: ${harvest.status} | notas: ${value(harvest.notes)}`);
 lines.push('','LOTES COSECHADOS VINCULADOS');
 for(const lot of data.lots)lines.push(`${lot.trace_code}: ${value(lot.agave_count)} agaves jimados; ${value(lot.average_brix)} grados Brix`);
 lines.push('','CAMION Y VIAJE',`Folio: ${data.folio} | referencia interna: ${data.internalCode}`,`Chofer: ${value(data.driver)} | placa: ${value(data.plate)}`,`Destino / comprador: ${value(data.buyer)} | estado: ${data.status}`,`Salida: ${value(data.departedAt)} | llegada: ${value(data.arrivedAt)} | entrega: ${value(data.deliveredAt)}`,'','RECEPCION');
 for(const d of data.deliveries)lines.push(`Entrega ${d.trace_code} | ${d.recipient_company} | ${d.status}`,`Recibe: ${value(d.received_by_name)} | fecha: ${value(d.received_at)}`,`Aceptado: ${kg(d.accepted_weight_kg)} | rechazado: ${kg(d.rejected_weight_kg)}`,`Motivo de rechazo: ${value(d.rejection_reason)}`);
 if(!data.deliveries.length)lines.push('Sin entrega registrada');
 lines.push('','RESUMEN DE TRAZABILIDAD',`Agaves jimados en lotes vinculados: ${value(totals.agaves)}`,`Peso total entregado (aceptado + rechazado): ${kg(totals.delivered)}`,`Promedio de kilos por agave (entregado / agaves jimados): ${totals.kgPerAgave==null?'Pendiente':`${totals.kgPerAgave.toLocaleString('es-MX',{maximumFractionDigits:2})} kg/agave`}`,`Peso aceptado en entregas: ${kg(totals.accepted)}`,`Peso rechazado: ${kg(totals.rejected)}`,`Diferencia aceptado - rechazado: ${kg(totals.acceptedMinusRejected)}`);
 lines.push('Nota: si un lote se reparte entre viajes, el conteo de agaves corresponde al lote completo y no identifica agaves exclusivos de este camion.');
 lines.push('','CORRECCIONES DOCUMENTADAS');
 if(data.corrections.length)for(const n of data.corrections)lines.push(`${n.created_at}: ${n.field_name} = ${n.corrected_value}; motivo: ${n.reason}; usuario: ${n.created_by}`);
 else lines.push('Sin correcciones documentadas');
 if(data.approvedAt)lines.push(`Aprobado: ${data.approvedAt}; usuario: ${value(data.approvedBy)}`);
 lines.push('',`Evidencias fotograficas adjuntas: ${data.photoCount}`,'Las siguientes paginas contienen fotos de jima, tickets y recibos con fecha, usuario y ubicacion disponibles.');
 return lines;
}
