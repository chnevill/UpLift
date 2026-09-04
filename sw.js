const CACHE='leeside-v501';
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

// Reads Data Saver directly from the app's own IndexedDB - a service worker
// runs in a separate context with no access to the page's JS variables, so
// this can't just call the app's own dataSaverActive(). Reimplements its
// exact logic instead (see index.html's isOnWifi()/dataSaverActive()) so the
// two stay in agreement. Opens WITHOUT a version number specifically - the
// app's own openDB() uses version 1 with an onupgradeneeded that creates the
// object store; opening from here with an explicit version could trigger
// that upgrade path from the wrong place and risk the app's own schema.
// Opening with no version just reads whatever already exists, or fails
// cleanly (caught below) if the app has never run on this device yet.
function isDataSaverActive(){
  return new Promise(resolve=>{
    try{
      const req=indexedDB.open('uplift_db');
      req.onerror=()=>resolve(false);
      req.onsuccess=e=>{
        const db=e.target.result;
        try{
          const tx=db.transaction('uplift_data','readonly');
          const getReq=tx.objectStore('uplift_data').get('state');
          getReq.onerror=()=>resolve(false);
          getReq.onsuccess=ev=>{
            const data=ev.target.result;
            if(!data||!data.settings||!data.settings.wifiOnly){resolve(false);return;}
            const isAndroid=/Android/i.test(navigator.userAgent);
            if(!isAndroid){resolve(true);return;} // iOS/desktop can't distinguish connection type - same as the app's own logic
            if(!navigator.onLine){resolve(true);return;}
            const conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
            if(!conn||conn.type===undefined||conn.type==='unknown'||conn.type==='other'){resolve(false);return;}
            resolve(conn.type==='cellular');
          };
        }catch(err){resolve(false);} // object store doesn't exist yet - app has never run here
      };
    }catch(err){resolve(false);}
  });
}

// Cheap freshness check using a HEAD request (no body downloaded) to compare
// ETag/Last-Modified against what's already cached - only does the full GET
// (the actual re-download) if something has genuinely changed. Runs in the
// background; never blocks or delays the response already served from cache.
async function checkAndUpdateCache(request,cachedResponse){
  try{
    const headResp=await fetch(request.url,{method:'HEAD',cache:'no-store'});
    if(!headResp.ok)return;
    const newEtag=headResp.headers.get('etag');
    const newLastMod=headResp.headers.get('last-modified');
    const oldEtag=cachedResponse?cachedResponse.headers.get('etag'):null;
    const oldLastMod=cachedResponse?cachedResponse.headers.get('last-modified'):null;
    const changed=!cachedResponse||(newEtag?newEtag!==oldEtag:newLastMod!==oldLastMod);
    if(!changed)return;
    const freshResp=await fetch(request.url,{cache:'no-store'});
    if(freshResp&&freshResp.status===200){
      const cache=await caches.open(CACHE);
      await cache.put(request,freshResp.clone());
    }
  }catch(err){/* offline or check failed - fine, cache stays exactly as it was */}
}

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  // Was matching ANY same-origin request, not just the app's own known files -
  // meaning a direct visit to a completely unrelated page on the same domain
  // (uplift-guide.html, its screenshots, anything else living alongside the
  // app) got silently swept into this same cache-forever logic the first time
  // it was ever fetched, then served from that frozen snapshot on every visit
  // after, regardless of what's actually live on the server.
  const isAppShell=URLS.includes(url.pathname);
  const isCachedCdn=CDN_URLS.includes(e.request.url);
  const isGuideHtml=url.pathname==='/UpLift/uplift-guide.html';
  const isScreenshot=url.pathname.startsWith('/UpLift/screenshots/');
  // The app shell now gets the same background-revalidation treatment as
  // the guide/screenshots below, not the plain cache-forever branch further
  // down - this is the actual fix for tonight's bug. A new service worker
  // only ever installs when sw.js's own bytes change, so a deploy that
  // touches only index.html (as every one of tonight's did) previously left
  // whatever was already cached in place forever, no matter how many new
  // versions got pushed - this HEAD-based check now catches that on every
  // visit instead of requiring a remembered, manual cache-name bump here.
  if(isGuideHtml||isScreenshot||isAppShell){
    e.respondWith(
      caches.match(e.request).then(cached=>{
        // Always serve whatever's cached instantly - zero network dependency
        // for the current response, matching the app's offline-first design
        // everywhere else. The freshness check below runs separately in the
        // background and only updates the cache for NEXT time; it never
        // delays or depends on for THIS response.
        if(cached){
          // Images specifically respect Data Saver - skip even the cheap HEAD
          // check while it's on, not just the full download, so no unnecessary
          // network activity happens for photos at all. Also wrapped in
          // e.waitUntil() below - without it, the browser can terminate this
          // service worker as soon as it sees the response resolved, potentially
          // cutting this background check off mid-flight before it ever gets to
          // update the cache. waitUntil() tells the browser explicitly to keep
          // the worker alive until this finishes, even though the page has
          // already gotten its response.
          const bgUpdate=isScreenshot
            ? isDataSaverActive().then(restricted=>{if(!restricted)return checkAndUpdateCache(e.request,cached);})
            : checkAndUpdateCache(e.request,cached);
          e.waitUntil(bgUpdate);
          return cached;
        }
        // Nothing cached yet - this is the one case that must wait on the
        // network, same as the app shell's own first install.
        return fetch(e.request).then(response=>{
          if(response&&response.status===200){
            const clone=response.clone();
            caches.open(CACHE).then(c=>c.put(e.request,clone));
          }
          return response;
        }).catch(()=>new Response('',{status:503,statusText:'Offline - never previously loaded'}));
      })
    );
    return;
  }
  // Only CDN assets reach here now - version-pinned URLs (e.g. leaflet@1.9.4)
  // that genuinely never change for a given version string, so straight
  // cache-forever is correct and revalidating them would just be wasted
  // network traffic. isAppShell is never true here - it always matches the
  // branch above instead.
  if(!isCachedCdn)return;
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
