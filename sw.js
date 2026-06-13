const CACHE='uplift-v1';
const URLS=[
  '/UpLift/',
  '/UpLift/index.html'
];

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(URLS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  // Only handle GET requests for our own origin
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;

  e.respondWith(
    caches.match(e.request).then(cached=>{
      // Return cached version immediately, fetch update in background
      const fetchPromise=fetch(e.request).then(response=>{
        if(response&&response.status===200){
          const clone=response.clone();
          caches.open(CACHE).then(c=>c.put(e.request,clone));
        }
        return response;
      }).catch(()=>cached);
      return cached||fetchPromise;
    })
  );
});
