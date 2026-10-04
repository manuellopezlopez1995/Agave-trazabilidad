const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');

// Exercise the component's effect/state transitions with deterministic map adapters.
// This checks coordinate preservation; it does not claim imagery/network validation.
function setup(key='restricted-test-key'){
 const slots=[],effects=[],layers=[],maps=[],confirmed=[];let cursor=0,tree;
 const React={
  createElement(type,props,...children){if(type==='div'&&props.ref)props.ref.current={};return {type,props:props||{},children:children.flat(Infinity)};},
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return [slots[i].value,value=>{slots[i].value=value;}];},
  useRef(initial){const i=cursor++;if(!slots[i])slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 function layer(kind){const item={kind,handlers:{},on(event,fn){this.handlers[event]=fn;return this;},off(event){delete this.handlers[event];return this;},addTo(map){map.layers.add(this);return this;}};layers.push(item);return item;}
 const L={map(){const map={layers:new Set(),handlers:{},center:null,zoom:null,setView(center,zoom){this.center=center;this.zoom=zoom;return this;},on(event,fn){this.handlers[event]=fn;},hasLayer(item){return this.layers.has(item);},removeLayer(item){this.layers.delete(item);},remove(){this.layers.clear();},invalidateSize(){}};maps.push(map);return map;},tileLayer(){return layer('map');},circleMarker(){return {addTo(){return this;},setLatLng(point){this.point=point;},setStyle(){}};}};
 const compiled=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/LocationPicker.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const exports={};vm.runInNewContext(compiled,{exports,process:{env:{EXPO_PUBLIC_ARCGIS_BASEMAP_KEY:key}},setTimeout(){},require(name){if(name==='react')return React;if(name==='react-native')return {Platform:{OS:'web'},Linking:{},Pressable:'Pressable',Text:'Text',TextInput:'TextInput',View:'View'};if(name==='expo-location'||name.endsWith('.css'))return {};if(name==='leaflet')return L;if(name==='esri-leaflet')return {basemapLayer(){return layer('satellite');}};throw Error(name);}});
 function render(){cursor=0;tree=exports.default({latitude:'20.7',longitude:'-102.3',name:'Huerta',address:'Jalisco',onConfirm:point=>confirmed.push(point)});while(effects.length)effects.shift()();return tree;}
 function label(node){return typeof node==='string'?node:node?.children?.map(label).join('')||'';}
 function find(node,text){if(node?.type==='Pressable'&&label(node)===text)return node;for(const child of node?.children||[]){const found=find(child,text);if(found)return found;}}
 function press(text){const item=find(tree,text);assert.ok(item,text);assert.ok(!item.props.disabled,`${text} disabled`);item.props.onPress();render();}
 function includes(text){return label(tree).includes(text);}
 render();return {render,press,includes,layers,maps,confirmed,find:text=>find(tree,text)};
}
test('switching backgrounds preserves viewport and clicked coordinate until explicit confirmation',()=>{
 const app=setup();app.press('Buscar lugar o ajustar punto en el mapa');
 const map=app.maps[0];map.handlers.click({latlng:{lat:20.8123456,lng:-102.4123456}});app.render();
 const center=map.center,zoom=map.zoom;app.press('Satelital');
 assert.equal(app.maps.length,1);assert.deepEqual(map.center,center);assert.equal(map.zoom,zoom);
 assert.equal(app.layers.at(-1).kind,'satellite');assert.equal(map.layers.size,1);assert.equal(app.confirmed.length,0);
 app.press('Mapa');assert.deepEqual(map.center,center);assert.equal(map.layers.size,1);
 app.press('Confirmar este punto en el formulario');assert.equal(app.confirmed[0].latitude,20.8123456);assert.equal(app.confirmed[0].longitude,-102.4123456);
});
test('tile failure does not lose point; closing and reopening keeps pending coordinate and view',()=>{
 const app=setup();app.press('Buscar lugar o ajustar punto en el mapa');app.maps[0].handlers.click({latlng:{lat:20.8,lng:-102.4}});app.render();app.press('Satelital');
 app.layers.at(-1).handlers.tileerror();app.render();assert.ok(app.includes('No se pudieron cargar algunas imágenes'));
 app.press('Cerrar búsqueda y mapa');app.press('Buscar lugar o ajustar punto en el mapa');
 assert.deepEqual(Array.from(app.maps[1].center),[20.8,-102.4]);assert.equal(app.layers.at(-1).kind,'satellite');
 app.press('Confirmar este punto en el formulario');assert.equal(app.confirmed[0].latitude,20.8);
});
test('missing service key keeps the map available and does not claim satellite activation',()=>{
 const app=setup('');app.press('Buscar lugar o ajustar punto en el mapa');assert.equal(app.find('Satelital').props.disabled,true);assert.ok(app.includes('pendiente de activación'));assert.equal(app.layers.at(-1).kind,'map');
});
