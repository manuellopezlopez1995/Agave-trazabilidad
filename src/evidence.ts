import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import {Alert,Platform} from 'react-native';
import {supabase} from './backend';
import {queueEvidence} from './offlineEvidence';

type Kind='harvest'|'delivery'|'weighing';
type EvidenceResult={bucket:string;path:string;mimeType:string;size:number;latitude?:number;longitude?:number;capturedAt:string;legibilityConfirmed:boolean;queued?:boolean};
const buckets:Record<Kind,string>={harvest:'harvest-evidence',delivery:'delivery-evidence',weighing:'weighing-tickets'};
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxEvidenceBytes=12*1024*1024;

// React Native's Storage upload accepts an ArrayBuffer, while ImagePicker returns base64.
function decodeBase64(input:string):ArrayBuffer{
 const clean=input.replace(/\s/g,'');
 if(clean.length%4!==0||/[^A-Za-z0-9+/=]/.test(clean))throw Error('La imagen no tiene un formato válido');
 const padding=clean.endsWith('==')?2:clean.endsWith('=')?1:0;
 const result=new Uint8Array(clean.length/4*3-padding);let offset=0;
 for(let i=0;i<clean.length;i+=4){
  const a=alphabet.indexOf(clean[i]),b=alphabet.indexOf(clean[i+1]);
  const c=clean[i+2]==='='?0:alphabet.indexOf(clean[i+2]);
  const d=clean[i+3]==='='?0:alphabet.indexOf(clean[i+3]);
  if(a<0||b<0||c<0||d<0)throw Error('La imagen no tiene un formato válido');
  const n=(a<<18)|(b<<12)|(c<<6)|d;
  result[offset++]=(n>>16)&255;
  if(offset<result.length)result[offset++]=(n>>8)&255;
  if(offset<result.length)result[offset++]=n&255;
 }
 return result.buffer as ArrayBuffer;
}

export async function captureEvidence(kind:Kind,organizationId:string,entityId:string,userId:string,weighing?:{gross:number;tare:number;ticketNumber:string;weighingType:string}):Promise<EvidenceResult|null>{
 if(!supabase)throw Error('Falta configurar Supabase');
 if(!uuidPattern.test(organizationId)||!uuidPattern.test(entityId)||!uuidPattern.test(userId))throw Error('La ruta de evidencia no es válida');
 // Web pickers must open synchronously from the user's tap. Browser permissions
 // are handled by the picker itself; awaiting a permission call blocks it.
 if(Platform.OS!=='web'){
  const permission=await ImagePicker.requestCameraPermissionsAsync();
  if(!permission.granted)throw Error('Activa el permiso de cámara para registrar evidencia');
 }
 const picture=await ImagePicker.launchCameraAsync({quality:.75,base64:true,exif:false,allowsEditing:false});
 if(picture.canceled)return null;
 const asset=picture.assets[0];if(!asset?.base64)throw Error('La cámara no devolvió la imagen');
 if(kind!=='harvest'){
  const question=kind==='weighing'?'¿Se leen claramente el folio y los pesos del ticket?':'¿Se leen claramente el receptor, la fecha y los pesos del recibo?';
  const approved=Platform.OS==='web'?window.confirm(question):await new Promise<boolean>(resolve=>Alert.alert('Verifica la fotografía',question,[{text:'Repetir foto',onPress:()=>resolve(false)},{text:'Sí, es legible',onPress:()=>resolve(true)}],{cancelable:false}));
  if(!approved)return null;
 }
 const bytes=decodeBase64(asset.base64);
 if(bytes.byteLength===0||bytes.byteLength>maxEvidenceBytes)throw Error('La fotografía debe pesar menos de 12 MB');
 const mimeType=asset.mimeType==='image/png'?'image/png':'image/jpeg';
 const path=`${organizationId}/${entityId}/${userId}/${Crypto.randomUUID()}.${mimeType==='image/png'?'png':'jpg'}`;
 const bucket=buckets[kind];
 const capturedAt=new Date().toISOString();
 let latitude:number|undefined,longitude:number|undefined;
 const locationPermission=Platform.OS==='web'
  ?await Location.requestForegroundPermissionsAsync()
  :await Location.getForegroundPermissionsAsync();
 if(locationPermission.granted){
  try{const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});latitude=p.coords.latitude;longitude=p.coords.longitude}catch{/* La foto sigue válida sin GPS. */}
 }
 if(Platform.OS==='web'&&!navigator.onLine){await queueEvidence({id:path,kind,organizationId,entityId,userId,bucket,path,mimeType,blob:new Blob([bytes],{type:mimeType}),capturedAt,latitude,longitude,legibilityConfirmed:kind!=='harvest',weighing});return {bucket,path,mimeType,size:bytes.byteLength,latitude,longitude,capturedAt,legibilityConfirmed:kind!=='harvest',queued:true}}
 const {error}=await supabase.storage.from(bucket).upload(path,bytes,{contentType:mimeType,upsert:false});
 if(error)throw error;
 return {bucket,path,mimeType,size:bytes.byteLength,latitude,longitude,capturedAt,legibilityConfirmed:kind!=='harvest'};
}
