import type {FinanceLine,FinancePayment} from './finance';

// Workbook generated in the browser with SpreadsheetML and an uncompressed ZIP.
// Amounts are assigned to trips; unapplied advances are excluded from the debt.
const xml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const dateSerial=(day:string)=>{const [y,m,d]=day.slice(0,10).split('-').map(Number);return (Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000};
const localDay=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const cell=(ref:string,value:string|number|null,style=0,formula?:string,cached?:number)=>{
 const attr=` r="${ref}"${style?` s="${style}"`:''}`;
 if(formula)return `<c${attr}><f>${xml(formula)}</f><v>${cached??''}</v></c>`;
 if(value==null||value==='')return '';
 return typeof value==='number'?`<c${attr}><v>${value}</v></c>`:`<c${attr} t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
};
const row=(i:number,cells:string[])=>`<row r="${i}">${cells.join('')}</row>`;
const enc=new TextEncoder();
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc32=(b:Uint8Array)=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0};
const put16=(a:number[],v:number)=>a.push(v&255,(v>>>8)&255);
const put32=(a:number[],v:number)=>{put16(a,v);put16(a,v>>>16)};
const zip=(files:{name:string;content:string}[])=>{
 const parts:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
 for(const f of files){const name=enc.encode(f.name),body=enc.encode(f.content),crc=crc32(body),local:number[]=[],central:number[]=[];
  put32(local,0x04034b50);put16(local,20);put16(local,0);put16(local,0);put16(local,0);put16(local,0);put32(local,crc);put32(local,body.length);put32(local,body.length);put16(local,name.length);put16(local,0);
  parts.push(Uint8Array.from(local),name,body);
  put32(central,0x02014b50);put16(central,20);put16(central,20);put16(central,0);put16(central,0);put16(central,0);put16(central,0);put32(central,crc);put32(central,body.length);put32(central,body.length);put16(central,name.length);put16(central,0);put16(central,0);put16(central,0);put16(central,0);put32(central,0);put32(central,offset);
  directory.push(Uint8Array.from(central),name);offset+=local.length+name.length+body.length;
 }
 const dirSize=directory.reduce((n,p)=>n+p.length,0),end:number[]=[];
 put32(end,0x06054b50);put16(end,0);put16(end,0);put16(end,files.length);put16(end,files.length);put32(end,dirSize);put32(end,offset);put16(end,0);
 return new Blob([...parts,...directory,Uint8Array.from(end)] as BlobPart[],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
};

export function financeXlsx(client:string,period:string,lines:FinanceLine[],payments:FinancePayment[]):Blob{
 const ordered=[...lines].sort((a,b)=>a.delivered_at.localeCompare(b.delivered_at)||a.folio.localeCompare(b.folio));
 const rows:string[]=[
  row(1,[cell('A1',`Finanzas por cliente · ${client}`,1)]),
  row(2,[cell('A2',period,2)]),
  row(3,[cell('A3','Abonos aplicados a estos viajes. Los anticipos sin aplicar no reducen el adeudo.',2)]),
  row(4,['Fecha del viaje','Viaje','Kilos','Precio por kilo','Total (kilos × precio)','Fecha del abono','Abono'].map((h,i)=>cell(`${'ABCDEFG'[i]}4`,h,3)))]
 ;
 let index=5,amount=0,applied=0,missing=0;
 for(const line of ordered){
  const allocations=payments.filter(p=>!p.reversed).flatMap(p=>p.allocations.filter(a=>a.trip_id===line.trip_id&&Number(a.amount_mxn)>0).map(a=>({date:p.paid_on,amount:Number(a.amount_mxn),id:p.id}))).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const kg=Number(line.net_kg),price=line.price_mxn_per_kg==null?null:Number(line.price_mxn_per_kg);
  if(!Number.isFinite(kg)||kg<0||price!=null&&(!Number.isFinite(price)||price<0))throw Error(`Datos financieros inválidos en ${line.folio}`);
  if(price==null)missing++;else amount+=kg*price;
  for(const a of allocations){if(!Number.isFinite(a.amount))throw Error(`Abono inválido en ${line.folio}`);applied+=a.amount}
  const main=[cell(`A${index}`,dateSerial(localDay(line.delivered_at)),4),cell(`B${index}`,line.folio),cell(`C${index}`,kg,5),cell(`D${index}`,price,6),price==null?'':cell(`E${index}`,null,7,`C${index}*D${index}`,kg*price),cell(`F${index}`,allocations[0]?dateSerial(allocations[0].date):null,4),cell(`G${index}`,allocations[0]?.amount??null,7)];
  rows.push(row(index++,main));
  for(const a of allocations.slice(1)){rows.push(row(index,[cell(`F${index}`,dateSerial(a.date),4),cell(`G${index}`,a.amount,7)]));index++}
 }
 const last=index-1,range=(col:string)=>last>=5?`${col}5:${col}${last}`:`${col}5:${col}5`;
 rows.push(row(index,[cell(`A${index}`,'Totales',8),cell(`E${index}`,null,9,`SUM(${range('E')})`,amount),cell(`G${index}`,null,9,`SUM(${range('G')})`,applied)]));
 const totalRow=index++;
 rows.push(row(index,[cell(`A${index}`,'Adeudo = total − abonos',8),missing?cell(`E${index}`,'Pendiente de precio',10):cell(`E${index}`,null,9,`E${totalRow}-G${totalRow}`,amount-applied)]));
 if(missing)rows.push(row(++index,[cell(`A${index}`,`${missing} viaje(s) sin precio: el total es parcial y el adeudo no está disponible.`,10)]));
 const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="4" width="20" customWidth="1"/><col min="5" max="5" width="28" customWidth="1"/><col min="6" max="6" width="20" customWidth="1"/><col min="7" max="7" width="22" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A4:G${last>=5?last:4}"/></worksheet>`;
 const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yy"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.0000"/><numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><color rgb="FF164B3A"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF164B3A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1E9"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="166" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 return zip([
  {name:'[Content_Types].xml',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
  {name:'_rels/.rels',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
  {name:'xl/workbook.xml',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Finanzas" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'},
  {name:'xl/_rels/workbook.xml.rels',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
  {name:'xl/styles.xml',content:styles},{name:'xl/worksheets/sheet1.xml',content:sheet}
 ]);
}
