const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/ticketOcr.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleShim={exports:{}};
vm.runInNewContext(code,{module:moduleShim,exports:moduleShim.exports,require,console});
const {parseTicketPasses}=moduleShim.exports;
const fixtures=[
 ['mexicano, números antes de etiqueta','ID#: 2233\n35420 kg BRUTO\n12480 kg TARA\n22940 kg NETO\n25/09/26 10:27',['2233',35420,12480,22940,'25/09/26','10:27']],
 ['báscula en inglés y separadores','Ticket No. 98441\nPESO BRUTO: 42,850 KG\nTARE: 13,200 kg\nNET: 29,650 kg\nFECHA 26/09/2026 HORA 14:04',['98441',42850,13200,29650,'26/09/2026','14:04']],
 ['folio alfanumérico','FOLIO # A-1735\nGROSS 38.500 kg\nTARA 10.200 Kg\nPESO NETO 28.300 KG\n2026-09-26 08:55',['A-1735',38500,10200,28300,'2026-09-26','08:55']],
 ['número con espacios','N° 7138\n45 120 KG PESO BRUTO\n12 440 KG TARA\n32 680 KG NETO\n26/09/26 06:22',['7138',45120,12440,32680,'26/09/26','06:22']],
];
for(const [name,input,expected] of fixtures)test(name,()=>{for(let i=0;i<20;i++){const r=parseTicketPasses([{text:input,confidence:88,name:'original'},{text:'pasada ilegible',confidence:12,name:'fallida'}]);assert.deepEqual([r.fields.folio,r.fields.gross,r.fields.tare,r.fields.printedNet,r.fields.date,r.fields.time],expected);assert.equal(r.netKg,r.fields.printedNet)}});
test('la aritmética resuelve candidatos contradictorios sin inventar',()=>{const r=parseTicketPasses([{text:'FOLIO: 771\nBRUTO 53420\nTARA 12480\nNETO 22940',confidence:90,name:'original'},{text:'BRUTO 35420\nTARA 12480\nNETO 22940',confidence:75,name:'contraste'}]);assert.equal(r.fields.gross,35420);assert.equal(r.netKg,22940)});
test('dos pesos no producen un bruto inventado',()=>{const r=parseTicketPasses([{text:'TARA 12480\nNETO 22940',confidence:95}]);assert.equal(r.fields.gross,undefined);assert.equal(r.fields.tare,12480);assert.equal(r.fields.printedNet,22940)});
