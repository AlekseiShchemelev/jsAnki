const CACHE_NAME = 'anki-js-v3';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './data.json',
    './manifest.json',
    './icons/icon-72.png',
    './icons/icon-96.png',
    './icons/icon-128.png',
    './icons/icon-144.png',
    './icons/icon-152.png',
    './icons/icon-192.png',
    './icons/icon-384.png',
    './icons/icon-512.png'
];

// Install Event - Cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
            .catch(err => console.error('[SW] Cache failed:', err))
    );
});

// Activate Event - Clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
            .then(() => console.log('[SW] Activated'))
    );
});

// Fetch Event - Stale-while-revalidate strategy
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Skip external requests
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                // Return cached version immediately
                const fetchPromise = fetch(event.request)
                    .then((networkResponse) => {
                        // Update cache with fresh version
                        if (networkResponse && networkResponse.status === 200) {
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        console.log('[SW] Network failed, serving from cache');
                        return cachedResponse;
                    });

                // Return cached or fetch
                return cachedResponse || fetchPromise;
            })
    );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});

// Background sync for offline form submissions (if needed later)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-progress') {
        console.log('[SW] Syncing progress...');
    }
});
