'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data/labeled');

// name → Set<lowercase_address>
const lists = new Map();

function loadList(name) {
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return new Set();
  try {
    const raw  = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Accept: string[] or {address:string}[] or {[addr]:any}
    const addrs = Array.isArray(raw)
      ? raw.map(e => (typeof e === 'string' ? e : e?.address)).filter(Boolean)
      : Object.keys(raw);
    const set = new Set(addrs.map(a => a.toLowerCase()));
    console.log(`[labeled] ${name}: ${set.size} addresses`);
    return set;
  } catch (err) {
    console.error(`[labeled] Failed to load ${name}:`, err.message);
    return new Set();
  }
}

for (const name of ['offramp15k', 'offramp5k', 'cex']) {
  lists.set(name, loadList(name));
}

/**
 * Returns true if the address is in the named labeled wallet set.
 * EVM addresses are compared case-insensitively.
 */
function isInList(listName, address) {
  const set = lists.get(listName);
  if (!set || !address) return false;
  return set.has(address.toLowerCase());
}

function getListSize(listName) {
  return lists.get(listName)?.size ?? 0;
}

module.exports = { isInList, getListSize };
