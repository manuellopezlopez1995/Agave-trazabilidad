import React,{useCallback,useEffect,useState} from 'react';
import {Alert,Platform,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {supabase} from './backend';

type Role='ADMIN'|'CREW_LEADER'|'DRIVER';
type Member={id:string;full_name:string;email:string;role:Role;status:string;vehicle_plate:string|null;memberActive:boolean;crewId:string|null};
type Crew={id:string;name:string;crew_leader_id:string|null;active:boolean};
type Form={fullName:string;email:string;role:Role;plate:string;crewId:string};
const empty:Form={fullName:'',email:'',role:'DRIVER',plate:'',crewId:''};
const names:Record<Role,string>={ADMIN:'Administrador',CREW_LEADER:'Jefe de cuadrilla',DRIVER:'Chofer'};
const roles:Role[]=['ADMIN','CREW_LEADER','DRIVER'];
function confirm(title:string,detail:string,run:()=>void){
 if(Platform.OS==='web'){if(window.confirm(`${title}\n\n${detail}`))run();return}
 Alert.alert(title,detail,[{text:'Cancelar',style:'cancel'},{text:'Confirmar',onPress:run}]);
}
export default function TeamPanel({organizationId,actorId,crews,onChanged}:{organizationId:string;actorId:string;crews:Crew[];onChanged:()=>void}){
 const [members,setMembers]=useState<Member[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [editing,setEditing]=useState<Member|null>(null),[form,setForm]=useState<Form>(empty),[showForm,setShowForm]=useState(false);
 const call=useCallback(async(body:Record<string,unknown>)=>{
  if(!supabase)throw Error('Conexión no configurada');
  const {data,error}=await supabase.functions.invoke('team-admin',{body:{organizationId,...body}});
  if(error){let message=error.message;try{message=(await error.context?.json())?.error??message}catch{}throw Error(message)}
  return data;
 },[organizationId]);
 const refresh=useCallback(async()=>{setLoading(true);try{const data=await call({action:'list'});setMembers(data.members??[]);setError('')}catch(e){setError(String(e));setMembers([])}finally{setLoading(false)}},[call]);
 useEffect(()=>{void refresh()},[refresh]);
 const set=(key:keyof Form,value:string)=>setForm(current=>({...current,[key]:value}));
 const openCreate=()=>{setEditing(null);setForm(empty);setShowForm(true);setError('')};
 const openEdit=(member:Member)=>{setEditing(member);setForm({fullName:member.full_name,email:member.email,role:member.role,plate:member.vehicle_plate??'',crewId:member.crewId??''});setShowForm(true);setError('')};
 const run=async(body:Record<string,unknown>)=>{setBusy(true);setError('');try{await call(body);setShowForm(false);setEditing(null);await refresh();onChanged()}catch(e){setError(String(e))}finally{setBusy(false)}};
 const save=()=>{const name=form.fullName.trim(),email=form.email.trim();if(!name||!email||form.role==='DRIVER'&&!form.plate.trim()){setError('Completa nombre, correo y placas del chofer.');return}
  void run({action:editing?'update':'create',userId:editing?.id,fullName:name,email,role:form.role,plate:form.role==='DRIVER'?form.plate.trim().toUpperCase():'',crewId:form.role==='CREW_LEADER'?form.crewId||null:null,memberActive:editing?.memberActive??true});
 };
 const active=members.filter(m=>m.memberActive&&m.status==='ACTIVE');
 return <View style={s.root}>
  <Text style={s.heading}>Equipo de campo</Text><Text style={s.muted}>Sólo administración · {active.length} usuario(s) activos en esta organización.</Text>
  <Text style={s.muted}>Las invitaciones llegan al correo de cada persona. Desactivar quita el acceso a esta organización y conserva la autoría de sus operaciones.</Text>
  {error?<Text style={s.error}>{error}</Text>:null}
  <Pressable style={s.button} onPress={openCreate} disabled={busy}><Text style={s.buttonText}>Crear usuario</Text></Pressable>
  {showForm&&<View style={s.card}>
   <Text style={s.heading}>{editing?'Editar usuario':'Nuevo usuario'}</Text>
   <Text style={s.label}>Nombre completo</Text><TextInput accessibilityLabel="Nombre completo" style={s.input} value={form.fullName} onChangeText={v=>set('fullName',v)}/>
   <Text style={s.label}>Correo electrónico</Text><TextInput accessibilityLabel="Correo electrónico" style={s.input} keyboardType="email-address" autoCapitalize="none" editable={!editing} value={form.email} onChangeText={v=>set('email',v)}/>
   <Text style={s.label}>Rol</Text><View style={s.options}>{roles.map(role=><Pressable key={role} accessibilityRole="button" accessibilityLabel={`Rol ${names[role]}`} style={[s.option,form.role===role&&s.selected]} onPress={()=>setForm(f=>({...f,role,plate:role==='DRIVER'?f.plate:'',crewId:role==='CREW_LEADER'?f.crewId:''}))}><Text style={form.role===role?s.selectedText:s.optionText}>{names[role]}</Text></Pressable>)}</View>
   {form.role==='DRIVER'&&<><Text style={s.label}>Placas del camión</Text><TextInput accessibilityLabel="Placas del camión" style={s.input} autoCapitalize="characters" value={form.plate} onChangeText={v=>set('plate',v)}/></>}
   {form.role==='CREW_LEADER'&&<><Text style={s.label}>Cuadrilla</Text><View style={s.options}><Pressable accessibilityRole="button" accessibilityLabel="Cuadrilla sin asignar" style={[s.option,!form.crewId&&s.selected]} onPress={()=>set('crewId','')}><Text style={!form.crewId?s.selectedText:s.optionText}>Sin asignar</Text></Pressable>{crews.filter(c=>c.active&&(!c.crew_leader_id||c.crew_leader_id===editing?.id)).map(c=><Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`Cuadrilla ${c.name}`} style={[s.option,form.crewId===c.id&&s.selected]} onPress={()=>set('crewId',c.id)}><Text style={form.crewId===c.id?s.selectedText:s.optionText}>{c.name}</Text></Pressable>)}</View></>}
   <Pressable style={s.button} onPress={save} disabled={busy}><Text style={s.buttonText}>{busy?'Guardando…':editing?'Guardar cambios':'Enviar invitación y crear'}</Text></Pressable>
   <Pressable style={s.secondary} onPress={()=>setShowForm(false)}><Text style={s.optionText}>Cancelar</Text></Pressable>
  </View>}
  {loading?<Text style={s.muted}>Cargando usuarios…</Text>:roles.map(role=><View key={role} style={s.card}><Text style={s.heading}>{names[role]} · {active.filter(m=>m.role===role).length}</Text>
   {members.filter(m=>m.role===role).map(member=><View key={member.id} style={s.person}>
    <Text style={s.personName}>{member.full_name}{member.id===actorId?' · Tú':''}</Text><Text>{member.email}</Text>
    <Text style={s.muted}>{member.memberActive&&member.status==='ACTIVE'?'Activo':'Desactivado'}{role==='DRIVER'?` · Placas: ${member.vehicle_plate??'Pendientes'}`:''}{role==='CREW_LEADER'?` · Cuadrilla: ${crews.find(c=>c.id===member.crewId)?.name??'Sin asignar'}`:''}</Text>
    <View style={s.options}><Pressable style={s.option} onPress={()=>openEdit(member)}><Text style={s.optionText}>Editar</Text></Pressable>
     <Pressable style={s.option} disabled={busy||member.id===actorId} onPress={()=>confirm(member.memberActive?'Desactivar acceso':'Reactivar acceso',`¿Confirmas el cambio de acceso de ${member.full_name} en esta organización?`,()=>void run({action:'update',userId:member.id,fullName:member.full_name,role:member.role,plate:member.vehicle_plate??'',crewId:member.crewId,memberActive:!member.memberActive}))}><Text style={s.optionText}>{member.memberActive?'Desactivar':'Reactivar'}</Text></Pressable>
     <Pressable style={s.option} disabled={busy||member.id===actorId} onPress={()=>confirm('Eliminar cuenta definitivamente',`Sólo se eliminará ${member.full_name} si no tiene vínculos con operaciones ni otras organizaciones.`,()=>void run({action:'delete',userId:member.id}))}><Text style={s.optionText}>Eliminar</Text></Pressable></View>
   </View>)}{!members.some(m=>m.role===role)&&<Text style={s.muted}>Sin usuarios.</Text>}
  </View>)}
 </View>;
}
const s=StyleSheet.create({root:{gap:14},heading:{fontSize:21,fontWeight:'800',color:'#164B3A'},muted:{color:'#6E7669',lineHeight:21},error:{color:'#A02D29',fontWeight:'700'},card:{padding:18,borderRadius:17,borderWidth:1,borderColor:'#DCE1D3',backgroundColor:'#FFFDF7',gap:9},person:{borderTopWidth:1,borderTopColor:'#E1E3D6',paddingTop:13,gap:4},personName:{fontSize:17,fontWeight:'700',color:'#164B3A'},label:{fontWeight:'700',color:'#164B3A',marginTop:5},input:{borderWidth:1,borderColor:'#CBD5C6',borderRadius:10,padding:12,fontSize:16,backgroundColor:'#FFF'},button:{backgroundColor:'#164B3A',padding:16,borderRadius:12,alignItems:'center'},buttonText:{color:'#FFF',fontSize:16,fontWeight:'800'},secondary:{padding:12,alignItems:'center'},options:{flexDirection:'row',flexWrap:'wrap',gap:8,marginVertical:5},option:{borderWidth:1,borderColor:'#CBD5C6',borderRadius:10,padding:11},selected:{backgroundColor:'#164B3A',borderColor:'#164B3A'},selectedText:{color:'#FFF',fontWeight:'700'},optionText:{color:'#164B3A',fontWeight:'700'}});
