const CACHE='uplift-v409';
const URLS=[
  '/UpLift/',
  '/UpLift/index.html'
];
// Third-party libraries, cached opportunistically (on first real fetch, not
// at install time - so a network hiccup on one CDN file can't break the
// whole service-worker install). Without this, these are cross-origin and
// the fetch handler below would ignore them entirely, leaving Stats' new
// chart (and the site map) dependent on the browser's regular HTTP cache,
// which isn't a reliable enough guarantee for "must work at a remote site
// with no signal." Exact-URL match, not origin-wide, so no other unpkg.com
// traffic gets swept in by accident.
const CDN_URLS=[
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/hammerjs@2.0.8/hammer.min.js',
  'https://unpkg.com/chart.js@4/dist/chart.umd.min.js',
  'https://unpkg.com/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js',
  'https://unpkg.com/chartjs-plugin-zoom@2/dist/chartjs-plugin-zoom.min.js'
];

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>
      // Fetch each file with {cache:'reload'} to force a real network request,
      // bypassing the browser's own HTTP cache (GitHub Pages serves these with
      // a several-minute cache lifetime) - otherwise a fresh SW can still end up
      // caching a stale copy of index.html if installed shortly after a deploy.
      Promise.all(URLS.map(url=>fetch(url,{cache:'reload'}).then(res=>c.put(url,res))))
    ).then(()=>self.skipWaiting())
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
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  const isSameOrigin=url.origin===location.origin;
  const isCachedCdn=CDN_URLS.includes(e.request.url);
  if(!isSameOrigin&&!isCachedCdn)return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached)return cached;
      return fetch(e.request).then(response=>{
        if(response&&response.status===200){
          const clone=response.clone();
          caches.open(CACHE).then(c=>c.put(e.request,clone));
        }
        return response;
      });
    })
  );
});
