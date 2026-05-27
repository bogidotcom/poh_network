'use strict';

const redis = require('redis');

const cacheFallback = new Map();
let useFallback = false;
let connected = false;

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: { connectTimeout: 2000, reconnectStrategy: false }
});

client.on('error', () => {
  if (!useFallback) {
    console.warn('[redis] Connection error, using in-memory fallback');
    useFallback = true;
  }
});

client.on('connect', () => {
  connected = true;
  useFallback = false;
  console.log('[redis] Connected');
});

// Try once at startup; if it fails, stay on fallback
client.connect().catch(() => { useFallback = true; });

async function getCachedResponse(key) {
  if (useFallback || !connected) return cacheFallback.get(key) || null;
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return cacheFallback.get(key) || null; }
}

async function setCachedResponse(key, value, ttl = 3600) {
  if (useFallback || !connected) { cacheFallback.set(key, value); return; }
  try {
    await client.setEx(key, ttl, JSON.stringify(value));
  } catch { cacheFallback.set(key, value); }
}

async function clearCache() {
  if (useFallback || !connected) { cacheFallback.clear(); return; }
  try { await client.flushDb(); } catch { cacheFallback.clear(); }
}

// Return up to `limit` cached profiles for the particles background animation.
// Scans profile:v1:* keys and returns lightweight objects.
async function getSampleProfiles(limit = 60) {
  try {
    let keys = [];
    if (useFallback || !connected) {
      // In-memory fallback: iterate Map keys
      for (const k of cacheFallback.keys()) {
        if (k.startsWith('profile:v1:')) keys.push(k);
      }
    } else {
      keys = await client.keys('profile:v1:*');
    }
    // Shuffle and cap
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    keys = keys.slice(0, limit);

    const profiles = await Promise.all(keys.map(async k => {
      try {
        const raw = useFallback || !connected
          ? cacheFallback.get(k)
          : JSON.parse(await client.get(k));
        if (!raw) return null;
        return {
          address:     raw.address    || null,
          displayName: raw.displayName || null,
          avatar:      raw.avatar      || null,
          domains:     (raw.domains    || []).slice(0, 3),
          handles:     (raw.links      || [])
            .filter(l => l.identity)
            .slice(0, 4)
            .map(l => ({ platform: l.platform, identity: l.identity })),
          link3:       raw.link3Profile?.handle || null,
        };
      } catch { return null; }
    }));
    return profiles.filter(Boolean);
  } catch { return []; }
}

module.exports = { getCachedResponse, setCachedResponse, clearCache, getSampleProfiles };
