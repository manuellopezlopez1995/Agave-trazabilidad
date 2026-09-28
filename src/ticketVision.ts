import type {Session} from '@supabase/supabase-js';
import {parseTicketPasses,TicketReading,TicketDiagnostics} from './ticketOcr';

const url=process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
export const visionEnabled=process.env.EXPO_PUBLIC_VISION_OCR_ENABLED==='true';

export async function readTicketWithVision(blob:Blob,tripId:string,session:Session,onProgress?:(d:TicketDiagnostics)=>void):Promise<TicketReading>{
 if(!url||!key)throw Error('OCR_NOT_CONFIGURED: falta la configuración pública de Supabase');
 if(!navigator.onLine)throw Error('OCR_OFFLINE: la lectura de servidor requiere conexión; conserva la fotografía');
 const progress:TicketDiagnostics={passes:[],candidates:{gross:[],tare:[],printedNet:[],folio:[],date:[],time:[]},selected:{},validation:[],failureCodes:{},engineStatus:'INICIADO',stage:'enviando fotografía original al servidor'};
 onProgress?.(progress);
 let response:Response;
 try{response=await fetch(`${url}/functions/v1/ticket-vision-ocr`,{
  method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:key,'Content-Type':blob.type||'image/jpeg','x-trip-id':tripId},
  body:blob,signal:AbortSignal.timeout(55000),
 })}catch(e){throw Error(e instanceof Error&&e.name==='TimeoutError'?'OCR_TIMEOUT: servidor no respondió':`OCR_ENGINE_FAILED: ${String(e)}`)}
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw Error(`${result?.code??'OCR_ENGINE_FAILED'}: ${response.status}`);
 if(typeof result?.rawText!=='string'||typeof result?.imageSha256!=='string')throw Error('PARSER_FAILED: respuesta OCR incompleta');
 const pages=Array.isArray(result.fullTextAnnotation?.pages)?result.fullTextAnnotation.pages:[];
 const blocks=pages.flatMap((p:any)=>p.blocks??[]);
 const confidences=blocks.map((b:any)=>Number(b.confidence)*100).filter((c:number)=>Number.isFinite(c)&&c>0);
 const confidence=confidences.length?Math.round(confidences.reduce((a:number,b:number)=>a+b,0)/confidences.length):0;
 const reading=parseTicketPasses([{name:'Google Vision, fotografía original',text:result.rawText,confidence}]);
 reading.diagnostics!.engineStatus='COMPLETADO';reading.diagnostics!.stage='OCR de servidor y parser completados';
 reading.diagnostics!.image={sha256:result.imageSha256,bytes:blob.size};
 reading.diagnostics!.passes[0].status='OK';
 if(!result.rawText.trim())reading.diagnostics!.engineError={code:'OCR_EMPTY_RESULT',message:'Google Vision no devolvió texto'};
 onProgress?.(reading.diagnostics!);
 return reading;
}
