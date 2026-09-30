const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
const m=new Module('ticketTime');m._compile(ts.transpileModule(fs.readFileSync(require.resolve('../src/ticketTime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,'ticketTime');
const {confirmedTicketTime}=m.exports;
test('reviewed ticket time preserves local timezone and rejects incomplete or impossible corrections',()=>{
 assert.equal(confirmedTicketTime('29/09/2026','10:30'),'2026-09-29T16:30:00.000Z');
 assert.equal(confirmedTicketTime('29/09/26','10:30 p.m.'),'2026-09-30T04:30:00.000Z');
 assert.equal(confirmedTicketTime('',''),undefined);
 for(const [d,t] of [['31/09/26','10:30'],['29/09/26','25:30'],['','10:30'],['29/09/26','']])assert.throws(()=>confirmedTicketTime(d,t),/Revisa/);
});
