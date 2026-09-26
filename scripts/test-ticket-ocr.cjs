const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const file=require('node:path').resolve(__dirname,'../src/ticketOcr.ts');
const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const loaded=new Module(file,module);loaded.filename=file;loaded.paths=module.paths;loaded._compile(js,file);
const {parseTicket,parseTicketPasses}=loaded.exports;
const tests=[
 ['Número antes de etiqueta, separadores sencillos','ID#: 2233\n35420 kg BRUTO\n12480 kg TARA\n22940 kg NETO',{folio:'2233',gross:35420,tare:12480,printedNet:22940,netKg:22940}],
 ['Otra báscula, etiqueta antes y separadores de miles','Folio: A-13\nPeso bruto: 45,430 kg\nTara: 15,000 kg\nPeso neto: 30,430 kg',{folio:'A-13',gross:45430,tare:15000,printedNet:30430,netKg:30430}],
 ['Otra sintaxis sin neto impreso','Ticket # B-002\nBRUTO: 37.500 kg\nTARA: 12.500 kg',{folio:'B-002',gross:37500,tare:12500,printedNet:undefined,netKg:25000}],
 ['OCR con basura al inicio de la línea','ID: 8812\nX. 35420 kg BRUTO E\nA. 12480 kg TARA\na 22940 kg NETO',{folio:'8812',gross:35420,tare:12480,printedNet:22940,netKg:22940}],
 ['Folio ausente no inventado','35420 kg BRUTO\n12480 kg TARA\n22940 kg NETO',{folio:undefined,gross:35420,tare:12480,printedNet:22940,netKg:22940}],
 ['Neto discrepante','ID 4781\n35,420 kg BRUTO\n12,480 kg TARA\n22,000 kg NETO',{folio:'4781',gross:35420,tare:12480,printedNet:22000,netKg:22940}],
 ['Bruto no supera tara','Folio: 4782\nBRUTO 10000 kg\nTARA 12000 kg',{folio:'4782',gross:10000,tare:12000,printedNet:undefined,netKg:-2000}],
];
for(const [name,text,expected] of tests){
 const reading=parseTicket(text,64);
 for(const [key,value] of Object.entries(expected))assert.equal(key==='netKg'?reading.netKg:reading.fields[key],value,name+' '+key);
 if(name==='Neto discrepante')assert.match(reading.warnings.join(' '),/no coincide/i);
 if(name==='Bruto no supera tara')assert.match(reading.warnings.join(' '),/debe superar/i);
 if(name==='Número antes de etiqueta, separadores sencillos')assert.equal(reading.warnings.length,0,'la baja confianza global no descarta valores consistentes');
}
const combined=parseTicketPasses([
 {text:'104: 2233\n35420 kg BRUTO\nA. 12480 kg TARA\na 22940 kg NETO',confidence:56},
 {text:'ID#: 2233\n35,420 kg BRUTO\n12,480 kg TARA\n22,940 kg NETO',confidence:72},
 {text:'ID#: 2233\n39,420 kg BRUTO\n12,480 kg TARA\n22,940 kg NETO',confidence:80},
]);
assert.deepEqual([combined.fields.folio,combined.fields.gross,combined.fields.tare,combined.netKg],['2233',35420,12480,22940]);
console.log('Ocho escenarios de OCR y consistencia matemática correctos.');
