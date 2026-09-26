import {createWorker} from 'tesseract.js';

export type TicketFields={gross?:number;tare?:number;printedNet?:number;folio?:string;date?:string;time?:string};
export type TicketReading={fields:TicketFields;netKg?:number;confidence:number;fieldConfidence:Partial<Record<keyof TicketFields,number>>;warnings:string[]};
type Candidate={value:number;quality:number};
type Pass={text:string;confidence:number};

const amount='(?:\\d{1,3}(?:[., ]\\d{3})+|\\d{3,6})(?:[.,]\\d{1,2})?';
const unit='(?:\\s*(?:k[gaq9]s?|kilogramos?))?';
function kilograms(raw:string):number|undefined{
 const compact=raw.replace(/\s/g,'');let normalized=compact;
 if(/[.,]/.test(compact)){
  const last=compact.match(/[.,](\d{1,2})$/);
  normalized=last?compact.slice(0,-last[0].length).replace(/[.,]/g,'')+'.'+last[1]:compact.replace(/[.,]/g,'');
 }
 const n=Number(normalized);return Number.isFinite(n)&&n>=0&&n<=200000?n:undefined;
}
function weightCandidates(text:string,label:'bruto'|'tara'|'neto'):Candidate[]{
 const output:Candidate[]=[];
 const printedLabel=label==='bruto'?'brut[0o]':label==='neto'?'net[0o]':'tara';
 const labelRe=new RegExp(`\\b(?:peso\\s+)?${printedLabel}\\b`,'i');
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim(),found=labelRe.exec(line);if(!found)continue;
  const before=line.slice(0,found.index),after=line.slice(found.index+found[0].length);
  const left=new RegExp(`(${amount})${unit}\\s*$`,'i').exec(before);
  const right=new RegExp(`^\\s*[:#=\\-]?\\s*(${amount})${unit}`,'i').exec(after);
  const match=left||right;if(!match)continue;
  const n=kilograms(match[1]);if(n===undefined)continue;
  const margin=left?before.slice(0,left.index):'';
  if(margin.length>20||/\d{3,}/.test(margin))continue;
  output.push({value:n,quality:margin.trim()?75:90});
 }
 return output;
}
function folioCandidates(text:string):{value:string;quality:number}[]{
 const output:{value:string;quality:number}[]=[];
 for(const line of text.split(/\r?\n/)){
  // ID# may be recognized as 1D, IDR or ID#. Require a nearby numeric value.
  const found=line.match(/\b(?:[i1l]d[r#]?|folio|ticket|boleta|n(?:o|º|°|úm(?:ero)?)\.?|n[úu]mero\s+de\s+(?:ticket|boleta))\s*[:#=.-]*\s*([A-Z0-9][A-Z0-9-]{1,38}[A-Z0-9])(?![A-Z0-9-])/i);
  if(found&&/\d/.test(found[1])&&!/\b(?:tel|teléfono|phone)\b/i.test(line.slice(0,found.index)))output.push({value:found[1],quality:90});
 }
 return output;
}
function mostLikely<T extends string|number>(items:{value:T;quality:number}[]):{value:T;quality:number}|undefined{
 const groups=new Map<T,{value:T;quality:number;votes:number}>();
 for(const item of items){const current=groups.get(item.value);if(current){current.votes++;current.quality=Math.max(current.quality,item.quality)}else groups.set(item.value,{...item,votes:1})}
 return [...groups.values()].sort((a,b)=>(b.votes*20+b.quality)-(a.votes*20+a.quality))[0];
}
export function parseTicketPasses(passes:Pass[]):TicketReading{
 const candidates={gross:[] as Candidate[],tare:[] as Candidate[],printedNet:[] as Candidate[],folio:[] as {value:string;quality:number}[]};
 const fields:TicketFields={},fieldConfidence:TicketReading['fieldConfidence']={};
 let pairedTimestamp=false;
 for(const pass of passes){
  for(const key of ['gross','tare','printedNet'] as const)candidates[key].push(...weightCandidates(pass.text,key==='gross'?'bruto':key==='tare'?'tara':'neto'));
  candidates.folio.push(...folioCandidates(pass.text));
  for(const line of pass.text.split(/\r?\n/)){
   const date=line.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
   const time=line.match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/);
   if(date&&time&&!pairedTimestamp){fields.date=date[1];fields.time=time[0];pairedTimestamp=true}
   else if(!pairedTimestamp){if(date&&!fields.date)fields.date=date[1];if(time&&!fields.time)fields.time=time[0]}
  }
 }
 const ranked=(values:Candidate[])=>[...new Set(values.map(x=>x.value))].map(value=>({value,quality:Math.max(...values.filter(x=>x.value===value).map(x=>x.quality)),votes:values.filter(x=>x.value===value).length})).sort((a,b)=>(b.votes*20+b.quality)-(a.votes*20+a.quality));
 const gross=ranked(candidates.gross),tare=ranked(candidates.tare),printed=ranked(candidates.printedNet);
 const consistent=printed.flatMap(n=>gross.flatMap(g=>tare.filter(t=>g.value>t.value&&Math.abs(g.value-t.value-n.value)<=2).map(t=>({g,t,n,score:g.votes+t.votes+n.votes+(Math.abs(g.value-t.value-n.value)<.01?2:0)})))).sort((a,b)=>b.score-a.score)[0];
 const selectedG=consistent?.g??gross[0],selectedT=consistent?.t??tare[0],selectedN=consistent?.n??printed[0];
 // Never derive a gross value from tare + net alone. If the OCR candidates
 // disagree with a clearly printed tare and net, leave gross for review.
 const conflictingGross=selectedG&&selectedT&&selectedN&&!consistent&&Math.abs(selectedG.value-selectedT.value-selectedN.value)>2;
 if(selectedG&&!conflictingGross){fields.gross=selectedG.value;fieldConfidence.gross=Math.min(99,selectedG.quality+(consistent?8:0))}
 if(selectedT){fields.tare=selectedT.value;fieldConfidence.tare=Math.min(99,selectedT.quality+(consistent?8:0))}
 if(selectedN){fields.printedNet=selectedN.value;fieldConfidence.printedNet=Math.min(99,selectedN.quality+(consistent?8:0))}
 const folio=mostLikely(candidates.folio);if(folio){fields.folio=folio.value;fieldConfidence.folio=folio.quality}
 const warnings:string[]=[];
 for(const [key,label] of [['gross','peso bruto'],['tare','tara'],['folio','folio']] as const)if(fields[key]===undefined)warnings.push(`No se pudo leer ${label}; complétalo mirando el ticket.`);
 let netKg:number|undefined;
 if(fields.gross!==undefined&&fields.tare!==undefined){
  netKg=fields.gross-fields.tare;
  if(netKg<=0)warnings.push('El bruto debe superar la tara.');
  else if(fields.printedNet!==undefined&&Math.abs(netKg-fields.printedNet)>2)warnings.push('El neto impreso no coincide con bruto menos tara; revisa el ticket antes de confirmar.');
 }
 for(const key of ['gross','tare','folio'] as const)if(fields[key]!==undefined&&(fieldConfidence[key]??0)<80)warnings.push(`Revisa ${key==='gross'?'el bruto':key==='tare'?'la tara':'el folio'} antes de confirmar.`);
 return {fields,netKg,fieldConfidence,confidence:passes.length?Math.round(Math.max(...passes.map(x=>x.confidence))):0,warnings};
}
export function parseTicket(text:string,confidence:number):TicketReading{return parseTicketPasses([{text,confidence}])}

// Only the recognition copies are modified; the original camera photograph stays intact.
async function recognitionCopies(blob:Blob):Promise<Blob[]>{
 if(typeof document==='undefined')return [];
 // HTMLImageElement works on iOS Safari even where createImageBitmap is absent or unreliable.
 const url=URL.createObjectURL(blob);
 const image=new window.Image();
 try{
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('No se pudo abrir el ticket para OCR'));image.src=url});
  const imageWidth=image.naturalWidth,imageHeight=image.naturalHeight;
  if(!imageWidth||!imageHeight)throw Error('La imagen del ticket está vacía');
  const areas=[{x:0,y:0,w:1,h:1},{x:.1,y:.1,w:.8,h:.8},{x:.15,y:.03,w:.7,h:.55}];
  const output:Blob[]=[];
  for(const area of areas){
   const width=Math.round(Math.min(2200,Math.max(1400,imageWidth*area.w*2)));
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(width*imageHeight*area.h/(imageWidth*area.w));
   const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)continue;
   context.drawImage(image,imageWidth*area.x,imageHeight*area.y,imageWidth*area.w,imageHeight*area.h,0,0,canvas.width,canvas.height);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height);
   for(let i=0;i<pixels.data.length;i+=4){const v=Math.round(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2]);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=Math.max(0,Math.min(255,(v-128)*1.2+128))}
   context.putImageData(pixels,0,0);
   const copy=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(copy)output.push(copy);
  }
  return output;
 }finally{URL.revokeObjectURL(url)}
}
export async function readTicket(blob:Blob):Promise<TicketReading>{
 let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
 const deadline=Date.now()+45000,passes:Pass[]=[];
 try{
  worker=await createWorker('spa+eng');
  const first=await worker.recognize(blob);passes.push({text:first.data.text,confidence:first.data.confidence});
  let reading=parseTicketPasses(passes);
  if(!reading.fields.folio||reading.fields.gross===undefined||reading.fields.tare===undefined||reading.warnings.some(x=>x.includes('neto impreso'))){
   for(const copy of await recognitionCopies(blob)){
    if(Date.now()>deadline)break;
    const result=await worker.recognize(copy);passes.push({text:result.data.text,confidence:result.data.confidence});
    reading=parseTicketPasses(passes);
    if(reading.fields.folio&&reading.fields.gross!==undefined&&reading.fields.tare!==undefined&&!reading.warnings.some(x=>x.includes('neto impreso')))break;
   }
  }
  console.debug('Diagnóstico OCR de ticket',passes.map(x=>({text:x.text,confidence:x.confidence,gross:weightCandidates(x.text,'bruto'),tare:weightCandidates(x.text,'tara'),net:weightCandidates(x.text,'neto'),folio:folioCandidates(x.text)})),{fields:reading.fields,fieldConfidence:reading.fieldConfidence,warnings:reading.warnings});
  return reading;
 }finally{if(worker)await worker.terminate()}
}
