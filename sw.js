// ========================================
// Service Worker for jsAnki
// Features: Offline support, Background Sync, Push Notifications
// ========================================

const CACHE_NAME = 'jsanki-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/data/manifest.json',
  '/icons/icon-72.png',
  '/icons/icon-192.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip cross-origin requests (except fonts, APIs)
  if (url.origin !== self.location.origin) {
    // Handle fonts with stale-while-revalidate
    if (request.destination === 'font') {
      event.respondWith(staleWhileRevalidate(request));
    }
    return;
  }
  
  // Strategy for data files (lazy loading)
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }
  
  // Strategy for static assets
  event.respondWith(cacheFirstWithNetwork(request));
});

// Cache-first strategy for static assets
async function cacheFirstWithNetwork(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  if (cached) {
    // Return cached version and update in background
    fetch(request)
      .then(response => {
        if (response.ok) {
          cache.put(request, response);
        }
      })
      .catch(() => {});
    
    return cached;
  }
  
  // Not in cache, fetch from network
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Fetch failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy for data files
async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache the fresh response
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    
    throw new Error('Network response not OK');
  } catch (error) {
    // Network failed, try cache
    console.log('[SW] Network failed, trying cache for:', request.url);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    // Not in cache either - return offline placeholder
    console.error('[SW] Not in cache:', request.url);
    return new Response(
      JSON.stringify({ error: 'Offline and not cached', offline: true }),
      { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Stale-while-revalidate strategy (for fonts, non-critical assets)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  
  // Return cached immediately if available, otherwise wait for network
  return cached || fetchPromise;
}

// ========================================
// Background Sync
// ========================================

// Store pending sync operations
let pendingSync = [];

self.addEventListener('sync', (event) => {
  console.log('[SW] Background Sync:', event.tag);
  
  if (event.tag === 'sync-progress') {
    event.waitUntil(syncProgress());
  } else if (event.tag === 'sync-stats') {
    event.waitUntil(syncStats());
  }
});

async function syncProgress() {
  console.log('[SW] Syncing progress...');
  
  try {
    // Get clients to access IndexedDB
    const clients = await self.clients.matchAll();
    
    // Notify clients to sync their data
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_PROGRESS',
        timestamp: Date.now()
      });
    });
    
    // If we had a server backend, we'd send data here:
    // await fetch('/api/sync', { method: 'POST', body: data });
    
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Sync failed:', error);
    // Will retry on next sync event
    throw error;
  }
}

async function syncStats() {
  console.log('[SW] Syncing stats...');
  // Analytics, usage statistics, etc.
  return Promise.resolve();
}

// ========================================
// Periodic Background Sync (for daily reminders)
// ========================================

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-reminder') {
    event.waitUntil(showDailyReminder());
  }
});

async function showDailyReminder() {
  // Check if user studied today
  // If not - schedule notification
  // This requires Push API permissions
  
  const now = new Date();
  const hours = now.getHours();
  
  // Send notification only during reasonable hours
  if (hours >= 9 && hours <= 21) {
    await self.registration.showNotification('Anki JS', {
      body: 'Время учить JavaScript! 📚 Не прерывай серию!',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: 'daily-study-reminder',
      requireInteraction: false,
      actions: [
        { action: 'study', title: 'Учиться' },
        { action: 'dismiss', title: 'Отложить' }
      ]
    });
  }
}

// ========================================
// Push Notifications
// ========================================

self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'Anki JS',
      body: event.data.text()
    };
  }
  
  const options = {
    body: data.body || 'Время повторить карточки!',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: data.tag || 'jsanki-reminder',
    requireInteraction: data.requireInteraction || false,
    data: data.data || {},
    actions: data.actions || [
      { action: 'open', title: 'Открыть' },
      { action: 'dismiss', title: 'Закрыть' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Anki JS', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click:', event.action);
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then(clientList => {
        // Focus existing window if open
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open new window
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// ========================================
// Message handling from main thread
// ========================================

self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'CACHE_DATA') {
    // Pre-cache specific data files
    const urls = event.data.urls || [];
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(urls);
      })
    );
  }
  
  if (event.data.type === 'REQUEST_SYNC') {
    // Request background sync
    if ('sync' in self.registration) {
      event.waitUntil(
        self.registration.sync.register(event.data.tag || 'sync-progress')
      );
    }
  }
});

// ========================================
// Online/Offline detection
// ========================================

self.addEventListener('online', () => {
  console.log('[SW] Browser is online');
  // Trigger sync when coming back online
  if ('sync' in self.registration) {
    self.registration.sync.register('sync-progress');
  }
});

self.addEventListener('offline', () => {
  console.log('[SW] Browser is offline');
});

console.log('[SW] Service Worker loaded');
