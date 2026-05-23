'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const CACHE_PATH = path.join(__dirname, '../../data/ofac_cache.json');
const SDN_URL    = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory: normalizedAddress → { name, program, chainCode }
let ofacMap     = new Map();
let lastUpdated = 0;

// ── CSV parser ────────────────────────────────────────────────────────────────
// SDN CSV format: entNum,"Name",type,"Program",...,Remarks
// Digital currency addresses appear in the Remarks column as:
//   Digital Currency Address - ETH 0xabc...;
//   alt. Digital Currency Address - XBT 1abc...;

function parseSdnCsv(csvText) {
  const map = new Map();

  for (const line of csvText.split('\n')) {
    if (!line.includes('Digital Currency Address')) continue;

    // Entity name: second field, always double-quoted
    const nameMatch = line.match(/^\d+,"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : 'Unknown';

    // Program codes appear as [PROG] brackets or as a plain code in the 4th column
    const bracketProgs = [...line.matchAll(/\[([A-Z][A-Z0-9_-]+)\]/g)].map(m => m[1]);
    const plainProg    = line.match(/^\d+,"[^"]+",(?:[^,]+)?,\s*"([A-Z][A-Z0-9_-]+)"/)?.[1];
    const program      = bracketProgs[0] || plainProg || 'SDN';

    // Extract every "Digital Currency Address - CHAIN addr" occurrence
    const addrRe = /(?:alt\.\s+)?Digital Currency Address\s+-\s+([A-Z0-9]+)\s+([A-Za-z0-9]+)/g;
    let m;
    while ((m = addrRe.exec(line)) !== null) {
      const chainCode = m[1];
      const rawAddr   = m[2];
      // Normalise EVM addresses to lowercase (covers all EVM chains)
      const addr = (chainCode === 'ETH' || chainCode === 'ETC') ? rawAddr.toLowerCase() : rawAddr;
      map.set(addr, { name, program, chainCode });
    }
  }

  return map;
}

// ── Download + parse + persist ────────────────────────────────────────────────

async function refresh() {
  try {
    console.log('[ofac] Downloading SDN list…');
    const res = await axios.get(SDN_URL, {
      maxRedirects: 5,
      timeout:      30_000,
      responseType: 'text',
    });
    const map   = parseSdnCsv(res.data);
    ofacMap     = map;
    lastUpdated = Date.now();

    const payload = {
      updatedAt: new Date(lastUpdated).toISOString(),
      count:     map.size,
      addresses: Object.fromEntries(map),
    };
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    const tmp = CACHE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, CACHE_PATH);
    console.log(`[ofac] SDN list loaded — ${map.size} sanctioned crypto addresses`);
  } catch (err) {
    console.error('[ofac] Failed to refresh SDN list:', err.message);
    // Fail open — keep whatever we already have in memory
  }
}

function loadFromCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    const age = Date.now() - new Date(raw.updatedAt).getTime();
    if (age > REFRESH_MS) return false; // stale — fetch fresh
    ofacMap     = new Map(Object.entries(raw.addresses || {}));
    lastUpdated = new Date(raw.updatedAt).getTime();
    console.log(`[ofac] Cache loaded — ${ofacMap.size} addresses (${Math.round(age / 3_600_000)}h old)`);
    return true;
  } catch {
    return false;
  }
}

// ── Startup: load cache or fetch, then refresh every 24 h ────────────────────

(async () => {
  const cacheOk = loadFromCache();
  if (!cacheOk) await refresh();
  setInterval(refresh, REFRESH_MS);
})();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether `address` (or any address matching its normalised form) is on
 * the OFAC SDN list.
 *
 * @param {string} address
 * @returns {{ sanctioned: false } | { sanctioned: true, name: string, program: string, chainCode: string }}
 */
function isOfacSanctioned(address) {
  if (!address) return { sanctioned: false };
  // EVM: compare lowercase; other chains (Solana, BTC, TRX): exact match
  const key = /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;
  const hit  = ofacMap.get(key);
  return hit ? { sanctioned: true, ...hit } : { sanctioned: false };
}

/** Diagnostic: how many sanctioned addresses are loaded and when they were last refreshed. */
function getOfacStats() {
  return {
    count:     ofacMap.size,
    updatedAt: lastUpdated ? new Date(lastUpdated).toISOString() : null,
  };
}

module.exports = { isOfacSanctioned, getOfacStats };
