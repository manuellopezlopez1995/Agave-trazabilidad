import React from 'react';
import {SafeAreaView,StyleSheet,Text,View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import RealApp from './src/RealApp';
import {configurationError} from './src/backend';

export default function App(){
 if(configurationError){
  return <SafeAreaView style={styles.root}><StatusBar style="dark"/><View style={styles.card}><Text style={styles.brand}>AGAVE / TRAZA</Text><Text style={styles.title}>Configuración incompleta</Text><Text style={styles.message}>{configurationError}</Text><Text style={styles.help}>Esta versión sólo funciona con el backend real. Solicita al administrador una compilación configurada correctamente.</Text></View></SafeAreaView>;
 }
 return <RealApp/>;
}

const styles=StyleSheet.create({
 root:{flex:1,justifyContent:'center',backgroundColor:'#F8FAF8',padding:24},
 card:{backgroundColor:'white',borderWidth:1,borderColor:'#E1E9E3',borderRadius:16,padding:22,gap:12},
 brand:{fontSize:15,fontWeight:'900',color:'#164B3A',letterSpacing:3},
 title:{fontSize:25,fontWeight:'800',color:'#173027'},
 message:{color:'#9B2424',backgroundColor:'#FCE9E9',padding:12,borderRadius:10},
 help:{color:'#60746A',lineHeight:21}
});
