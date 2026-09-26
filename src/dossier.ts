import {variance,recordedFieldWeight} from './operations';
import {weightSummary} from './weightSummary';

// Los identificadores técnicos sólo se utilizan para enlazar los datos y nunca se imprimen.
export type DossierImage={kind:string;label:string;mime:string;base64:string;fileName:string;capturedAt?:string|null;uploadedBy?:string|null;latitude?:number|null;longitude?:number|null;legibilityConfirmed?:boolean};
export type DossierData={harvest:any;farm:any;crew:any;lots:any[];trips:any[];links:any[];weighings:any[];deliveries:any[];drivers:any[];images:DossierImage[];generatedAt:string;organizationName:string;buyerName:string;varianceLimitKg?:number;varianceLimitPercent?:number;varianceNotes?:any[];corrections?:any[]};
const esc=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const kg=(n:unknown)=>n==null?'No registrado':`${Number(n).toLocaleString('es-MX',{maximumFractionDigits:2})} kg`;
const date=(v:unknown)=>v?new Date(String(v)).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}):'No registrada';
const day=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00Z`).toLocaleDateString('es-MX',{dateStyle:'long',timeZone:'UTC'}):'No registrada';
const row=(label:string,value:unknown)=>`<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
const photo=(i:DossierImage,title:string,details:string[]=[])=>`<figure><img src="data:${esc(i.mime)};base64,${i.base64}" alt="${esc(title)}"><figcaption><strong>${esc(title)}</strong><span>Fecha y hora: ${esc(date(i.capturedAt))}</span>${details.map(d=>`<span>${esc(d)}</span>`).join('')}${i.latitude!=null&&i.longitude!=null?`<span>Ubicación GPS: ${esc(i.latitude)}, ${esc(i.longitude)}</span>`:''}</figcaption></figure>`;

export function dossierGaps(data:DossierData){
 const gaps:string[]=[];
 if(!['HARVESTED','COMPLETED'].includes(data.harvest.status))gaps.push('La jima aún no está cosechada/cerrada.');
 if(!data.lots.length)gaps.push('No hay lotes registrados.');
 if(!data.images.some(i=>i.kind==='harvest'))gaps.push('Falta evidencia fotográfica de la jima.');
 for(const lot of data.lots){
  const trips=data.trips.filter(t=>data.links.some(x=>x.agave_lot_id===lot.id&&x.trip_id===t.id));
  if(!trips.length)gaps.push(`El lote ${lot.trace_code} aún no tiene viaje.`);
  for(const trip of trips){
   const ws=data.weighings.filter(w=>w.trip_id===trip.id),ds=data.deliveries.filter(d=>d.trip_id===trip.id);
   if(!ws.some(w=>w.weighing_type==='ORIGIN'))gaps.push(`Falta pesaje de origen en ${trip.trace_code}.`);
   if(!ws.some(w=>w.weighing_type==='DESTINATION'))gaps.push(`Falta pesaje de destino en ${trip.trace_code}.`);
   if(ws.some(w=>!w.ticket_storage_path||!w.legibility_confirmed))gaps.push(`Hay un ticket sin fotografía legible confirmada en ${trip.trace_code}.`);
   if(!ds.length||ds.some(d=>d.status!=='COMPLETED'))gaps.push(`Falta cerrar la entrega de ${trip.trace_code}.`);
   const loaded=recordedFieldWeight(data.links.filter(x=>x.trip_id===trip.id));
   const o=ws.find(w=>w.weighing_type==='ORIGIN'),dest=ws.find(w=>w.weighing_type==='DESTINATION');
   const v=variance(loaded,o?.net_weight_kg??null,dest?.net_weight_kg??null,null,null,data.varianceLimitKg,data.varianceLimitPercent);
   if(v.exceeded&&!data.varianceNotes?.some(n=>n.trip_id===trip.id&&n.reason?.trim().length>=10))gaps.push(`${v.exceededStages.map(stage=>stage.label).join(', ')} en ${trip.trace_code} supera la tolerancia y no tiene explicación registrada.`);
  }
 }
 return [...new Set(gaps)];
}

