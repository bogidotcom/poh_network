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

// ── Task 4: Additional sanctions lists (UK FCDO, EU) ──────────────────────────
// UK: https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv (auto-fetched)
// EU: https://data.europa.eu/apps/eusanctionstracker/individuals/
//     Built on official EU Consolidated Financial Sanctions List (FSD)
//     Best source: https://webgate.ec.europa.eu/fsd/fsf (login may be required for bulk export)
//     Recommended: Periodically download the latest "Consolidated list" (CSV or XML v1.1)
//     and place it as data/eu_consolidated.csv (or .xml) in this project.
//
// Current implementation: name-based fuzzy matching (EU lists rarely contain crypto addresses).
// Crypto address screening is still best covered by the OFAC SDN list.

const UK_SANCTIONS_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv';
let ukNames = new Set(); // lowercased names for substring / exact match

async function refreshUk() {
  try {
    const res = await axios.get(UK_SANCTIONS_URL, { timeout: 15000, responseType: 'text' });
    const lines = res.data.split('\n').slice(1); // skip header
    ukNames = new Set();
    for (const line of lines) {
      // Name is usually first or "Name" column; simple split
      const name = (line.split(',')[0] || '').replace(/^"|"$/g, '').toLowerCase().trim();
      if (name && name.length > 3) ukNames.add(name);
    }
    console.log(`[sanctions] UK list loaded — ${ukNames.size} names`);
  } catch (e) {
    console.warn('[sanctions] UK list refresh failed (using empty):', e.message);
  }
}

// Kick off (non-blocking)
refreshUk().catch(() => {});

function isUkSanctioned(addressOrName) {
  if (!addressOrName) return { sanctioned: false };
  const q = String(addressOrName).toLowerCase();
  for (const name of ukNames) {
    if (q.includes(name) || name.includes(q)) return { sanctioned: true, name, list: 'UK-FCDO' };
  }
  return { sanctioned: false };
}

function getAdditionalSanctionsStats() {
  return { ukCount: ukNames.size, euCount: euNames.size };
}

// ── EU Sanctions (name-based) ─────────────────────────────────────────────────
const EU_LOCAL_CSV_PATH = path.join(__dirname, '../../data/eu_consolidated.csv');
const EU_LOCAL_XML_PATH = path.join(__dirname, '../../data/eu_consolidated.xml');

let euNames = new Set();

async function refreshEuFromRemote() {
  // The official source often requires auth/token. We try common public patterns as fallback.
  const candidates = [
    'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList/content',
    'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content',
  ];

  for (const url of candidates) {
    try {
      const res = await axios.get(url, { timeout: 20000, responseType: 'text' });
      if (res.status === 200 && res.data && res.data.length > 1000) {
        parseEuCsv(res.data);
        console.log(`[sanctions] EU list loaded from remote (${euNames.size} names)`);
        return true;
      }
    } catch (e) {
      // try next
    }
  }
  return false;
}

function parseEuCsv(csvText) {
  euNames = new Set();
  const lines = csvText.split('\n');
  for (let i = 1; i < lines.length; i++) { // skip header
    const line = lines[i].trim();
    if (!line) continue;

    // EU CSV format varies by version. Common: Name is in early columns.
    // Try splitting and taking plausible name fields.
    const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/); // handle quoted commas
    for (let p = 0; p < Math.min(6, parts.length); p++) {
      let name = parts[p].replace(/^"|"$/g, '').trim();
      if (name.length > 4 && /[A-Za-z]/.test(name)) {
        euNames.add(name.toLowerCase());
      }
    }
  }
}

function loadEuFromLocalFile() {
  const fs = require('fs');
  try {
    if (fs.existsSync(EU_LOCAL_CSV_PATH)) {
      const csv = fs.readFileSync(EU_LOCAL_CSV_PATH, 'utf8');
      parseEuCsv(csv);
      console.log(`[sanctions] EU list loaded from local CSV — ${euNames.size} names`);
      return true;
    }
    if (fs.existsSync(EU_LOCAL_XML_PATH)) {
      // Very basic XML name extraction (for <name> or <wholeName> tags)
      const xml = fs.readFileSync(EU_LOCAL_XML_PATH, 'utf8');
      const nameMatches = xml.match(/<wholeName[^>]*>([^<]+)<\/wholeName>|<name[^>]*>([^<]+)<\/name>/gi) || [];
      euNames = new Set(nameMatches.map(m => m.replace(/<[^>]+>/g, '').trim().toLowerCase()).filter(n => n.length > 4));
      console.log(`[sanctions] EU list loaded from local XML — ${euNames.size} names`);
      return true;
    }
  } catch (e) {
    console.warn('[sanctions] Failed to load local EU sanctions file:', e.message);
  }
  return false;
}

async function refreshEu() {
  const loadedLocal = loadEuFromLocalFile();
  if (loadedLocal) return;

  const loadedRemote = await refreshEuFromRemote();
  if (!loadedRemote) {
    console.warn('[sanctions] EU sanctions list not loaded (no local file + remote fetch failed). Place data/eu_consolidated.csv for best results.');
  }
}

// Kick off
refreshEu().catch(() => {});

function isEuSanctioned(query) {
  if (!query) return { sanctioned: false };
  const q = String(query).toLowerCase().trim();
  for (const name of euNames) {
    if (q.includes(name) || name.includes(q)) {
      return { sanctioned: true, name, list: 'EU' };
    }
  }
  return { sanctioned: false };
}

/** Combined sanctions check (OFAC crypto + UK/EU name matching) */
function isSanctioned(addressOrName) {
  const ofac = isOfacSanctioned(addressOrName);
  if (ofac.sanctioned) return { ...ofac, list: 'OFAC' };

  const uk = isUkSanctioned(addressOrName);
  if (uk.sanctioned) return uk;

  const eu = isEuSanctioned(addressOrName);
  if (eu.sanctioned) return eu;

  return { sanctioned: false };
}

module.exports = {
  isOfacSanctioned,
  getOfacStats,
  isUkSanctioned,
  isEuSanctioned,
  isSanctioned,
  getAdditionalSanctionsStats,
  refreshEu,           // exposed for manual refresh if needed
};
