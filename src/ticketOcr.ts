import type {Worker} from 'tesseract.js';

export type TicketFields={gross?:number;tare?:number;printedNet?:number;folio?:string;date?:string;time?:string};
export type TicketFailureCode='OCR_ENGINE_FAILED'|'OCR_EMPTY_RESULT'|'FIELD_NOT_FOUND'|'LOW_CONFIDENCE'|'VALIDATION_FAILED'|'PARSER_FAILED'|'ASSET_LOAD_FAILED'|'OCR_TIMEOUT'|'OCR_NOT_CONFIGURED'|'OCR_OFFLINE'|'VISION_MONTHLY_LIMIT'|'VISION_USER_LIMIT'|'TRIP_ACCESS_DENIED'|'GOOGLE_AUTH_FAILED'|'GOOGLE_VISION_FAILED'|'OCR_BUDGET_UNAVAILABLE';
export type TicketReading={fields:TicketFields;netKg?:number;confidence:number;fieldConfidence:Partial<Record<keyof TicketFields,number>>;warnings:string[];diagnostics?:TicketDiagnostics};
type Key=keyof TicketFields;
type Candidate={value:string|number;quality:number;pass:string;line:string;reason:string};
type OcrLine={text:string;confidence:number;bbox?:{x0:number;y0:number;x1:number;y1:number};words?:{text:string;confidence:number;bbox?:unknown}[]};
type Pass={text:string;confidence:number;lines?:OcrLine[];name?:string};
export type TicketDiagnostics={image?:{sha256?:string;width?:number;height?:number;orientation?:string;bytes?:number};passes:{name:string;text:string;confidence:number;width?:number;height?:number;status?:'OK'|'ERROR';durationMs?:number}[];candidates:Record<Key,Candidate[]>;selected:TicketFields;validation:string[];failureCodes:Partial<Record<Key,TicketFailureCode>>;engineStatus?:'INICIADO'|'WORKER_CARGADO'|'COMPLETADO'|'ERROR';stage?:string;engineError?:{code:TicketFailureCode;message:string};runtime?:{bundle?:string;serviceWorker?:string;cacheNames?:string[];online?:boolean}};
const keys=['gross','tare','printedNet','folio','date','time'] as const;
const labels:Record<Key,RegExp>={gross:/\b(?:peso\s*)?(?:bruto|gross|brut0)\b/i,tare:/\b(?:peso\s*)?(?:tara|tare)\b/i,printedNet:/\b(?:peso\s*)?(?:neto|net|net0)\b/i,folio:/\b(?:folio|ticket|boleta|(?:[i1l]d|n(?:o|º|°|úm(?:ero)?)\.?)(?:\s*(?:#|:|número))?)(?=\s|[:#.=\-°º]|\d)/i,date:/\bfecha\b/i,time:/\bhora\b/i};
const numberRe=/(?:\d{1,3}(?:[., ]\d{3})+|\d{3,6})(?:[.,]\d{1,2})?/g;
function kilograms(raw:string):number|undefined{
 const compact=raw.replace(/\s/g,'');const decimal=compact.match(/[.,](\d{1,2})$/);
 const normalized=decimal?compact.slice(0,-decimal[0].length).replace(/[.,]/g,'')+'.'+decimal[1]:compact.replace(/[.,]/g,'');
 const n=Number(normalized);return Number.isFinite(n)&&n>0&&n<=200000?n:undefined;
}
function dates(line:string):string[]{return [...line.matchAll(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g)].map(x=>x[0])}
function times(line:string):string[]{return [...line.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[AP]\.?M\.?)?\b/gi)].map(x=>x[0].replace(/\s+/g,' ').trim())}
function findCandidates(passes:Pass[]):Record<Key,Candidate[]>{
 const all=Object.fromEntries(keys.map(k=>[k,[]])) as unknown as Record<Key,Candidate[]>;
 for(const [index,pass] of passes.entries()){
  const passName=pass.name??`intento OCR ${index+1}`;
  const lines=pass.lines?.length?pass.lines:pass.text.split(/\r?\n/).map(text=>({text,confidence:pass.confidence}));
  for(let i=0;i<lines.length;i++){
   const line=lines[i].text.trim();if(!line)continue;
   const quality=Math.max(0,Math.min(100,Number(lines[i].confidence)||pass.confidence));
   for(const key of ['gross','tare','printedNet'] as const){
    const match=labels[key].exec(line);if(!match)continue;
    const segments=[line.slice(0,match.index),line.slice(match.index+match[0].length)];
    const same=segments.flatMap((segment,side)=>[...segment.matchAll(numberRe)].map(x=>({raw:x[0],distance:side?x.index??0:segment.length-(x.index??0)-x[0].length})));
    const nearby=same.filter(x=>x.distance<22);
    const next=nearby.length?nearby:i+1<lines.length?[...lines[i+1].text.matchAll(numberRe)].filter(x=>!Object.values(labels).some(re=>re.test(lines[i+1].text))).map(x=>({raw:x[0],distance:24})):[];
    for(const n of next){const value=kilograms(n.raw);if(value===undefined)continue;all[key].push({value,quality:Math.round(Math.min(98,quality*.55+42-Math.min(n.distance,24)*.5)),pass:passName,line,reason:n.distance===24?'línea siguiente':'etiqueta cercana'});}
   }
   const folio=labels.folio.exec(line);
   if(folio){const rest=line.slice(folio.index+folio[0].length).replace(/^[\s:#.=\-°º]*(?:(?:no|número)\.?\s*)?/i,'');const values=rest.match(/^([A-Z0-9][A-Z0-9-]{1,38})\b/i);
    if(values&&/\d/.test(values[1])&&!/^(?:kg|bruto|tara|neto)$/i.test(values[1]))all.folio.push({value:values[1],quality:Math.round(Math.min(98,quality*.65+30)),pass:passName,line,reason:'etiqueta de folio'});
   }
   for(const [key,values] of [['date',dates(line)],['time',times(line)]] as const)for(const value of values)all[key].push({value,quality:Math.round(Math.min(98,quality*.7+(labels[key].test(line)?28:15))),pass:passName,line,reason:labels[key].test(line)?'etiqueta cercana':'patrón de fecha/hora'});
  }
 }
 return all;
}
function rank(items:Candidate[]){const grouped=new Map<string,{value:string|number;quality:number;votes:Set<string>}>();for(const x of items){const k=String(x.value),old=grouped.get(k);if(old){old.quality=Math.max(old.quality,x.quality);old.votes.add(x.pass)}else grouped.set(k,{value:x.value,quality:x.quality,votes:new Set([x.pass])})}return [...grouped.values()].map(x=>({value:x.value,quality:Math.min(99,x.quality+Math.min(3,x.votes.size-1)*5),votes:x.votes.size})).sort((a,b)=>b.quality-a.quality||b.votes-a.votes||String(a.value).localeCompare(String(b.value)))}
function parseOneWeighing(passes:Pass[]):TicketReading{
 const candidates=findCandidates(passes),ranked=Object.fromEntries(keys.map(k=>[k,rank(candidates[k])])) as Record<Key,ReturnType<typeof rank>>;
 const fields:TicketFields={},fieldConfidence:TicketReading['fieldConfidence']={},validation:string[]=[];
 const gross=ranked.gross.slice(0,5),tare=ranked.tare.slice(0,5),net=ranked.printedNet.slice(0,5);
 const combinations=net.flatMap(n=>gross.flatMap(g=>tare.filter(t=>Number(g.value)>Number(t.value)&&Math.abs(Number(g.value)-Number(t.value)-Number(n.value))<=2).map(t=>({g,t,n,score:g.quality+t.quality+n.quality+(Number(g.value)-Number(t.value)===Number(n.value)?30:15)})))).sort((a,b)=>b.score-a.score||Number(a.g.value)-Number(b.g.value));
 const best=combinations[0];if(best)validation.push(`${best.g.value} - ${best.t.value} = ${best.n.value}`);
 for(const [key,selected] of [['gross',best?.g??gross[0]],['tare',best?.t??tare[0]],['printedNet',best?.n??net[0]],['folio',ranked.folio[0]],['date',ranked.date[0]],['time',ranked.time[0]]] as const){if(selected){(fields as Record<string,string|number>)[key]=selected.value;fieldConfidence[key]=Math.min(99,selected.quality+(best&&['gross','tare','printedNet'].includes(key)?5:0))}}
 let netKg:number|undefined;const warnings:string[]=[];
 if(fields.gross!==undefined&&fields.tare!==undefined){netKg=fields.gross-fields.tare;if(netKg<=0)warnings.push('El bruto debe superar la tara.');else if(fields.printedNet!==undefined&&Math.abs(netKg-fields.printedNet)>2){warnings.push('El neto impreso no coincide con bruto menos tara; revisa el ticket antes de confirmar.');validation.push('Los pesos leídos no coinciden');}}
 for(const [key,label] of [['gross','peso bruto'],['tare','tara'],['printedNet','neto impreso'],['folio','folio'],['date','fecha'],['time','hora']] as const){if(fields[key]===undefined)warnings.push(`No se pudo leer ${label}; revisa el ticket.`);else if((fieldConfidence[key]??0)<70)warnings.push(`Verifica ${label} antes de confirmar.`)}
 const failureCodes:TicketDiagnostics['failureCodes']={};
 for(const key of keys){if(fields[key]===undefined)failureCodes[key]=passes.every(p=>!p.text.trim())?'OCR_EMPTY_RESULT':'FIELD_NOT_FOUND';else if((fieldConfidence[key]??0)<70)failureCodes[key]='LOW_CONFIDENCE';else if(['gross','tare','printedNet'].includes(key)&&warnings.some(w=>w.includes('no coincide')))failureCodes[key]='VALIDATION_FAILED'}
 const diagnostics:TicketDiagnostics={passes:passes.map((p,i)=>({name:p.name??`intento OCR ${i+1}`,text:p.text,confidence:p.confidence})),candidates,selected:fields,validation,failureCodes};
 return {fields,netKg,fieldConfidence,confidence:passes.length?Math.round(Math.max(...passes.map(x=>x.confidence))):0,warnings,diagnostics};
}
// A ticket may contain several real PESADAS. Keep their fields in separate
// groups so the entry timestamp cannot replace the exit timestamp. OCR attempts
// are independent observations of those same groups, not additional pesadas.
export function parseTicketPasses(passes:Pass[]):TicketReading{
 const header=/^\s*(?:PESO|PESADA|WEIGHT)\s+DE\s+(?:ENTRADA|SALIDA|INGRESO|EGRESO|ARRIVAL|DEPARTURE)\b/i;
 const grouped=new Map<string,Pass[]>();let multiple=false;
 for(const pass of passes){
  const lines=pass.text.split(/\r?\n/);let group='sin encabezado';
  for(const line of lines){const match=line.match(header);if(match){group=match[0].trim().toUpperCase().replace(/\s+/g,' ');multiple=true}
   const existing=grouped.get(group)??[];if(!grouped.has(group))grouped.set(group,existing);
   let current=existing.find(p=>p.name===pass.name);if(!current){current={name:pass.name,confidence:pass.confidence,text:''};existing.push(current)}
   current.text+=(current.text?'\n':'')+line;
  }
 }
 if(!multiple)return parseOneWeighing(passes);
 const results=[...grouped.entries()].map(([name,items])=>({name,reading:parseOneWeighing(items)}));
 const score=(result:typeof results[number])=>{
  const f=result.reading.fields,complete=Number(f.gross!==undefined)+Number(f.tare!==undefined)+Number(f.printedNet!==undefined);
  const consistent=f.gross!==undefined&&f.tare!==undefined&&f.printedNet!==undefined&&Math.abs(f.gross-f.tare-f.printedNet)<=2;
  return complete*100+Number(consistent)*150+Number(!!f.folio)*15+Number(!!f.date)*5+Number(!!f.time)*5+(/SALIDA|EGRESO|DEPARTURE/.test(result.name)?1:0);
 };
 results.sort((a,b)=>score(b)-score(a));const chosen=results[0].reading;
 chosen.diagnostics!.validation.unshift(`Pesada seleccionada: ${results[0].name}; pesadas detectadas: ${results.map(r=>r.name).join(', ')}`);
 // Full OCR text remains visible in ADMIN diagnostics, even when one pesada wins.
 chosen.diagnostics!.passes=passes.map((p,i)=>({name:p.name??`intento OCR ${i+1}`,text:p.text,confidence:p.confidence}));
 return chosen;
}
export function parseTicket(text:string,confidence:number):TicketReading{return parseTicketPasses([{text,confidence}])}
function linesFromBlocks(blocks:any[]|null|undefined):OcrLine[]{return (blocks??[]).flatMap(block=>(block.paragraphs??[]).flatMap((p:any)=>(p.lines??[]).map((l:any)=>({text:String(l.text??'').trim(),confidence:Number(l.confidence??0),bbox:l.bbox,words:l.words}))));}
async function imageInfo(blob:Blob){const bytes=await blob.arrayBuffer();const hash=typeof crypto!=='undefined'&&crypto.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join(''):undefined;const url=URL.createObjectURL(blob);const image=new Image();try{await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('No se pudo abrir el ticket'));image.src=url});return {image,width:image.naturalWidth,height:image.naturalHeight,hash,url}}catch(e){URL.revokeObjectURL(url);throw e}}
function exifOrientation(blob:Blob):Promise<string>{return blob.slice(0,131072).arrayBuffer().then(buffer=>{const v=new DataView(buffer);if(v.byteLength<4||v.getUint16(0)!==0xffd8)return 'sin EXIF JPEG';let offset=2;while(offset+4<v.byteLength){if(v.getUint8(offset)!==0xff)break;const marker=v.getUint8(offset+1),length=v.getUint16(offset+2);if(length<2||offset+2+length>v.byteLength)break;if(marker===0xe1&&length>14&&v.getUint32(offset+4)===0x45786966){const t=offset+10,little=v.getUint16(t)===0x4949;if(v.getUint16(t+2,little)!==42)break;const ifd=t+v.getUint32(t+4,little);if(ifd+2>v.byteLength)break;const count=v.getUint16(ifd,little);for(let i=0;i<count;i++){const p=ifd+2+i*12;if(p+12>v.byteLength)break;if(v.getUint16(p,little)===0x0112)return `EXIF ${v.getUint16(p+8,little)}`}}offset+=length+2}return 'EXIF no disponible'}).catch(()=>'EXIF no disponible')}
async function variant(image:HTMLImageElement,box:{x:number;y:number;w:number;h:number},style:'gray'|'contrast'|'binary'):Promise<Blob>{
 const canvas=document.createElement('canvas');const sourceW=image.naturalWidth*box.w,sourceH=image.naturalHeight*box.h;
 const scale=Math.min(3,Math.max(1,1800/sourceW));canvas.width=Math.round(sourceW*scale);canvas.height=Math.round(sourceH*scale);const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas no disponible');ctx.drawImage(image,image.naturalWidth*box.x,image.naturalHeight*box.y,sourceW,sourceH,0,0,canvas.width,canvas.height);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),data=pixels.data;const sample:number[]=[];for(let i=0;i<data.length;i+=Math.max(4,Math.floor(data.length/50000/4)*4))sample.push(.299*data[i]+.587*data[i+1]+.114*data[i+2]);sample.sort((a,b)=>a-b);const low=sample[Math.floor(sample.length*.04)]??0,high=sample[Math.floor(sample.length*.96)]??255;const span=Math.max(35,high-low);
 for(let i=0;i<data.length;i+=4){const gray=.299*data[i]+.587*data[i+1]+.114*data[i+2];const stretched=Math.max(0,Math.min(255,(gray-low)*255/span));const v=style==='gray'?gray:style==='binary'?(stretched<Math.min(210,(low+high)/2+24)?0:255):stretched;data[i]=data[i+1]=data[i+2]=v}ctx.putImageData(pixels,0,0);
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('No se pudo procesar imagen')),'image/png'));
}
function timeout<T>(task:Promise<T>,milliseconds:number,stage:string):Promise<T>{let timer:ReturnType<typeof setTimeout>;return Promise.race([task,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`OCR_TIMEOUT: ${stage} excedió ${milliseconds} ms`)),milliseconds)})]).finally(()=>clearTimeout(timer!))}
export async function readTicket(blob:Blob,onProgress?:(diagnostics:TicketDiagnostics)=>void):Promise<TicketReading>{
 let worker:Worker|undefined;const passes:Pass[]=[];let info:Awaited<ReturnType<typeof imageInfo>>|undefined;
 const progress:TicketDiagnostics={passes:[],candidates:{gross:[],tare:[],printedNet:[],folio:[],date:[],time:[]},selected:{},validation:[],failureCodes:{},engineStatus:'INICIADO',stage:'decodificando imagen'};
 const report=()=>onProgress?.({...progress,passes:progress.passes.map(p=>({...p})),image:progress.image&&{...progress.image}});report();
 try{
  info=await timeout(imageInfo(blob),15000,'decodificación de imagen');progress.image={sha256:info.hash,width:info.width,height:info.height,orientation:await exifOrientation(blob),bytes:blob.size};progress.stage='cargando worker y modelos spa+eng';report();worker=await timeout((await import('tesseract.js')).createWorker('spa+eng'),30000,'carga de worker/modelos');progress.engineStatus='WORKER_CARGADO';report();
  const read=async(input:Blob,name:string)=>{progress.stage=`reconociendo ${name}`;const started=Date.now();const attempt:TicketDiagnostics['passes'][number]={name,text:'',confidence:0,status:'ERROR'};progress.passes.push(attempt);report();try{if(name==='original'){attempt.width=info!.width;attempt.height=info!.height}else if(typeof createImageBitmap==='function'){try{const bitmap=await timeout(createImageBitmap(input),5000,`dimensiones ${name}`);attempt.width=bitmap.width;attempt.height=bitmap.height;bitmap.close()}catch{/* Las dimensiones diagnósticas no deben impedir OCR. */}}const result=await timeout(worker!.recognize(input,{}, {text:true,blocks:true}),25000,`lectura ${name}`);attempt.text=result.data.text;attempt.confidence=result.data.confidence;attempt.status='OK';passes.push({text:result.data.text,confidence:result.data.confidence,lines:linesFromBlocks(result.data.blocks),name})}finally{attempt.durationMs=Date.now()-started;report()}};
  await read(blob,'original');
  // Consistent baseline passes run for every photograph. Later passes only add candidates.
  await read(await variant(info.image,{x:0,y:0,w:1,h:1},'contrast'),'contraste completo');
  await read(await variant(info.image,{x:0,y:0,w:1,h:1},'binary'),'térmico completo');
  let reading=parseTicketPasses(passes);
  if(keys.some(k=>reading.fields[k]===undefined||(reading.fieldConfidence[k]??0)<70)||reading.warnings.some(w=>w.includes('no coincide'))){
   const boxes=passes[0].lines?.filter(l=>Object.values(labels).some(re=>re.test(l.text))&&l.bbox).map(l=>l.bbox!)??[];
   const minY=boxes.length?Math.max(0,Math.min(...boxes.map(b=>b.y0))/info.height-.08):.07;
   const maxY=boxes.length?Math.min(1,Math.max(...boxes.map(b=>b.y1))/info.height+.1):.93;
   const areas=[{x:.05,y:minY,w:.9,h:Math.max(.12,maxY-minY)},{x:.04,y:.02,w:.92,h:.5},{x:.04,y:.45,w:.92,h:.53}];
   for(const [i,area] of areas.entries()){await read(await variant(info.image,area,i===0?'contrast':'gray'),`región ${i+1}`);reading=parseTicketPasses(passes);if(!keys.some(k=>reading.fields[k]===undefined||(reading.fieldConfidence[k]??0)<70)&&!reading.warnings.some(w=>w.includes('no coincide')))break}
  }
  reading.diagnostics!.image=progress.image;reading.diagnostics!.passes=progress.passes;reading.diagnostics!.engineStatus='COMPLETADO';reading.diagnostics!.stage='OCR y parser completados';
  console.debug('Diagnóstico OCR de ticket',reading.diagnostics);return reading;
 }catch(e){progress.engineStatus='ERROR';const error=e instanceof Error?e:new Error(String(e));const code:TicketFailureCode=/OCR_TIMEOUT/.test(error.message)?'OCR_TIMEOUT':/fetch|network|404|load|worker|import|async.*require/i.test(error.message)?'ASSET_LOAD_FAILED':'OCR_ENGINE_FAILED';progress.engineError={code,message:error.message};report();Object.assign(error,{ticketDiagnostics:{...progress,passes:progress.passes.map(p=>({...p}))}});throw error}finally{if(info)URL.revokeObjectURL(info.url);if(worker){try{await timeout(worker.terminate(),3000,'liberación de worker')}catch(e){console.warn('No se pudo liberar worker OCR',e)}}}
}
