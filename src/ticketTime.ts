// The scale's printed local time is distinct from photo capture and confirmation.
export function confirmedTicketTime(dateText:string,timeText:string,timeZone='America/Mexico_City'){
 const date=dateText.trim(),time=timeText.trim();
 if(!date&&!time)return undefined;
 const value=ticketWeighedAt(date,time,timeZone);
 if(!value)throw Error('Revisa la fecha y hora del ticket: usa DD/MM/AAAA y HH:MM. Completa ambos campos o déjalos vacíos si no aparecen en la fotografía.');
 return value;
}
export function ticketWeighedAt(dateText?:string|null,timeText?:string|null,timeZone='America/Mexico_City'):string|undefined{
 if(!dateText||!timeText)return undefined;
 const date=dateText.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
 const time=timeText.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/i);
 if(!date||!time)return undefined;
 const day=Number(date[1]),month=Number(date[2]),year=Number(date[3])+(date[3].length===2?2000:0);
 let hour=Number(time[1]);const minute=Number(time[2]);
 if(time[3]){if(hour<1||hour>12)return undefined;hour=hour%12+(time[3].toLowerCase().startsWith('p')?12:0)}
 if(month<1||month>12||day<1||day>31||hour>23||minute>59)return undefined;
 const naive=Date.UTC(year,month-1,day,hour,minute);
 if(new Date(naive).getUTCDate()!==day||new Date(naive).getUTCMonth()!==month-1)return undefined;
 try{
  const offsetAt=(ms:number)=>{const name=new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'shortOffset'}).formatToParts(ms).find(p=>p.type==='timeZoneName')?.value??'';const m=name.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);if(!m)throw Error('Unknown zone offset');return (m[1]==='+'?1:-1)*(Number(m[2])*60+Number(m[3]??0))};
  let utc=naive-offsetAt(naive)*60000;utc=naive-offsetAt(utc)*60000;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(utc);
  const part=(type:string)=>Number(parts.find(p=>p.type===type)?.value);
  if(part('year')!==year||part('month')!==month||part('day')!==day||part('hour')!==hour||part('minute')!==minute)return undefined;
  return new Date(utc).toISOString();
 }catch{return undefined}
}
