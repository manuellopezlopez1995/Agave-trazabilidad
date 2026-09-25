/* Sólo archivos públicos de la app; jamás se guarda en caché la sesión ni las fotos privadas. */
const CACHE='agave-shell-v1';
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 const root=self.registration.scope;
 const response=await fetch(root,{cache:'reload'});
 if(!response.ok)throw Error('No se pudo instalar la PWA');
 const html=await response.clone().text();
 const assets=[root,new URL('manifest.json',root).href,new URL('icon-192.png',root).href];
 for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  if(match[1].includes('/_expo/')||match[1].endsWith('.css'))assets.push(new URL(match[1],root).href);
 }
 await cache.addAll([...new Set(assets)]);
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('agave-shell-')&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>await caches.match(self.registration.scope)||Response.error()));return}
 if(url.pathname.includes('/_expo/')||/\.(png|ico|svg|css|js)$/.test(url.pathname)){
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));return response})));}
});
