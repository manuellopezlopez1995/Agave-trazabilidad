// El expediente se construye en el dispositivo del administrador: las fotos privadas
// se descargan con su sesión y nunca se publican como enlaces permanentes.
export type DossierImage={kind:string;label:string;mime:string;base64:string;fileName:string};
export type DossierData={harvest:any;farm:any;crew:any;lots:any[];trips:any[];links:any[];weighings:any[];deliveries:any[];drivers:any[];images:DossierImage[];generatedAt:string;organizationId:string};
const esc=(value:unknown)=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const kg=(n:unknown)=>n==null?'—':`${Number(n).toLocaleString('es-MX',{maximumFractionDigits:2})} kg`;
const date=(value:unknown)=>value?new Date(String(value)).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}):'—';
const row=(label:string,value:unknown)=>`<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
export function dossierGaps(data:DossierData){
 const gaps:string[]=[];
 if(data.harvest.status!=='HARVESTED')gaps.push('La jima aún no está cosechada/cerrada.');
 if(!data.lots.length)gaps.push('No hay lotes registrados.');
 if(!data.images.some(i=>i.kind==='harvest'))gaps.push('Falta evidencia fotográfica de la jima.');
 for(const lot of data.lots){
  const trips=data.trips.filter(t=>data.links.some(x=>x.agave_lot_id===lot.id&&x.trip_id===t.id));
  if(!trips.length)gaps.push(`El lote ${lot.trace_code} aún no tiene viaje.`);
  for(const trip of trips){
   const ws=data.weighings.filter(w=>w.trip_id===trip.id),ds=data.deliveries.filter(d=>d.trip_id===trip.id);
   if(!ws.some(w=>w.weighing_type==='ORIGIN'))gaps.push(`Falta pesaje de origen en ${trip.trace_code}.`);
   if(!ws.some(w=>w.weighing_type==='DESTINATION'))gaps.push(`Falta pesaje de destino en ${trip.trace_code}.`);
   if(ws.some(w=>!w.ticket_storage_path))gaps.push(`Hay un pesaje sin fotografía del ticket en ${trip.trace_code}.`);
   if(!ds.length||ds.some(d=>d.status!=='COMPLETED'))gaps.push(`Falta cerrar la entrega de ${trip.trace_code}.`);
   for(const d of ds)if(!data.images.some(i=>i.kind==='delivery'&&i.label.includes(d.trace_code)))gaps.push(`Falta foto del recibo de ${d.trace_code}.`);
  }
 }
 return [...new Set(gaps)];
}
export function buildDossier(data:DossierData){
 const gaps=dossierGaps(data),complete=!gaps.length;
 const buyerNames=[...new Set(data.deliveries.map(d=>d.recipient_company).filter(Boolean))];
 const buyer=buyerNames.length?buyerNames.join(', '):data.trips.map(t=>t.destination_name).filter(Boolean).join(', ')||'Sin destinatario registrado';
 const totalHarvest=data.lots.reduce((a,l)=>a+Number(l.actual_weight_kg||0),0);
 const totalAccepted=data.deliveries.reduce((a,d)=>a+Number(d.accepted_weight_kg||0),0);
 const totalRejected=data.deliveries.reduce((a,d)=>a+Number(d.rejected_weight_kg||0),0);
 const photo=(img:DossierImage)=>`<figure><img src="data:${esc(img.mime)};base64,${img.base64}" alt="${esc(img.label)}"><figcaption>${esc(img.label)} · ${esc(img.fileName)}</figcaption></figure>`;
 const trips=data.trips.map(t=>{
  const ls=data.links.filter(link=>link.trip_id===t.id).map(link=>data.lots.find(l=>l.id===link.agave_lot_id)).filter(Boolean);
  const ws=data.weighings.filter(w=>w.trip_id===t.id),ds=data.deliveries.filter(d=>d.trip_id===t.id);
  const origin=ws.find(w=>w.weighing_type==='ORIGIN'),destination=ws.find(w=>w.weighing_type==='DESTINATION');
  const driver=data.drivers.find(p=>p.id===t.driver_id);
  const delta=origin&&destination?Number(origin.net_weight_kg)-Number(destination.net_weight_kg):null;
  return `<section class="trip"><h2>Camión / viaje ${esc(t.trace_code)}</h2><table>${row('Estado',t.status)}${row('Destino',t.destination_name)}${row('Chofer',driver?.full_name??'Sin identificar')}${row('Salida',date(t.departed_at))}${row('Llegada',date(t.arrived_at))}${row('Lotes vinculados',ls.map(l=>l.trace_code).join(', ')||'Sin lote')}${row('Peso de lotes cargados',kg(ls.reduce((a,l)=>a+Number(l.actual_weight_kg||0),0)))}</table>
  <h3>Pesajes y conciliación</h3><table><thead><tr><th>Punto</th><th>Bruto</th><th>Tara</th><th>Neto</th><th>Folio</th></tr></thead><tbody>${ws.map(w=>`<tr><td>${esc(w.weighing_type)}</td><td>${esc(kg(w.gross_weight_kg))}</td><td>${esc(kg(w.tare_weight_kg))}</td><td>${esc(kg(w.net_weight_kg))}</td><td>${esc(w.ticket_number)}</td></tr>`).join('')||'<tr><td colspan="5">Sin pesajes</td></tr>'}</tbody></table><p><strong>Diferencia origen − destino:</strong> ${kg(delta)}</p>
  <h3>Recepción</h3>${ds.map(d=>`<table>${row('Entrega',d.trace_code)}${row('Comprador / receptor',d.recipient_company)}${row('Estado',d.status)}${row('Recibido por',d.received_by_name)}${row('Fecha de recepción',date(d.received_at))}${row('Aceptado',kg(d.accepted_weight_kg))}${row('Rechazado',kg(d.rejected_weight_kg))}${row('Motivo de rechazo',d.rejection_reason)}</table>`).join('')||'<p>No se registró entrega.</p>'}
  <h3>Tickets y recibos</h3><div class="photos">${data.images.filter(i=>(i.kind==='ticket'&&ws.some(w=>w.id===i.label))||(i.kind==='delivery'&&ds.some(d=>i.label.includes(d.trace_code)))).map(photo).join('')||'<p>Sin fotografías vinculadas.</p>'}</div></section>`;
 }).join('');
 const relevantTrips=new Set(data.trips.map(t=>t.id));
 const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expediente ${esc(data.harvest.trace_code)}</title><style>body{font:15px/1.5 system-ui,-apple-system,sans-serif;color:#193b30;background:#f7f4eb;margin:0}main{max-width:960px;margin:auto;background:#fffdf7;padding:40px}header{background:#184535;color:#fff;padding:30px;border-radius:18px}h1{font-size:32px;margin:8px 0}h2{border-bottom:2px solid #d2bd98;padding-bottom:8px;margin-top:36px}h3{margin-top:24px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{width:35%;color:#435b4f}thead th{width:auto;background:#edf1e7}.notice{padding:14px;border-radius:9px;background:${complete?'#dff1df':'#fff0d7'};margin:20px 0}.trip{break-before:page}.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}figure{margin:0;break-inside:avoid}figure img{max-width:100%;max-height:380px;object-fit:contain}figcaption{font-size:12px;overflow-wrap:anywhere}footer{border-top:1px solid #ddd;margin-top:35px;padding-top:15px;font-size:12px;color:#526356}@media print{body{background:white}main{padding:0}.trip{break-before:page}}</style></head><body><main><header><small>AGAVE / TRAZA · EXPEDIENTE DE TRAZABILIDAD</small><h1>Jima ${esc(data.harvest.trace_code)}</h1><div>Destino declarado: ${esc(buyer)}</div></header><div class="notice"><strong>${complete?'EXPEDIENTE OPERATIVO COMPLETO':'BORRADOR · FALTAN DATOS O EVIDENCIAS'}</strong>${gaps.length?`<ul>${gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul>`:''}<p>El estado refleja los registros disponibles al momento de la descarga; no constituye confirmación de aceptación por el comprador.</p></div>
 <h2>Origen y cosecha</h2><table>${row('Predio',data.farm?.name)}${row('Código predial',data.farm?.code)}${row('Municipio / estado',[data.farm?.municipality,data.farm?.state].filter(Boolean).join(', '))}${row('Cuadrilla',data.crew?.name)}${row('Fecha programada',data.harvest.scheduled_date)}${row('Inicio',date(data.harvest.started_at))}${row('Cierre',date(data.harvest.completed_at))}${row('Estado de jima',data.harvest.status)}${row('Notas',data.harvest.notes)}${row('Organización (ID)',data.organizationId)}</table>
 <h3>Lotes cosechados</h3><table><thead><tr><th>Lote</th><th>Agaves</th><th>°Brix</th><th>Peso campo</th><th>Viaje(s)</th></tr></thead><tbody>${data.lots.map(l=>`<tr><td>${esc(l.trace_code)}</td><td>${esc(l.agave_count)}</td><td>${esc(l.average_brix)}</td><td>${esc(kg(l.actual_weight_kg))}</td><td>${esc(data.links.filter(x=>x.agave_lot_id===l.id&&relevantTrips.has(x.trip_id)).map(x=>data.trips.find(t=>t.id===x.trip_id)?.trace_code).filter(Boolean).join(', ')||'Pendiente')}</td></tr>`).join('')}</tbody></table>
 <div class="photos">${data.images.filter(i=>i.kind==='harvest').map(photo).join('')}</div>${trips}<h2>Resumen de conciliación</h2><table>${row('Lotes',data.lots.length)}${row('Camiones / viajes',data.trips.length)}${row('Peso registrado en campo',kg(totalHarvest))}${row('Peso aceptado en entregas',kg(totalAccepted))}${row('Peso rechazado',kg(totalRejected))}${row('Diferencia campo − aceptado − rechazado',kg(totalHarvest-totalAccepted-totalRejected))}</table><footer>Generado: ${esc(date(data.generatedAt))} · Identificador de jima: ${esc(data.harvest.id)} · Documento de control interno. Verifique los datos y anexos antes de compartirlo con ${esc(buyer)}. Las imágenes están incrustadas en este archivo y contienen información privada de la operación.</footer></main></body></html>`;
 return {html,gaps,complete};
}
