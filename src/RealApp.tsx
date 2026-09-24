import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Linking,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {Session} from '@supabase/supabase-js';
import {supabase} from './backend';
import {captureEvidence} from './evidence';

type Role='ADMIN'|'CREW_LEADER'|'DRIVER';
type Profile={id:string;full_name:string;role:Role;status:string};
type Farm={id:string;code:string;name:string;municipality:string|null;state:string;area_hectares:number|null};
type Crew={id:string;code:string|null;name:string;crew_leader_id:string|null};
type Harvest={id:string;trace_code:string;farm_id:string;crew_id:string|null;status:string;scheduled_date:string|null;notes:string|null};
type Lot={id:string;trace_code:string;harvest_order_id:string;farm_id:string;status:string;agave_count:number|null;average_brix:number|null;actual_weight_kg:number|null};
type Trip={id:string;trace_code:string;driver_id:string|null;status:string;destination_name:string|null;departed_at:string|null;arrived_at:string|null};
type Delivery={id:string;trace_code:string;trip_id:string;status:string;recipient_company:string;accepted_weight_kg:number|null;rejected_weight_kg:number|null;received_by_name:string|null};
type Weighing={id:string;trip_id:string;weighing_type:string;gross_weight_kg:number; tare_weight_kg:number;net_weight_kg:number;ticket_storage_path:string|null};
type TripLot={trip_id:string;agave_lot_id:string};
type FileRow={id:string;harvest_order_id?:string;delivery_id?:string;storage_bucket:string;storage_path:string};
type Pane='home'|'farms'|'harvests'|'trips'|'deliveries';
const green='#164B3A';
function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable disabled={disabled} onPress={onPress} style={[styles.button,disabled&&{opacity:.5}]}><Text style={styles.buttonText}>{label}</Text></Pressable>}
function Input({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <View><Text style={styles.label}>{label}</Text><TextInput autoCapitalize="none" style={styles.input} value={value} onChangeText={onChange}/></View>}
function check(error:{message:string}|null){if(error)throw new Error(error.message)}
function requiredText(value:string,label:string,maxLength:number){const clean=value.trim().replace(/\s+/g,' ');if(!clean)throw Error(`${label} es obligatorio`);if(clean.length>maxLength)throw Error(`${label} no puede superar ${maxLength} caracteres`);return clean}
function decimal(value:string,label:string,min:number,max:number){const normalized=value.trim().replace(',','.');if(!normalized)throw Error(`${label} es obligatorio`);const parsed=Number(normalized);if(!Number.isFinite(parsed)||parsed<min||parsed>max)throw Error(`${label} debe estar entre ${min} y ${max}`);return parsed}
function integer(value:string,label:string,min:number,max:number){const parsed=decimal(value,label,min,max);if(!Number.isInteger(parsed))throw Error(`${label} debe ser un número entero`);return parsed}
function isoDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('La fecha debe tener el formato AAAA-MM-DD');const parsed=new Date(`${value}T00:00:00Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error('La fecha no es válida');return value}
function confirm(title:string,message:string,run:()=>void){Alert.alert(title,message,[{text:'Cancelar',style:'cancel'},{text:'Confirmar',style:'default',onPress:run}])}
export default function RealApp(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [profile,setProfile]=useState<Profile|null>(null),[organizationId,setOrganizationId]=useState('');
 const [farms,setFarms]=useState<Farm[]>([]),[crews,setCrews]=useState<Crew[]>([]),[harvests,setHarvests]=useState<Harvest[]>([]),[lots,setLots]=useState<Lot[]>([]),[trips,setTrips]=useState<Trip[]>([]),[tripLots,setTripLots]=useState<TripLot[]>([]),[deliveries,setDeliveries]=useState<Delivery[]>([]),[weighings,setWeighings]=useState<Weighing[]>([]),[harvestPhotos,setHarvestPhotos]=useState<FileRow[]>([]),[deliveryPhotos,setDeliveryPhotos]=useState<FileRow[]>([]),[drivers,setDrivers]=useState<Profile[]>([]);
 const [pane,setPane]=useState<Pane>('home'),[selected,setSelected]=useState(''),[farmCode,setFarmCode]=useState(''),[farmName,setFarmName]=useState(''),[farmState,setFarmState]=useState('Jalisco');
 const [farmId,setFarmId]=useState(''),[crewId,setCrewId]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [lotCount,setLotCount]=useState(''),[lotBrix,setLotBrix]=useState(''),[lotWeight,setLotWeight]=useState('');
 const [tripLotId,setTripLotId]=useState(''),[tripDriverId,setTripDriverId]=useState(''),[destination,setDestination]=useState('Destino de prueba');
 const [gross,setGross]=useState(''),[tare,setTare]=useState(''),[ticketNumber,setTicketNumber]=useState('');
 const [receiver,setReceiver]=useState(''),[accepted,setAccepted]=useState(''),[rejected,setRejected]=useState(''),[rejectionReason,setRejectionReason]=useState('');
 useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data:{session},error})=>{if(error)setError(error.message);setSession(session);setLoading(false)});const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);if(!next){setProfile(null);setOrganizationId('');setFarms([]);setCrews([]);setHarvests([]);setLots([]);setTrips([]);setTripLots([]);setDeliveries([]);setWeighings([]);setHarvestPhotos([]);setDeliveryPhotos([]);setDrivers([])}});return()=>subscription.unsubscribe()},[]);
 const load=useCallback(async()=>{if(!supabase||!session)return;setError('');try{
  const {data:p,error:pe}=await supabase.from('profiles').select('id,full_name,role,status').eq('id',session.user.id).single();check(pe);if(!p||p.status!=='ACTIVE')throw Error('Tu perfil no está activo.');setProfile(p as Profile);
  const {data:membership,error:me}=await supabase.from('organization_members').select('organization_id').eq('profile_id',session.user.id).eq('active',true).single();check(me);if(!membership)throw Error('No tienes una organización activa.');const org=membership.organization_id;setOrganizationId(org);
  const [f,c,h,l,t,tl,d,w,hp,dp,dr]=await Promise.all([
   supabase.from('farms').select('id,code,name,municipality,state,area_hectares').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('crews').select('id,code,name,crew_leader_id').eq('organization_id',org),
   supabase.from('harvest_orders').select('id,trace_code,farm_id,crew_id,status,scheduled_date,notes').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('agave_lots').select('id,trace_code,harvest_order_id,farm_id,status,agave_count,average_brix,actual_weight_kg').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trips').select('id,trace_code,driver_id,status,destination_name,departed_at,arrived_at').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trip_lots').select('trip_id,agave_lot_id'),
   supabase.from('deliveries').select('id,trace_code,trip_id,status,recipient_company,accepted_weight_kg,rejected_weight_kg,received_by_name').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('weighings').select('id,trip_id,weighing_type,gross_weight_kg,tare_weight_kg,net_weight_kg,ticket_storage_path'),
   supabase.from('harvest_evidence').select('id,harvest_order_id,storage_bucket,storage_path'),
   supabase.from('delivery_evidence').select('id,delivery_id,storage_bucket,storage_path'),
   supabase.from('profiles').select('id,full_name,role,status').eq('role','DRIVER').eq('status','ACTIVE')
  ]);for(const result of [f,c,h,l,t,tl,d,w,hp,dp,dr])check(result.error);setFarms((f.data??[]) as Farm[]);setCrews((c.data??[]) as Crew[]);setHarvests((h.data??[]) as Harvest[]);setLots((l.data??[]) as Lot[]);setTrips((t.data??[]) as Trip[]);setTripLots((tl.data??[]) as TripLot[]);setDeliveries((d.data??[]) as Delivery[]);setWeighings((w.data??[]) as Weighing[]);setHarvestPhotos((hp.data??[]) as FileRow[]);setDeliveryPhotos((dp.data??[]) as FileRow[]);setDrivers((dr.data??[]) as Profile[]);
 }catch(e){setError(String(e))}},[session]);
 useEffect(()=>{if(session)void load()},[session,load]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load()}catch(e){setError(String(e));Alert.alert('No se pudo completar',String(e))}finally{setBusy(false)}};
 const login=()=>action(async()=>{if(!supabase)throw Error('Falta configurar Supabase');const normalized=email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))throw Error('Escribe un correo válido');if(!password)throw Error('Escribe tu contraseña');const {error}=await supabase.auth.signInWithPassword({email:normalized,password});check(error);setPassword('')});
 const createFarm=()=>action(async()=>{if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const code=requiredText(farmCode,'Código',40).toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))throw Error('El código sólo puede contener letras, números, guion y guion bajo');const name=requiredText(farmName,'Nombre',120),state=requiredText(farmState,'Estado',80);const {error}=await supabase.from('farms').insert({organization_id:organizationId,code,name,state,country:'México',created_by:session.user.id});check(error);setFarmCode('');setFarmName('')});
 const createHarvest=()=>action(async()=>{if(!supabase||!session||!organizationId)throw Error('Sesión inválida');if(!farmId||!crewId)throw Error('Selecciona predio y cuadrilla');const scheduledDate=isoDate(date);const {error}=await supabase.from('harvest_orders').insert({organization_id:organizationId,farm_id:farmId,crew_id:crewId,scheduled_date:scheduledDate,status:'ASSIGNED',created_by:session.user.id});check(error);setFarmId('');setCrewId('')});
 const updateHarvest=(h:Harvest)=>action(async()=>{if(!supabase)throw Error('Falta configurar Supabase');const next=h.status==='ASSIGNED'?'IN_PROGRESS':h.status==='IN_PROGRESS'?'HARVESTED':null;if(!next)throw Error('Esta jima no tiene avance disponible');const {data,error}=await supabase.rpc('advance_harvest',{p_harvest_id:h.id});check(error);if(data!==next)throw Error('El servidor no confirmó el nuevo estado de la jima')});
 const addLot=(h:Harvest)=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');if(h.status!=='IN_PROGRESS')throw Error('La jima debe estar en curso');const count=integer(lotCount,'Agaves cosechados',1,100000),brix=decimal(lotBrix,'Brix promedio',0,50),weight=decimal(lotWeight,'Peso del lote',0.01,200000);
  const {error}=await supabase.from('agave_lots').insert({organization_id:organizationId,harvest_order_id:h.id,farm_id:h.farm_id,agave_count:count,average_brix:brix,actual_weight_kg:weight,harvest_date:new Date().toISOString().slice(0,10),created_by:session.user.id});check(error);setLotCount('');setLotBrix('');setLotWeight('');
 });
 const measureLot=(lot:Lot)=>action(async()=>{
  if(!supabase)throw Error('Falta configurar Supabase');const harvest=harvests.find(h=>h.id===lot.harvest_order_id);if(harvest?.status!=='IN_PROGRESS'||lot.status!=='OPEN')throw Error('Sólo se puede medir un lote abierto durante una jima en curso');const count=integer(lotCount,'Agaves cosechados',1,100000),brix=decimal(lotBrix,'Brix promedio',0,50),weight=decimal(lotWeight,'Peso del lote',0.01,200000);
  const {data,error}=await supabase.from('agave_lots').update({agave_count:count,average_brix:brix,actual_weight_kg:weight,harvest_date:new Date().toISOString().slice(0,10)}).eq('id',lot.id).eq('status','OPEN').select('id');check(error);if(!data?.length)throw Error('No se actualizó el lote; revisa permisos RLS');setLotCount('');setLotBrix('');setLotWeight('');
 });
 const addPhoto=(kind:'harvest'|'delivery',id:string)=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');
  const photo=await captureEvidence(kind,organizationId,id,session.user.id);if(!photo)return;
  if(kind==='harvest'){
   const {error}=await supabase.from('harvest_evidence').insert({harvest_order_id:id,evidence_type:'PHOTO',storage_bucket:photo.bucket,storage_path:photo.path,mime_type:photo.mimeType,file_size_bytes:photo.size,latitude:photo.latitude,longitude:photo.longitude,captured_at:photo.capturedAt,uploaded_by:session.user.id});check(error);
  }else{
   const {error}=await supabase.from('delivery_evidence').insert({delivery_id:id,evidence_type:'PHOTO',storage_bucket:photo.bucket,storage_path:photo.path,mime_type:photo.mimeType,file_size_bytes:photo.size,captured_at:photo.capturedAt,uploaded_by:session.user.id});check(error);
  }
 });
 const openPhoto=(bucket:string,path:string)=>action(async()=>{if(!supabase)throw Error('Falta configurar Supabase');const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,60);check(error);if(data?.signedUrl)await Linking.openURL(data.signedUrl)});
 const createTrip=()=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const lot=lots.find(l=>l.id===tripLotId);
  if(!lot||!tripDriverId)throw Error('Selecciona lote y chofer');const destinationName=requiredText(destination,'Destino',120);
  if(lot.status!=='HARVESTED'||harvests.find(h=>h.id===lot.harvest_order_id)?.status!=='HARVESTED')throw Error('El lote y la jima deben estar cosechados antes de programar el viaje');
  if(tripLots.some(link=>link.agave_lot_id===lot.id))throw Error('Este lote ya está asignado a un viaje');
  const {data:trip,error:tripError}=await supabase.from('trips').insert({organization_id:organizationId,driver_id:tripDriverId,origin_farm_id:lot.farm_id,destination_name:destinationName,status:'ASSIGNED',created_by:session.user.id}).select('id').single();check(tripError);if(!trip)throw Error('No se creó el viaje');
  const {error:lotError}=await supabase.from('trip_lots').insert({trip_id:trip.id,agave_lot_id:lot.id,loaded_weight_kg:lot.actual_weight_kg,loaded_agave_count:lot.agave_count,created_by:session.user.id});check(lotError);
  const {error:deliveryError}=await supabase.from('deliveries').insert({organization_id:organizationId,trip_id:trip.id,recipient_company:destinationName,status:'PENDING',created_by:session.user.id});check(deliveryError);setTripLotId('');setTripDriverId('');
 });
 const addWeighing=(trip:Trip,withTicket=false)=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const g=decimal(gross,'Peso bruto',0.01,200000),t=decimal(tare,'Tara',0,200000);
  if(!['ASSIGNED','LOADING','ARRIVED'].includes(trip.status))throw Error('El pesaje se registra en origen antes de salir o al llegar a destino');
  if(g<=t)throw Error('El peso bruto debe superar la tara');const weighingType=trip.status==='ARRIVED'?'DESTINATION':'ORIGIN';if(weighings.some(w=>w.trip_id===trip.id&&w.weighing_type===weighingType))throw Error(`Ya existe el pesaje de ${weighingType==='ORIGIN'?'origen':'destino'}`);
  const photo=withTicket?await captureEvidence('weighing',organizationId,trip.id,session.user.id):null;if(withTicket&&!photo)return;
  const ticket=ticketNumber.trim();if(ticket.length>80)throw Error('El folio de báscula no puede superar 80 caracteres');const {error}=await supabase.from('weighings').insert({trip_id:trip.id,weighing_type:weighingType,gross_weight_kg:g,tare_weight_kg:t,net_weight_kg:g-t,ticket_number:ticket||null,storage_bucket:photo?.bucket??null,ticket_storage_path:photo?.path??null,recorded_by:session.user.id});check(error);setGross('');setTare('');setTicketNumber('');
 });
 const advanceTrip=(trip:Trip)=>action(async()=>{
  if(!supabase)throw Error('Falta configurar Supabase');const transitions:Record<string,string>={ASSIGNED:'LOADING',LOADING:'IN_TRANSIT',IN_TRANSIT:'ARRIVED'};
  const next=transitions[trip.status];if(!next)throw Error('El viaje no tiene un avance disponible');
  const {data,error}=await supabase.rpc('advance_trip',{p_trip_id:trip.id});check(error);if(data!==next)throw Error('El servidor no confirmó el nuevo estado del viaje');
 });
 const finishDelivery=(d:Delivery)=>action(async()=>{
  if(!supabase)throw Error('Falta configurar Supabase');const trip=trips.find(t=>t.id===d.trip_id),receiverName=requiredText(receiver,'Nombre de quien recibe',120),weight=decimal(accepted||'0','Peso aceptado',0,200000),rejectedWeight=decimal(rejected||'0','Peso rechazado',0,200000);
  if(!trip||trip.status!=='ARRIVED')throw Error('Primero registra la llegada del viaje');
  if(weight+rejectedWeight<=0)throw Error('El peso total recibido debe ser mayor que cero');const reason=rejectionReason.trim();if(rejectedWeight>0&&!reason)throw Error('Indica el motivo del rechazo');if(reason.length>300)throw Error('El motivo del rechazo no puede superar 300 caracteres');
  if(!weighings.some(w=>w.trip_id===trip.id&&w.weighing_type==='DESTINATION'))throw Error('Registra el pesaje de destino antes de cerrar');
  const destinationWeight=weighings.filter(w=>w.trip_id===trip.id&&w.weighing_type==='DESTINATION').at(-1)?.net_weight_kg;
  if(destinationWeight!=null&&Math.abs(weight+rejectedWeight-Number(destinationWeight))>1)throw Error('La suma aceptada y rechazada debe coincidir con el peso neto de destino (tolerancia de 1 kg)');
  if(!deliveryPhotos.some(photo=>photo.delivery_id===d.id))throw Error('Adjunta una fotografía del recibo antes de cerrar la entrega');
  const {data,error}=await supabase.rpc('complete_delivery',{p_delivery_id:d.id,p_received_by_name:receiverName,p_accepted_weight_kg:weight,p_rejected_weight_kg:rejectedWeight,p_rejection_reason:reason||null});check(error);if(data!=='COMPLETED')throw Error('El servidor no confirmó el cierre de la entrega');setReceiver('');setAccepted('');setRejected('');setRejectionReason('');
 });
 if(loading)return <SafeAreaView style={styles.center}><ActivityIndicator color={green}/></SafeAreaView>;
 if(!session)return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><Text style={styles.brand}>AGAVE / TRAZA</Text><Text style={styles.title}>Acceso a la operación real</Text><Text>Ingresa con tu usuario de la app. Los datos se leen de Supabase según tus permisos.</Text><Input label="Correo" value={email} onChange={setEmail}/><View><Text style={styles.label}>Contraseña</Text><TextInput secureTextEntry style={styles.input} value={password} onChangeText={setPassword}/></View><Button label="Iniciar sesión" onPress={login} disabled={busy}/>{error?<Text style={styles.error}>{error}</Text>:null}</ScrollView></SafeAreaView>;
 return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><Text style={styles.brand}>AGAVE / TRAZA</Text><Text style={styles.small}>{profile?.full_name??session.user.email} · {profile?.role??'Cargando perfil'}</Text><View style={styles.row}><Button label="Inicio" onPress={()=>{setPane('home');setSelected('')}}/><Button label="Actualizar" onPress={()=>void action(async()=>{})} disabled={busy}/></View>{error?<Text style={styles.error}>{error}</Text>:null}
 {pane==='home'&&<><Text style={styles.title}>Operación</Text><Button label={`Predios (${farms.length})`} onPress={()=>setPane('farms')}/><Button label={`Jimas (${harvests.length})`} onPress={()=>setPane('harvests')}/><Button label={`Viajes (${trips.length})`} onPress={()=>setPane('trips')}/><Button label={`Entregas (${deliveries.length})`} onPress={()=>setPane('deliveries')}/><Button label="Cerrar sesión" onPress={()=>void supabase?.auth.signOut()}/></>}
 {pane==='farms'&&<><Text style={styles.title}>Predios visibles</Text>{farms.map(f=><View key={f.id} style={styles.card}><Text style={styles.heading}>{f.name}</Text><Text>{f.code} · {f.municipality??f.state}</Text></View>)}{profile?.role==='ADMIN'&&<><Text style={styles.heading}>Nuevo predio</Text><Input label="Código" value={farmCode} onChange={setFarmCode}/><Input label="Nombre" value={farmName} onChange={setFarmName}/><Input label="Estado" value={farmState} onChange={setFarmState}/><Button label="Guardar predio" onPress={createFarm} disabled={busy}/></>}</>}
 {pane==='harvests'&&<>
  <Text style={styles.title}>Jimas visibles</Text>
  {harvests.map(h=><View key={h.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===h.id?'':h.id)}><Text style={styles.heading}>{h.trace_code} {selected===h.id?'▲':'▼'}</Text><Text>{farms.find(f=>f.id===h.farm_id)?.name??'Predio'} · {h.status} · {h.scheduled_date??'Sin fecha'}</Text></Pressable>
   {selected===h.id&&<>
    <Text>Cuadrilla: {crews.find(c=>c.id===h.crew_id)?.name??'Sin asignar'}</Text>
    {h.notes?<Text>{h.notes}</Text>:null}
    {lots.filter(l=>l.harvest_order_id===h.id).map(l=><View key={l.id}><Text>Lote {l.trace_code}: {l.agave_count??'—'} agaves · {l.average_brix??'—'} °Brix · {l.actual_weight_kg??'—'} kg</Text>{h.status==='IN_PROGRESS'&&l.status==='OPEN'&&(profile?.role==='ADMIN'||profile?.role==='CREW_LEADER')&&<Button label={`Guardar mediciones en ${l.trace_code}`} onPress={()=>measureLot(l)} disabled={busy}/>}</View>)}
    <Text>Evidencias: {harvestPhotos.filter(p=>p.harvest_order_id===h.id).length}</Text>
    {harvestPhotos.filter(p=>p.harvest_order_id===h.id).map(p=><Button key={p.id} label="Ver fotografía" onPress={()=>openPhoto(p.storage_bucket,p.storage_path)}/>)}
    {(profile?.role==='CREW_LEADER'||profile?.role==='ADMIN')&&<>
     <Button label="Tomar foto de jima" onPress={()=>addPhoto('harvest',h.id)} disabled={busy}/>
     {h.status==='IN_PROGRESS'&&<><Input label="Agaves cosechados" value={lotCount} onChange={setLotCount}/><Input label="Brix promedio" value={lotBrix} onChange={setLotBrix}/><Input label="Peso del lote (kg)" value={lotWeight} onChange={setLotWeight}/><Button label="Registrar lote" onPress={()=>addLot(h)} disabled={busy}/></>}
     {(h.status==='ASSIGNED'||h.status==='IN_PROGRESS')&&<Button label={h.status==='ASSIGNED'?'Iniciar jima':'Terminar jima'} onPress={()=>confirm(h.status==='ASSIGNED'?'Iniciar jima':'Terminar jima',h.status==='ASSIGNED'?'La jima quedará en curso.':'La jima y sus lotes quedarán cerrados para operación.',()=>void updateHarvest(h))} disabled={busy}/>} 
    </>}
   </>}
  </View>)}
  {profile?.role==='ADMIN'&&<><Text style={styles.heading}>Programar jima</Text><Text>Predio</Text>{farms.map(f=><Button key={f.id} label={`${farmId===f.id?'✓ ':''}${f.name}`} onPress={()=>setFarmId(f.id)}/>)}<Text>Cuadrilla</Text>{crews.map(c=><Button key={c.id} label={`${crewId===c.id?'✓ ':''}${c.name}`} onPress={()=>setCrewId(c.id)}/>)}<Input label="Fecha (AAAA-MM-DD)" value={date} onChange={setDate}/><Button label="Crear jima" onPress={createHarvest} disabled={busy}/></>}
 </>}
 {pane==='trips'&&<>
  <Text style={styles.title}>Viajes visibles</Text>
  {trips.map(t=><View key={t.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===t.id?'':t.id)}><Text style={styles.heading}>{t.trace_code} {selected===t.id?'▲':'▼'}</Text><Text>{t.status} · {t.destination_name??'Sin destino'}</Text></Pressable>
   {selected===t.id&&<>
    <Text>Pesajes: {weighings.filter(w=>w.trip_id===t.id).length}</Text>
    {weighings.filter(w=>w.trip_id===t.id).map(w=><View key={w.id}><Text>{w.weighing_type}: bruto {w.gross_weight_kg} − tara {w.tare_weight_kg} = neto {w.net_weight_kg} kg</Text>{w.ticket_storage_path&&<Button label="Ver ticket" onPress={()=>openPhoto('weighing-tickets',w.ticket_storage_path!)}/>}</View>)}
    {(profile?.role==='ADMIN'||profile?.role==='DRIVER'&&t.driver_id===session.user.id)&&<>
     {['ASSIGNED','LOADING','ARRIVED'].includes(t.status)&&!weighings.some(w=>w.trip_id===t.id&&w.weighing_type===(t.status==='ARRIVED'?'DESTINATION':'ORIGIN'))&&<>
     <Input label="Peso bruto (kg)" value={gross} onChange={setGross}/><Input label="Tara (kg)" value={tare} onChange={setTare}/><Input label="Folio de báscula (opcional)" value={ticketNumber} onChange={setTicketNumber}/>
     <Button label="Guardar pesaje" onPress={()=>addWeighing(t)} disabled={busy}/><Button label="Fotografiar ticket y guardar pesaje" onPress={()=>addWeighing(t,true)} disabled={busy}/>
     </>}
     {['ASSIGNED','LOADING','IN_TRANSIT'].includes(t.status)&&<Button label={t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada'} onPress={()=>confirm(t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada',`El viaje avanzará de ${t.status} al siguiente estado.`,()=>void advanceTrip(t))} disabled={busy}/>} 
    </>}
   </>}
  </View>)}
  {profile?.role==='ADMIN'&&<><Text style={styles.heading}>Crear viaje y entrega</Text><Text>Lote</Text>{lots.map(l=><Button key={l.id} label={`${tripLotId===l.id?'✓ ':''}${l.trace_code}`} onPress={()=>setTripLotId(l.id)}/>)}<Text>Chofer</Text>{drivers.map(d=><Button key={d.id} label={`${tripDriverId===d.id?'✓ ':''}${d.full_name}`} onPress={()=>setTripDriverId(d.id)}/>)}<Input label="Destino" value={destination} onChange={setDestination}/><Button label="Crear viaje asignado" onPress={createTrip} disabled={busy}/></>}
 </>}
 {pane==='deliveries'&&<>
  <Text style={styles.title}>Entregas visibles</Text>
  {deliveries.map(d=><View key={d.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===d.id?'':d.id)}><Text style={styles.heading}>{d.trace_code} {selected===d.id?'▲':'▼'}</Text><Text>{d.recipient_company} · {d.status}</Text></Pressable>
   {selected===d.id&&<>
    <Text>Viaje: {trips.find(t=>t.id===d.trip_id)?.trace_code??d.trip_id}</Text><Text>Receptor: {d.received_by_name??'Pendiente'} · aceptado: {d.accepted_weight_kg??'—'} kg · rechazado: {d.rejected_weight_kg??'—'} kg</Text>
    <Text>Fotos: {deliveryPhotos.filter(p=>p.delivery_id===d.id).length}</Text>
    {deliveryPhotos.filter(p=>p.delivery_id===d.id).map(p=><Button key={p.id} label="Ver recibo fotografiado" onPress={()=>openPhoto(p.storage_bucket,p.storage_path)}/>)}
    {(profile?.role==='ADMIN'||profile?.role==='DRIVER'&&trips.find(t=>t.id===d.trip_id)?.driver_id===session.user.id)&&d.status!=='COMPLETED'&&<>
     <Button label="Fotografiar recibo" onPress={()=>addPhoto('delivery',d.id)} disabled={busy}/><Input label="Nombre de quien recibe" value={receiver} onChange={setReceiver}/><Input label="Peso aceptado (kg)" value={accepted} onChange={setAccepted}/><Input label="Peso rechazado (kg)" value={rejected} onChange={setRejected}/><Input label="Motivo del rechazo (si aplica)" value={rejectionReason} onChange={setRejectionReason}/><Button label="Cerrar entrega" onPress={()=>confirm('Cerrar entrega','Los pesos, el receptor y el recibo quedarán registrados y el viaje se marcará como entregado.',()=>void finishDelivery(d))} disabled={busy}/>
    </>}
   </>}
  </View>)}
 </>}
 {busy&&<ActivityIndicator color={green}/>}</ScrollView></SafeAreaView>
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#F8FAF8'},center:{flex:1,justifyContent:'center'},body:{padding:22,paddingBottom:65,gap:13},brand:{fontSize:15,fontWeight:'900',color:green,letterSpacing:3,marginTop:18},title:{fontSize:26,fontWeight:'800',color:'#173027',marginVertical:10},heading:{fontWeight:'700',fontSize:18,color:'#173027'},small:{color:'#60746A'},label:{fontWeight:'700',color:'#173027',marginBottom:5},input:{backgroundColor:'white',borderWidth:1,borderColor:'#CCD8CF',borderRadius:10,padding:13,fontSize:16},button:{backgroundColor:green,padding:13,borderRadius:12,marginTop:4,alignSelf:'stretch'},buttonText:{color:'white',textAlign:'center',fontWeight:'700'},card:{backgroundColor:'white',padding:16,borderRadius:13,borderColor:'#E1E9E3',borderWidth:1,gap:6},row:{flexDirection:'row',gap:10},error:{color:'#9B2424',backgroundColor:'#FCE9E9',padding:12,borderRadius:10}});
