const assert=require('node:assert/strict');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>{
 const source=require('node:fs').readFileSync(filename,'utf8');
 module._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
};
const {buildDossier}=require('./dossier.ts');
const uuid='30f45665-f2be-4192-a3bf-5d0dac825b08';
const trip={id:uuid,trace_code:'AGV-2026-000053',plantation_folio:'345678-1',driver_id:uuid,status:'DELIVERED',destination_name:'Diageo',vehicle_plate:'TET-001'};
const data={harvest:{id:uuid,trace_code:'AGV-2026-000048',status:'HARVESTED'},farm:{name:'Predio de prueba',plantation_id:'345678',code:'PRED-000001'},crew:{name:'Cuadrilla de Prueba'},lots:[{id:uuid,trace_code:'AGV-2026-000052',agave_count:830,average_brix:36,actual_weight_kg:20430}],trips:[trip],links:[{trip_id:uuid,agave_lot_id:uuid,loaded_weight_kg:20430}],weighings:[{id:'origin',trip_id:uuid,weighing_type:'ORIGIN',gross_weight_kg:45430,tare_weight_kg:15000,net_weight_kg:30430,ticket_number:'1234',ticket_storage_path:`private/${uuid}.jpg`,legibility_confirmed:true},{id:'destination',trip_id:uuid,weighing_type:'DESTINATION',gross_weight_kg:45400,tare_weight_kg:15000,net_weight_kg:30400,ticket_number:'2345',ticket_storage_path:`private/${uuid}.jpg`,legibility_confirmed:true}],deliveries:[{trip_id:uuid,trace_code:'ENT-2026-000048',recipient_company:'Diageo',status:'COMPLETED',received_at:'2026-09-26T00:00:00Z',accepted_weight_kg:null,rejected_weight_kg:null}],drivers:[{id:uuid,full_name:'Chofer Prueba'}],images:[{kind:'harvest',label:uuid,fileName:`${uuid}.jpg`,mime:'image/jpeg',base64:'aGVsbG8=',uploadedBy:uuid},{kind:'ticket',label:'origin',fileName:`${uuid}.jpg`,mime:'image/jpeg',base64:'aGVsbG8=',uploadedBy:uuid},{kind:'ticket',label:'destination',fileName:`${uuid}.jpg`,mime:'image/jpeg',base64:'aGVsbG8=',uploadedBy:uuid}],organizationName:'Agave Trazabilidad',buyerName:'Diageo',generatedAt:'2026-09-26T00:00:00Z',varianceLimitKg:10,varianceLimitPercent:2,varianceNotes:[{trip_id:uuid,reason:'el jefe de cuadrilla se confundió con los lotes cargados'}]};
const {html,gaps,complete}=buildDossier(data);
assert.equal(complete,true,JSON.stringify(gaps));
assert.doesNotMatch(html,new RegExp(uuid,'i'));
assert.doesNotMatch(html,/\.jpg<\/figcaption>|Usuario:|Organización \(ID\)/);
for(const expected of ['Agave Trazabilidad','345678-1','AGV-2026-000052','30,400 kg','Ticket de báscula de destino / Evidencia de entrega','Entrega acreditada con ticket de destino'])assert.ok(html.includes(expected),expected);
assert.doesNotMatch(html,/Los agaves provienen de los lotes vinculados|el conteo del lote no representa agaves exclusivos/i);
for(const hidden of ['20,430 kg','30,430 kg','Ticket de báscula – ORIGIN','1234'])assert.ok(!html.includes(hidden),hidden);
assert.equal((html.match(/<figure>/g)||[]).length,2);
const missing=buildDossier({...data,links:[{trip_id:uuid,agave_lot_id:uuid,loaded_weight_kg:null}]});
assert.ok(!missing.html.includes('Ticket de báscula – ORIGIN'));
assert.ok(!missing.html.includes('Diferencia fuera de tolerancia:'));
console.log('Expediente: cifras, pruebas de privacidad, fotos y valores ausentes correctos');

for(const notes of [data.varianceNotes,[]]){
 const output=buildDossier({...data,varianceNotes:notes}).html;
 assert.doesNotMatch(output,/ORIGIN|conciliaci[oó]n|JUSTIFICADA|justifica|confundió/i);
}
const {buildTripReportLines}=require('./tripReport.ts');
const internal=buildTripReportLines({folio:'test',internalCode:'internal',status:'DELIVERED',buyer:'buyer',driver:'driver',plate:'plate',departedAt:null,arrivedAt:null,deliveredAt:null,crewNames:{},lots:[],harvests:[],deliveries:[],weighings:[{weighing_type:'ORIGIN',net_weight_kg:22640,gross_weight_kg:35520,tare_weight_kg:12880,ticket_number:'2231'},{weighing_type:'DESTINATION',net_weight_kg:26580,gross_weight_kg:41260,tare_weight_kg:14680,ticket_number:'7781'}],corrections:[],generatedAt:'test',photoCount:0,varianceNotes:[{reason:'Texto exacto: prueba & <sin cambiar>',created_at:'2026-09-28T05:43:00Z',created_by:'author-id',author_name:'Autor de prueba'}]}).join('\n');
for(const text of ['-3,940 kg','Texto exacto: prueba & <sin cambiar>','Autor de prueba','27/9/2026','America/Mexico_City'])assert.ok(internal.includes(text),text);
console.log('Conciliacion exclusivamente interna: pruebas correctas');
