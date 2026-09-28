const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),http=require('node:http');
require('fake-indexeddb/auto');
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
globalThis.window={location:{search:''}};
const receipts=new Map(),files=new Map();let dropResponse=false,applied=0,server,port;
const backend={supabase:{
 rpc:async(name,p)=>{try{const r=await fetch(`http://127.0.0.1:${port}/rpc`,{method:'POST',body:JSON.stringify({name,p})});return {data:await r.json(),error:null}}catch(e){return {data:null,error:e}}},
 storage:{from:()=>({
  upload:async(p,b)=>{if(files.has(p))return {error:Error('already exists')};files.set(p,b);return {error:null}},
  download:async p=>({data:files.get(p),error:files.has(p)?null:Error('missing')})
 })}
}};

const loaded={};function load(name){if(loaded[name])return loaded[name].exports;const file=path.resolve(__dirname,'../src',name+'.ts'),m=new Module(file,module);m.filename=file;m.paths=module.paths;loaded[name]=m;m.require=id=>id==='./backend'?backend:id==='./offlineEvidence'?load('offlineEvidence'):require(id);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports}
const journal=load('offlineJournal');
async function listen(){server=http.createServer(async(req,res)=>{let s='';for await(const chunk of req)s+=chunk;const {p}=JSON.parse(s);if(!receipts.has(p.p_event_id)){receipts.set(p.p_event_id,{state:'IN_PROGRESS'});applied++}if(dropResponse){dropResponse=false;req.socket.destroy();return}res.setHeader('content-type','application/json');res.end(JSON.stringify(receipts.get(p.p_event_id)))});await new Promise(resolve=>server.listen(port??0,'127.0.0.1',resolve));port=server.address().port}
async function stop(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
test('offline persistence, real transport interruption, replay and actor isolation',async()=>{
 const actor='actor-a',org='org-a',id=crypto.randomUUID(),now=new Date().toISOString();
 await journal.saveOfflineView(actor,{organizationId:org,profile:{id:actor},harvests:[{id:'h',status:'ASSIGNED'}],trips:[],lots:[]});
 navigator.onLine=false;
 await journal.enqueueOperation({id,actorId:actor,organizationId:org,kind:'harvest',entityId:'h',capturedAt:now,queuedAt:now,payload:{expected:'ASSIGNED'}});
 const draft={id:'ticket-a',actorId:actor,organizationId:org,entityId:'t',kind:'ticket',blob:new Blob(['ORIGINAL PHOTO'],{type:'image/png'}),mimeType:'image/png',capturedAt:now};await journal.saveDraft(draft);
 delete loaded.offlineJournal;const reopened=load('offlineJournal');
 assert.equal((await reopened.operations(actor,org)).length,1);assert.equal((await reopened.operations('actor-b',org)).length,0);assert.equal(await (await reopened.drafts(actor,org))[0].blob.text(),'ORIGINAL PHOTO');
 const cached=await reopened.readOfflineView(actor);assert.equal(reopened.projectOfflineView(cached.view,await reopened.operations(actor,org),[]).harvests[0].status,'IN_PROGRESS');assert.equal(cached.view.harvests[0].status,'ASSIGNED');
 await assert.rejects(reopened.syncJournal(actor,org),/Sin conexión/);assert.equal((await reopened.operations(actor,org)).length,1);
 navigator.onLine=true;await listen();dropResponse=true;
 await assert.rejects(reopened.syncJournal(actor,org),/Pendiente conservado/);assert.equal(applied,1);assert.equal((await reopened.operations(actor,org)).length,1);
 await stop();await assert.rejects(reopened.syncJournal(actor,org),/Pendiente conservado/);assert.equal((await reopened.operations(actor,org)).length,1);
 await listen();await Promise.all([reopened.syncJournal(actor,org),reopened.syncJournal(actor,org)]);assert.equal(applied,1);assert.equal((await reopened.operations(actor,org)).length,0);await stop();
 assert.equal((await reopened.drafts(actor,org)).length,1,'unconfirmed OCR photo never silently removed');
});
test('upload retry compares original bytes, not just size',async()=>{const a=new Blob(['1234'],{type:'image/png'});await journal.originalUpload('bucket','photo',a);await journal.originalUpload('bucket','photo',a);await assert.rejects(journal.originalUpload('bucket','photo',new Blob(['4321'])),/no coincide/)});
test('lot and closed-harvest projections keep linked evidence and no invented weights',()=>{const now=new Date().toISOString(),base={harvests:[{id:'h',farm_id:'f',status:'IN_PROGRESS'}],trips:[{id:'t',harvest_order_id:'h'}],lots:[]};const ops=[{id:'l',kind:'lot',entityId:'h',payload:{count:830,brix:36,path:'p'}},{id:'c',kind:'harvest',entityId:'h',payload:{expected:'IN_PROGRESS'}}];const result=journal.projectOfflineView(base,ops,[]);assert.equal(result.lots[0].actual_weight_kg,null);assert.equal(result.lots[0].status,'HARVESTED');assert.equal(result.harvestPhotos[0].agave_lot_id,'l');assert.equal(result.tripLots[0].agave_lot_id,'l');assert.equal(base.lots.length,0)});

test('installed PWA remembers practice workspace when start_url loses query',()=>{const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};const reopen=search=>{window.location.search=search;delete loaded.offlineJournal;return load('offlineJournal').practiceMode};assert.equal(reopen('?practice=1'),true);assert.equal(reopen(''),true);assert.equal(reopen('?session=offline-admin'),false);assert.equal(reopen('?practice=0'),false);assert.equal(reopen(''),false);});

test('concurrent photo synchronization creates one stable database record',async()=>{
 const rows=new Map();backend.supabase.from=()=>({select:()=>({eq:(column,value)=>({maybeSingle:async()=>({data:[...rows.values()].find(x=>x[column]===value)??null,error:null})})}),insert:async data=>{if(rows.has(data.id))return {error:Error('duplicate key')};rows.set(data.id,data);return {error:null}}});
 const evidence=load('offlineEvidence'),id=crypto.randomUUID();navigator.onLine=true;
 await evidence.queueEvidence({id,kind:'harvest',organizationId:'photo-org',entityId:'h',userId:'photo-actor',bucket:'harvest-evidence',path:'concurrent-photo',mimeType:'image/png',blob:new Blob(['ORIGINAL'],{type:'image/png'}),capturedAt:new Date().toISOString(),legibilityConfirmed:false});
 await Promise.all([evidence.syncEvidence('photo-org','photo-actor'),evidence.syncEvidence('photo-org','photo-actor')]);
 assert.equal(rows.size,1);assert.ok(rows.has(id));assert.equal((await evidence.pendingEvidence()).filter(x=>x.id===id).length,0);
});
