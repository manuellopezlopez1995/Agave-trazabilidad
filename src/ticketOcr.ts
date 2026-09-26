// Extraction is deliberately conservative: only explicitly labelled numbers are accepted.
export type TicketFields={gross?:number;tare?:number;printedNet?:number;folio?:string;date?:string;time?:string};
export type TicketReading={fields:TicketFields;confidence:number;warnings:string[]};
const weight=/([0-9]{1,3}(?:[., ]\d{3})+|\d{3,6})(?:[.,](\d{1,2}))?\s*(?:kg|kgs)?/i;
function number(raw:string){const digits=raw.replace(/[., ]/g,'');return Number(digits)}
function weightFor(text:string,labels:RegExp){for(const line of text.split(/\r?\n/)){if(!labels.test(line))continue;const value=line.replace(labels,'').match(weight);if(value)return number(value[1])+(value[2]?Number(`0.${value[2]}`):0)}return undefined}
export function parseTicket(text:string,confidence:number):TicketReading{
 const fields:TicketFields={gross:weightFor(text,/^.*?\b(?:peso\s*)?bruto\b\s*[:#-]?\s*/i),tare:weightFor(text,/^.*?\b(?:peso\s*)?tara\b\s*[:#-]?\s*/i),printedNet:weightFor(text,/^.*?\b(?:peso\s*)?neto\b\s*[:#-]?\s*/i)};
 for(const line of text.split(/\r?\n/)){
  const folio=line.match(/\b(?:folio|ticket|boleta|no\.?\s*de\s*ticket)\b\s*(?:n[úu]m(?:ero)?\.?|no\.?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,39})/i);
  if(folio&&!fields.folio)fields.folio=folio[1];
  const date=line.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);if(date&&!fields.date)fields.date=date[1];
  const time=line.match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/);if(time&&!fields.time)fields.time=time[0];
 }
 const warnings:string[]=[];
 if(confidence<80)warnings.push('Lectura de baja confianza: revisa cada valor antes de confirmar.');
 for(const [key,label] of [['gross','peso bruto'],['tare','tara'],['folio','folio']] as const)if(fields[key]===undefined)warnings.push(`No se pudo leer ${label}; complétalo mirando el ticket.`);
 if(fields.gross!==undefined&&fields.tare!==undefined){const net=fields.gross-fields.tare;if(net<=0)warnings.push('El bruto no supera la tara.');else if(fields.printedNet!==undefined&&Math.abs(net-fields.printedNet)>Math.max(2,net*.001))warnings.push('El neto impreso no coincide con bruto menos tara; revisa el ticket.');}
 return {fields,confidence,warnings};
}
export async function readTicket(blob:Blob):Promise<TicketReading>{
 const {createWorker}=await import('tesseract.js');
 let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
 const timeout=new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('La lectura tardó demasiado; vuelve a fotografiar o revisa manualmente.')),30000));
 try{
  worker=await Promise.race([createWorker('spa+eng'),timeout]);
  const result=await Promise.race([worker.recognize(blob),timeout]);
  return parseTicket(result.data.text,result.data.confidence);
 }finally{if(worker)await worker.terminate()}
}
