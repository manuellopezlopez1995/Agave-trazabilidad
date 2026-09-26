const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const file=require('node:path').resolve(__dirname,'../src/ticketOcr.ts');
const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const loaded=new Module(file,module);loaded.filename=file;loaded.paths=module.paths;loaded._compile(js,file);
const {parseTicket,parseTicketPasses}=loaded.exports;
const tests=[
 ['Número antes de etiqueta, separadores sencillos','ID#: 8716\n36750 kg BRUTO\n13400 kg TARA\n23350 kg NETO',{folio:'8716',gross:36750,tare:13400,printedNet:23350,netKg:23350}],
 ['Otra báscula, etiqueta antes y separadores de miles','Folio: A-13\nPeso bruto: 45,430 kg\nTara: 15,000 kg\nPeso neto: 30,430 kg',{folio:'A-13',gross:45430,tare:15000,printedNet:30430,netKg:30430}],
 ['Otra sintaxis sin neto impreso','Ticket # B-002\nBRUTO: 37.500 kg\nTARA: 12.500 kg',{folio:'B-002',gross:37500,tare:12500,printedNet:undefined,netKg:25000}],
 ['OCR con basura al inicio de la línea','IDR: 8812\nX. 36750 kg BRUT0 E\nA. 13400 kq TARA\na 23350 kg NET0',{folio:'8812',gross:36750,tare:13400,printedNet:23350,netKg:23350}],
 ['Folio ausente no inventado','36750 kg BRUTO\n13400 kg TARA\n23350 kg NETO',{folio:undefined,gross:36750,tare:13400,printedNet:23350,netKg:23350}],
 ['Neto discrepante','ID 4781\n36,750 kg BRUTO\n13,400 kg TARA\n22,000 kg NETO',{folio:'4781',gross:undefined,tare:13400,printedNet:22000,netKg:undefined}],
 ['Bruto no supera tara','Folio: 4782\nBRUTO 10000 kg\nTARA 12000 kg',{folio:'4782',gross:10000,tare:12000,printedNet:undefined,netKg:-2000}],
];
for(const [name,text,expected] of tests){
 const reading=parseTicket(text,64);
 for(const [key,value] of Object.entries(expected))assert.equal(key==='netKg'?reading.netKg:reading.fields[key],value,name+' '+key);
 if(name==='Neto discrepante')assert.match(reading.warnings.join(' '),/peso bruto/i);
 if(name==='Bruto no supera tara')assert.match(reading.warnings.join(' '),/debe superar/i);
 if(name==='Número antes de etiqueta, separadores sencillos')assert.equal(reading.warnings.length,0,'la baja confianza global no descarta valores consistentes');
}
const combined=parseTicketPasses([
 {text:'10R: 8716\n36750 kg BRUTO\nA. 13400 kg TARA\na 23350 kg NETO',confidence:56},
 {text:'ID#: 8716\n36,750 kg BRUTO\n13,400 kg TARA\n23,350 kg NETO',confidence:72},
 {text:'ID#: 8716\n39,750 kg BRUTO\n13,400 kg TARA\n23,350 kg NETO',confidence:80},
]);
assert.deepEqual([combined.fields.folio,combined.fields.gross,combined.fields.tare,combined.netKg],['8716',36750,13400,23350]);
const mixed=parseTicketPasses([
 {text:'1D: 6674\nNO. 6674\n36750 kg BRUTO\n13400 kg TARA\n23350 kg NETO',confidence:67},
 {text:'FOLIO: 6674\n63750 kg BRUTO\n13400 kg TARA\n23350 kg NETO',confidence:78},
 {text:'No. 6674\n63750 kg BRUTO\n13400 kg TARA\n23350 kg NETO',confidence:79},
]);
assert.deepEqual([mixed.fields.folio,mixed.fields.gross,mixed.netKg],['6674',36750,23350],'la consistencia matemática prevalece sobre las pasadas repetidas');
const noEvidence=parseTicketPasses([{text:'N° 6674\n63750 kg BRUTO\n13400 kg TARA\n23350 kg NETO',confidence:81}]);
assert.equal(noEvidence.fields.gross,undefined,'no se inventa el bruto aunque tara y neto permitan calcularlo');
const screenWithTicket=parseTicket('10:12\n| IDR: 8716\n| 10:27 AM 25/09/26\n| 36750 kg BRUTO\nE 13400 kg TARA\n— 23350 kg NETO',72);
assert.equal(screenWithTicket.fields.time,'10:27','la hora del ticket prevalece sobre la barra del teléfono');
assert.equal(screenWithTicket.fields.folio,'8716');
assert.equal(screenWithTicket.netKg,23350);
console.log('Nueve escenarios de OCR y consistencia matemática correctos.');
