const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
const m=new Module('financeXlsx');m._compile(ts.transpileModule(fs.readFileSync(require.resolve('../src/financeXlsx.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,'financeXlsx');
const {financeXlsx}=m.exports;
test('Excel formulas count each trip once with multiple payments and exclude reversals and unapplied advances',async()=>{
 const lines=[{trip_id:'a',folio:'99092801-1',delivered_at:'2026-09-28T07:58:22Z',net_kg:22640,price_mxn_per_kg:1.25},{trip_id:'b',folio:'99092801-2',delivered_at:'2026-09-28T18:54:07Z',net_kg:500,price_mxn_per_kg:2},{trip_id:'c',folio:'99092802-2',delivered_at:'2026-09-29T16:49:06Z',net_kg:500,price_mxn_per_kg:6.5}];
 const payments=[{id:'p1',paid_on:'2026-09-28',amount_mxn:1000,allocations:[{trip_id:'a',amount_mxn:500},{trip_id:'b',amount_mxn:300}]},{id:'p2',paid_on:'2026-09-28',amount_mxn:200,allocations:[{trip_id:'b',amount_mxn:100}]},{id:'reversed',paid_on:'2026-09-29',reversed:true,allocations:[{trip_id:'c',amount_mxn:9000}]}];
 const xml=new TextDecoder().decode(await financeXlsx('PRUEBA OFFLINE','septiembre 2026',lines,payments).arrayBuffer());
 assert.equal((xml.match(/<f>C\d+\*D\d+<\/f>/g)||[]).length,3);
 assert.equal((xml.match(/<t>99092801-2<\/t>/g)||[]).length,1);
 assert.match(xml,/<c r="E9"[^>]*><f>SUM\(E5:E8\)<\/f><v>32550<\/v>/);
 assert.match(xml,/<c r="G9"[^>]*><f>SUM\(G5:G8\)<\/f><v>900<\/v>/);
 assert.match(xml,/<f>E9-G9<\/f><v>31650<\/v>/);
 assert.match(xml,/<row r="7"><c r="F7"/,'second allocation uses only payment columns');
 const partial=new TextDecoder().decode(await financeXlsx('PRUEBA OFFLINE','septiembre 2026',[{...lines[2],price_mxn_per_kg:null}],[]).arrayBuffer());
 assert.match(partial,/Pendiente de precio/);assert.match(partial,/total es parcial/);
});
