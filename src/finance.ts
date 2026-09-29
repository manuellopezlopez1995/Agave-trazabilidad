export type FinanceLine={trip_id:string;client_name:string;folio:string;delivered_at:string;net_kg:number;price_mxn_per_kg:number|null;amount_mxn:number|null};
export type FinanceAllocation={trip_id:string;amount_mxn:number};
export type FinancePayment={id:string;client_name:string;paid_on:string;amount_mxn:number;reference:string;receipt_path:string|null;created_by:string;created_at:string;reversed:boolean;reversal_reason:string|null;allocations:FinanceAllocation[]};
export type FinanceAudit={id:string;trip_id?:string;client_name?:string;price_mxn_per_kg:number;effective_on?:string;reason:string;created_by:string;created_at:string};
export type FinanceReport={lines:FinanceLine[];payments:FinancePayment[];rules:FinanceAudit[];revisions:FinanceAudit[]};
export const money=(value:number)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(value);
export const kilos=(value:number)=>new Intl.NumberFormat('es-MX',{maximumFractionDigits:3}).format(value);
export const localDay=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
export const monthName=(month:string)=>new Intl.DateTimeFormat('es-MX',{month:'long',timeZone:'UTC'}).format(new Date(`2026-${month}-01T00:00:00Z`));
export function totals(lines:FinanceLine[],payments:FinancePayment[]){
 const ids=new Set(lines.map(x=>x.trip_id));
 const applied=payments.filter(p=>!p.reversed).reduce((sum,p)=>sum+p.allocations.filter(a=>ids.has(a.trip_id)).reduce((n,a)=>n+Number(a.amount_mxn),0),0);
 return {kg:lines.reduce((n,l)=>n+Number(l.net_kg),0),amount:lines.reduce((n,l)=>n+Number(l.amount_mxn??0),0),applied,pending:lines.filter(l=>l.price_mxn_per_kg==null).length};
}
export function advances(payments:FinancePayment[]){return payments.filter(p=>!p.reversed).reduce((n,p)=>n+Number(p.amount_mxn)-p.allocations.reduce((s,a)=>s+Number(a.amount_mxn),0),0)}
export function csv(rows:(string|number|null)[][]){return '\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n')+'\r\n'}
