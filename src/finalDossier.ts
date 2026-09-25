import {buildDossier,DossierImage} from './dossier';

export type IssuedDossier={id:string;harvest_order_id:string;buyer_name:string;version:number;cutoff_at:string;issued_by:string;sha256:string;snapshot:any};

// El HTML sólo se representa desde la instantánea persistida, nunca desde tarjetas actuales.
export function renderIssuedDossier(issued:IssuedDossier,images:DossierImage[]){
 const s=issued.snapshot;
 const result=buildDossier({harvest:s.harvest,farm:s.farm,crew:s.crew,lots:s.lots??[],trips:s.trips??[],links:s.links??[],weighings:s.weighings??[],deliveries:s.deliveries??[],drivers:s.drivers??[],images,generatedAt:issued.cutoff_at,organizationId:s.organization_id,buyerName:issued.buyer_name,varianceLimitKg:Number(s.variance_settings?.limit_kg??10),varianceLimitPercent:Number(s.variance_settings?.limit_percent??2),varianceNotes:s.variance_reviews??[],corrections:s.corrections??[]});
 const stamp=`<div style="padding:15px;background:#dff1df;border:1px solid #164b3a;overflow-wrap:anywhere"><strong>VERSIÓN FINAL ${issued.version}</strong><br>Fecha de corte: ${new Date(issued.cutoff_at).toISOString()}<br>Emitido por usuario: ${issued.issued_by}<br>SHA-256 de la instantánea en Supabase: ${issued.sha256}<br>Identificador de versión: ${issued.id}</div>`;
 return result.html.replace('<main>',`<main>${stamp}`);
}
