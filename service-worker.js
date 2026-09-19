/* Manifest version: 6pH1M4SR */
self.importScripts('./service-worker-assets.js');
self.addEventListener('install', event => event.waitUntil(onInstall(event)));
self.addEventListener('activate', event => event.waitUntil(onActivate(event)));
self.addEventListener('fetch', event => event.respondWith(onFetch(event).catch(error => fallbackResponse(event.request, error))));
self.addEventListener('sync', event => {
    if (event.tag === 'fieldops-sync') {
        event.waitUntil(onSync());
    }
});

const cacheNamePrefix = 'offline-cache-';
const cacheName = `${cacheNamePrefix}${self.assetsManifest.version}`;
const offlineAssetsInclude = [ /\.dll$/, /\.pdb$/, /\.wasm/, /\.html/, /\.js$/, /\.json$/, /\.css$/, /\.woff$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/, /\.blat$/, /\.dat$/, /\.webmanifest$/ ];
const offlineAssetsExclude = [ /^service-worker\.js$/ ];

const baseUrl = new URL(self.registration.scope);
const manifestUrlList = self.assetsManifest.assets.map(asset => new URL(asset.url, baseUrl).href);

async function onInstall(event) {
    const assetsRequests = self.assetsManifest.assets
        .filter(asset => offlineAssetsInclude.some(pattern => pattern.test(asset.url)))
        .filter(asset => !offlineAssetsExclude.some(pattern => pattern.test(asset.url)))
        .map(asset => new Request(new URL(asset.url, baseUrl).href, { integrity: asset.hash, cache: 'no-cache' }));
    const cache = await caches.open(cacheName);
    await Promise.all(assetsRequests.map(async request => {
        try {
            await cache.add(request);
        } catch (error) {
            console.warn('[FieldOps] Service worker: skipped cache asset', request.url);
        }
    }));
    await self.skipWaiting();
}

async function onActivate(event) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys
        .filter(key => key.startsWith(cacheNamePrefix) && key !== cacheName)
        .map(key => caches.delete(key)));

    if ('periodicSync' in self.registration) {
        try {
            await self.registration.periodicSync.register('fieldops-periodic-sync', {
                minInterval: 15 * 60 * 1000
            });
        } catch (e) {
            // Periodic sync is optional and unsupported by several browsers.
        }
    }

    await self.clients.claim();
}

async function onFetch(event) {
    try {
        if (event.request.method !== 'GET') {
            return await fetch(event.request);
        }

        const cache = await caches.open(cacheName);
        const isNavigation = event.request.mode === 'navigate';
        const isManifestAsset = manifestUrlList.some(url => url === event.request.url);

        if (isNavigation && !isManifestAsset) {
            const indexResponse = await getIndexResponse(cache);
            if (indexResponse) {
                return indexResponse;
            }

            return await fetch(new URL('index.html', baseUrl).href);
        }

        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            return cachedResponse;
        }

        return await fetch(event.request);
    } catch (error) {
        return await fallbackResponse(event.request, error);
    }
}

async function getIndexResponse(cache) {
    return await cache.match(new URL('index.html', baseUrl).href)
        || await cache.match('index.html')
        || await caches.match(new URL('index.html', baseUrl).href)
        || await caches.match('index.html');
}

async function fallbackResponse(request, error) {
    if (request.mode === 'navigate') {
        try {
            const cache = await caches.open(cacheName);
            const indexResponse = await getIndexResponse(cache);
            if (indexResponse) {
                return indexResponse;
            }
        } catch {
            // Fall through to a non-rejecting response.
        }
    }

    return new Response('', {
        status: 504,
        statusText: 'Gateway Timeout'
    });
}

async function onSync() {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({ type: 'FIELD_OPS_SYNC' });
    });
}
