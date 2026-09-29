/** Small standalone, multi-page PDF for the administrative finance tables. */
const enc=new TextEncoder();
const safe=(x:string)=>x.replace(/[·–—]/g,' - ').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
export function financePdf(title:string,lines:string[]):Blob{
 const objects:string[]=[];const add=(value:string)=>{objects.push(value);return objects.length};
 const catalog=add(''),root=add(''),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
 const pages:number[]=[];
 for(let offset=0;offset<Math.max(lines.length,1);offset+=52){
  let content='0.08 0.27 0.20 rg 0 780 595 62 re f\n1 1 1 rg BT /F1 15 Tf 42 803 Td ('+safe(title.slice(0,64))+') Tj ET\n';
  const pageLines=lines.slice(offset,offset+52);
  pageLines.forEach((line,i)=>{content+=`0.08 0.20 0.16 rg BT /F1 9 Tf 42 ${757-i*13} Td (${safe(line.slice(0,98))}) Tj ET\n`});
  const stream=add(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
  pages.push(add(`<< /Type /Page /Parent ${root} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
 }
 objects[catalog-1]=`<< /Type /Catalog /Pages ${root} 0 R >>`;
 objects[root-1]=`<< /Type /Pages /Kids [${pages.map(p=>`${p} 0 R`).join(' ')}] /Count ${pages.length} >>`;
 const chunks=[enc.encode('%PDF-1.4\n')];const offsets=[0];let length=chunks[0].length;
 for(let i=0;i<objects.length;i++){offsets.push(length);const part=enc.encode(`${i+1} 0 obj\n${objects[i]}\nendobj\n`);chunks.push(part);length+=part.length}
 const xref=length;chunks.push(enc.encode(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`));
 return new Blob(chunks as BlobPart[],{type:'application/pdf'});
}
