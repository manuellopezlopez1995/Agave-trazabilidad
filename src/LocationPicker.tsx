import React,{useEffect,useRef,useState} from 'react';
import {Linking,Platform,Pressable,Text,TextInput,View} from 'react-native';
import * as Location from 'expo-location';
import 'leaflet/dist/leaflet.css';

type Point={latitude:number;longitude:number;name?:string;address?:string;accuracy?:number};
type Props={latitude:string;longitude:string;name:string;address:string;onConfirm:(point:Point)=>void};
type Feature={geometry?:{coordinates?:number[]};properties?:Record<string,string>};
const tileUrl=process.env.EXPO_PUBLIC_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const button={padding:14,backgroundColor:'#164B3A',borderRadius:12,marginTop:8};
function validPoint(latitude:string,longitude:string):Point|null{
 if(!latitude.trim()||!longitude.trim())return null;
 const lat=Number(latitude),lng=Number(longitude);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{latitude:lat,longitude:lng}:null;
}
function featurePoint(feature:Feature):Point|null{
 const [longitude,latitude]=feature.geometry?.coordinates??[];
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 const p=feature.properties??{};
 const address=[p.street&&[p.housenumber,p.street].filter(Boolean).join(' '),p.city||p.town||p.village||p.county,p.state,p.country].filter(Boolean).join(', ');
 return {latitude,longitude,name:p.name||p.street||p.city||p.town||p.village||address,address};
}
export default function LocationPicker(props:Props){
 const [open,setOpen]=useState(false),[candidate,setCandidate]=useState<Point|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState<Point[]>([]);
 const mapRef=useRef<HTMLDivElement>(null),map=useRef<any>(null),marker=useRef<any>(null),request=useRef<AbortController|null>(null);
 const propsRef=useRef(props);propsRef.current=props;
 const candidateRef=useRef(candidate);candidateRef.current=candidate;
 const saved=validPoint(props.latitude,props.longitude);
 const choose=(point:Point)=>{setCandidate(point);setError('');map.current?.setView([point.latitude,point.longitude],17);marker.current?.setLatLng([point.latitude,point.longitude]);marker.current?.setStyle({opacity:1});};
 useEffect(()=>{
  if(!open||Platform.OS!=='web'||!mapRef.current)return;
  let active=true,instance:any;
  void import('leaflet').then(L=>{
   if(!active||!mapRef.current)return;
   const initial=candidateRef.current??validPoint(propsRef.current.latitude,propsRef.current.longitude);
   instance=L.map(mapRef.current,{zoomControl:true}).setView(initial?[initial.latitude,initial.longitude]:[20.7,-102.3],initial?16:8);
   map.current=instance;
   L.tileLayer(tileUrl,{attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',maxZoom:19}).addTo(instance);
   marker.current=L.circleMarker(initial?[initial.latitude,initial.longitude]:[20.7,-102.3],{radius:9,color:'#164B3A',fillColor:'#e5a32b',fillOpacity:1,opacity:initial?1:0}).addTo(instance);
   instance.on('click',(event:any)=>{const previous=candidateRef.current;const current=propsRef.current;choose({latitude:event.latlng.lat,longitude:event.latlng.lng,name:previous?.name||current.name,address:previous?.address||current.address});marker.current?.setStyle({opacity:1});});
   setTimeout(()=>{if(active)instance.invalidateSize();},100);
  }).catch(()=>{if(active)setError('No se pudo abrir el mapa. Puedes escribir las coordenadas en el formulario.');});
  return()=>{active=false;request.current?.abort();instance?.remove();if(map.current===instance){map.current=null;marker.current=null;}};
 },[open]);
 const search=async()=>{
  if(Platform.OS!=='web'||!navigator.onLine){setError('Conéctate para buscar un lugar.');return;}
  const term=query.trim();if(term.length<3){setError('Escribe al menos tres caracteres del nombre o dirección.');return;}
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setBusy(true);setError('');setResults([]);
  try{
   const response=await fetch('https://photon.komoot.io/api/?q='+encodeURIComponent(term)+'&limit=6&lang=es',{signal:controller.signal});
   if(!response.ok)throw Error(response.status===429?'El buscador alcanzó su límite. Intenta más tarde.':'El buscador no respondió. Intenta más tarde.');
   const body=await response.json() as {features?:Feature[]};
   const found=(body.features??[]).map(featurePoint).filter((point):point is Point=>!!point);
   setResults(found);if(!found.length)setError('No se encontraron lugares. Prueba con la localidad o introduce las coordenadas.');
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'No se pudo buscar el lugar.');}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 };
 const locate=async()=>{setBusy(true);setError('');try{
  const permission=await Location.requestForegroundPermissionsAsync();if(permission.status!=='granted')throw Error('Permite la ubicación en el dispositivo o selecciona el punto manualmente.');
  const result=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
  choose({latitude:result.coords.latitude,longitude:result.coords.longitude,accuracy:result.coords.accuracy??undefined,name:props.name,address:props.address});
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <View style={{marginVertical:10,padding:14,borderColor:'#d9e1d3',borderWidth:1,borderRadius:12}}>
  <Text style={{fontWeight:'bold',color:'#164B3A'}}>Elegir ubicación</Text>
  <Pressable style={button} disabled={busy} onPress={()=>void locate()}><Text style={{color:'white',textAlign:'center'}}>Usar mi ubicación actual</Text></Pressable>
  {Platform.OS==='web'&&<><Pressable style={button} onPress={()=>setOpen(!open)}><Text style={{color:'white',textAlign:'center'}}>{open?'Cerrar búsqueda y mapa':'Buscar lugar o ajustar punto en el mapa'}</Text></Pressable>
   {open&&<><TextInput accessibilityLabel="Nombre o dirección del lugar" placeholder="Nombre o dirección del lugar" value={query} onChangeText={setQuery} onSubmitEditing={()=>void search()} style={{borderWidth:1,borderColor:'#cbd5cc',padding:12,marginTop:10,borderRadius:9}}/>
    <Pressable style={button} disabled={busy} onPress={()=>void search()}><Text style={{color:'white',textAlign:'center'}}>Buscar</Text></Pressable>
    {results.map((result,index)=><Pressable key={result.latitude+'-'+result.longitude+'-'+index} onPress={()=>{choose(result);setResults([]);marker.current?.setStyle({opacity:1});}} style={{padding:10,borderBottomWidth:1,borderColor:'#d9e1d3'}}><Text style={{color:'#164B3A',fontWeight:'bold'}}>{result.name}</Text><Text>{result.address}</Text></Pressable>)}
    <div ref={mapRef} aria-label="Mapa interactivo para elegir el punto exacto" style={{height:320,marginTop:12,borderRadius:12}}/>
    <Text style={{marginTop:8}}>Acerca el mapa y toca el punto exacto. Datos de búsqueda: Photon/OpenStreetMap. Mapa: © OpenStreetMap contributors.</Text>
    <Pressable onPress={()=>void Linking.openURL('https://www.openstreetmap.org/fixthemap')}><Text style={{color:'#164B3A',textDecorationLine:'underline'}}>Reportar un problema del mapa</Text></Pressable>
   </>}
  </>}
  {busy&&<Text>Obteniendo ubicación…</Text>}{!!error&&<Text accessibilityRole="alert" style={{color:'#a52828',marginTop:8}}>{error}</Text>}
  {candidate&&<View style={{marginTop:12}}><Text style={{fontWeight:'bold'}}>Punto pendiente de confirmar</Text><Text>{candidate.name||props.name} · {candidate.address||props.address}</Text><Text>{candidate.latitude.toFixed(7)}, {candidate.longitude.toFixed(7)}{candidate.accuracy!=null?' · Precisión GPS aproximada: '+Math.round(candidate.accuracy)+' m':''}</Text><Pressable style={button} onPress={()=>{props.onConfirm(candidate);setCandidate(null);}}><Text style={{color:'white',textAlign:'center'}}>Confirmar este punto en el formulario</Text></Pressable><Pressable onPress={()=>setCandidate(null)}><Text style={{padding:10}}>Descartar selección</Text></Pressable></View>}
  {saved&&<><Text style={{marginTop:10}}>Punto del formulario: {saved.latitude.toFixed(7)}, {saved.longitude.toFixed(7)}</Text><Pressable onPress={()=>void Linking.openURL('https://www.google.com/maps/search/?api=1&query='+saved.latitude+','+saved.longitude)}><Text style={{paddingVertical:10,color:'#164B3A',textDecorationLine:'underline'}}>Ver punto en Google Maps</Text></Pressable></>}
  <Text style={{marginTop:8}}>Confirma el punto y guarda el formulario. Los lugares guardados se consultan sin señal; las búsquedas nuevas y el mapa requieren conexión.</Text>
 </View>;
}