export function buildDossier(data:DossierData){
 const gaps=dossierGaps(data),complete=!gaps.length;
 const totals=weightSummary(data.lots,data.deliveries,data.weighings);
 const destinationTotal=data.deliveries.length&&data.deliveries.every(d=>d.status==='COMPLETED')&&data.deliveries.every(d=>data.weighings.some(w=>w.trip_id===d.trip_id&&w.weighing_type==='DESTINATION'&&Number(w.net_weight_kg)>0))
  ?data.deliveries.reduce((sum,d)=>sum+Number(data.weighings.find(w=>w.trip_id===d.trip_id&&w.weighing_type==='DESTINATION')!.net_weight_kg),0):null;
 const harvestImages=data.images.filter(i=>i.kind==='harvest');
 const trips=data.trips.map(t=>{
  const ls=data.links.filter(x=>x.trip_id===t.id).map(x=>data.lots.find(l=>l.id===x.agave_lot_id)).filter(Boolean);
  const ws=data.weighings.filter(w=>w.trip_id===t.id),ds=data.deliveries.filter(d=>d.trip_id===t.id);
  const origin=ws.find(w=>w.weighing_type==='ORIGIN'),destination=ws.find(w=>w.weighing_type==='DESTINATION');
  const loaded=recordedFieldWeight(data.links.filter(x=>x.trip_id===t.id));
  const diff=variance(loaded,origin?.net_weight_kg??null,destination?.net_weight_kg??null,null,null,data.varianceLimitKg,data.varianceLimitPercent);
  const notes=data.varianceNotes?.filter(n=>n.trip_id===t.id&&n.reason?.trim())??[];
  const percent=origin?.net_weight_kg&&destination?.net_weight_kg!=null?100*Math.abs(Number(origin.net_weight_kg)-Number(destination.net_weight_kg))/Number(origin.net_weight_kg):null;
  const driver=data.drivers.find(p=>p.id===t.driver_id);
  const ticket=(w:any,type:'ORIGIN'|'DESTINATION')=>w?`<article><h3>Ticket de báscula – ${type}</h3><table>${row('Folio',w.ticket_number)}${row('Fecha y hora',date(w.captured_at))}${row('Peso bruto',kg(w.gross_weight_kg))}${row('Tara',kg(w.tare_weight_kg))}${row('Peso neto',kg(w.net_weight_kg))}</table>${data.images.filter(i=>i.kind==='ticket'&&i.label===w.id).map(i=>photo(i,`Ticket de báscula – ${type}`,[`Folio: ${w.ticket_number??'No registrado'}`,`Peso bruto: ${kg(w.gross_weight_kg)}`,`Tara: ${kg(w.tare_weight_kg)}`,`Peso neto: ${kg(w.net_weight_kg)}`])).join('')||'<p>Fotografía no disponible.</p>'}</article>`:`<p>Pesaje ${type} no registrado.</p>`;
  const corrections=data.corrections?.filter(n=>n.trip_id===t.id)??[];
  return `<section class="trip"><h2>Transporte · viaje ${esc(t.plantation_folio??t.trace_code)}</h2><table>${row('Referencia de viaje',t.trace_code)}${row('Estado',t.status)}${row('Destino',t.destination_name)}${row('Chofer',driver?.full_name??'Sin identificar')}${row('Placa',t.vehicle_plate)}${row('Salida',date(t.departed_at))}${row('Llegada',date(t.arrived_at))}${row('Lotes vinculados',ls.map(l=>l.trace_code).join(', ')||'Sin lote')}</table>
  <h2>Pesajes</h2><div class="ticket-grid">${ticket(origin,'ORIGIN')}${ticket(destination,'DESTINATION')}</div>
  <h2>Conciliación de pesos</h2><table>${row('Peso registrado en lotes cargados',kg(loaded))}${row('Peso neto ORIGIN',kg(origin?.net_weight_kg))}${row('Diferencia lotes → ORIGIN',diff.originDifference==null?'No calculable':kg(Math.abs(diff.originDifference)))}${row('Peso neto DESTINATION',kg(destination?.net_weight_kg))}${row('Diferencia ORIGIN → DESTINATION',diff.transitDifference==null?'No calculable':kg(Math.abs(diff.transitDifference)))}${row('Porcentaje ORIGIN → DESTINATION',percent==null?'No calculable':`${percent.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})} %`)}</table>
  ${diff.exceeded?`<div class="variance"><strong>Diferencia fuera de tolerancia: ${notes.some(n=>n.reason.trim().length>=10)?'JUSTIFICADA':'PENDIENTE DE JUSTIFICAR'}</strong><p>${esc(diff.exceededStages.map(s=>s.label).join(' y '))} supera el umbral de ${esc(kg(diff.threshold))}.</p>${notes.map(n=>`<p>Explicación registrada: ${esc(n.reason)}</p>`).join('')}</div>`:''}
  <h2>Entrega</h2><p class="delivery">Entrega acreditada con ticket de destino</p>${ds.map(d=>`<table>${row('Referencia de entrega',d.trace_code)}${row('Comprador / destino',d.recipient_company)}${row('Estado',d.status)}${row('Fecha de cierre',date(d.received_at))}${row('Peso neto DESTINATION',kg(destination?.net_weight_kg))}</table>`).join('')||'<p>Entrega no registrada.</p>'}
  ${corrections.length?`<h3>Correcciones documentadas</h3>${corrections.map(n=>`<p>${esc(date(n.created_at))} · ${esc(n.field_name)}: ${esc(n.corrected_value)} · Motivo: ${esc(n.reason)}</p>`).join('')}<p>Los valores originales permanecen en el historial del sistema.</p>`:''}</section>`;
 }).join('');
 const linked=new Set(data.trips.map(t=>t.id));
 const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expediente ${esc(data.harvest.trace_code)} · ${esc(data.buyerName)}</title><style>*{box-sizing:border-box}body{font:15px/1.5 system-ui,-apple-system,sans-serif;color:#203b30;background:#f3f4ee;margin:0}main{max-width:920px;margin:auto;background:#fff;padding:42px 48px;box-shadow:0 4px 25px #183e2920}header{background:#164d39;color:white;padding:34px 38px;border-radius:12px}header small{letter-spacing:.18em;font-weight:700}h1{font-size:30px;margin:10px 0}header p{margin:0;color:#e1ecdf}h2{color:#164d39;font-size:21px;border-bottom:2px solid #d8e4d5;padding-bottom:7px;margin:35px 0 15px}h3{font-size:16px;color:#164d39;margin:18px 0 8px}table{border-collapse:collapse;width:100%;margin:12px 0 20px}th,td{border-bottom:1px solid #e5ebe3;padding:9px 11px;text-align:left;vertical-align:top}th{width:38%;color:#4c6255;font-weight:600}thead th{width:auto;background:#eaf2e9}.notice,.variance{padding:14px 18px;border-radius:8px;margin:22px 0;background:${complete?'#e7f3e5':'#fff0db'}}.variance{background:#fff3db;border-left:4px solid #b47725}.variance p{margin:7px 0 0}.trip{break-before:page}.photos,.ticket-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}figure{margin:12px 0 24px;padding:12px;border:1px solid #e1e9df;border-radius:9px;break-inside:avoid}figure img{display:block;max-width:100%;max-height:440px;object-fit:contain;margin:auto}figcaption{font-size:12px;margin-top:10px;overflow-wrap:anywhere;color:#45594c}figcaption span,figcaption strong{display:block}.delivery{font-weight:700;color:#164d39}footer{border-top:1px solid #ddd;margin-top:38px;padding-top:16px;font-size:12px;color:#53665a}@media print{@page{size:A4;margin:16mm}body{background:white}main{padding:0;box-shadow:none}.trip{break-before:page}header{print-color-adjust:exact;-webkit-print-color-adjust:exact}.ticket-grid{display:block}}</style></head><body><main><header><small>AGAVE / TRAZA · TRAZABILIDAD AGRÍCOLA</small><h1>Expediente de jima ${esc(data.harvest.trace_code)}</h1><p>Proveedor: ${esc(data.organizationName)} · Comprador: ${esc(data.buyerName)}</p></header><div class="notice"><strong>${complete?'EXPEDIENTE OPERATIVO COMPLETO':'BORRADOR · FALTAN DATOS O EVIDENCIAS'}</strong>${gaps.length?`<ul>${gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul>`:''}<p>Información disponible a la fecha de generación. El ticket de destino acredita la entrega, sin implicar aceptación comercial adicional.</p></div>
 <h2>Origen y cosecha</h2><table>${row('Proveedor / organización',data.organizationName)}${row('Predio',data.farm?.name)}${row('Código predial',data.farm?.code)}${row('ID de plantación',data.farm?.plantation_id)}${row('Municipio / estado',[data.farm?.municipality,data.farm?.state].filter(Boolean).join(', '))}${row('Cuadrilla',data.crew?.name)}${row('Fecha programada',day(data.harvest.scheduled_date))}${row('Inicio',date(data.harvest.started_at))}${row('Finalización',date(data.harvest.completed_at))}${row('Estado de jima',data.harvest.status)}</table>
 <h2>Lotes</h2><table><thead><tr><th>Lote</th><th>Agaves</th><th>°Brix</th><th>Peso registrado</th><th>Viaje(s)</th></tr></thead><tbody>${data.lots.map(l=>`<tr><td>${esc(l.trace_code)}</td><td>${esc(l.agave_count)}</td><td>${esc(l.average_brix)} °Brix</td><td>${esc(kg(l.actual_weight_kg))}</td><td>${esc(data.links.filter(x=>x.agave_lot_id===l.id&&linked.has(x.trip_id)).map(x=>data.trips.find(t=>t.id===x.trip_id)?.plantation_folio??data.trips.find(t=>t.id===x.trip_id)?.trace_code).filter(Boolean).join(', ')||'Pendiente')}</td></tr>`).join('')}</tbody></table>
 <h2>Evidencias de jima</h2><div class="photos">${harvestImages.map((i,index)=>photo(i,`Evidencia de jima${harvestImages.length>1?` ${index+1}`:''}`)).join('')||'<p>Sin fotografías de jima disponibles.</p>'}</div>${trips}<h2>Resumen de trazabilidad</h2><table>${row('Lotes vinculados (registros del viaje)',data.lots.length)}${row('Camiones / viajes vinculados',data.trips.length)}${row('Agaves jimados (conteo de lotes vinculados)',totals.agaves??'No registrado')}${row('Peso total entregado (tickets DESTINATION)',kg(destinationTotal))}${row('Promedio (kg entregados ÷ agaves jimados)',destinationTotal==null||!totals.agaves?'No calculable':`${(destinationTotal/totals.agaves).toLocaleString('es-MX',{maximumFractionDigits:2})} kg/agave`)}</table><p>Los agaves provienen de los lotes vinculados; el peso entregado proviene del neto del ticket de destino de cada viaje completado. Si un lote se reparte entre compradores o viajes, el conteo del lote no representa agaves exclusivos de este comprador.</p><footer>Generado: ${esc(date(data.generatedAt))} · Jima ${esc(data.harvest.trace_code)} · ${esc(data.organizationName)}. Revise datos y anexos antes de entregar este documento a ${esc(data.buyerName)}. Las imágenes están incrustadas y son información privada de la operación.</footer></main></body></html>`;
 return {html,gaps,complete};
}
