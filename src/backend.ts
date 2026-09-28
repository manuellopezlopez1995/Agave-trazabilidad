import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createClient} from '@supabase/supabase-js';

const url=process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key=process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

function validateConfiguration(){
 if(!url)return 'Falta EXPO_PUBLIC_SUPABASE_URL.';
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))return 'EXPO_PUBLIC_SUPABASE_URL no es una URL válida de Supabase.';
 if(!key)return 'Falta EXPO_PUBLIC_SUPABASE_ANON_KEY.';
 if(!(key.startsWith('sb_publishable_')||key.split('.').length===3))return 'La clave pública de Supabase no tiene un formato válido.';
 return null;
}

// Optional named sessions isolate authenticated users during supervised multi-role
// acceptance tests. The name grants no permissions: Supabase still verifies each JWT.
const sessionName=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('session'):null;
const sessionStorageKey=sessionName&&/^offline-(admin|crew|driver)$/.test(sessionName)?`agave-${sessionName}-auth`:undefined;
export const configurationError=validateConfiguration();
export const supabase=configurationError?null:createClient(url!,key!,{
 auth:{...(sessionStorageKey?{storageKey:sessionStorageKey}:{}),storage:AsyncStorage,autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}
});
