/** PDF descargable sin servicios externos: texto y fotografías privadas descargadas con la sesión actual. */
export type PdfPhoto={label:string;blob:Blob};
const encoder=new TextEncoder();
const clean=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?');
const escapePdf=(value:string)=>clean(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const bytes=(value:string)=>encoder.encode(value);
const join=(chunks:Uint8Array[])=>{const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length}return out};
const photoJpeg=async(blob:Blob)=>{
 const url=URL.createObjectURL(blob);
 try{
  const img=new window.Image();img.src=url;await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error('No se pudo convertir una fotografía a PDF'))});
  const scale=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo preparar la fotografía');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',.83).split(',')[1];const raw=atob(data);const result=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)result[i]=raw.charCodeAt(i);
  return {data:result,width:canvas.width,height:canvas.height};
 }finally{URL.revokeObjectURL(url)}
};
/** Mantiene los datos en páginas A4 y añade una página por evidencia. */
export async function makeTripPdf(lines:string[],photos:PdfPhoto[]):Promise<Blob>{
 const objects:Uint8Array[]=[];const add=(content:Uint8Array|string)=>{objects.push(typeof content==='string'?bytes(content):content);return objects.length};
 const catalog=add(''),pagesRoot=add(''),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 const pages:number[]=[];const pageLines:string[]=[];
 for(const line of lines){let text=clean(line);if(!text){pageLines.push('');continue}while(text.length>92){let cut=text.lastIndexOf(' ',92);if(cut<25)cut=92;pageLines.push(text.slice(0,cut));text=text.slice(cut).trimStart()}pageLines.push(text)}
 for(let start=0;start<pageLines.length;start+=49){const part=pageLines.slice(start,start+49);const stream=`BT /F1 11 Tf 46 790 Td 15 TL ${part.map((line,i)=>`${i?'T* ':''}(${escapePdf(line)}) Tj`).join('\n')} ET`;
  const streamBytes=bytes(stream),content=add(join([bytes(`<< /Length ${streamBytes.length} >>\nstream\n`),streamBytes,bytes('\nendstream')]));
  pages.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
 }
 for(const photo of photos){const jpeg=await photoJpeg(photo.blob);
  const image=add(join([bytes(`<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.data.length} >>\nstream\n`),jpeg.data,bytes('\nendstream')]));
  const ratio=Math.min(500/jpeg.width,690/jpeg.height),w=jpeg.width*ratio,h=jpeg.height*ratio;
  const stream=`BT /F1 12 Tf 46 790 Td (${escapePdf(photo.label)}) Tj ET\nq ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${((595-w)/2).toFixed(2)} ${(750-h).toFixed(2)} cm /Photo Do Q`;
  const contentBytes=bytes(stream),content=add(join([bytes(`<< /Length ${contentBytes.length} >>\nstream\n`),contentBytes,bytes('\nendstream')]));
  pages.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Photo ${image} 0 R >> >> /Contents ${content} 0 R >>`));
 }
 objects[catalog-1]=bytes(`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`);
 objects[pagesRoot-1]=bytes(`<< /Type /Pages /Kids [${pages.map(id=>`${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
 const chunks=[bytes('%PDF-1.4\n%\xD0\xD4\xC5\xD8\n')],offsets=[0];let total=chunks[0].length;
 objects.forEach((obj,i)=>{offsets.push(total);const section=join([bytes(`${i+1} 0 obj\n`),obj,bytes('\nendobj\n')]);chunks.push(section);total+=section.length});
 const xref=total;chunks.push(bytes(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`));
 return new Blob(chunks as BlobPart[],{type:'application/pdf'});
}
