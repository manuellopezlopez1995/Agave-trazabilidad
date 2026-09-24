import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Image,Linking,Platform,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {Session} from '@supabase/supabase-js';
import {supabase} from './backend';
import {captureEvidence} from './evidence';
import {buildDossier,DossierImage} from './dossier';
import {partitionByBuyer,variance,DEFAULT_VARIANCE_KG,DEFAULT_VARIANCE_PERCENT} from './operations';

type Role='ADMIN'|'CREW_LEADER'|'DRIVER';
type Profile={id:string;full_name:string;role:Role;status:string};
type Farm={id:string;code:string;name:string;municipality:string|null;state:string;area_hectares:number|null};
type Crew={id:string;code:string|null;name:string;crew_leader_id:string|null};
type Harvest={id:string;trace_code:string;farm_id:string;crew_id:string|null;status:string;scheduled_date:string|null;notes:string|null};
type Lot={id:string;trace_code:string;harvest_order_id:string;farm_id:string;status:string;agave_count:number|null;average_brix:number|null;actual_weight_kg:number|null};
type Trip={id:string;trace_code:string;driver_id:string|null;status:string;destination_name:string|null;departed_at:string|null;arrived_at:string|null;vehicle_plate?:string|null};
type Delivery={id:string;trace_code:string;trip_id:string;status:string;recipient_company:string;accepted_weight_kg:number|null;rejected_weight_kg:number|null;received_by_name:string|null};
type Weighing={id:string;trip_id:string;weighing_type:string;gross_weight_kg:number; tare_weight_kg:number;net_weight_kg:number;ticket_storage_path:string|null;ticket_number?:string|null;legibility_confirmed?:boolean};
type TripLot={trip_id:string;agave_lot_id:string;loaded_weight_kg:number|null};
type FileRow={id:string;harvest_order_id?:string;delivery_id?:string;storage_bucket:string;storage_path:string;legibility_confirmed?:boolean};
type Pane='home'|'farms'|'harvests'|'trips'|'deliveries'|'team'|'control';
const green='#164B3A';
const roleNames:Record<Role,string>={ADMIN:'Administración',CREW_LEADER:'Jefe de cuadrilla',DRIVER:'Chofer de agave'};
const teamTargets:Record<Role,number>={ADMIN:2,CREW_LEADER:5,DRIVER:10};
const landscape=Platform.OS==='web'?{uri:'/Agave-trazabilidad/altos-agave.svg'}:null;
function SectionTitle({eyebrow,title,description}:{eyebrow:string;title:string;description?:string}){return <View style={styles.sectionHead}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text>{description?<Text style={styles.muted}>{description}</Text>:null}</View>}
function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable disabled={disabled} onPress={onPress} style={[styles.button,disabled&&{opacity:.5}]}><Text style={styles.buttonText}>{label}</Text></Pressable>}
function Input({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <View><Text style={styles.label}>{label}</Text><TextInput autoCapitalize="none" style={styles.input} value={value} onChangeText={onChange}/></View>}
function check(error:{message:string}|null){if(error)throw new Error(error.message)}
function requiredText(value:string,label:string,maxLength:number){const clean=value.trim().replace(/\s+/g,' ');if(!clean)throw Error(`${label} es obligatorio`);if(clean.length>maxLength)throw Error(`${label} no puede superar ${maxLength} caracteres`);return clean}
function decimal(value:string,label:string,min:number,max:number){const normalized=value.trim().replace(',','.');if(!normalized)throw Error(`${label} es obligatorio`);const parsed=Number(normalized);if(!Number.isFinite(parsed)||parsed<min||parsed>max)throw Error(`${label} debe estar entre ${min} y ${max}`);return parsed}
function integer(value:string,label:string,min:number,max:number){const parsed=decimal(value,label,min,max);if(!Number.isInteger(parsed))throw Error(`${label} debe ser un número entero`);return parsed}
function isoDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('La fecha debe tener el formato AAAA-MM-DD');const parsed=new Date(`${value}T00:00:00Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error('La fecha no es válida');return value}
function confirm(title:string,message:string,run:()=>void){if(Platform.OS==='web'){if(window.confirm(`${title}\n\n${message}`))run();return}Alert.alert(title,message,[{text:'Cancelar',style:'cancel'},{text:'Confirmar',style:'default',onPress:run}])}
function showError(message:string){if(Platform.OS==='web')window.alert(message);else Alert.alert('No se pudo completar',message)}
export default function RealApp(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [profile,setProfile]=useState<Profile|null>(null),[organizationId,setOrganizationId]=useState('');
 const [farms,setFarms]=useState<Farm[]>([]),[crews,setCrews]=useState<Crew[]>([]),[harvests,setHarvests]=useState<Harvest[]>([]),[lots,setLots]=useState<Lot[]>([]),[trips,setTrips]=useState<Trip[]>([]),[tripLots,setTripLots]=useState<TripLot[]>([]),[deliveries,setDeliveries]=useState<Delivery[]>([]),[weighings,setWeighings]=useState<Weighing[]>([]),[harvestPhotos,setHarvestPhotos]=useState<FileRow[]>([]),[deliveryPhotos,setDeliveryPhotos]=useState<FileRow[]>([]),[drivers,setDrivers]=useState<Profile[]>([]);
 const [pane,setPane]=useState<Pane>('home'),[selected,setSelected]=useState(''),[farmCode,setFarmCode]=useState(''),[farmName,setFarmName]=useState(''),[farmState,setFarmState]=useState('Jalisco');
 const [farmId,setFarmId]=useState(''),[crewId,setCrewId]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [lotCount,setLotCount]=useState(''),[lotBrix,setLotBrix]=useState(''),[lotWeight,setLotWeight]=useState('');
 const [tripLotId,setTripLotId]=useState(''),[tripDriverId,setTripDriverId]=useState(''),[destination,setDestination]=useState(''),[vehiclePlate,setVehiclePlate]=useState('');
 const [gross,setGross]=useState(''),[tare,setTare]=useState(''),[ticketNumber,setTicketNumber]=useState('');
 const [receiver,setReceiver]=useState(''),[accepted,setAccepted]=useState(''),[rejected,setRejected]=useState(''),[rejectionReason,setRejectionReason]=useState('');
 const [photoUrl,setPhotoUrl]=useState('');
 const [photoLoading,setPhotoLoading]=useState(false),[exporting,setExporting]=useState(false);
 const [team,setTeam]=useState<Profile[]>([]),[teamError,setTeamError]=useState('');
 const [search,setSearch]=useState(''),[varianceReason,setVarianceReason]=useState(''),[varianceNotes,setVarianceNotes]=useState<{trip_id:string;reason:string;created_at:string}[]>([]),[varianceLimitKg,setVarianceLimitKg]=useState(DEFAULT_VARIANCE_KG),[varianceLimitPercent,setVarianceLimitPercent]=useState(DEFAULT_VARIANCE_PERCENT),[reviewReady,setReviewReady]=useState(false);
 const [corrections,setCorrections]=useState<{trip_id:string;field_name:string;corrected_value:string;reason:string;created_at:string;created_by:string}[]>([]),[correctionField,setCorrectionField]=useState(''),[correctionValue,setCorrectionValue]=useState(''),[correctionReason,setCorrectionReason]=useState('');
 const [limitKgInput,setLimitKgInput]=useState(String(DEFAULT_VARIANCE_KG)),[limitPercentInput,setLimitPercentInput]=useState(String(DEFAULT_VARIANCE_PERCENT));
 useEffect(()=>()=>{if(photoUrl.startsWith('blob:'))URL.revokeObjectURL(photoUrl)},[photoUrl]);
 useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data:{session},error})=>{if(error)setError(error.message);setSession(session);setLoading(false)});const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);if(!next){setProfile(null);setOrganizationId('');setFarms([]);setCrews([]);setHarvests([]);setLots([]);setTrips([]);setTripLots([]);setDeliveries([]);setWeighings([]);setHarvestPhotos([]);setDeliveryPhotos([]);setDrivers([]);setTeam([])}});return()=>subscription.unsubscribe()},[]);
 const load=useCallback(async()=>{if(!supabase||!session)return;setError('');try{
  const {data:p,error:pe}=await supabase.from('profiles').select('id,full_name,role,status').eq('id',session.user.id).single();check(pe);if(!p||p.status!=='ACTIVE')throw Error('Tu perfil no está activo.');setProfile(p as Profile);
  const {data:membership,error:me}=await supabase.from('organization_members').select('organization_id').eq('profile_id',session.user.id).eq('active',true).single();check(me);if(!membership)throw Error('No tienes una organización activa.');const org=membership.organization_id;setOrganizationId(org);
  if(p.role==='ADMIN'){
   const {data:members,error:membersError}=await supabase.from('organization_members').select('profile_id').eq('organization_id',org).eq('active',true);
   if(membersError){setTeamError('No se pudo consultar el equipo de esta organización.');setTeam([])}
   else if(members?.length){
    const {data:people,error:peopleError}=await supabase.from('profiles').select('id,full_name,role,status').in('id',members.map(m=>m.profile_id));
    setTeamError(peopleError?'No se pudo consultar el equipo de esta organización.':'');setTeam(peopleError?[]:(people??[]) as Profile[]);
   }else{setTeam([]);setTeamError('')}
  }
  const [f,c,h,l,t,tl,d,w,hp,dp,dr]=await Promise.all([
   supabase.from('farms').select('id,code,name,municipality,state,area_hectares').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('crews').select('id,code,name,crew_leader_id').eq('organization_id',org),
   supabase.from('harvest_orders').select('id,trace_code,farm_id,crew_id,status,scheduled_date,notes').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('agave_lots').select('id,trace_code,harvest_order_id,farm_id,status,agave_count,average_brix,actual_weight_kg').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trips').select('id,trace_code,driver_id,status,destination_name,departed_at,arrived_at,vehicle_plate').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trip_lots').select('trip_id,agave_lot_id,loaded_weight_kg'),
   supabase.from('deliveries').select('id,trace_code,trip_id,status,recipient_company,accepted_weight_kg,rejected_weight_kg,received_by_name').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('weighings').select('id,trip_id,weighing_type,gross_weight_kg,tare_weight_kg,net_weight_kg,ticket_storage_path,ticket_number,legibility_confirmed'),
   supabase.from('harvest_evidence').select('id,harvest_order_id,storage_bucket,storage_path'),
   supabase.from('delivery_evidence').select('id,delivery_id,storage_bucket,storage_path,legibility_confirmed'),
   supabase.from('profiles').select('id,full_name,role,status').eq('role','DRIVER').eq('status','ACTIVE')
  ]);for(const result of [f,c,h,l,t,tl,d,w,hp,dp,dr])check(result.error);setFarms((f.data??[]) as Farm[]);setCrews((c.data??[]) as Crew[]);setHarvests((h.data??[]) as Harvest[]);setLots((l.data??[]) as Lot[]);setTrips((t.data??[]) as Trip[]);setTripLots((tl.data??[]) as TripLot[]);setDeliveries((d.data??[]) as Delivery[]);setWeighings((w.data??[]) as Weighing[]);setHarvestPhotos((hp.data??[]) as FileRow[]);setDeliveryPhotos((dp.data??[]) as FileRow[]);setDrivers((dr.data??[]) as Profile[]);
  const [settings,reviews,correctionResult]=await Promise.all([supabase.from('organization_variance_settings').select('limit_kg,limit_percent').eq('organization_id',org).maybeSingle(),supabase.from('trip_variance_reviews').select('trip_id,reason,created_at').eq('organization_id',org).order('created_at',{ascending:false}),supabase.from('trip_correction_notes').select('trip_id,field_name,corrected_value,reason,created_at,created_by').eq('organization_id',org).order('created_at',{ascending:false})]);
  if(!settings.error&&!reviews.error&&!correctionResult.error){setReviewReady(true);const kg=Number(settings.data?.limit_kg??DEFAULT_VARIANCE_KG),percent=Number(settings.data?.limit_percent??DEFAULT_VARIANCE_PERCENT);setVarianceLimitKg(kg);setVarianceLimitPercent(percent);setLimitKgInput(String(kg));setLimitPercentInput(String(percent));setVarianceNotes((reviews.data??[]) as typeof varianceNotes);setCorrections((correctionResult.data??[]) as typeof corrections)}else{setReviewReady(false);setVarianceNotes([]);setCorrections([])}
 }catch(e){setError(String(e))}},[session]);
 useEffect(()=>{if(session)void load()},[session,load]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load()}catch(e){setError(String(e));showError(String(e))}finally{setBusy(false)}};
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
   const {error}=await supabase.from('delivery_evidence').insert({delivery_id:id,evidence_type:'PHOTO',storage_bucket:photo.bucket,storage_path:photo.path,mime_type:photo.mimeType,file_size_bytes:photo.size,captured_at:photo.capturedAt,uploaded_by:session.user.id,latitude:photo.latitude,longitude:photo.longitude,legibility_confirmed:photo.legibilityConfirmed});check(error);
  }
 });
 const openPhoto=async(bucket:string,path:string)=>{
  if(!supabase)return showError('Falta configurar Supabase');
  if(photoLoading)return;
  setPhotoLoading(true);setError('');
  try{
   if(Platform.OS==='web'){
    // Descarga con la sesión activa: evita enlaces firmados y ventanas bloqueadas en iOS.
    const {data,error}=await supabase.storage.from(bucket).download(path);check(error);
    if(!data)throw Error('Storage no devolvió la fotografía');
    setPhotoUrl(URL.createObjectURL(data));
   }else{
    const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,300);check(error);
    if(!data?.signedUrl)throw Error('Storage no devolvió el enlace de la fotografía');
    await Linking.openURL(data.signedUrl);
   }
  }catch(e){const message=`No se pudo abrir la fotografía: ${String(e)}`;setError(message);showError(message)}
  finally{setPhotoLoading(false)}
 };
 const exportHarvest=async(h:Harvest,buyerFilter:string)=>{
  if(Platform.OS!=='web'||!supabase||!organizationId||profile?.role!=='ADMIN')return showError('El expediente se descarga desde la PWA con una sesión de administrador.');
  if(exporting)return;setExporting(true);setError('');
  try{
   // Releer al exportar: el expediente no debe basarse en tarjetas que pudieron quedar desactualizadas.
   const [hr,fr,cr,lr]=await Promise.all([
    supabase.from('harvest_orders').select('id,trace_code,farm_id,crew_id,status,scheduled_date,started_at,completed_at,notes').eq('id',h.id).eq('organization_id',organizationId).single(),
    supabase.from('farms').select('id,code,name,municipality,state').eq('id',h.farm_id).eq('organization_id',organizationId).single(),
    h.crew_id?supabase.from('crews').select('id,name').eq('id',h.crew_id).eq('organization_id',organizationId).single():Promise.resolve({data:null,error:null}),
    supabase.from('agave_lots').select('id,trace_code,agave_count,average_brix,actual_weight_kg').eq('harvest_order_id',h.id).eq('organization_id',organizationId)
   ]);for(const r of [hr,fr,cr,lr])check(r.error);if(!hr.data||!fr.data)throw Error('La jima o el predio ya no están disponibles para esta organización.');
   const lotIds=(lr.data??[]).map(l=>l.id);
   const linksResult=lotIds.length?await supabase.from('trip_lots').select('trip_id,agave_lot_id,loaded_weight_kg').in('agave_lot_id',lotIds):{data:[],error:null};check(linksResult.error);
   const tripIds=[...new Set((linksResult.data??[]).map(l=>l.trip_id))];
   const [tr,wr,dr,he]=await Promise.all([
    tripIds.length?supabase.from('trips').select('id,trace_code,driver_id,status,destination_name,departed_at,arrived_at,vehicle_plate').in('id',tripIds).eq('organization_id',organizationId):Promise.resolve({data:[],error:null}),
    tripIds.length?supabase.from('weighings').select('id,trip_id,weighing_type,gross_weight_kg,tare_weight_kg,net_weight_kg,ticket_number,storage_bucket,ticket_storage_path,legibility_confirmed,captured_at,recorded_by,latitude,longitude').in('trip_id',tripIds):Promise.resolve({data:[],error:null}),
    tripIds.length?supabase.from('deliveries').select('id,trace_code,trip_id,status,recipient_company,accepted_weight_kg,rejected_weight_kg,received_by_name,received_at,rejection_reason').in('trip_id',tripIds).eq('organization_id',organizationId):Promise.resolve({data:[],error:null}),
    supabase.from('harvest_evidence').select('id,storage_bucket,storage_path,captured_at,uploaded_by,latitude,longitude').eq('harvest_order_id',h.id)
   ]);for(const r of [tr,wr,dr,he])check(r.error);
   if((tr.data??[]).length!==tripIds.length)throw Error('No se pudieron leer todos los viajes asociados; no se generará un expediente parcial.');
   const deliveryIds=(dr.data??[]).map(d=>d.id);
import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Image,Linking,Platform,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {Session} from '@supabase/supabase-js';
import {supabase} from './backend';
import {captureEvidence} from './evidence';
import {buildDossier,DossierImage} from './dossier';
import {partitionByBuyer,variance,DEFAULT_VARIANCE_KG,DEFAULT_VARIANCE_PERCENT} from './operations';

type Role='ADMIN'|'CREW_LEADER'|'DRIVER';
type Profile={id:string;full_name:string;role:Role;status:string};
type Farm={id:string;code:string;name:string;municipality:string|null;state:string;area_hectares:number|null};
type Crew={id:string;code:string|null;name:string;crew_leader_id:string|null};
type Harvest={id:string;trace_code:string;farm_id:string;crew_id:string|null;status:string;scheduled_date:string|null;notes:string|null};
type Lot={id:string;trace_code:string;harvest_order_id:string;farm_id:string;status:string;agave_count:number|null;average_brix:number|null;actual_weight_kg:number|null};
type Trip={id:string;trace_code:string;driver_id:string|null;status:string;destination_name:string|null;departed_at:string|null;arrived_at:string|null;vehicle_plate?:string|null};
type Delivery={id:string;trace_code:string;trip_id:string;status:string;recipient_company:string;accepted_weight_kg:number|null;rejected_weight_kg:number|null;received_by_name:string|null};
type Weighing={id:string;trip_id:string;weighing_type:string;gross_weight_kg:number; tare_weight_kg:number;net_weight_kg:number;ticket_storage_path:string|null;ticket_number?:string|null;legibility_confirmed?:boolean};
type TripLot={trip_id:string;agave_lot_id:string;loaded_weight_kg:number|null};
type FileRow={id:string;harvest_order_id?:string;delivery_id?:string;storage_bucket:string;storage_path:string;legibility_confirmed?:boolean};
type Pane='home'|'farms'|'harvests'|'trips'|'deliveries'|'team'|'control';
const green='#164B3A';
const roleNames:Record<Role,string>={ADMIN:'Administración',CREW_LEADER:'Jefe de cuadrilla',DRIVER:'Chofer de agave'};
const teamTargets:Record<Role,number>={ADMIN:2,CREW_LEADER:5,DRIVER:10};
const landscape=Platform.OS==='web'?{uri:'/Agave-trazabilidad/altos-agave.svg'}:null;
function SectionTitle({eyebrow,title,description}:{eyebrow:string;title:string;description?:string}){return <View style={styles.sectionHead}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text>{description?<Text style={styles.muted}>{description}</Text>:null}</View>}
function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable disabled={disabled} onPress={onPress} style={[styles.button,disabled&&{opacity:.5}]}><Text style={styles.buttonText}>{label}</Text></Pressable>}
function Input({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <View><Text style={styles.label}>{label}</Text><TextInput autoCapitalize="none" style={styles.input} value={value} onChangeText={onChange}/></View>}
function check(error:{message:string}|null){if(error)throw new Error(error.message)}
function requiredText(value:string,label:string,maxLength:number){const clean=value.trim().replace(/\s+/g,' ');if(!clean)throw Error(`${label} es obligatorio`);if(clean.length>maxLength)throw Error(`${label} no puede superar ${maxLength} caracteres`);return clean}
function decimal(value:string,label:string,min:number,max:number){const normalized=value.trim().replace(',','.');if(!normalized)throw Error(`${label} es obligatorio`);const parsed=Number(normalized);if(!Number.isFinite(parsed)||parsed<min||parsed>max)throw Error(`${label} debe estar entre ${min} y ${max}`);return parsed}
function integer(value:string,label:string,min:number,max:number){const parsed=decimal(value,label,min,max);if(!Number.isInteger(parsed))throw Error(`${label} debe ser un número entero`);return parsed}
function isoDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('La fecha debe tener el formato AAAA-MM-DD');const parsed=new Date(`${value}T00:00:00Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error('La fecha no es válida');return value}
function confirm(title:string,message:string,run:()=>void){if(Platform.OS==='web'){if(window.confirm(`${title}\n\n${message}`))run();return}Alert.alert(title,message,[{text:'Cancelar',style:'cancel'},{text:'Confirmar',style:'default',onPress:run}])}
function showError(message:string){if(Platform.OS==='web')window.alert(message);else Alert.alert('No se pudo completar',message)}
export default function RealApp(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [profile,setProfile]=useState<Profile|null>(null),[organizationId,setOrganizationId]=useState('');
 const [farms,setFarms]=useState<Farm[]>([]),[crews,setCrews]=useState<Crew[]>([]),[harvests,setHarvests]=useState<Harvest[]>([]),[lots,setLots]=useState<Lot[]>([]),[trips,setTrips]=useState<Trip[]>([]),[tripLots,setTripLots]=useState<TripLot[]>([]),[deliveries,setDeliveries]=useState<Delivery[]>([]),[weighings,setWeighings]=useState<Weighing[]>([]),[harvestPhotos,setHarvestPhotos]=useState<FileRow[]>([]),[deliveryPhotos,setDeliveryPhotos]=useState<FileRow[]>([]),[drivers,setDrivers]=useState<Profile[]>([]);
 const [pane,setPane]=useState<Pane>('home'),[selected,setSelected]=useState(''),[farmCode,setFarmCode]=useState(''),[farmName,setFarmName]=useState(''),[farmState,setFarmState]=useState('Jalisco');
 const [farmId,setFarmId]=useState(''),[crewId,setCrewId]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [lotCount,setLotCount]=useState(''),[lotBrix,setLotBrix]=useState(''),[lotWeight,setLotWeight]=useState('');
 const [tripLotId,setTripLotId]=useState(''),[tripDriverId,setTripDriverId]=useState(''),[destination,setDestination]=useState(''),[vehiclePlate,setVehiclePlate]=useState('');
 const [gross,setGross]=useState(''),[tare,setTare]=useState(''),[ticketNumber,setTicketNumber]=useState('');
 const [receiver,setReceiver]=useState(''),[accepted,setAccepted]=useState(''),[rejected,setRejected]=useState(''),[rejectionReason,setRejectionReason]=useState('');
 const [photoUrl,setPhotoUrl]=useState('');
 const [photoLoading,setPhotoLoading]=useState(false),[exporting,setExporting]=useState(false);
 const [team,setTeam]=useState<Profile[]>([]),[teamError,setTeamError]=useState('');
 const [search,setSearch]=useState(''),[varianceReason,setVarianceReason]=useState(''),[varianceNotes,setVarianceNotes]=useState<{trip_id:string;reason:string;created_at:string}[]>([]),[varianceLimitKg,setVarianceLimitKg]=useState(DEFAULT_VARIANCE_KG),[varianceLimitPercent,setVarianceLimitPercent]=useState(DEFAULT_VARIANCE_PERCENT),[reviewReady,setReviewReady]=useState(false);
 const [corrections,setCorrections]=useState<{trip_id:string;field_name:string;corrected_value:string;reason:string;created_at:string;created_by:string}[]>([]),[correctionField,setCorrectionField]=useState(''),[correctionValue,setCorrectionValue]=useState(''),[correctionReason,setCorrectionReason]=useState('');
 const [limitKgInput,setLimitKgInput]=useState(String(DEFAULT_VARIANCE_KG)),[limitPercentInput,setLimitPercentInput]=useState(String(DEFAULT_VARIANCE_PERCENT));
 useEffect(()=>()=>{if(photoUrl.startsWith('blob:'))URL.revokeObjectURL(photoUrl)},[photoUrl]);
 useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data:{session},error})=>{if(error)setError(error.message);setSession(session);setLoading(false)});const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);if(!next){setProfile(null);setOrganizationId('');setFarms([]);setCrews([]);setHarvests([]);setLots([]);setTrips([]);setTripLots([]);setDeliveries([]);setWeighings([]);setHarvestPhotos([]);setDeliveryPhotos([]);setDrivers([]);setTeam([])}});return()=>subscription.unsubscribe()},[]);
 const load=useCallback(async()=>{if(!supabase||!session)return;setError('');try{
  const {data:p,error:pe}=await supabase.from('profiles').select('id,full_name,role,status').eq('id',session.user.id).single();check(pe);if(!p||p.status!=='ACTIVE')throw Error('Tu perfil no está activo.');setProfile(p as Profile);
  const {data:membership,error:me}=await supabase.from('organization_members').select('organization_id').eq('profile_id',session.user.id).eq('active',true).single();check(me);if(!membership)throw Error('No tienes una organización activa.');const org=membership.organization_id;setOrganizationId(org);
  if(p.role==='ADMIN'){
   const {data:members,error:membersError}=await supabase.from('organization_members').select('profile_id').eq('organization_id',org).eq('active',true);
   if(membersError){setTeamError('No se pudo consultar el equipo de esta organización.');setTeam([])}
   else if(members?.length){
    const {data:people,error:peopleError}=await supabase.from('profiles').select('id,full_name,role,status').in('id',members.map(m=>m.profile_id));
    setTeamError(peopleError?'No se pudo consultar el equipo de esta organización.':'');setTeam(peopleError?[]:(people??[]) as Profile[]);
   }else{setTeam([]);setTeamError('')}
  }
  const [f,c,h,l,t,tl,d,w,hp,dp,dr]=await Promise.all([
   supabase.from('farms').select('id,code,name,municipality,state,area_hectares').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('crews').select('id,code,name,crew_leader_id').eq('organization_id',org),
   supabase.from('harvest_orders').select('id,trace_code,farm_id,crew_id,status,scheduled_date,notes').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('agave_lots').select('id,trace_code,harvest_order_id,farm_id,status,agave_count,average_brix,actual_weight_kg').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trips').select('id,trace_code,driver_id,status,destination_name,departed_at,arrived_at,vehicle_plate').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trip_lots').select('trip_id,agave_lot_id,loaded_weight_kg'),
   supabase.from('deliveries').select('id,trace_code,trip_id,status,recipient_company,accepted_weight_kg,rejected_weight_kg,received_by_name').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('weighings').select('id,trip_id,weighing_type,gross_weight_kg,tare_weight_kg,net_weight_kg,ticket_storage_path,ticket_number,legibility_confirmed'),
   supabase.from('harvest_evidence').select('id,harvest_order_id,storage_bucket,storage_path'),
   supabase.from('delivery_evidence').select('id,delivery_id,storage_bucket,storage_path,legibility_confirmed'),
   supabase.from('profiles').select('id,full_name,role,status').eq('role','DRIVER').eq('status','ACTIVE')
  ]);for(const result of [f,c,h,l,t,tl,d,w,hp,dp,dr])check(result.error);setFarms((f.data??[]) as Farm[]);setCrews((c.data??[]) as Crew[]);setHarvests((h.data??[]) as Harvest[]);setLots((l.data??[]) as Lot[]);setTrips((t.data??[]) as Trip[]);setTripLots((tl.data??[]) as TripLot[]);setDeliveries((d.data??[]) as Delivery[]);setWeighings((w.data??[]) as Weighing[]);setHarvestPhotos((hp.data??[]) as FileRow[]);setDeliveryPhotos((dp.data??[]) as FileRow[]);setDrivers((dr.data??[]) as Profile[]);
  const [settings,reviews,correctionResult]=await Promise.all([supabase.from('organization_variance_settings').select('limit_kg,limit_percent').eq('organization_id',org).maybeSingle(),supabase.from('trip_variance_reviews').select('trip_id,reason,created_at').eq('organization_id',org).order('created_at',{ascending:false}),supabase.from('trip_correction_notes').select('trip_id,field_name,corrected_value,reason,created_at,created_by').eq('organization_id',org).order('created_at',{ascending:false})]);
  if(!settings.error&&!reviews.error&&!correctionResult.error){setReviewReady(true);const kg=Number(settings.data?.limit_kg??DEFAULT_VARIANCE_KG),percent=Number(settings.data?.limit_percent??DEFAULT_VARIANCE_PERCENT);setVarianceLimitKg(kg);setVarianceLimitPercent(percent);setLimitKgInput(String(kg));setLimitPercentInput(String(percent));setVarianceNotes((reviews.data??[]) as typeof varianceNotes);setCorrections((correctionResult.data??[]) as typeof corrections)}else{setReviewReady(false);setVarianceNotes([]);setCorrections([])}
 }catch(e){setError(String(e))}},[session]);
 useEffect(()=>{if(session)void load()},[session,load]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load()}catch(e){setError(String(e));showError(String(e))}finally{setBusy(false)}};
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
   const {error}=await supabase.from('delivery_evidence').insert({delivery_id:id,evidence_type:'PHOTO',storage_bucket:photo.bucket,storage_path:photo.path,mime_type:photo.mimeType,file_size_bytes:photo.size,captured_at:photo.capturedAt,uploaded_by:session.user.id,latitude:photo.latitude,longitude:photo.longitude,legibility_confirmed:photo.legibilityConfirmed});check(error);
  }
 });
 const openPhoto=async(bucket:string,path:string)=>{
  if(!supabase)return showError('Falta configurar Supabase');
  if(photoLoading)return;
  setPhotoLoading(true);setError('');
  try{
   if(Platform.OS==='web'){
    // Descarga con la sesión activa: evita enlaces firmados y ventanas bloqueadas en iOS.
    const {data,error}=await supabase.storage.from(bucket).download(path);check(error);
    if(!data)throw Error('Storage no devolvió la fotografía');
    setPhotoUrl(URL.createObjectURL(data));
   }else{
    const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,300);check(error);
    if(!data?.signedUrl)throw Error('Storage no devolvió el enlace de la fotografía');
    await Linking.openURL(data.signedUrl);
   }
  }catch(e){const message=`No se pudo abrir la fotografía: ${String(e)}`;setError(message);showError(message)}
  finally{setPhotoLoading(false)}
 };
 const exportHarvest=async(h:Harvest,buyerFilter:string)=>{
  if(Platform.OS!=='web'||!supabase||!organizationId||profile?.role!=='ADMIN')return showError('El expediente se descarga desde la PWA con una sesión de administrador.');
  if(exporting)return;setExporting(true);setError('');
  try{
   // Releer al exportar: el expediente no debe basarse en tarjetas que pudieron quedar desactualizadas.
   const [hr,fr,cr,lr]=await Promise.all([
    supabase.from('harvest_orders').select('id,trace_code,farm_id,crew_id,status,scheduled_date,started_at,completed_at,notes').eq('id',h.id).eq('organization_id',organizationId).single(),
    supabase.from('farms').select('id,code,name,municipality,state').eq('id',h.farm_id).eq('organization_id',organizationId).single(),
    h.crew_id?supabase.from('crews').select('id,name').eq('id',h.crew_id).eq('organization_id',organizationId).single():Promise.resolve({data:null,error:null}),
    supabase.from('agave_lots').select('id,trace_code,agave_count,average_brix,actual_weight_kg').eq('harvest_order_id',h.id).eq('organization_id',organizationId)
   ]);for(const r of [hr,fr,cr,lr])check(r.error);if(!hr.data||!fr.data)throw Error('La jima o el predio ya no están disponibles para esta organización.');
   const lotIds=(lr.data??[]).map(l=>l.id);
   const linksResult=lotIds.length?await supabase.from('trip_lots').select('trip_id,agave_lot_id,loaded_weight_kg').in('agave_lot_id',lotIds):{data:[],error:null};check(linksResult.error);
   const tripIds=[...new Set((linksResult.data??[]).map(l=>l.trip_id))];
   const [tr,wr,dr,he]=await Promise.all([
    tripIds.length?supabase.from('trips').select('id,trace_code,driver_id,status,destination_name,departed_at,arrived_at,vehicle_plate').in('id',tripIds).eq('organization_id',organizationId):Promise.resolve({data:[],error:null}),
    tripIds.length?supabase.from('weighings').select('id,trip_id,weighing_type,gross_weight_kg,tare_weight_kg,net_weight_kg,ticket_number,storage_bucket,ticket_storage_path,legibility_confirmed,captured_at,recorded_by,latitude,longitude').in('trip_id',tripIds):Promise.resolve({data:[],error:null}),
    tripIds.length?supabase.from('deliveries').select('id,trace_code,trip_id,status,recipient_company,accepted_weight_kg,rejected_weight_kg,received_by_name,received_at,rejection_reason').in('trip_id',tripIds).eq('organization_id',organizationId):Promise.resolve({data:[],error:null}),
    supabase.from('harvest_evidence').select('id,storage_bucket,storage_path,captured_at,uploaded_by,latitude,longitude').eq('harvest_order_id',h.id)
   ]);for(const r of [tr,wr,dr,he])check(r.error);
   if((tr.data??[]).length!==tripIds.length)throw Error('No se pudieron leer todos los viajes asociados; no se generará un expediente parcial.');
   const deliveryIds=(dr.data??[]).map(d=>d.id);
   const [de,driversResult]=await Promise.all([
    deliveryIds.length?supabase.from('delivery_evidence').select('id,delivery_id,storage_bucket,storage_path,captured_at,uploaded_by,latitude,longitude,legibility_confirmed').in('delivery_id',deliveryIds):Promise.resolve({data:[],error:null}),
    (tr.data??[]).some(t=>t.driver_id)?supabase.from('profiles').select('id,full_name').in('id',(tr.data??[]).map(t=>t.driver_id).filter((v):v is string=>!!v)):Promise.resolve({data:[],error:null})
   ]);for(const r of [de,driversResult])check(r.error);
import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Image,Linking,Platform,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {Session} from '@supabase/supabase-js';
import {supabase} from './backend';
import {captureEvidence} from './evidence';
import {buildDossier,DossierImage} from './dossier';
import {partitionByBuyer,variance,DEFAULT_VARIANCE_KG,DEFAULT_VARIANCE_PERCENT} from './operations';

type Role='ADMIN'|'CREW_LEADER'|'DRIVER';
type Profile={id:string;full_name:string;role:Role;status:string};
type Farm={id:string;code:string;name:string;municipality:string|null;state:string;area_hectares:number|null};
type Crew={id:string;code:string|null;name:string;crew_leader_id:string|null};
type Harvest={id:string;trace_code:string;farm_id:string;crew_id:string|null;status:string;scheduled_date:string|null;notes:string|null};
type Lot={id:string;trace_code:string;harvest_order_id:string;farm_id:string;status:string;agave_count:number|null;average_brix:number|null;actual_weight_kg:number|null};
type Trip={id:string;trace_code:string;driver_id:string|null;status:string;destination_name:string|null;departed_at:string|null;arrived_at:string|null;delivered_at?:string|null;vehicle_plate?:string|null};
type Delivery={id:string;trace_code:string;trip_id:string;status:string;recipient_company:string;accepted_weight_kg:number|null;rejected_weight_kg:number|null;received_by_name:string|null};
type Weighing={id:string;trip_id:string;weighing_type:string;gross_weight_kg:number; tare_weight_kg:number;net_weight_kg:number;ticket_storage_path:string|null;ticket_number?:string|null;legibility_confirmed?:boolean};
type TripLot={trip_id:string;agave_lot_id:string;loaded_weight_kg:number|null};
type FileRow={id:string;harvest_order_id?:string;delivery_id?:string;storage_bucket:string;storage_path:string;legibility_confirmed?:boolean};
type Pane='home'|'farms'|'harvests'|'trips'|'deliveries'|'team'|'control';
const green='#164B3A';
const roleNames:Record<Role,string>={ADMIN:'Administración',CREW_LEADER:'Jefe de cuadrilla',DRIVER:'Chofer de agave'};
const teamTargets:Record<Role,number>={ADMIN:2,CREW_LEADER:5,DRIVER:10};
const landscape=Platform.OS==='web'?{uri:'/Agave-trazabilidad/altos-agave.svg'}:null;
function SectionTitle({eyebrow,title,description}:{eyebrow:string;title:string;description?:string}){return <View style={styles.sectionHead}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text>{description?<Text style={styles.muted}>{description}</Text>:null}</View>}
function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable disabled={disabled} onPress={onPress} style={[styles.button,disabled&&{opacity:.5}]}><Text style={styles.buttonText}>{label}</Text></Pressable>}
function Input({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <View><Text style={styles.label}>{label}</Text><TextInput autoCapitalize="none" style={styles.input} value={value} onChangeText={onChange}/></View>}
function check(error:{message:string}|null){if(error)throw new Error(error.message)}
function requiredText(value:string,label:string,maxLength:number){const clean=value.trim().replace(/\s+/g,' ');if(!clean)throw Error(`${label} es obligatorio`);if(clean.length>maxLength)throw Error(`${label} no puede superar ${maxLength} caracteres`);return clean}
function decimal(value:string,label:string,min:number,max:number){const normalized=value.trim().replace(',','.');if(!normalized)throw Error(`${label} es obligatorio`);const parsed=Number(normalized);if(!Number.isFinite(parsed)||parsed<min||parsed>max)throw Error(`${label} debe estar entre ${min} y ${max}`);return parsed}
function integer(value:string,label:string,min:number,max:number){const parsed=decimal(value,label,min,max);if(!Number.isInteger(parsed))throw Error(`${label} debe ser un número entero`);return parsed}
function isoDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('La fecha debe tener el formato AAAA-MM-DD');const parsed=new Date(`${value}T00:00:00Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw Error('La fecha no es válida');return value}
function confirm(title:string,message:string,run:()=>void){if(Platform.OS==='web'){if(window.confirm(`${title}\n\n${message}`))run();return}Alert.alert(title,message,[{text:'Cancelar',style:'cancel'},{text:'Confirmar',style:'default',onPress:run}])}
function showError(message:string){if(Platform.OS==='web')window.alert(message);else Alert.alert('No se pudo completar',message)}
export default function RealApp(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [profile,setProfile]=useState<Profile|null>(null),[organizationId,setOrganizationId]=useState('');
 const [farms,setFarms]=useState<Farm[]>([]),[crews,setCrews]=useState<Crew[]>([]),[harvests,setHarvests]=useState<Harvest[]>([]),[lots,setLots]=useState<Lot[]>([]),[trips,setTrips]=useState<Trip[]>([]),[tripLots,setTripLots]=useState<TripLot[]>([]),[deliveries,setDeliveries]=useState<Delivery[]>([]),[weighings,setWeighings]=useState<Weighing[]>([]),[harvestPhotos,setHarvestPhotos]=useState<FileRow[]>([]),[deliveryPhotos,setDeliveryPhotos]=useState<FileRow[]>([]),[drivers,setDrivers]=useState<Profile[]>([]);
 const [pane,setPane]=useState<Pane>('home'),[selected,setSelected]=useState(''),[farmCode,setFarmCode]=useState(''),[farmName,setFarmName]=useState(''),[farmState,setFarmState]=useState('Jalisco');
 const [farmId,setFarmId]=useState(''),[crewId,setCrewId]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [lotCount,setLotCount]=useState(''),[lotBrix,setLotBrix]=useState(''),[lotWeight,setLotWeight]=useState('');
 const [tripLotId,setTripLotId]=useState(''),[tripDriverId,setTripDriverId]=useState(''),[destination,setDestination]=useState(''),[vehiclePlate,setVehiclePlate]=useState('');
 const [gross,setGross]=useState(''),[tare,setTare]=useState(''),[ticketNumber,setTicketNumber]=useState('');
 const [receiver,setReceiver]=useState(''),[accepted,setAccepted]=useState(''),[rejected,setRejected]=useState(''),[rejectionReason,setRejectionReason]=useState('');
 const [photoUrl,setPhotoUrl]=useState('');
 const [photoLoading,setPhotoLoading]=useState(false),[exporting,setExporting]=useState(false);
 const [team,setTeam]=useState<Profile[]>([]),[teamError,setTeamError]=useState('');
 const [search,setSearch]=useState(''),[varianceReason,setVarianceReason]=useState(''),[varianceNotes,setVarianceNotes]=useState<{trip_id:string;reason:string;created_at:string}[]>([]),[varianceLimitKg,setVarianceLimitKg]=useState(DEFAULT_VARIANCE_KG),[varianceLimitPercent,setVarianceLimitPercent]=useState(DEFAULT_VARIANCE_PERCENT),[reviewReady,setReviewReady]=useState(false);
 const [corrections,setCorrections]=useState<{trip_id:string;field_name:string;corrected_value:string;reason:string;created_at:string;created_by:string}[]>([]),[correctionField,setCorrectionField]=useState(''),[correctionValue,setCorrectionValue]=useState(''),[correctionReason,setCorrectionReason]=useState('');
 const [limitKgInput,setLimitKgInput]=useState(String(DEFAULT_VARIANCE_KG)),[limitPercentInput,setLimitPercentInput]=useState(String(DEFAULT_VARIANCE_PERCENT));
 useEffect(()=>()=>{if(photoUrl.startsWith('blob:'))URL.revokeObjectURL(photoUrl)},[photoUrl]);
 useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data:{session},error})=>{if(error)setError(error.message);setSession(session);setLoading(false)});const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);if(!next){setProfile(null);setOrganizationId('');setFarms([]);setCrews([]);setHarvests([]);setLots([]);setTrips([]);setTripLots([]);setDeliveries([]);setWeighings([]);setHarvestPhotos([]);setDeliveryPhotos([]);setDrivers([]);setTeam([])}});return()=>subscription.unsubscribe()},[]);
 const load=useCallback(async()=>{if(!supabase||!session)return;setError('');try{
  const {data:p,error:pe}=await supabase.from('profiles').select('id,full_name,role,status').eq('id',session.user.id).single();check(pe);if(!p||p.status!=='ACTIVE')throw Error('Tu perfil no está activo.');setProfile(p as Profile);
  const {data:membership,error:me}=await supabase.from('organization_members').select('organization_id').eq('profile_id',session.user.id).eq('active',true).single();check(me);if(!membership)throw Error('No tienes una organización activa.');const org=membership.organization_id;setOrganizationId(org);
  if(p.role==='ADMIN'){
   const {data:members,error:membersError}=await supabase.from('organization_members').select('profile_id').eq('organization_id',org).eq('active',true);
   if(membersError){setTeamError('No se pudo consultar el equipo de esta organización.');setTeam([])}
   else if(members?.length){
    const {data:people,error:peopleError}=await supabase.from('profiles').select('id,full_name,role,status').in('id',members.map(m=>m.profile_id));
    setTeamError(peopleError?'No se pudo consultar el equipo de esta organización.':'');setTeam(peopleError?[]:(people??[]) as Profile[]);
   }else{setTeam([]);setTeamError('')}
  }
  const [f,c,h,l,t,tl,d,w,hp,dp,dr]=await Promise.all([
   supabase.from('farms').select('id,code,name,municipality,state,area_hectares').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('crews').select('id,code,name,crew_leader_id').eq('organization_id',org),
   supabase.from('harvest_orders').select('id,trace_code,farm_id,crew_id,status,scheduled_date,notes').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('agave_lots').select('id,trace_code,harvest_order_id,farm_id,status,agave_count,average_brix,actual_weight_kg').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trips').select('id,trace_code,driver_id,status,destination_name,departed_at,arrived_at,delivered_at,vehicle_plate').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('trip_lots').select('trip_id,agave_lot_id,loaded_weight_kg'),
   supabase.from('deliveries').select('id,trace_code,trip_id,status,recipient_company,accepted_weight_kg,rejected_weight_kg,received_by_name').eq('organization_id',org).order('created_at',{ascending:false}),
   supabase.from('weighings').select('id,trip_id,weighing_type,gross_weight_kg,tare_weight_kg,net_weight_kg,ticket_storage_path,ticket_number,legibility_confirmed'),
   supabase.from('harvest_evidence').select('id,harvest_order_id,storage_bucket,storage_path'),
   supabase.from('delivery_evidence').select('id,delivery_id,storage_bucket,storage_path,legibility_confirmed'),
   supabase.from('profiles').select('id,full_name,role,status').eq('role','DRIVER').eq('status','ACTIVE')
  ]);for(const result of [f,c,h,l,t,tl,d,w,hp,dp,dr])check(result.error);setFarms((f.data??[]) as Farm[]);setCrews((c.data??[]) as Crew[]);setHarvests((h.data??[]) as Harvest[]);setLots((l.data??[]) as Lot[]);setTrips((t.data??[]) as Trip[]);setTripLots((tl.data??[]) as TripLot[]);setDeliveries((d.data??[]) as Delivery[]);setWeighings((w.data??[]) as Weighing[]);setHarvestPhotos((hp.data??[]) as FileRow[]);setDeliveryPhotos((dp.data??[]) as FileRow[]);setDrivers((dr.data??[]) as Profile[]);
  const [settings,reviews,correctionResult]=await Promise.all([supabase.from('organization_variance_settings').select('limit_kg,limit_percent').eq('organization_id',org).maybeSingle(),supabase.from('trip_variance_reviews').select('trip_id,reason,created_at').eq('organization_id',org).order('created_at',{ascending:false}),supabase.from('trip_correction_notes').select('trip_id,field_name,corrected_value,reason,created_at,created_by').eq('organization_id',org).order('created_at',{ascending:false})]);
  if(!settings.error&&!reviews.error&&!correctionResult.error){setReviewReady(true);const kg=Number(settings.data?.limit_kg??DEFAULT_VARIANCE_KG),percent=Number(settings.data?.limit_percent??DEFAULT_VARIANCE_PERCENT);setVarianceLimitKg(kg);setVarianceLimitPercent(percent);setLimitKgInput(String(kg));setLimitPercentInput(String(percent));setVarianceNotes((reviews.data??[]) as typeof varianceNotes);setCorrections((correctionResult.data??[]) as typeof corrections)}else{setReviewReady(false);setVarianceNotes([]);setCorrections([])}
 }catch(e){setError(String(e))}},[session]);
 useEffect(()=>{if(session)void load()},[session,load]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load()}catch(e){setError(String(e));showError(String(e))}finally{setBusy(false)}};
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
   const {error}=await supabase.from('delivery_evidence').insert({delivery_id:id,evidence_type:'PHOTO',storage_bucket:photo.bucket,storage_path:photo.path,mime_type:photo.mimeType,file_size_bytes:photo.size,captured_at:photo.capturedAt,uploaded_by:session.user.id,latitude:photo.latitude,longitude:photo.longitude,legibility_confirmed:photo.legibilityConfirmed});check(error);
  }
 });
 const openPhoto=async(bucket:string,path:string)=>{
  if(!supabase)return showError('Falta configurar Supabase');
  if(photoLoading)return;
  setPhotoLoading(true);setError('');
  try{
   if(Platform.OS==='web'){
    // Descarga con la sesión activa: evita enlaces firmados y ventanas bloqueadas en iOS.
    const {data,error}=await supabase.storage.from(bucket).download(path);check(error);
    if(!data)throw Error('Storage no devolvió la fotografía');
    setPhotoUrl(URL.createObjectURL(data));
   }else{
    const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,300);check(error);
    if(!data?.signedUrl)throw Error('Storage no devolvió el enlace de la fotografía');
    await Linking.openURL(data.signedUrl);
   }
  }catch(e){const message=`No se pudo abrir la fotografía: ${String(e)}`;setError(message);showError(message)}
  finally{setPhotoLoading(false)}
 };
 const exportHarvest=async(h:Harvest,buyerFilter:string)=>{
  if(Platform.OS!=='web'||!supabase||!organizationId||profile?.role!=='ADMIN')return showError('El expediente se descarga desde la PWA con una sesión de administrador.');
  if(exporting)return;setExporting(true);setError('');
  try{
   // Releer al exportar: el expediente no debe basarse en tarjetas que pudieron quedar desactualizadas.
   const [hr,fr,cr,lr]=await Promise.all([
    supabase.from('harvest_orders').select('id,trace_code,farm_id,crew_id,status,scheduled_date,started_at,completed_at,notes').eq('id',h.id).eq('organization_id',organizationId).single(),
    supabase.from('farms').select('id,code,name,municipality,state').eq('id',h.farm_id).eq('organization_id',organizationId).single(),
    h.crew_id?supabase.from('crews').select('id,name').eq('id',h.crew_id).eq('organization_id',organizationId).single():Promise.resolve({data:null,error:null}),
    supabase.from('agave_lots').select('id,trace_code,agave_count,average_brix,actual_weight_kg').eq('harvest_order_id',h.id).eq('organization_id',organizationId)
   ]);for(const r of [hr,fr,cr,lr])check(r.error);if(!hr.data||!fr.data)throw Error('La jima o el predio ya no están disponibles para esta organización.');
   const lotIds=(lr.data??[]).map(l=>l.id);
   const linksResult=lotIds.length?await supabase.from('trip_lots').select('trip_id,agave_lot_id,loaded_weight_kg').in('agave_lot_id',lotIds):{data:[],error:null};check(linksResult.error);
   const tripIds=[...new Set((linksResult.data??[]).map(l=>l.trip_id))];
   const [tr,wr,dr,he]=await Promise.all([
    tripIds.length?supabase.from('trips').select('id,trace_code,driver_id,status,destination_name,departed_at,arrived_at,vehicle_plate').in('id',tripIds).eq('organization_id',organizationId):Promise.resolve({data:[],error:null}),
    tripIds.length?supabase.from('weighings').select('id,trip_id,weighing_type,gross_weight_kg,tare_weight_kg,net_weight_kg,ticket_number,storage_bucket,ticket_storage_path,legibility_confirmed,captured_at,recorded_by,latitude,longitude').in('trip_id',tripIds):Promise.resolve({data:[],error:null}),
    tripIds.length?supabase.from('deliveries').select('id,trace_code,trip_id,status,recipient_company,accepted_weight_kg,rejected_weight_kg,received_by_name,received_at,rejection_reason').in('trip_id',tripIds).eq('organization_id',organizationId):Promise.resolve({data:[],error:null}),
    supabase.from('harvest_evidence').select('id,storage_bucket,storage_path,captured_at,uploaded_by,latitude,longitude').eq('harvest_order_id',h.id)
   ]);for(const r of [tr,wr,dr,he])check(r.error);
   if((tr.data??[]).length!==tripIds.length)throw Error('No se pudieron leer todos los viajes asociados; no se generará un expediente parcial.');
   const deliveryIds=(dr.data??[]).map(d=>d.id);
   const [de,driversResult]=await Promise.all([
    deliveryIds.length?supabase.from('delivery_evidence').select('id,delivery_id,storage_bucket,storage_path,captured_at,uploaded_by,latitude,longitude,legibility_confirmed').in('delivery_id',deliveryIds):Promise.resolve({data:[],error:null}),
    (tr.data??[]).some(t=>t.driver_id)?supabase.from('profiles').select('id,full_name').in('id',(tr.data??[]).map(t=>t.driver_id).filter((v):v is string=>!!v)):Promise.resolve({data:[],error:null})
   ]);for(const r of [de,driversResult])check(r.error);
   const groupsBeforeImages=partitionByBuyer({lots:lr.data??[],trips:tr.data??[],links:linksResult.data??[],weighings:wr.data??[],deliveries:dr.data??[],images:[]});
   const buyer=groupsBeforeImages.find(g=>g.key===buyerFilter);if(!buyer)throw Error('La asignación del comprador cambió; actualiza la pantalla y vuelve a intentar.');
   const buyerWeighingIds=new Set(buyer.weighings.map(w=>w.id)),buyerDeliveryIds=new Set(buyer.deliveries.map(d=>d.id));
   const refs=[...(he.data??[]).map(p=>({kind:'harvest',label:`Jima ${h.trace_code}`,bucket:p.storage_bucket,path:p.storage_path,capturedAt:p.captured_at,uploadedBy:p.uploaded_by,latitude:p.latitude,longitude:p.longitude,legibilityConfirmed:true})),...(wr.data??[]).filter(w=>w.ticket_storage_path&&buyerWeighingIds.has(w.id)).map(w=>({kind:'ticket',label:w.id,bucket:w.storage_bucket||'weighing-tickets',path:w.ticket_storage_path!,capturedAt:w.captured_at,uploadedBy:w.recorded_by,latitude:w.latitude,longitude:w.longitude,legibilityConfirmed:w.legibility_confirmed})),...(de.data??[]).filter(p=>buyerDeliveryIds.has(p.delivery_id)).map(p=>({kind:'delivery',label:`Entrega ${(dr.data??[]).find(d=>d.id===p.delivery_id)?.trace_code??p.delivery_id}`,bucket:p.storage_bucket,path:p.storage_path,capturedAt:p.captured_at,uploadedBy:p.uploaded_by,latitude:p.latitude,longitude:p.longitude,legibilityConfirmed:p.legibility_confirmed}))];
   const images:DossierImage[]=[];
   for(const ref of refs){
    const {data:blob,error:downloadError}=await supabase.storage.from(ref.bucket).download(ref.path);check(downloadError);if(!blob)throw Error(`No se pudo descargar la evidencia ${ref.label}`);
    if(!blob.type.startsWith('image/'))throw Error(`La evidencia ${ref.label} no es una imagen compatible.`);
    const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('No se pudo leer una fotografía'));reader.readAsDataURL(blob)});
    images.push({kind:ref.kind,label:ref.label,mime:blob.type,base64,fileName:ref.path.split('/').pop()||'evidencia',capturedAt:ref.capturedAt,uploadedBy:ref.uploadedBy,latitude:ref.latitude,longitude:ref.longitude,legibilityConfirmed:ref.legibilityConfirmed});
   }
   const groups=partitionByBuyer({lots:lr.data??[],trips:tr.data??[],links:linksResult.data??[],weighings:wr.data??[],deliveries:dr.data??[],images});
   const group=groups.find(g=>g.key===buyerFilter);if(!group)throw Error('La asignación del comprador cambió; actualiza la pantalla y vuelve a intentar.');
    const result=buildDossier({harvest:hr.data,farm:fr.data,crew:cr.data,lots:group.lots,trips:group.trips,links:group.links,weighings:group.weighings,deliveries:group.deliveries,drivers:driversResult.data??[],images:group.images,generatedAt:new Date().toISOString(),organizationId,buyerName:group.name,varianceLimitKg,varianceLimitPercent,varianceNotes,corrections});
    const file=new Blob([result.html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=`expediente-${h.trace_code.replace(/[^a-zA-Z0-9_-]/g,'_')}-${group.name.replace(/[^a-zA-Z0-9_-]/g,'_')}-${result.complete?'completo':'borrador'}.html`;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   if(!result.complete)showError(`El expediente de ${group.name} se descargó como BORRADOR. Revisa los pendientes dentro del archivo.`);
  }catch(e){const message=`No se pudo generar el expediente: ${String(e)}`;setError(message);showError(message)}finally{setExporting(false)}
 };
 const createTrip=()=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const lot=lots.find(l=>l.id===tripLotId);
  if(!lot||!tripDriverId)throw Error('Selecciona lote y chofer');const destinationName=requiredText(destination,'Destino',120);
  if(lot.status!=='HARVESTED'||harvests.find(h=>h.id===lot.harvest_order_id)?.status!=='HARVESTED')throw Error('El lote y la jima deben estar cosechados antes de programar el viaje');
  if(tripLots.some(link=>link.agave_lot_id===lot.id))throw Error('Este lote ya está asignado a un viaje');
  const plate=requiredText(vehiclePlate,'Placa del camión',25).toUpperCase();const {data:trip,error:tripError}=await supabase.from('trips').insert({organization_id:organizationId,driver_id:tripDriverId,origin_farm_id:lot.farm_id,destination_name:destinationName,vehicle_plate:plate,status:'ASSIGNED',created_by:session.user.id}).select('id').single();check(tripError);if(!trip)throw Error('No se creó el viaje');
  const {error:lotError}=await supabase.from('trip_lots').insert({trip_id:trip.id,agave_lot_id:lot.id,loaded_weight_kg:lot.actual_weight_kg,loaded_agave_count:lot.agave_count,created_by:session.user.id});check(lotError);
  const {error:deliveryError}=await supabase.from('deliveries').insert({organization_id:organizationId,trip_id:trip.id,recipient_company:destinationName,status:'PENDING',created_by:session.user.id});check(deliveryError);setTripLotId('');setTripDriverId('');setVehiclePlate('');setDestination('');
 });
 const addWeighing=(trip:Trip)=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const g=decimal(gross,'Peso bruto',0.01,200000),t=decimal(tare,'Tara',0,200000);
  if(!['ASSIGNED','LOADING','ARRIVED'].includes(trip.status))throw Error('El pesaje se registra en origen antes de salir o al llegar a destino');
  if(g<=t)throw Error('El peso bruto debe superar la tara');const weighingType=trip.status==='ARRIVED'?'DESTINATION':'ORIGIN';if(weighings.some(w=>w.trip_id===trip.id&&w.weighing_type===weighingType))throw Error(`Ya existe el pesaje de ${weighingType==='ORIGIN'?'origen':'destino'}`);
  const ticket=requiredText(ticketNumber,'Folio de báscula',80);const photo=await captureEvidence('weighing',organizationId,trip.id,session.user.id);if(!photo)return;
  const {error}=await supabase.from('weighings').insert({trip_id:trip.id,weighing_type:weighingType,gross_weight_kg:g,tare_weight_kg:t,net_weight_kg:g-t,ticket_number:ticket,storage_bucket:photo.bucket,ticket_storage_path:photo.path,recorded_by:session.user.id,legibility_confirmed:photo.legibilityConfirmed,captured_at:photo.capturedAt,latitude:photo.latitude,longitude:photo.longitude});check(error);setGross('');setTare('');setTicketNumber('');
 });
 const recordVariance=(trip:Trip)=>action(async()=>{if(!supabase||!reviewReady)throw Error('Falta activar el control de conciliación en Supabase');const reason=requiredText(varianceReason,'Explicación de la diferencia',1000);if(reason.length<10)throw Error('Describe la diferencia con al menos 10 caracteres');const {error}=await supabase.rpc('record_trip_variance_review',{p_trip_id:trip.id,p_reason:reason});check(error);setVarianceReason('')});
 const recordCorrection=(trip:Trip)=>action(async()=>{if(!supabase||!reviewReady)throw Error('Falta activar el registro de correcciones en Supabase');const field=requiredText(correctionField,'Campo a corregir',80),value=requiredText(correctionValue,'Valor corregido',300),reason=requiredText(correctionReason,'Motivo',1000);if(reason.length<10)throw Error('Describe el motivo con al menos 10 caracteres');const {error}=await supabase.rpc('record_trip_correction',{p_trip_id:trip.id,p_field_name:field,p_corrected_value:value,p_reason:reason});check(error);setCorrectionField('');setCorrectionValue('');setCorrectionReason('')});
 const saveVarianceLimits=()=>action(async()=>{if(!supabase||!session||!organizationId||!reviewReady||profile?.role!=='ADMIN')throw Error('No puedes cambiar la tolerancia');const limit_kg=decimal(limitKgInput,'Tolerancia en kg',0,10000),limit_percent=decimal(limitPercentInput,'Tolerancia en porcentaje',0,100);const {error}=await supabase.from('organization_variance_settings').upsert({organization_id:organizationId,limit_kg,limit_percent,updated_at:new Date().toISOString(),updated_by:session.user.id});check(error)});
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
  const linked=tripLots.filter(l=>l.trip_id===trip.id),fieldKg=linked.length?linked.reduce((a,l)=>a+Number(l.loaded_weight_kg||0),0):null,origin=weighings.find(w=>w.trip_id===trip.id&&w.weighing_type==='ORIGIN');
  const difference=variance(fieldKg,origin?.net_weight_kg??null,Number(destinationWeight),weight,rejectedWeight,varianceLimitKg,varianceLimitPercent);
  if(difference.exceeded&&!varianceNotes.some(note=>note.trip_id===trip.id&&note.reason.trim()))throw Error('La diferencia excede la tolerancia; registra una explicación en el viaje antes de cerrar.');
  const {data,error}=await supabase.rpc('complete_delivery',{p_delivery_id:d.id,p_received_by_name:receiverName,p_accepted_weight_kg:weight,p_rejected_weight_kg:rejectedWeight,p_rejection_reason:reason||null});check(error);if(data!=='COMPLETED')throw Error('El servidor no confirmó el cierre de la entrega');setReceiver('');setAccepted('');setRejected('');setRejectionReason('');
 });
 const tripReview=(t:Trip)=>{
  const linked=tripLots.filter(l=>l.trip_id===t.id),field=linked.length?linked.reduce((a,l)=>a+Number(l.loaded_weight_kg||0),0):null;
  const ws=weighings.filter(w=>w.trip_id===t.id),origin=ws.find(w=>w.weighing_type==='ORIGIN'),dest=ws.find(w=>w.weighing_type==='DESTINATION'),ds=deliveries.filter(d=>d.trip_id===t.id);
  const accepted=ds.length&&ds.every(d=>d.accepted_weight_kg!=null)?ds.reduce((a,d)=>a+Number(d.accepted_weight_kg),0):null;
  const rejected=ds.length&&ds.every(d=>d.rejected_weight_kg!=null)?ds.reduce((a,d)=>a+Number(d.rejected_weight_kg),0):null;
  const comparison=variance(field,origin?.net_weight_kg??null,dest?.net_weight_kg??null,accepted,rejected,varianceLimitKg,varianceLimitPercent);
  const missing=[!origin?'pesaje origen':null,!dest?'pesaje destino':null,...ws.filter(w=>!w.ticket_storage_path||!w.legibility_confirmed).map(w=>`ticket ${w.weighing_type}`),!ds.length?'entrega':null,...ds.filter(d=>!deliveryPhotos.some(p=>p.delivery_id===d.id&&p.legibility_confirmed)).map(d=>`recibo ${d.trace_code}`)].filter(Boolean);
  return {comparison,missing,hasExplanation:varianceNotes.some(n=>n.trip_id===t.id&&n.reason?.trim())};
 };
 const buyerGroupsForHarvest=(h:Harvest)=>{
  try{return {groups:partitionByBuyer({lots:lots.filter(l=>l.harvest_order_id===h.id),trips:trips.filter(t=>tripLots.some(x=>x.trip_id===t.id&&lots.some(l=>l.id===x.agave_lot_id&&l.harvest_order_id===h.id))),links:tripLots,weighings,deliveries,images:[]}),message:''}}
  catch(e){return {groups:[],message:String(e)}}
 };
 const todayInJalisco=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const dailyTrips=trips.filter(t=>t.status!=='DELIVERED'||(t.delivered_at&&new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t.delivered_at))===todayInJalisco)||tripReview(t).missing.length>0);
 const matchesTrip=(t:Trip)=>{const query=search.trim().toLocaleLowerCase('es-MX');if(!query)return true;
  const relatedLots=tripLots.filter(l=>l.trip_id===t.id).map(x=>lots.find(l=>l.id===x.agave_lot_id)).filter(Boolean);
  const fields=[t.trace_code,t.vehicle_plate,t.destination_name,...relatedLots.map(l=>l!.trace_code),...relatedLots.map(l=>harvests.find(h=>h.id===l!.harvest_order_id)?.trace_code),...relatedLots.map(l=>farms.find(f=>f.id===l!.farm_id)?.name),...weighings.filter(w=>w.trip_id===t.id).map(w=>w.ticket_number),...deliveries.filter(d=>d.trip_id===t.id).map(d=>d.recipient_company)];
  return fields.some(value=>String(value??'').toLocaleLowerCase('es-MX').includes(query));
 };
 if(loading)return <SafeAreaView style={styles.center}><ActivityIndicator color={green}/></SafeAreaView>;
 if(!session)return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.loginBody}><View style={styles.loginHero}><Text style={styles.brand}>AGAVE  /  TRAZA</Text>{landscape?<Image source={landscape} resizeMode="cover" style={styles.loginArt}/>:null}<Text style={styles.heroKicker}>TRAZABILIDAD DESDE EL ORIGEN</Text><Text style={styles.heroTitle}>El campo tiene una historia.</Text><Text style={styles.heroText}>Regístrala desde Los Altos de Jalisco hasta su destino.</Text></View><View style={styles.loginForm}><SectionTitle eyebrow="BIENVENIDO" title="Inicia sesión" description="Tu operación, tus registros y tus fotografías en un solo lugar."/><Input label="Correo electrónico" value={email} onChange={setEmail}/><View><Text style={styles.label}>Contraseña</Text><TextInput secureTextEntry style={styles.input} value={password} onChangeText={setPassword}/></View><Button label="Entrar a Agave Traza" onPress={login} disabled={busy}/>{error?<Text style={styles.error}>{error}</Text>:null}<Text style={styles.formFoot}>LOS ALTOS · JALISCO · MÉXICO</Text></View></ScrollView></SafeAreaView>;
 return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><View style={styles.topBar}><View><Text style={styles.brand}>AGAVE  /  TRAZA</Text><Text style={styles.small}>{profile?.full_name??session.user.email} · {profile?roleNames[profile.role]:'Cargando perfil'}</Text></View><View style={styles.topActions}><Pressable onPress={()=>{setPane('home');setSelected('')}} style={styles.topAction}><Text style={styles.topActionText}>Inicio</Text></Pressable><Pressable onPress={()=>void action(async()=>{})} disabled={busy} style={styles.topAction}><Text style={styles.topActionText}>↻ Actualizar</Text></Pressable></View></View>{error?<Text style={styles.error}>{error}</Text>:null}
 {pane==='home'&&<><View style={styles.hero}>{landscape?<Image source={landscape} resizeMode="cover" style={styles.heroArt}/>:null}<View style={styles.heroCopy}><Text style={styles.heroKicker}>DESDE EL ORIGEN · LOS ALTOS DE JALISCO</Text><Text style={styles.heroTitle}>Cada agave cuenta una historia.</Text><Text style={styles.heroText}>Del predio a la entrega, cada paso queda registrado.</Text></View></View><SectionTitle eyebrow="CENTRO DE OPERACIONES" title="Tu jornada" description="Selecciona el proceso que quieres consultar o registrar."/><View style={styles.dashboard}><Pressable style={styles.dashboardCard} onPress={()=>setPane('farms')}><Text style={styles.cardNumber}>{farms.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Predios</Text><Text style={styles.cardCaption}>Territorio y origen  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('harvests')}><Text style={styles.cardNumber}>{harvests.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Jimas</Text><Text style={styles.cardCaption}>Cosecha y lotes  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('trips')}><Text style={styles.cardNumber}>{trips.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Viajes</Text><Text style={styles.cardCaption}>Ruta y pesajes  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('deliveries')}><Text style={styles.cardNumber}>{deliveries.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Entregas</Text><Text style={styles.cardCaption}>Recepción final  ↗</Text></Pressable></View>{profile?.role==='ADMIN'&&<Button label="Control diario de camiones" onPress={()=>setPane('control')}/>}{profile?.role==='ADMIN'?<Pressable style={styles.teamBanner} onPress={()=>setPane('team')}><View><Text style={styles.heroKicker}>ORGANIZACIÓN</Text><Text style={styles.teamBannerTitle}>Equipo de campo</Text><Text style={styles.teamBannerNote}>2 administradores · 5 jefes · 10 choferes</Text></View><Text style={styles.teamArrow}>↗</Text></Pressable>:null}<Button label="Cerrar sesión" onPress={()=>void supabase?.auth.signOut()}/></>}
 {pane==='control'&&profile?.role==='ADMIN'&&<><SectionTitle eyebrow="OPERACIÓN / HOY" title="Control diario de camiones" description="Viajes activos, entregados hoy y expedientes pendientes; la búsqueda incluye el historial."/><Text>Asignados: {dailyTrips.filter(t=>['ASSIGNED','LOADING'].includes(t.status)).length} · En ruta: {dailyTrips.filter(t=>t.status==='IN_TRANSIT').length} · Llegados: {dailyTrips.filter(t=>t.status==='ARRIVED').length} · Entregados: {dailyTrips.filter(t=>t.status==='DELIVERED').length} · Documentos pendientes: {dailyTrips.filter(t=>tripReview(t).missing.length>0).length}</Text><Input label="Buscar jima, predio, placa, folio o comprador" value={search} onChange={setSearch}/><Text style={styles.muted}>Tolerancia: {varianceLimitKg} kg o {varianceLimitPercent}% del peso de origen, lo que sea mayor.</Text>{reviewReady&&<><Input label="Tolerancia mínima (kg)" value={limitKgInput} onChange={setLimitKgInput}/><Input label="Tolerancia porcentual sobre origen (%)" value={limitPercentInput} onChange={setLimitPercentInput}/><Button label="Guardar tolerancia de la organización" onPress={saveVarianceLimits} disabled={busy}/></>}{!reviewReady&&<Text style={styles.error}>La migración de control de Supabase está pendiente; no cierres entregas hasta activarla.</Text>}{(search.trim()?trips.filter(matchesTrip):dailyTrips).map(t=>{const review=tripReview(t);return <View key={t.id} style={styles.card}><Text style={styles.heading}>{t.trace_code} · {t.status}</Text><Text>{t.vehicle_plate??'Sin placa'} · {t.destination_name??'Sin comprador'}</Text><Text>Campo − origen: {review.comparison.originDifference??'—'} kg · Origen − destino: {review.comparison.transitDifference??'—'} kg · Destino − recepción: {review.comparison.receiptDifference??'—'} kg</Text><Text style={review.comparison.exceeded&&!review.hasExplanation?styles.error:styles.muted}>{review.comparison.exceeded?(review.hasExplanation?'Diferencia explicada':'Diferencia fuera de tolerancia · falta explicación'):'Sin alerta de diferencia'}</Text>{review.missing.length>0&&<Text style={styles.error}>Pendientes: {review.missing.join(', ')}</Text>}{varianceNotes.filter(n=>n.trip_id===t.id).map((note,i)=><Text key={i}>Aclaración {new Date(note.created_at).toLocaleString('es-MX')}: {note.reason}</Text>)}</View>})}</>}
 {pane==='team'&&profile?.role==='ADMIN'&&<><SectionTitle eyebrow="PERSONAS / ACCESOS" title="Equipo de campo" description="Planeación para 17 cuentas, repartidas por función. Sólo se cuentan perfiles activos de tu organización."/>{teamError?<Text style={styles.error}>{teamError}</Text>:null}<View style={styles.teamIntro}><Text style={styles.teamIntroNumber}>{teamError?'—':team.length} / 17</Text><Text style={styles.teamIntroLabel}>Usuarios activos registrados</Text></View>{(['ADMIN','CREW_LEADER','DRIVER'] as Role[]).map(role=>{const people=team.filter(person=>person.role===role&&person.status==='ACTIVE');return <View key={role} style={styles.teamRole}><View style={styles.teamRoleHeader}><Text style={styles.heading}>{roleNames[role]}</Text><Text style={styles.teamCount}>{teamError?'—':people.length} / {teamTargets[role]}</Text></View>{people.map(person=><Text key={person.id} style={styles.teamPerson}>●  {person.full_name}</Text>)}{!teamError&&people.length<teamTargets[role]?<Text style={styles.muted}>Faltan {teamTargets[role]-people.length} {teamTargets[role]-people.length===1?'cuenta':'cuentas'} por dar de alta.</Text>:null}</View>})}<Text style={styles.teamHelp}>Las cuentas nuevas requieren correo y nombre de cada persona. No se crean usuarios de muestra ni se comparten contraseñas desde esta pantalla.</Text></>}
 {pane==='farms'&&<><SectionTitle eyebrow="01 / ORIGEN" title="Predios visibles" description="La tierra donde comienza cada lote de agave."/>{farms.map(f=><View key={f.id} style={styles.card}><Text style={styles.heading}>{f.name}</Text><Text>{f.code} · {f.municipality??f.state}</Text></View>)}{profile?.role==='ADMIN'&&<><Text style={styles.heading}>Nuevo predio</Text><Input label="Código" value={farmCode} onChange={setFarmCode}/><Input label="Nombre" value={farmName} onChange={setFarmName}/><Input label="Estado" value={farmState} onChange={setFarmState}/><Button label="Guardar predio" onPress={createFarm} disabled={busy}/></>}</>}
 {pane==='harvests'&&<>
  <SectionTitle eyebrow="02 / COSECHA" title="Jimas visibles" description="El trabajo en campo, los lotes y su evidencia."/>
  {harvests.map(h=><View key={h.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===h.id?'':h.id)}><Text style={styles.heading}>{h.trace_code} {selected===h.id?'▲':'▼'}</Text><Text>{farms.find(f=>f.id===h.farm_id)?.name??'Predio'} · {h.status} · {h.scheduled_date??'Sin fecha'}</Text></Pressable>
   {selected===h.id&&<>
    <Text>Cuadrilla: {crews.find(c=>c.id===h.crew_id)?.name??'Sin asignar'}</Text>
    {h.notes?<Text>{h.notes}</Text>:null}
    {profile?.role==='ADMIN'&&(()=>{const result=buyerGroupsForHarvest(h);return <>{result.message?<Text style={styles.error}>{result.message}</Text>:null}{result.groups.map(group=><Button key={group.key} label={exporting?'Preparando expediente…':`Descargar expediente · ${group.name}`} onPress={()=>void exportHarvest(h,group.key)} disabled={exporting||busy}/>)}</>})()}
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
  <SectionTitle eyebrow="03 / TRAYECTO" title="Viajes visibles" description="Del predio a destino con cada pesaje registrado."/>
  {trips.map(t=><View key={t.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===t.id?'':t.id)}><Text style={styles.heading}>{t.trace_code} {selected===t.id?'▲':'▼'}</Text><Text>{t.status} · {t.destination_name??'Sin destino'}</Text></Pressable>
   {selected===t.id&&<>
    <Text>Placa: {t.vehicle_plate??'Sin registrar'} · Pesajes: {weighings.filter(w=>w.trip_id===t.id).length}</Text><Text>Campo − origen: {tripReview(t).comparison.originDifference??'—'} kg · Origen − destino: {tripReview(t).comparison.transitDifference??'—'} kg · Destino − recepción: {tripReview(t).comparison.receiptDifference??'—'} kg</Text>{tripReview(t).comparison.exceeded&&<Text style={styles.error}>Diferencia superior a {tripReview(t).comparison.threshold.toFixed(2)} kg. Registra explicación antes de cerrar.</Text>}{varianceNotes.filter(n=>n.trip_id===t.id).map((n,i)=><Text key={i}>Explicación: {n.reason}</Text>)}
    {weighings.filter(w=>w.trip_id===t.id).map(w=><View key={w.id}><Text>{w.weighing_type}: bruto {w.gross_weight_kg} − tara {w.tare_weight_kg} = neto {w.net_weight_kg} kg</Text>{w.ticket_storage_path&&<Button label="Ver ticket" onPress={()=>openPhoto('weighing-tickets',w.ticket_storage_path!)}/>}</View>)}
    {(profile?.role==='ADMIN'||profile?.role==='DRIVER'&&t.driver_id===session.user.id)&&<>
     {['ASSIGNED','LOADING','ARRIVED'].includes(t.status)&&!weighings.some(w=>w.trip_id===t.id&&w.weighing_type===(t.status==='ARRIVED'?'DESTINATION':'ORIGIN'))&&<>
     <Input label="Peso bruto (kg)" value={gross} onChange={setGross}/><Input label="Tara (kg)" value={tare} onChange={setTare}/><Input label="Folio de báscula" value={ticketNumber} onChange={setTicketNumber}/>
     <Button label="Fotografiar ticket legible y guardar pesaje" onPress={()=>addWeighing(t)} disabled={busy}/>
     </>}
     {tripReview(t).comparison.exceeded&&reviewReady&&<><Input label="Explicación de la diferencia (mínimo 10 caracteres)" value={varianceReason} onChange={setVarianceReason}/><Button label="Registrar explicación" onPress={()=>recordVariance(t)} disabled={busy}/></>}{profile?.role==='ADMIN'&&reviewReady&&<><Input label="Dato que requiere corrección" value={correctionField} onChange={setCorrectionField}/><Input label="Valor correcto documentado" value={correctionValue} onChange={setCorrectionValue}/><Input label="Motivo de la corrección" value={correctionReason} onChange={setCorrectionReason}/><Button label="Anotar corrección sin borrar original" onPress={()=>recordCorrection(t)} disabled={busy}/></>}{['ASSIGNED','LOADING','IN_TRANSIT'].includes(t.status)&&<Button label={t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada'} onPress={()=>confirm(t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada',`El viaje avanzará de ${t.status} al siguiente estado.`,()=>void advanceTrip(t))} disabled={busy}/>} 
    </>}
   </>}
  </View>)}
  {profile?.role==='ADMIN'&&<><Text style={styles.heading}>Crear viaje y entrega</Text><Text>Lote</Text>{lots.map(l=><Button key={l.id} label={`${tripLotId===l.id?'✓ ':''}${l.trace_code}`} onPress={()=>setTripLotId(l.id)}/>)}<Text>Chofer</Text>{drivers.map(d=><Button key={d.id} label={`${tripDriverId===d.id?'✓ ':''}${d.full_name}`} onPress={()=>setTripDriverId(d.id)}/>)}<Input label="Comprador y destilería de destino" value={destination} onChange={setDestination}/><Input label="Placa del camión" value={vehiclePlate} onChange={setVehiclePlate}/><Button label="Crear viaje asignado" onPress={createTrip} disabled={busy}/></>}
 </>}
 {pane==='deliveries'&&<>
  <SectionTitle eyebrow="04 / DESTINO" title="Entregas visibles" description="La recepción final y el comprobante de entrega."/>
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
 {busy&&<ActivityIndicator color={green}/>}</ScrollView>
 {photoLoading?<Text style={styles.small}>Abriendo fotografía…</Text>:null}
 {photoUrl?<View style={styles.photoOverlay}><Button label="Cerrar fotografía" onPress={()=>setPhotoUrl('')}/><Image source={{uri:photoUrl}} resizeMode="contain" style={styles.photoPreview} onError={()=>{setPhotoUrl('');showError('La fotografía descargada no se pudo mostrar.')}}/></View>:null}
 </SafeAreaView>
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#F7F4EB'},center:{flex:1,justifyContent:'center'},body:{width:'100%',maxWidth:1160,alignSelf:'center',paddingHorizontal:22,paddingBottom:76,gap:16},
 brand:{fontSize:14,fontWeight:'900',color:green,letterSpacing:3},small:{color:'#687A6E',fontSize:13,marginTop:5},muted:{color:'#677568',fontSize:14,lineHeight:21},eyebrow:{color:'#A46A31',fontSize:11,fontWeight:'900',letterSpacing:2.2},title:{fontSize:30,fontWeight:'800',color:'#183B30',marginTop:5},sectionHead:{marginTop:20,marginBottom:4,gap:4},heading:{fontWeight:'800',fontSize:18,color:'#1C4133'},
 topBar:{paddingTop:22,paddingBottom:17,flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,borderBottomWidth:1,borderBottomColor:'#E5E4D7'},topActions:{flexDirection:'row',gap:8},topAction:{borderWidth:1,borderColor:'#D8DFD2',paddingVertical:10,paddingHorizontal:14,borderRadius:30,backgroundColor:'#FFFDF7'},topActionText:{color:green,fontWeight:'700',fontSize:13},
 hero:{height:315,backgroundColor:'#173D32',borderRadius:24,overflow:'hidden',justifyContent:'flex-end'},heroArt:{position:'absolute',top:0,left:0,width:'100%',height:'100%'},heroCopy:{padding:28,backgroundColor:'rgba(16,49,39,.84)',gap:7},heroKicker:{color:'#DEB477',fontSize:11,fontWeight:'900',letterSpacing:2},heroTitle:{color:'#FFFBEE',fontSize:35,fontWeight:'800',lineHeight:40,maxWidth:530},heroText:{color:'#E7E7D8',fontSize:15,lineHeight:22},
 dashboard:{flexDirection:'row',flexWrap:'wrap',gap:12},dashboardCard:{flexGrow:1,flexBasis:180,minWidth:145,backgroundColor:'#FFFDF7',borderWidth:1,borderColor:'#E1E3D6',padding:19,borderRadius:18,minHeight:148,justifyContent:'space-between'},cardNumber:{fontSize:35,fontWeight:'800',color:'#B16F35'},cardTitle:{fontSize:19,fontWeight:'800',color:green},cardCaption:{fontSize:12,color:'#708174'},teamBanner:{backgroundColor:'#1B4738',padding:24,borderRadius:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:6},teamBannerTitle:{color:'#FFF9E8',fontSize:22,fontWeight:'800',marginTop:5},teamBannerNote:{color:'#E6DCC7',fontSize:13,marginTop:4},teamArrow:{fontSize:28,color:'#E8B975'},
 teamIntro:{backgroundColor:'#204738',padding:24,borderRadius:18},teamIntroNumber:{color:'#FFF7E3',fontSize:36,fontWeight:'900'},teamIntroLabel:{color:'#E0D5BE',marginTop:5},teamRole:{backgroundColor:'#FFFDF7',padding:19,borderRadius:17,borderWidth:1,borderColor:'#E3E5D9',gap:9},teamRoleHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'},teamCount:{color:'#AA692D',fontWeight:'900',fontSize:18},teamPerson:{color:green,fontSize:14,paddingVertical:3},teamHelp:{fontSize:13,color:'#6E7669',lineHeight:20,marginTop:6},
 loginBody:{flexGrow:1,width:'100%',maxWidth:950,alignSelf:'center',padding:20,paddingBottom:55,gap:16,justifyContent:'center'},loginHero:{backgroundColor:'#14382E',borderRadius:23,overflow:'hidden',minHeight:290,padding:27,justifyContent:'flex-end',gap:8},loginArt:{position:'absolute',width:'100%',height:'100%',top:0,left:0,opacity:.58},loginForm:{backgroundColor:'#FFFDF7',borderWidth:1,borderColor:'#E3E5D9',borderRadius:20,padding:24,gap:14},formFoot:{textAlign:'center',color:'#9A6B3C',fontSize:11,fontWeight:'800',letterSpacing:2,marginTop:14},
 label:{fontWeight:'700',color:'#234736',marginBottom:7},input:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#CDD8CE',borderRadius:12,padding:14,fontSize:16,color:'#183B30'},button:{backgroundColor:green,paddingVertical:15,paddingHorizontal:17,borderRadius:12,marginTop:4,alignSelf:'stretch'},buttonText:{color:'white',textAlign:'center',fontWeight:'800'},card:{backgroundColor:'#FFFDF7',padding:19,borderRadius:16,borderColor:'#E0E4D8',borderWidth:1,gap:9},row:{flexDirection:'row',gap:10},error:{color:'#9B2424',backgroundColor:'#FCE9E9',padding:12,borderRadius:10},photoOverlay:{position:'absolute',top:0,right:0,bottom:0,left:0,backgroundColor:'#F7F4EB',padding:16,zIndex:10,gap:12},photoPreview:{flex:1,width:'100%',backgroundColor:'#E1E9E3'}
});
   const groupsBeforeImages=partitionByBuyer({lots:lr.data??[],trips:tr.data??[],links:linksResult.data??[],weighings:wr.data??[],deliveries:dr.data??[],images:[]});
   const buyer=groupsBeforeImages.find(g=>g.key===buyerFilter);if(!buyer)throw Error('La asignación del comprador cambió; actualiza la pantalla y vuelve a intentar.');
   const buyerWeighingIds=new Set(buyer.weighings.map(w=>w.id)),buyerDeliveryIds=new Set(buyer.deliveries.map(d=>d.id));
   const refs=[...(he.data??[]).map(p=>({kind:'harvest',label:`Jima ${h.trace_code}`,bucket:p.storage_bucket,path:p.storage_path,capturedAt:p.captured_at,uploadedBy:p.uploaded_by,latitude:p.latitude,longitude:p.longitude,legibilityConfirmed:true})),...(wr.data??[]).filter(w=>w.ticket_storage_path&&buyerWeighingIds.has(w.id)).map(w=>({kind:'ticket',label:w.id,bucket:w.storage_bucket||'weighing-tickets',path:w.ticket_storage_path!,capturedAt:w.captured_at,uploadedBy:w.recorded_by,latitude:w.latitude,longitude:w.longitude,legibilityConfirmed:w.legibility_confirmed})),...(de.data??[]).filter(p=>buyerDeliveryIds.has(p.delivery_id)).map(p=>({kind:'delivery',label:`Entrega ${(dr.data??[]).find(d=>d.id===p.delivery_id)?.trace_code??p.delivery_id}`,bucket:p.storage_bucket,path:p.storage_path,capturedAt:p.captured_at,uploadedBy:p.uploaded_by,latitude:p.latitude,longitude:p.longitude,legibilityConfirmed:p.legibility_confirmed}))];
   const images:DossierImage[]=[];
   for(const ref of refs){
    const {data:blob,error:downloadError}=await supabase.storage.from(ref.bucket).download(ref.path);check(downloadError);if(!blob)throw Error(`No se pudo descargar la evidencia ${ref.label}`);
    if(!blob.type.startsWith('image/'))throw Error(`La evidencia ${ref.label} no es una imagen compatible.`);
    const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('No se pudo leer una fotografía'));reader.readAsDataURL(blob)});
    images.push({kind:ref.kind,label:ref.label,mime:blob.type,base64,fileName:ref.path.split('/').pop()||'evidencia',capturedAt:ref.capturedAt,uploadedBy:ref.uploadedBy,latitude:ref.latitude,longitude:ref.longitude,legibilityConfirmed:ref.legibilityConfirmed});
   }
   const groups=partitionByBuyer({lots:lr.data??[],trips:tr.data??[],links:linksResult.data??[],weighings:wr.data??[],deliveries:dr.data??[],images});
   const group=groups.find(g=>g.key===buyerFilter);if(!group)throw Error('La asignación del comprador cambió; actualiza la pantalla y vuelve a intentar.');
    const result=buildDossier({harvest:hr.data,farm:fr.data,crew:cr.data,lots:group.lots,trips:group.trips,links:group.links,weighings:group.weighings,deliveries:group.deliveries,drivers:driversResult.data??[],images:group.images,generatedAt:new Date().toISOString(),organizationId,buyerName:group.name,varianceLimitKg,varianceLimitPercent,varianceNotes,corrections});
    const file=new Blob([result.html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=`expediente-${h.trace_code.replace(/[^a-zA-Z0-9_-]/g,'_')}-${group.name.replace(/[^a-zA-Z0-9_-]/g,'_')}-${result.complete?'completo':'borrador'}.html`;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   if(!result.complete)showError(`El expediente de ${group.name} se descargó como BORRADOR. Revisa los pendientes dentro del archivo.`);
  }catch(e){const message=`No se pudo generar el expediente: ${String(e)}`;setError(message);showError(message)}finally{setExporting(false)}
 };
 const createTrip=()=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const lot=lots.find(l=>l.id===tripLotId);
  if(!lot||!tripDriverId)throw Error('Selecciona lote y chofer');const destinationName=requiredText(destination,'Destino',120);
  if(lot.status!=='HARVESTED'||harvests.find(h=>h.id===lot.harvest_order_id)?.status!=='HARVESTED')throw Error('El lote y la jima deben estar cosechados antes de programar el viaje');
  if(tripLots.some(link=>link.agave_lot_id===lot.id))throw Error('Este lote ya está asignado a un viaje');
  const plate=requiredText(vehiclePlate,'Placa del camión',25).toUpperCase();const {data:trip,error:tripError}=await supabase.from('trips').insert({organization_id:organizationId,driver_id:tripDriverId,origin_farm_id:lot.farm_id,destination_name:destinationName,vehicle_plate:plate,status:'ASSIGNED',created_by:session.user.id}).select('id').single();check(tripError);if(!trip)throw Error('No se creó el viaje');
  const {error:lotError}=await supabase.from('trip_lots').insert({trip_id:trip.id,agave_lot_id:lot.id,loaded_weight_kg:lot.actual_weight_kg,loaded_agave_count:lot.agave_count,created_by:session.user.id});check(lotError);
  const {error:deliveryError}=await supabase.from('deliveries').insert({organization_id:organizationId,trip_id:trip.id,recipient_company:destinationName,status:'PENDING',created_by:session.user.id});check(deliveryError);setTripLotId('');setTripDriverId('');setVehiclePlate('');setDestination('');
 });
 const addWeighing=(trip:Trip)=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const g=decimal(gross,'Peso bruto',0.01,200000),t=decimal(tare,'Tara',0,200000);
  if(!['ASSIGNED','LOADING','ARRIVED'].includes(trip.status))throw Error('El pesaje se registra en origen antes de salir o al llegar a destino');
  if(g<=t)throw Error('El peso bruto debe superar la tara');const weighingType=trip.status==='ARRIVED'?'DESTINATION':'ORIGIN';if(weighings.some(w=>w.trip_id===trip.id&&w.weighing_type===weighingType))throw Error(`Ya existe el pesaje de ${weighingType==='ORIGIN'?'origen':'destino'}`);
  const ticket=requiredText(ticketNumber,'Folio de báscula',80);const photo=await captureEvidence('weighing',organizationId,trip.id,session.user.id);if(!photo)return;
  const {error}=await supabase.from('weighings').insert({trip_id:trip.id,weighing_type:weighingType,gross_weight_kg:g,tare_weight_kg:t,net_weight_kg:g-t,ticket_number:ticket,storage_bucket:photo.bucket,ticket_storage_path:photo.path,recorded_by:session.user.id,legibility_confirmed:photo.legibilityConfirmed,captured_at:photo.capturedAt,latitude:photo.latitude,longitude:photo.longitude});check(error);setGross('');setTare('');setTicketNumber('');
 });
 const recordVariance=(trip:Trip)=>action(async()=>{if(!supabase||!reviewReady)throw Error('Falta activar el control de conciliación en Supabase');const reason=requiredText(varianceReason,'Explicación de la diferencia',1000);if(reason.length<10)throw Error('Describe la diferencia con al menos 10 caracteres');const {error}=await supabase.rpc('record_trip_variance_review',{p_trip_id:trip.id,p_reason:reason});check(error);setVarianceReason('')});
 const recordCorrection=(trip:Trip)=>action(async()=>{if(!supabase||!reviewReady)throw Error('Falta activar el registro de correcciones en Supabase');const field=requiredText(correctionField,'Campo a corregir',80),value=requiredText(correctionValue,'Valor corregido',300),reason=requiredText(correctionReason,'Motivo',1000);if(reason.length<10)throw Error('Describe el motivo con al menos 10 caracteres');const {error}=await supabase.rpc('record_trip_correction',{p_trip_id:trip.id,p_field_name:field,p_corrected_value:value,p_reason:reason});check(error);setCorrectionField('');setCorrectionValue('');setCorrectionReason('')});
 const saveVarianceLimits=()=>action(async()=>{if(!supabase||!session||!organizationId||!reviewReady||profile?.role!=='ADMIN')throw Error('No puedes cambiar la tolerancia');const limit_kg=decimal(limitKgInput,'Tolerancia en kg',0,10000),limit_percent=decimal(limitPercentInput,'Tolerancia en porcentaje',0,100);const {error}=await supabase.from('organization_variance_settings').upsert({organization_id:organizationId,limit_kg,limit_percent,updated_at:new Date().toISOString(),updated_by:session.user.id});check(error)});
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
  const linked=tripLots.filter(l=>l.trip_id===trip.id),fieldKg=linked.length?linked.reduce((a,l)=>a+Number(l.loaded_weight_kg||0),0):null,origin=weighings.find(w=>w.trip_id===trip.id&&w.weighing_type==='ORIGIN');
  const difference=variance(fieldKg,origin?.net_weight_kg??null,Number(destinationWeight),weight,rejectedWeight,varianceLimitKg,varianceLimitPercent);
  if(difference.exceeded&&!varianceNotes.some(note=>note.trip_id===trip.id&&note.reason.trim()))throw Error('La diferencia excede la tolerancia; registra una explicación en el viaje antes de cerrar.');
  const {data,error}=await supabase.rpc('complete_delivery',{p_delivery_id:d.id,p_received_by_name:receiverName,p_accepted_weight_kg:weight,p_rejected_weight_kg:rejectedWeight,p_rejection_reason:reason||null});check(error);if(data!=='COMPLETED')throw Error('El servidor no confirmó el cierre de la entrega');setReceiver('');setAccepted('');setRejected('');setRejectionReason('');
 });
 const tripReview=(t:Trip)=>{
  const linked=tripLots.filter(l=>l.trip_id===t.id),field=linked.length?linked.reduce((a,l)=>a+Number(l.loaded_weight_kg||0),0):null;
  const ws=weighings.filter(w=>w.trip_id===t.id),origin=ws.find(w=>w.weighing_type==='ORIGIN'),dest=ws.find(w=>w.weighing_type==='DESTINATION'),ds=deliveries.filter(d=>d.trip_id===t.id);
  const accepted=ds.length&&ds.every(d=>d.accepted_weight_kg!=null)?ds.reduce((a,d)=>a+Number(d.accepted_weight_kg),0):null;
  const rejected=ds.length&&ds.every(d=>d.rejected_weight_kg!=null)?ds.reduce((a,d)=>a+Number(d.rejected_weight_kg),0):null;
  const comparison=variance(field,origin?.net_weight_kg??null,dest?.net_weight_kg??null,accepted,rejected,varianceLimitKg,varianceLimitPercent);
  const missing=[!origin?'pesaje origen':null,!dest?'pesaje destino':null,...ws.filter(w=>!w.ticket_storage_path||!w.legibility_confirmed).map(w=>`ticket ${w.weighing_type}`),!ds.length?'entrega':null,...ds.filter(d=>!deliveryPhotos.some(p=>p.delivery_id===d.id&&p.legibility_confirmed)).map(d=>`recibo ${d.trace_code}`)].filter(Boolean);
  return {comparison,missing,hasExplanation:varianceNotes.some(n=>n.trip_id===t.id&&n.reason?.trim())};
 };
 const buyerGroupsForHarvest=(h:Harvest)=>{
  try{return {groups:partitionByBuyer({lots:lots.filter(l=>l.harvest_order_id===h.id),trips:trips.filter(t=>tripLots.some(x=>x.trip_id===t.id&&lots.some(l=>l.id===x.agave_lot_id&&l.harvest_order_id===h.id))),links:tripLots,weighings,deliveries,images:[]}),message:''}}
  catch(e){return {groups:[],message:String(e)}}
 };
 const matchesTrip=(t:Trip)=>{const query=search.trim().toLocaleLowerCase('es-MX');if(!query)return true;
  const relatedLots=tripLots.filter(l=>l.trip_id===t.id).map(x=>lots.find(l=>l.id===x.agave_lot_id)).filter(Boolean);
  const fields=[t.trace_code,t.vehicle_plate,t.destination_name,...relatedLots.map(l=>l!.trace_code),...relatedLots.map(l=>harvests.find(h=>h.id===l!.harvest_order_id)?.trace_code),...relatedLots.map(l=>farms.find(f=>f.id===l!.farm_id)?.name),...weighings.filter(w=>w.trip_id===t.id).map(w=>w.ticket_number),...deliveries.filter(d=>d.trip_id===t.id).map(d=>d.recipient_company)];
  return fields.some(value=>String(value??'').toLocaleLowerCase('es-MX').includes(query));
 };
 if(loading)return <SafeAreaView style={styles.center}><ActivityIndicator color={green}/></SafeAreaView>;
 if(!session)return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.loginBody}><View style={styles.loginHero}><Text style={styles.brand}>AGAVE  /  TRAZA</Text>{landscape?<Image source={landscape} resizeMode="cover" style={styles.loginArt}/>:null}<Text style={styles.heroKicker}>TRAZABILIDAD DESDE EL ORIGEN</Text><Text style={styles.heroTitle}>El campo tiene una historia.</Text><Text style={styles.heroText}>Regístrala desde Los Altos de Jalisco hasta su destino.</Text></View><View style={styles.loginForm}><SectionTitle eyebrow="BIENVENIDO" title="Inicia sesión" description="Tu operación, tus registros y tus fotografías en un solo lugar."/><Input label="Correo electrónico" value={email} onChange={setEmail}/><View><Text style={styles.label}>Contraseña</Text><TextInput secureTextEntry style={styles.input} value={password} onChangeText={setPassword}/></View><Button label="Entrar a Agave Traza" onPress={login} disabled={busy}/>{error?<Text style={styles.error}>{error}</Text>:null}<Text style={styles.formFoot}>LOS ALTOS · JALISCO · MÉXICO</Text></View></ScrollView></SafeAreaView>;
 return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><View style={styles.topBar}><View><Text style={styles.brand}>AGAVE  /  TRAZA</Text><Text style={styles.small}>{profile?.full_name??session.user.email} · {profile?roleNames[profile.role]:'Cargando perfil'}</Text></View><View style={styles.topActions}><Pressable onPress={()=>{setPane('home');setSelected('')}} style={styles.topAction}><Text style={styles.topActionText}>Inicio</Text></Pressable><Pressable onPress={()=>void action(async()=>{})} disabled={busy} style={styles.topAction}><Text style={styles.topActionText}>↻ Actualizar</Text></Pressable></View></View>{error?<Text style={styles.error}>{error}</Text>:null}
 {pane==='home'&&<><View style={styles.hero}>{landscape?<Image source={landscape} resizeMode="cover" style={styles.heroArt}/>:null}<View style={styles.heroCopy}><Text style={styles.heroKicker}>DESDE EL ORIGEN · LOS ALTOS DE JALISCO</Text><Text style={styles.heroTitle}>Cada agave cuenta una historia.</Text><Text style={styles.heroText}>Del predio a la entrega, cada paso queda registrado.</Text></View></View><SectionTitle eyebrow="CENTRO DE OPERACIONES" title="Tu jornada" description="Selecciona el proceso que quieres consultar o registrar."/><View style={styles.dashboard}><Pressable style={styles.dashboardCard} onPress={()=>setPane('farms')}><Text style={styles.cardNumber}>{farms.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Predios</Text><Text style={styles.cardCaption}>Territorio y origen  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('harvests')}><Text style={styles.cardNumber}>{harvests.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Jimas</Text><Text style={styles.cardCaption}>Cosecha y lotes  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('trips')}><Text style={styles.cardNumber}>{trips.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Viajes</Text><Text style={styles.cardCaption}>Ruta y pesajes  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('deliveries')}><Text style={styles.cardNumber}>{deliveries.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Entregas</Text><Text style={styles.cardCaption}>Recepción final  ↗</Text></Pressable></View>{profile?.role==='ADMIN'&&<Button label="Control diario de camiones" onPress={()=>setPane('control')}/>}{profile?.role==='ADMIN'?<Pressable style={styles.teamBanner} onPress={()=>setPane('team')}><View><Text style={styles.heroKicker}>ORGANIZACIÓN</Text><Text style={styles.teamBannerTitle}>Equipo de campo</Text><Text style={styles.teamBannerNote}>2 administradores · 5 jefes · 10 choferes</Text></View><Text style={styles.teamArrow}>↗</Text></Pressable>:null}<Button label="Cerrar sesión" onPress={()=>void supabase?.auth.signOut()}/></>}
 {pane==='control'&&profile?.role==='ADMIN'&&<><SectionTitle eyebrow="OPERACIÓN / HOY" title="Control diario de camiones" description="Pendientes, en ruta, recibidos y expedientes con documentos faltantes."/><Text>Asignados: {trips.filter(t=>['ASSIGNED','LOADING'].includes(t.status)).length} · En ruta: {trips.filter(t=>t.status==='IN_TRANSIT').length} · Llegados: {trips.filter(t=>t.status==='ARRIVED').length} · Entregados: {trips.filter(t=>t.status==='DELIVERED').length}</Text><Input label="Buscar jima, predio, placa, folio o comprador" value={search} onChange={setSearch}/><Text style={styles.muted}>Tolerancia: {varianceLimitKg} kg o {varianceLimitPercent}% del peso de origen, lo que sea mayor.</Text>{reviewReady&&<><Input label="Tolerancia mínima (kg)" value={limitKgInput} onChange={setLimitKgInput}/><Input label="Tolerancia porcentual sobre origen (%)" value={limitPercentInput} onChange={setLimitPercentInput}/><Button label="Guardar tolerancia de la organización" onPress={saveVarianceLimits} disabled={busy}/></>}{!reviewReady&&<Text style={styles.error}>La migración de control de Supabase está pendiente; no cierres entregas hasta activarla.</Text>}{trips.filter(matchesTrip).map(t=>{const review=tripReview(t);return <View key={t.id} style={styles.card}><Text style={styles.heading}>{t.trace_code} · {t.status}</Text><Text>{t.vehicle_plate??'Sin placa'} · {t.destination_name??'Sin comprador'}</Text><Text>Campo − origen: {review.comparison.originDifference??'—'} kg · Origen − destino: {review.comparison.transitDifference??'—'} kg · Destino − recepción: {review.comparison.receiptDifference??'—'} kg</Text><Text style={review.comparison.exceeded&&!review.hasExplanation?styles.error:styles.muted}>{review.comparison.exceeded?(review.hasExplanation?'Diferencia explicada':'Diferencia fuera de tolerancia · falta explicación'):'Sin alerta de diferencia'}</Text>{review.missing.length>0&&<Text style={styles.error}>Pendientes: {review.missing.join(', ')}</Text>}{varianceNotes.filter(n=>n.trip_id===t.id).map((note,i)=><Text key={i}>Aclaración {new Date(note.created_at).toLocaleString('es-MX')}: {note.reason}</Text>)}</View>})}</>}
 {pane==='team'&&profile?.role==='ADMIN'&&<><SectionTitle eyebrow="PERSONAS / ACCESOS" title="Equipo de campo" description="Planeación para 17 cuentas, repartidas por función. Sólo se cuentan perfiles activos de tu organización."/>{teamError?<Text style={styles.error}>{teamError}</Text>:null}<View style={styles.teamIntro}><Text style={styles.teamIntroNumber}>{teamError?'—':team.length} / 17</Text><Text style={styles.teamIntroLabel}>Usuarios activos registrados</Text></View>{(['ADMIN','CREW_LEADER','DRIVER'] as Role[]).map(role=>{const people=team.filter(person=>person.role===role&&person.status==='ACTIVE');return <View key={role} style={styles.teamRole}><View style={styles.teamRoleHeader}><Text style={styles.heading}>{roleNames[role]}</Text><Text style={styles.teamCount}>{teamError?'—':people.length} / {teamTargets[role]}</Text></View>{people.map(person=><Text key={person.id} style={styles.teamPerson}>●  {person.full_name}</Text>)}{!teamError&&people.length<teamTargets[role]?<Text style={styles.muted}>Faltan {teamTargets[role]-people.length} {teamTargets[role]-people.length===1?'cuenta':'cuentas'} por dar de alta.</Text>:null}</View>})}<Text style={styles.teamHelp}>Las cuentas nuevas requieren correo y nombre de cada persona. No se crean usuarios de muestra ni se comparten contraseñas desde esta pantalla.</Text></>}
 {pane==='farms'&&<><SectionTitle eyebrow="01 / ORIGEN" title="Predios visibles" description="La tierra donde comienza cada lote de agave."/>{farms.map(f=><View key={f.id} style={styles.card}><Text style={styles.heading}>{f.name}</Text><Text>{f.code} · {f.municipality??f.state}</Text></View>)}{profile?.role==='ADMIN'&&<><Text style={styles.heading}>Nuevo predio</Text><Input label="Código" value={farmCode} onChange={setFarmCode}/><Input label="Nombre" value={farmName} onChange={setFarmName}/><Input label="Estado" value={farmState} onChange={setFarmState}/><Button label="Guardar predio" onPress={createFarm} disabled={busy}/></>}</>}
 {pane==='harvests'&&<>
  <SectionTitle eyebrow="02 / COSECHA" title="Jimas visibles" description="El trabajo en campo, los lotes y su evidencia."/>
  {harvests.map(h=><View key={h.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===h.id?'':h.id)}><Text style={styles.heading}>{h.trace_code} {selected===h.id?'▲':'▼'}</Text><Text>{farms.find(f=>f.id===h.farm_id)?.name??'Predio'} · {h.status} · {h.scheduled_date??'Sin fecha'}</Text></Pressable>
   {selected===h.id&&<>
    <Text>Cuadrilla: {crews.find(c=>c.id===h.crew_id)?.name??'Sin asignar'}</Text>
    {h.notes?<Text>{h.notes}</Text>:null}
    {profile?.role==='ADMIN'&&(()=>{const result=buyerGroupsForHarvest(h);return <>{result.message?<Text style={styles.error}>{result.message}</Text>:null}{result.groups.map(group=><Button key={group.key} label={exporting?'Preparando expediente…':`Descargar expediente · ${group.name}`} onPress={()=>void exportHarvest(h,group.key)} disabled={exporting||busy}/>)}</>})()}
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
  <SectionTitle eyebrow="03 / TRAYECTO" title="Viajes visibles" description="Del predio a destino con cada pesaje registrado."/>
  {trips.map(t=><View key={t.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===t.id?'':t.id)}><Text style={styles.heading}>{t.trace_code} {selected===t.id?'▲':'▼'}</Text><Text>{t.status} · {t.destination_name??'Sin destino'}</Text></Pressable>
   {selected===t.id&&<>
    <Text>Placa: {t.vehicle_plate??'Sin registrar'} · Pesajes: {weighings.filter(w=>w.trip_id===t.id).length}</Text><Text>Campo − origen: {tripReview(t).comparison.originDifference??'—'} kg · Origen − destino: {tripReview(t).comparison.transitDifference??'—'} kg · Destino − recepción: {tripReview(t).comparison.receiptDifference??'—'} kg</Text>{tripReview(t).comparison.exceeded&&<Text style={styles.error}>Diferencia superior a {tripReview(t).comparison.threshold.toFixed(2)} kg. Registra explicación antes de cerrar.</Text>}{varianceNotes.filter(n=>n.trip_id===t.id).map((n,i)=><Text key={i}>Explicación: {n.reason}</Text>)}
    {weighings.filter(w=>w.trip_id===t.id).map(w=><View key={w.id}><Text>{w.weighing_type}: bruto {w.gross_weight_kg} − tara {w.tare_weight_kg} = neto {w.net_weight_kg} kg</Text>{w.ticket_storage_path&&<Button label="Ver ticket" onPress={()=>openPhoto('weighing-tickets',w.ticket_storage_path!)}/>}</View>)}
    {(profile?.role==='ADMIN'||profile?.role==='DRIVER'&&t.driver_id===session.user.id)&&<>
     {['ASSIGNED','LOADING','ARRIVED'].includes(t.status)&&!weighings.some(w=>w.trip_id===t.id&&w.weighing_type===(t.status==='ARRIVED'?'DESTINATION':'ORIGIN'))&&<>
     <Input label="Peso bruto (kg)" value={gross} onChange={setGross}/><Input label="Tara (kg)" value={tare} onChange={setTare}/><Input label="Folio de báscula" value={ticketNumber} onChange={setTicketNumber}/>
     <Button label="Fotografiar ticket legible y guardar pesaje" onPress={()=>addWeighing(t)} disabled={busy}/>
     </>}
     {tripReview(t).comparison.exceeded&&reviewReady&&<><Input label="Explicación de la diferencia (mínimo 10 caracteres)" value={varianceReason} onChange={setVarianceReason}/><Button label="Registrar explicación" onPress={()=>recordVariance(t)} disabled={busy}/></>}{profile?.role==='ADMIN'&&reviewReady&&<><Input label="Dato que requiere corrección" value={correctionField} onChange={setCorrectionField}/><Input label="Valor correcto documentado" value={correctionValue} onChange={setCorrectionValue}/><Input label="Motivo de la corrección" value={correctionReason} onChange={setCorrectionReason}/><Button label="Anotar corrección sin borrar original" onPress={()=>recordCorrection(t)} disabled={busy}/></>}{['ASSIGNED','LOADING','IN_TRANSIT'].includes(t.status)&&<Button label={t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada'} onPress={()=>confirm(t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada',`El viaje avanzará de ${t.status} al siguiente estado.`,()=>void advanceTrip(t))} disabled={busy}/>} 
    </>}
   </>}
  </View>)}
  {profile?.role==='ADMIN'&&<><Text style={styles.heading}>Crear viaje y entrega</Text><Text>Lote</Text>{lots.map(l=><Button key={l.id} label={`${tripLotId===l.id?'✓ ':''}${l.trace_code}`} onPress={()=>setTripLotId(l.id)}/>)}<Text>Chofer</Text>{drivers.map(d=><Button key={d.id} label={`${tripDriverId===d.id?'✓ ':''}${d.full_name}`} onPress={()=>setTripDriverId(d.id)}/>)}<Input label="Comprador y destilería de destino" value={destination} onChange={setDestination}/><Input label="Placa del camión" value={vehiclePlate} onChange={setVehiclePlate}/><Button label="Crear viaje asignado" onPress={createTrip} disabled={busy}/></>}
 </>}
 {pane==='deliveries'&&<>
  <SectionTitle eyebrow="04 / DESTINO" title="Entregas visibles" description="La recepción final y el comprobante de entrega."/>
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
 {busy&&<ActivityIndicator color={green}/>}</ScrollView>
 {photoLoading?<Text style={styles.small}>Abriendo fotografía…</Text>:null}
 {photoUrl?<View style={styles.photoOverlay}><Button label="Cerrar fotografía" onPress={()=>setPhotoUrl('')}/><Image source={{uri:photoUrl}} resizeMode="contain" style={styles.photoPreview} onError={()=>{setPhotoUrl('');showError('La fotografía descargada no se pudo mostrar.')}}/></View>:null}
 </SafeAreaView>
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#F7F4EB'},center:{flex:1,justifyContent:'center'},body:{width:'100%',maxWidth:1160,alignSelf:'center',paddingHorizontal:22,paddingBottom:76,gap:16},
 brand:{fontSize:14,fontWeight:'900',color:green,letterSpacing:3},small:{color:'#687A6E',fontSize:13,marginTop:5},muted:{color:'#677568',fontSize:14,lineHeight:21},eyebrow:{color:'#A46A31',fontSize:11,fontWeight:'900',letterSpacing:2.2},title:{fontSize:30,fontWeight:'800',color:'#183B30',marginTop:5},sectionHead:{marginTop:20,marginBottom:4,gap:4},heading:{fontWeight:'800',fontSize:18,color:'#1C4133'},
 topBar:{paddingTop:22,paddingBottom:17,flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,borderBottomWidth:1,borderBottomColor:'#E5E4D7'},topActions:{flexDirection:'row',gap:8},topAction:{borderWidth:1,borderColor:'#D8DFD2',paddingVertical:10,paddingHorizontal:14,borderRadius:30,backgroundColor:'#FFFDF7'},topActionText:{color:green,fontWeight:'700',fontSize:13},
 hero:{height:315,backgroundColor:'#173D32',borderRadius:24,overflow:'hidden',justifyContent:'flex-end'},heroArt:{position:'absolute',top:0,left:0,width:'100%',height:'100%'},heroCopy:{padding:28,backgroundColor:'rgba(16,49,39,.84)',gap:7},heroKicker:{color:'#DEB477',fontSize:11,fontWeight:'900',letterSpacing:2},heroTitle:{color:'#FFFBEE',fontSize:35,fontWeight:'800',lineHeight:40,maxWidth:530},heroText:{color:'#E7E7D8',fontSize:15,lineHeight:22},
 dashboard:{flexDirection:'row',flexWrap:'wrap',gap:12},dashboardCard:{flexGrow:1,flexBasis:180,minWidth:145,backgroundColor:'#FFFDF7',borderWidth:1,borderColor:'#E1E3D6',padding:19,borderRadius:18,minHeight:148,justifyContent:'space-between'},cardNumber:{fontSize:35,fontWeight:'800',color:'#B16F35'},cardTitle:{fontSize:19,fontWeight:'800',color:green},cardCaption:{fontSize:12,color:'#708174'},teamBanner:{backgroundColor:'#1B4738',padding:24,borderRadius:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:6},teamBannerTitle:{color:'#FFF9E8',fontSize:22,fontWeight:'800',marginTop:5},teamBannerNote:{color:'#E6DCC7',fontSize:13,marginTop:4},teamArrow:{fontSize:28,color:'#E8B975'},
 teamIntro:{backgroundColor:'#204738',padding:24,borderRadius:18},teamIntroNumber:{color:'#FFF7E3',fontSize:36,fontWeight:'900'},teamIntroLabel:{color:'#E0D5BE',marginTop:5},teamRole:{backgroundColor:'#FFFDF7',padding:19,borderRadius:17,borderWidth:1,borderColor:'#E3E5D9',gap:9},teamRoleHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'},teamCount:{color:'#AA692D',fontWeight:'900',fontSize:18},teamPerson:{color:green,fontSize:14,paddingVertical:3},teamHelp:{fontSize:13,color:'#6E7669',lineHeight:20,marginTop:6},
 loginBody:{flexGrow:1,width:'100%',maxWidth:950,alignSelf:'center',padding:20,paddingBottom:55,gap:16,justifyContent:'center'},loginHero:{backgroundColor:'#14382E',borderRadius:23,overflow:'hidden',minHeight:290,padding:27,justifyContent:'flex-end',gap:8},loginArt:{position:'absolute',width:'100%',height:'100%',top:0,left:0,opacity:.58},loginForm:{backgroundColor:'#FFFDF7',borderWidth:1,borderColor:'#E3E5D9',borderRadius:20,padding:24,gap:14},formFoot:{textAlign:'center',color:'#9A6B3C',fontSize:11,fontWeight:'800',letterSpacing:2,marginTop:14},
 label:{fontWeight:'700',color:'#234736',marginBottom:7},input:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#CDD8CE',borderRadius:12,padding:14,fontSize:16,color:'#183B30'},button:{backgroundColor:green,paddingVertical:15,paddingHorizontal:17,borderRadius:12,marginTop:4,alignSelf:'stretch'},buttonText:{color:'white',textAlign:'center',fontWeight:'800'},card:{backgroundColor:'#FFFDF7',padding:19,borderRadius:16,borderColor:'#E0E4D8',borderWidth:1,gap:9},row:{flexDirection:'row',gap:10},error:{color:'#9B2424',backgroundColor:'#FCE9E9',padding:12,borderRadius:10},photoOverlay:{position:'absolute',top:0,right:0,bottom:0,left:0,backgroundColor:'#F7F4EB',padding:16,zIndex:10,gap:12},photoPreview:{flex:1,width:'100%',backgroundColor:'#E1E9E3'}
});
   const [de,driversResult]=await Promise.all([
    deliveryIds.length?supabase.from('delivery_evidence').select('id,delivery_id,storage_bucket,storage_path,captured_at,uploaded_by,latitude,longitude,legibility_confirmed').in('delivery_id',deliveryIds):Promise.resolve({data:[],error:null}),
    (tr.data??[]).some(t=>t.driver_id)?supabase.from('profiles').select('id,full_name').in('id',(tr.data??[]).map(t=>t.driver_id).filter((v):v is string=>!!v)):Promise.resolve({data:[],error:null})
   ]);for(const r of [de,driversResult])check(r.error);
   const refs=[...(he.data??[]).map(p=>({kind:'harvest',label:`Jima ${h.trace_code}`,bucket:p.storage_bucket,path:p.storage_path,capturedAt:p.captured_at,uploadedBy:p.uploaded_by,latitude:p.latitude,longitude:p.longitude,legibilityConfirmed:true})),...(wr.data??[]).filter(w=>w.ticket_storage_path).map(w=>({kind:'ticket',label:w.id,bucket:w.storage_bucket||'weighing-tickets',path:w.ticket_storage_path!,capturedAt:w.captured_at,uploadedBy:w.recorded_by,latitude:w.latitude,longitude:w.longitude,legibilityConfirmed:w.legibility_confirmed})),...(de.data??[]).map(p=>({kind:'delivery',label:`Entrega ${(dr.data??[]).find(d=>d.id===p.delivery_id)?.trace_code??p.delivery_id}`,bucket:p.storage_bucket,path:p.storage_path,capturedAt:p.captured_at,uploadedBy:p.uploaded_by,latitude:p.latitude,longitude:p.longitude,legibilityConfirmed:p.legibility_confirmed}))];
   const images:DossierImage[]=[];
   for(const ref of refs){
    const {data:blob,error:downloadError}=await supabase.storage.from(ref.bucket).download(ref.path);check(downloadError);if(!blob)throw Error(`No se pudo descargar la evidencia ${ref.label}`);
    if(!blob.type.startsWith('image/'))throw Error(`La evidencia ${ref.label} no es una imagen compatible.`);
    const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('No se pudo leer una fotografía'));reader.readAsDataURL(blob)});
    images.push({kind:ref.kind,label:ref.label,mime:blob.type,base64,fileName:ref.path.split('/').pop()||'evidencia',capturedAt:ref.capturedAt,uploadedBy:ref.uploadedBy,latitude:ref.latitude,longitude:ref.longitude,legibilityConfirmed:ref.legibilityConfirmed});
   }
   const groups=partitionByBuyer({lots:lr.data??[],trips:tr.data??[],links:linksResult.data??[],weighings:wr.data??[],deliveries:dr.data??[],images});
   const group=groups.find(g=>g.key===buyerFilter);if(!group)throw Error('La asignación del comprador cambió; actualiza la pantalla y vuelve a intentar.');
    const result=buildDossier({harvest:hr.data,farm:fr.data,crew:cr.data,lots:group.lots,trips:group.trips,links:group.links,weighings:group.weighings,deliveries:group.deliveries,drivers:driversResult.data??[],images:group.images,generatedAt:new Date().toISOString(),organizationId,buyerName:group.name,varianceLimitKg,varianceLimitPercent,varianceNotes,corrections});
    const file=new Blob([result.html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=`expediente-${h.trace_code.replace(/[^a-zA-Z0-9_-]/g,'_')}-${group.name.replace(/[^a-zA-Z0-9_-]/g,'_')}-${result.complete?'completo':'borrador'}.html`;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   if(!result.complete)showError(`El expediente de ${group.name} se descargó como BORRADOR. Revisa los pendientes dentro del archivo.`);
  }catch(e){const message=`No se pudo generar el expediente: ${String(e)}`;setError(message);showError(message)}finally{setExporting(false)}
 };
 const createTrip=()=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const lot=lots.find(l=>l.id===tripLotId);
  if(!lot||!tripDriverId)throw Error('Selecciona lote y chofer');const destinationName=requiredText(destination,'Destino',120);
  if(lot.status!=='HARVESTED'||harvests.find(h=>h.id===lot.harvest_order_id)?.status!=='HARVESTED')throw Error('El lote y la jima deben estar cosechados antes de programar el viaje');
  if(tripLots.some(link=>link.agave_lot_id===lot.id))throw Error('Este lote ya está asignado a un viaje');
  const plate=requiredText(vehiclePlate,'Placa del camión',25).toUpperCase();const {data:trip,error:tripError}=await supabase.from('trips').insert({organization_id:organizationId,driver_id:tripDriverId,origin_farm_id:lot.farm_id,destination_name:destinationName,vehicle_plate:plate,status:'ASSIGNED',created_by:session.user.id}).select('id').single();check(tripError);if(!trip)throw Error('No se creó el viaje');
  const {error:lotError}=await supabase.from('trip_lots').insert({trip_id:trip.id,agave_lot_id:lot.id,loaded_weight_kg:lot.actual_weight_kg,loaded_agave_count:lot.agave_count,created_by:session.user.id});check(lotError);
  const {error:deliveryError}=await supabase.from('deliveries').insert({organization_id:organizationId,trip_id:trip.id,recipient_company:destinationName,status:'PENDING',created_by:session.user.id});check(deliveryError);setTripLotId('');setTripDriverId('');setVehiclePlate('');setDestination('');
 });
 const addWeighing=(trip:Trip)=>action(async()=>{
  if(!supabase||!session||!organizationId)throw Error('Sesión inválida');const g=decimal(gross,'Peso bruto',0.01,200000),t=decimal(tare,'Tara',0,200000);
  if(!['ASSIGNED','LOADING','ARRIVED'].includes(trip.status))throw Error('El pesaje se registra en origen antes de salir o al llegar a destino');
  if(g<=t)throw Error('El peso bruto debe superar la tara');const weighingType=trip.status==='ARRIVED'?'DESTINATION':'ORIGIN';if(weighings.some(w=>w.trip_id===trip.id&&w.weighing_type===weighingType))throw Error(`Ya existe el pesaje de ${weighingType==='ORIGIN'?'origen':'destino'}`);
  const ticket=requiredText(ticketNumber,'Folio de báscula',80);const photo=await captureEvidence('weighing',organizationId,trip.id,session.user.id);if(!photo)return;
  const {error}=await supabase.from('weighings').insert({trip_id:trip.id,weighing_type:weighingType,gross_weight_kg:g,tare_weight_kg:t,net_weight_kg:g-t,ticket_number:ticket,storage_bucket:photo.bucket,ticket_storage_path:photo.path,recorded_by:session.user.id,legibility_confirmed:photo.legibilityConfirmed,captured_at:photo.capturedAt,latitude:photo.latitude,longitude:photo.longitude});check(error);setGross('');setTare('');setTicketNumber('');
 });
 const recordVariance=(trip:Trip)=>action(async()=>{if(!supabase||!reviewReady)throw Error('Falta activar el control de conciliación en Supabase');const reason=requiredText(varianceReason,'Explicación de la diferencia',1000);if(reason.length<10)throw Error('Describe la diferencia con al menos 10 caracteres');const {error}=await supabase.rpc('record_trip_variance_review',{p_trip_id:trip.id,p_reason:reason});check(error);setVarianceReason('')});
 const recordCorrection=(trip:Trip)=>action(async()=>{if(!supabase||!reviewReady)throw Error('Falta activar el registro de correcciones en Supabase');const field=requiredText(correctionField,'Campo a corregir',80),value=requiredText(correctionValue,'Valor corregido',300),reason=requiredText(correctionReason,'Motivo',1000);if(reason.length<10)throw Error('Describe el motivo con al menos 10 caracteres');const {error}=await supabase.rpc('record_trip_correction',{p_trip_id:trip.id,p_field_name:field,p_corrected_value:value,p_reason:reason});check(error);setCorrectionField('');setCorrectionValue('');setCorrectionReason('')});
 const saveVarianceLimits=()=>action(async()=>{if(!supabase||!session||!organizationId||!reviewReady||profile?.role!=='ADMIN')throw Error('No puedes cambiar la tolerancia');const limit_kg=decimal(limitKgInput,'Tolerancia en kg',0,10000),limit_percent=decimal(limitPercentInput,'Tolerancia en porcentaje',0,100);const {error}=await supabase.from('organization_variance_settings').upsert({organization_id:organizationId,limit_kg,limit_percent,updated_at:new Date().toISOString(),updated_by:session.user.id});check(error)});
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
  const linked=tripLots.filter(l=>l.trip_id===trip.id),fieldKg=linked.length?linked.reduce((a,l)=>a+Number(l.loaded_weight_kg||0),0):null,origin=weighings.find(w=>w.trip_id===trip.id&&w.weighing_type==='ORIGIN');
  const difference=variance(fieldKg,origin?.net_weight_kg??null,Number(destinationWeight),weight,rejectedWeight,varianceLimitKg,varianceLimitPercent);
  if(difference.exceeded&&!varianceNotes.some(note=>note.trip_id===trip.id&&note.reason.trim()))throw Error('La diferencia excede la tolerancia; registra una explicación en el viaje antes de cerrar.');
  const {data,error}=await supabase.rpc('complete_delivery',{p_delivery_id:d.id,p_received_by_name:receiverName,p_accepted_weight_kg:weight,p_rejected_weight_kg:rejectedWeight,p_rejection_reason:reason||null});check(error);if(data!=='COMPLETED')throw Error('El servidor no confirmó el cierre de la entrega');setReceiver('');setAccepted('');setRejected('');setRejectionReason('');
 });
 const tripReview=(t:Trip)=>{
  const linked=tripLots.filter(l=>l.trip_id===t.id),field=linked.length?linked.reduce((a,l)=>a+Number(l.loaded_weight_kg||0),0):null;
  const ws=weighings.filter(w=>w.trip_id===t.id),origin=ws.find(w=>w.weighing_type==='ORIGIN'),dest=ws.find(w=>w.weighing_type==='DESTINATION'),ds=deliveries.filter(d=>d.trip_id===t.id);
  const accepted=ds.length&&ds.every(d=>d.accepted_weight_kg!=null)?ds.reduce((a,d)=>a+Number(d.accepted_weight_kg),0):null;
  const rejected=ds.length&&ds.every(d=>d.rejected_weight_kg!=null)?ds.reduce((a,d)=>a+Number(d.rejected_weight_kg),0):null;
  const comparison=variance(field,origin?.net_weight_kg??null,dest?.net_weight_kg??null,accepted,rejected,varianceLimitKg,varianceLimitPercent);
  const missing=[!origin?'pesaje origen':null,!dest?'pesaje destino':null,...ws.filter(w=>!w.ticket_storage_path||!w.legibility_confirmed).map(w=>`ticket ${w.weighing_type}`),!ds.length?'entrega':null,...ds.filter(d=>!deliveryPhotos.some(p=>p.delivery_id===d.id&&p.legibility_confirmed)).map(d=>`recibo ${d.trace_code}`)].filter(Boolean);
  return {comparison,missing,hasExplanation:varianceNotes.some(n=>n.trip_id===t.id&&n.reason?.trim())};
 };
 const matchesTrip=(t:Trip)=>{const query=search.trim().toLocaleLowerCase('es-MX');if(!query)return true;
  const relatedLots=tripLots.filter(l=>l.trip_id===t.id).map(x=>lots.find(l=>l.id===x.agave_lot_id)).filter(Boolean);
  const fields=[t.trace_code,t.vehicle_plate,t.destination_name,...relatedLots.map(l=>l!.trace_code),...relatedLots.map(l=>harvests.find(h=>h.id===l!.harvest_order_id)?.trace_code),...relatedLots.map(l=>farms.find(f=>f.id===l!.farm_id)?.name),...weighings.filter(w=>w.trip_id===t.id).map(w=>w.ticket_number),...deliveries.filter(d=>d.trip_id===t.id).map(d=>d.recipient_company)];
  return fields.some(value=>String(value??'').toLocaleLowerCase('es-MX').includes(query));
 };
 if(loading)return <SafeAreaView style={styles.center}><ActivityIndicator color={green}/></SafeAreaView>;
 if(!session)return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.loginBody}><View style={styles.loginHero}><Text style={styles.brand}>AGAVE  /  TRAZA</Text>{landscape?<Image source={landscape} resizeMode="cover" style={styles.loginArt}/>:null}<Text style={styles.heroKicker}>TRAZABILIDAD DESDE EL ORIGEN</Text><Text style={styles.heroTitle}>El campo tiene una historia.</Text><Text style={styles.heroText}>Regístrala desde Los Altos de Jalisco hasta su destino.</Text></View><View style={styles.loginForm}><SectionTitle eyebrow="BIENVENIDO" title="Inicia sesión" description="Tu operación, tus registros y tus fotografías en un solo lugar."/><Input label="Correo electrónico" value={email} onChange={setEmail}/><View><Text style={styles.label}>Contraseña</Text><TextInput secureTextEntry style={styles.input} value={password} onChangeText={setPassword}/></View><Button label="Entrar a Agave Traza" onPress={login} disabled={busy}/>{error?<Text style={styles.error}>{error}</Text>:null}<Text style={styles.formFoot}>LOS ALTOS · JALISCO · MÉXICO</Text></View></ScrollView></SafeAreaView>;
 return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><View style={styles.topBar}><View><Text style={styles.brand}>AGAVE  /  TRAZA</Text><Text style={styles.small}>{profile?.full_name??session.user.email} · {profile?roleNames[profile.role]:'Cargando perfil'}</Text></View><View style={styles.topActions}><Pressable onPress={()=>{setPane('home');setSelected('')}} style={styles.topAction}><Text style={styles.topActionText}>Inicio</Text></Pressable><Pressable onPress={()=>void action(async()=>{})} disabled={busy} style={styles.topAction}><Text style={styles.topActionText}>↻ Actualizar</Text></Pressable></View></View>{error?<Text style={styles.error}>{error}</Text>:null}
 {pane==='home'&&<><View style={styles.hero}>{landscape?<Image source={landscape} resizeMode="cover" style={styles.heroArt}/>:null}<View style={styles.heroCopy}><Text style={styles.heroKicker}>DESDE EL ORIGEN · LOS ALTOS DE JALISCO</Text><Text style={styles.heroTitle}>Cada agave cuenta una historia.</Text><Text style={styles.heroText}>Del predio a la entrega, cada paso queda registrado.</Text></View></View><SectionTitle eyebrow="CENTRO DE OPERACIONES" title="Tu jornada" description="Selecciona el proceso que quieres consultar o registrar."/><View style={styles.dashboard}><Pressable style={styles.dashboardCard} onPress={()=>setPane('farms')}><Text style={styles.cardNumber}>{farms.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Predios</Text><Text style={styles.cardCaption}>Territorio y origen  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('harvests')}><Text style={styles.cardNumber}>{harvests.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Jimas</Text><Text style={styles.cardCaption}>Cosecha y lotes  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('trips')}><Text style={styles.cardNumber}>{trips.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Viajes</Text><Text style={styles.cardCaption}>Ruta y pesajes  ↗</Text></Pressable><Pressable style={styles.dashboardCard} onPress={()=>setPane('deliveries')}><Text style={styles.cardNumber}>{deliveries.length.toString().padStart(2,'0')}</Text><Text style={styles.cardTitle}>Entregas</Text><Text style={styles.cardCaption}>Recepción final  ↗</Text></Pressable></View>{profile?.role==='ADMIN'&&<Button label="Control diario de camiones" onPress={()=>setPane('control')}/>}{profile?.role==='ADMIN'?<Pressable style={styles.teamBanner} onPress={()=>setPane('team')}><View><Text style={styles.heroKicker}>ORGANIZACIÓN</Text><Text style={styles.teamBannerTitle}>Equipo de campo</Text><Text style={styles.teamBannerNote}>2 administradores · 5 jefes · 10 choferes</Text></View><Text style={styles.teamArrow}>↗</Text></Pressable>:null}<Button label="Cerrar sesión" onPress={()=>void supabase?.auth.signOut()}/></>}
 {pane==='control'&&profile?.role==='ADMIN'&&<><SectionTitle eyebrow="OPERACIÓN / HOY" title="Control diario de camiones" description="Pendientes, en ruta, recibidos y expedientes con documentos faltantes."/><Text>Asignados: {trips.filter(t=>['ASSIGNED','LOADING'].includes(t.status)).length} · En ruta: {trips.filter(t=>t.status==='IN_TRANSIT').length} · Llegados: {trips.filter(t=>t.status==='ARRIVED').length} · Entregados: {trips.filter(t=>t.status==='DELIVERED').length}</Text><Input label="Buscar jima, predio, placa, folio o comprador" value={search} onChange={setSearch}/><Text style={styles.muted}>Tolerancia: {varianceLimitKg} kg o {varianceLimitPercent}% del peso de origen, lo que sea mayor.</Text>{reviewReady&&<><Input label="Tolerancia mínima (kg)" value={limitKgInput} onChange={setLimitKgInput}/><Input label="Tolerancia porcentual sobre origen (%)" value={limitPercentInput} onChange={setLimitPercentInput}/><Button label="Guardar tolerancia de la organización" onPress={saveVarianceLimits} disabled={busy}/></>}{!reviewReady&&<Text style={styles.error}>La migración de control de Supabase está pendiente; no cierres entregas hasta activarla.</Text>}{trips.filter(matchesTrip).map(t=>{const review=tripReview(t);return <View key={t.id} style={styles.card}><Text style={styles.heading}>{t.trace_code} · {t.status}</Text><Text>{t.vehicle_plate??'Sin placa'} · {t.destination_name??'Sin comprador'}</Text><Text>Campo − origen: {review.comparison.originDifference??'—'} kg · Origen − destino: {review.comparison.transitDifference??'—'} kg · Destino − recepción: {review.comparison.receiptDifference??'—'} kg</Text><Text style={review.comparison.exceeded&&!review.hasExplanation?styles.error:styles.muted}>{review.comparison.exceeded?(review.hasExplanation?'Diferencia explicada':'Diferencia fuera de tolerancia · falta explicación'):'Sin alerta de diferencia'}</Text>{review.missing.length>0&&<Text style={styles.error}>Pendientes: {review.missing.join(', ')}</Text>}{varianceNotes.filter(n=>n.trip_id===t.id).map((note,i)=><Text key={i}>Aclaración {new Date(note.created_at).toLocaleString('es-MX')}: {note.reason}</Text>)}</View>})}</>}
 {pane==='team'&&profile?.role==='ADMIN'&&<><SectionTitle eyebrow="PERSONAS / ACCESOS" title="Equipo de campo" description="Planeación para 17 cuentas, repartidas por función. Sólo se cuentan perfiles activos de tu organización."/>{teamError?<Text style={styles.error}>{teamError}</Text>:null}<View style={styles.teamIntro}><Text style={styles.teamIntroNumber}>{teamError?'—':team.length} / 17</Text><Text style={styles.teamIntroLabel}>Usuarios activos registrados</Text></View>{(['ADMIN','CREW_LEADER','DRIVER'] as Role[]).map(role=>{const people=team.filter(person=>person.role===role&&person.status==='ACTIVE');return <View key={role} style={styles.teamRole}><View style={styles.teamRoleHeader}><Text style={styles.heading}>{roleNames[role]}</Text><Text style={styles.teamCount}>{teamError?'—':people.length} / {teamTargets[role]}</Text></View>{people.map(person=><Text key={person.id} style={styles.teamPerson}>●  {person.full_name}</Text>)}{!teamError&&people.length<teamTargets[role]?<Text style={styles.muted}>Faltan {teamTargets[role]-people.length} {teamTargets[role]-people.length===1?'cuenta':'cuentas'} por dar de alta.</Text>:null}</View>})}<Text style={styles.teamHelp}>Las cuentas nuevas requieren correo y nombre de cada persona. No se crean usuarios de muestra ni se comparten contraseñas desde esta pantalla.</Text></>}
 {pane==='farms'&&<><SectionTitle eyebrow="01 / ORIGEN" title="Predios visibles" description="La tierra donde comienza cada lote de agave."/>{farms.map(f=><View key={f.id} style={styles.card}><Text style={styles.heading}>{f.name}</Text><Text>{f.code} · {f.municipality??f.state}</Text></View>)}{profile?.role==='ADMIN'&&<><Text style={styles.heading}>Nuevo predio</Text><Input label="Código" value={farmCode} onChange={setFarmCode}/><Input label="Nombre" value={farmName} onChange={setFarmName}/><Input label="Estado" value={farmState} onChange={setFarmState}/><Button label="Guardar predio" onPress={createFarm} disabled={busy}/></>}</>}
 {pane==='harvests'&&<>
  <SectionTitle eyebrow="02 / COSECHA" title="Jimas visibles" description="El trabajo en campo, los lotes y su evidencia."/>
  {harvests.map(h=><View key={h.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===h.id?'':h.id)}><Text style={styles.heading}>{h.trace_code} {selected===h.id?'▲':'▼'}</Text><Text>{farms.find(f=>f.id===h.farm_id)?.name??'Predio'} · {h.status} · {h.scheduled_date??'Sin fecha'}</Text></Pressable>
   {selected===h.id&&<>
    <Text>Cuadrilla: {crews.find(c=>c.id===h.crew_id)?.name??'Sin asignar'}</Text>
    {h.notes?<Text>{h.notes}</Text>:null}
    {profile?.role==='ADMIN'&&partitionByBuyer({lots:lots.filter(l=>l.harvest_order_id===h.id),trips:trips.filter(t=>tripLots.some(x=>x.trip_id===t.id&&lots.some(l=>l.id===x.agave_lot_id&&l.harvest_order_id===h.id))),links:tripLots,weighings,deliveries,images:[]}).map(group=><Button key={group.key} label={exporting?'Preparando expediente…':`Descargar expediente · ${group.name}`} onPress={()=>void exportHarvest(h,group.key)} disabled={exporting||busy}/>)}
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
  <SectionTitle eyebrow="03 / TRAYECTO" title="Viajes visibles" description="Del predio a destino con cada pesaje registrado."/>
  {trips.map(t=><View key={t.id} style={styles.card}>
   <Pressable onPress={()=>setSelected(selected===t.id?'':t.id)}><Text style={styles.heading}>{t.trace_code} {selected===t.id?'▲':'▼'}</Text><Text>{t.status} · {t.destination_name??'Sin destino'}</Text></Pressable>
   {selected===t.id&&<>
    <Text>Placa: {t.vehicle_plate??'Sin registrar'} · Pesajes: {weighings.filter(w=>w.trip_id===t.id).length}</Text><Text>Campo − origen: {tripReview(t).comparison.originDifference??'—'} kg · Origen − destino: {tripReview(t).comparison.transitDifference??'—'} kg · Destino − recepción: {tripReview(t).comparison.receiptDifference??'—'} kg</Text>{tripReview(t).comparison.exceeded&&<Text style={styles.error}>Diferencia superior a {tripReview(t).comparison.threshold.toFixed(2)} kg. Registra explicación antes de cerrar.</Text>}{varianceNotes.filter(n=>n.trip_id===t.id).map((n,i)=><Text key={i}>Explicación: {n.reason}</Text>)}
    {weighings.filter(w=>w.trip_id===t.id).map(w=><View key={w.id}><Text>{w.weighing_type}: bruto {w.gross_weight_kg} − tara {w.tare_weight_kg} = neto {w.net_weight_kg} kg</Text>{w.ticket_storage_path&&<Button label="Ver ticket" onPress={()=>openPhoto('weighing-tickets',w.ticket_storage_path!)}/>}</View>)}
    {(profile?.role==='ADMIN'||profile?.role==='DRIVER'&&t.driver_id===session.user.id)&&<>
     {['ASSIGNED','LOADING','ARRIVED'].includes(t.status)&&!weighings.some(w=>w.trip_id===t.id&&w.weighing_type===(t.status==='ARRIVED'?'DESTINATION':'ORIGIN'))&&<>
     <Input label="Peso bruto (kg)" value={gross} onChange={setGross}/><Input label="Tara (kg)" value={tare} onChange={setTare}/><Input label="Folio de báscula" value={ticketNumber} onChange={setTicketNumber}/>
     <Button label="Fotografiar ticket legible y guardar pesaje" onPress={()=>addWeighing(t)} disabled={busy}/>
     </>}
     {tripReview(t).comparison.exceeded&&reviewReady&&<><Input label="Explicación de la diferencia (mínimo 10 caracteres)" value={varianceReason} onChange={setVarianceReason}/><Button label="Registrar explicación" onPress={()=>recordVariance(t)} disabled={busy}/></>}{profile?.role==='ADMIN'&&reviewReady&&<><Input label="Dato que requiere corrección" value={correctionField} onChange={setCorrectionField}/><Input label="Valor correcto documentado" value={correctionValue} onChange={setCorrectionValue}/><Input label="Motivo de la corrección" value={correctionReason} onChange={setCorrectionReason}/><Button label="Anotar corrección sin borrar original" onPress={()=>recordCorrection(t)} disabled={busy}/></>}{['ASSIGNED','LOADING','IN_TRANSIT'].includes(t.status)&&<Button label={t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada'} onPress={()=>confirm(t.status==='ASSIGNED'?'Iniciar carga':t.status==='LOADING'?'Salir a ruta':'Registrar llegada',`El viaje avanzará de ${t.status} al siguiente estado.`,()=>void advanceTrip(t))} disabled={busy}/>} 
    </>}
   </>}
  </View>)}
  {profile?.role==='ADMIN'&&<><Text style={styles.heading}>Crear viaje y entrega</Text><Text>Lote</Text>{lots.map(l=><Button key={l.id} label={`${tripLotId===l.id?'✓ ':''}${l.trace_code}`} onPress={()=>setTripLotId(l.id)}/>)}<Text>Chofer</Text>{drivers.map(d=><Button key={d.id} label={`${tripDriverId===d.id?'✓ ':''}${d.full_name}`} onPress={()=>setTripDriverId(d.id)}/>)}<Input label="Comprador y destilería de destino" value={destination} onChange={setDestination}/><Input label="Placa del camión" value={vehiclePlate} onChange={setVehiclePlate}/><Button label="Crear viaje asignado" onPress={createTrip} disabled={busy}/></>}
 </>}
 {pane==='deliveries'&&<>
  <SectionTitle eyebrow="04 / DESTINO" title="Entregas visibles" description="La recepción final y el comprobante de entrega."/>
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
 {busy&&<ActivityIndicator color={green}/>}</ScrollView>
 {photoLoading?<Text style={styles.small}>Abriendo fotografía…</Text>:null}
 {photoUrl?<View style={styles.photoOverlay}><Button label="Cerrar fotografía" onPress={()=>setPhotoUrl('')}/><Image source={{uri:photoUrl}} resizeMode="contain" style={styles.photoPreview} onError={()=>{setPhotoUrl('');showError('La fotografía descargada no se pudo mostrar.')}}/></View>:null}
 </SafeAreaView>
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:'#F7F4EB'},center:{flex:1,justifyContent:'center'},body:{width:'100%',maxWidth:1160,alignSelf:'center',paddingHorizontal:22,paddingBottom:76,gap:16},
 brand:{fontSize:14,fontWeight:'900',color:green,letterSpacing:3},small:{color:'#687A6E',fontSize:13,marginTop:5},muted:{color:'#677568',fontSize:14,lineHeight:21},eyebrow:{color:'#A46A31',fontSize:11,fontWeight:'900',letterSpacing:2.2},title:{fontSize:30,fontWeight:'800',color:'#183B30',marginTop:5},sectionHead:{marginTop:20,marginBottom:4,gap:4},heading:{fontWeight:'800',fontSize:18,color:'#1C4133'},
 topBar:{paddingTop:22,paddingBottom:17,flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,borderBottomWidth:1,borderBottomColor:'#E5E4D7'},topActions:{flexDirection:'row',gap:8},topAction:{borderWidth:1,borderColor:'#D8DFD2',paddingVertical:10,paddingHorizontal:14,borderRadius:30,backgroundColor:'#FFFDF7'},topActionText:{color:green,fontWeight:'700',fontSize:13},
 hero:{height:315,backgroundColor:'#173D32',borderRadius:24,overflow:'hidden',justifyContent:'flex-end'},heroArt:{position:'absolute',top:0,left:0,width:'100%',height:'100%'},heroCopy:{padding:28,backgroundColor:'rgba(16,49,39,.84)',gap:7},heroKicker:{color:'#DEB477',fontSize:11,fontWeight:'900',letterSpacing:2},heroTitle:{color:'#FFFBEE',fontSize:35,fontWeight:'800',lineHeight:40,maxWidth:530},heroText:{color:'#E7E7D8',fontSize:15,lineHeight:22},
 dashboard:{flexDirection:'row',flexWrap:'wrap',gap:12},dashboardCard:{flexGrow:1,flexBasis:180,minWidth:145,backgroundColor:'#FFFDF7',borderWidth:1,borderColor:'#E1E3D6',padding:19,borderRadius:18,minHeight:148,justifyContent:'space-between'},cardNumber:{fontSize:35,fontWeight:'800',color:'#B16F35'},cardTitle:{fontSize:19,fontWeight:'800',color:green},cardCaption:{fontSize:12,color:'#708174'},teamBanner:{backgroundColor:'#1B4738',padding:24,borderRadius:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:6},teamBannerTitle:{color:'#FFF9E8',fontSize:22,fontWeight:'800',marginTop:5},teamBannerNote:{color:'#E6DCC7',fontSize:13,marginTop:4},teamArrow:{fontSize:28,color:'#E8B975'},
 teamIntro:{backgroundColor:'#204738',padding:24,borderRadius:18},teamIntroNumber:{color:'#FFF7E3',fontSize:36,fontWeight:'900'},teamIntroLabel:{color:'#E0D5BE',marginTop:5},teamRole:{backgroundColor:'#FFFDF7',padding:19,borderRadius:17,borderWidth:1,borderColor:'#E3E5D9',gap:9},teamRoleHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'},teamCount:{color:'#AA692D',fontWeight:'900',fontSize:18},teamPerson:{color:green,fontSize:14,paddingVertical:3},teamHelp:{fontSize:13,color:'#6E7669',lineHeight:20,marginTop:6},
 loginBody:{flexGrow:1,width:'100%',maxWidth:950,alignSelf:'center',padding:20,paddingBottom:55,gap:16,justifyContent:'center'},loginHero:{backgroundColor:'#14382E',borderRadius:23,overflow:'hidden',minHeight:290,padding:27,justifyContent:'flex-end',gap:8},loginArt:{position:'absolute',width:'100%',height:'100%',top:0,left:0,opacity:.58},loginForm:{backgroundColor:'#FFFDF7',borderWidth:1,borderColor:'#E3E5D9',borderRadius:20,padding:24,gap:14},formFoot:{textAlign:'center',color:'#9A6B3C',fontSize:11,fontWeight:'800',letterSpacing:2,marginTop:14},
 label:{fontWeight:'700',color:'#234736',marginBottom:7},input:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#CDD8CE',borderRadius:12,padding:14,fontSize:16,color:'#183B30'},button:{backgroundColor:green,paddingVertical:15,paddingHorizontal:17,borderRadius:12,marginTop:4,alignSelf:'stretch'},buttonText:{color:'white',textAlign:'center',fontWeight:'800'},card:{backgroundColor:'#FFFDF7',padding:19,borderRadius:16,borderColor:'#E0E4D8',borderWidth:1,gap:9},row:{flexDirection:'row',gap:10},error:{color:'#9B2424',backgroundColor:'#FCE9E9',padding:12,borderRadius:10},photoOverlay:{position:'absolute',top:0,right:0,bottom:0,left:0,backgroundColor:'#F7F4EB',padding:16,zIndex:10,gap:12},photoPreview:{flex:1,width:'100%',backgroundColor:'#E1E9E3'}
});
