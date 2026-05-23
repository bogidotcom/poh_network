'use strict';

const axios = require('axios');

const WEB3BIO_API = 'https://api.web3.bio';
const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';

// ── Web3.bio — social profiles + avatar ──────────────────────────────────────

async function fetchWeb3Bio(address) {
  try {
    const res = await axios.get(`${WEB3BIO_API}/profile/${address}`, { timeout: 8000 });
    if (!Array.isArray(res.data) || !res.data.length) return null;
    return res.data; // array of { platform, identity, displayName, avatar, description, links }
  } catch { return null; }
}

// ── Etherscan: first tx, last tx, total tx count ──────────────────────────────

async function fetchTxStats(address) {
  const apikey = process.env.ETHERSCAN_API_KEY;
  if (!apikey) return null;
  try {
    const [first, last, count] = await Promise.all([
      axios.get(ETHERSCAN_V2, {
        params: { chainid: 1, module: 'account', action: 'txlist',
                  address, page: 1, offset: 1, sort: 'asc', apikey },
        timeout: 8000,
      }),
      axios.get(ETHERSCAN_V2, {
        params: { chainid: 1, module: 'account', action: 'txlist',
                  address, page: 1, offset: 1, sort: 'desc', apikey },
        timeout: 8000,
      }),
      axios.get(ETHERSCAN_V2, {
        params: { chainid: 1, module: 'account', action: 'txlist',
                  address, page: 1, offset: 1, sort: 'asc', apikey },
        timeout: 8000,
      }),
    ]);
    const firstTx = first.data?.result?.[0];
    const lastTx  = last.data?.result?.[0];
    // total from Etherscan normal tx endpoint (result count is not total, use different endpoint)
    const txlistRes = await axios.get(ETHERSCAN_V2, {
      params: { chainid: 1, module: 'account', action: 'txlist',
                address, page: 1, offset: 10000, sort: 'asc', apikey },
      timeout: 12000,
    });
    const total = Array.isArray(txlistRes.data?.result) ? txlistRes.data.result.length : null;
    return {
      firstTx: firstTx ? { hash: firstTx.hash, ts: parseInt(firstTx.timeStamp, 10) * 1000 } : null,
      lastTx:  lastTx  ? { hash: lastTx.hash,  ts: parseInt(lastTx.timeStamp,  10) * 1000 } : null,
      total,
    };
  } catch { return null; }
}

// ── Gitcoin Passport score ────────────────────────────────────────────────────

async function fetchGitcoinScore(address) {
  try {
    const scorerId = process.env.GITCOIN_SCORER_ID || '335';
    const apiKey   = process.env.GITCOIN_API_KEY;
    const headers  = apiKey ? { 'X-API-KEY': apiKey } : {};
    const res = await axios.get(
      `https://api.scorer.gitcoin.co/registry/score/${scorerId}/${address}`,
      { headers, timeout: 8000 }
    );
    if (res.data?.score == null) return null;
    return { score: parseFloat(res.data.score), passing: parseFloat(res.data.score) >= 20 };
  } catch { return null; }
}

// ── BrightID — social-graph uniqueness verification ──────────────────────────
// Uses the Gitcoin app context (largest BrightID app, links ETH addresses).
// validateStatus: true prevents axios throwing on 4xx — we parse error codes ourselves.
// errorNum 3 = not in BrightID; 4 = linked but not sponsored; 2 = not enough connections
async function fetchBrightId(address) {
  try {
    const res = await axios.get(
      `https://app.brightid.org/node/v5/verifications/Gitcoin/${address.toLowerCase()}`,
      { timeout: 6000, validateStatus: () => true }
    );
    const d = res.data;
    if (!d?.error) return { verified: true };                                  // confirmed unique
    if (d.errorNum === 4 || d.errorNum === 2) return { verified: false };     // in BrightID, not verified here
    return null;                                                               // not in BrightID at all
  } catch { return null; }
}

// ── BAB Token — Binance Account Bound (on-chain KYC badge) ───────────────────
// SBT on BNB Chain. If balanceOf > 0, address passed Binance KYC.
async function fetchBabToken(address) {
  try {
    const BAB  = '0x2B09d47D550061f995A3b5C6F0Fd58005215D7c8'; // BSC mainnet
    const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
    const res  = await axios.post('https://bsc-dataseed.binance.org/', {
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: BAB, data }, 'latest'],
    }, { timeout: 6000 });
    return parseInt(res.data?.result || '0x0', 16) > 0 ? { hasKyc: true } : null;
  } catch { return null; }
}

// ── Nomis — multi-chain reputation score ──────────────────────────────────────
async function fetchNomisScore(address) {
  try {
    // Scores are stored only after the user requests calculation via nomis.cc
    const res = await axios.get(
      `https://api.nomis.cc/api/v1/wallet/1/${address}/score`,
      { timeout: 8000, validateStatus: () => true }
    );
    if (res.status !== 200) return null;
    const val = res.data?.data?.score?.value ?? res.data?.data?.score ?? res.data?.score;
    if (val == null) return null;
    return { score: parseFloat(val) };
  } catch { return null; }
}

// ── Humanity Protocol — biometric / zkTLS proof of humanity ──────────────────
async function fetchHumanityProtocol(address) {
  try {
    const res = await axios.get(
      `https://api.humanityprotocol.com/v1/users/${address}`,
      { timeout: 6000, validateStatus: () => true }
    );
    if (res.status !== 200 || !res.data) return null;
    const d = res.data;
    if (!d.registered && !d.humanityId && !d.verified) return null;
    return { registered: true, humanityId: d.humanityId || null };
  } catch { return null; }
}

// ── Human Protocol (human.tech) — operator/worker reputation ─────────────────
async function fetchHumanTech(address) {
  try {
    const res = await axios.get(
      `https://api.humanprotocol.org/reputation/${address}`,
      { timeout: 6000, validateStatus: () => true }
    );
    if (res.status !== 200 || !res.data) return null;
    const score = res.data.reputationScore ?? res.data.score;
    if (score == null) return null;
    return { score: parseFloat(score) };
  } catch { return null; }
}

// ── Gnosis Safe — find Safe multisigs where address is an owner ───────────────
async function fetchSafeWallets(address) {
  try {
    const res = await axios.get(
      `https://safe-transaction-mainnet.safe.global/api/v1/owners/${address}/safes/`,
      { timeout: 6000 }
    );
    const safes = res.data?.safes;
    return Array.isArray(safes) && safes.length ? safes.slice(0, 10) : null;
  } catch { return null; }
}

// ── Galxe (Galaxy) — on-chain credential/NFT identity ────────────────────────

async function fetchGalxeProfile(address) {
  try {
    const query = `query { addressInfo(address: "${address}") { id username avatar } }`;
    const res = await axios.post(
      'https://graphigo.prd.galaxy.eco/query',
      { query },
      { headers: { 'Content-Type': 'application/json' }, timeout: 6000 }
    );
    const info = res.data?.data?.addressInfo;
    // Skip auto-generated profiles where username === id (unclaimed Galxe accounts)
    if (!info?.username || info.username === info.id) return null;
    return {
      platform: 'galxe',
      identity: info.username,
      displayName: info.username,
      avatar: info.avatar || null,
      description: null,
      url: `https://app.galxe.com/user/${info.username}`,
    };
  } catch { return null; }
}

// ── ENS reverse lookup ────────────────────────────────────────────────────────

async function fetchEnsName(address) {
  try {
    const res = await axios.get(`https://api.ensdata.net/${address}`, { timeout: 6000 });
    if (!res.data?.ens) return null;
    return {
      name:   res.data.ens,
      avatar: res.data.avatar || null,
      url:    `https://app.ens.domains/${res.data.ens}`,
    };
  } catch { return null; }
}

// ── Tx graph nodes + edges for visualization ──────────────────────────────────
// Returns top counterparties from the cache populated during scan.

function buildGraphData(address, counterparties) {
  const nodes = [{ id: address, label: address, isCenter: true }];
  const edges = [];
  let i = 0;
  for (const cp of counterparties) {
    if (i >= 30) break; // cap at 30 nodes for perf
    nodes.push({ id: cp, label: cp, isCenter: false });
    edges.push({ source: address, target: cp });
    i++;
  }
  return { nodes, edges };
}

// ── Main enrichment ───────────────────────────────────────────────────────────

async function enrichProfile(address, counterparties) {
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);

  const tasks = {
    web3bio:   fetchWeb3Bio(address),
    txStats:   isEvm ? fetchTxStats(address)         : Promise.resolve(null),
    gitcoin:   isEvm ? fetchGitcoinScore(address)    : Promise.resolve(null),
    ens:       isEvm ? fetchEnsName(address)          : Promise.resolve(null),
    galxe:     isEvm ? fetchGalxeProfile(address)    : Promise.resolve(null),
    brightid:  isEvm ? fetchBrightId(address)        : Promise.resolve(null),
    bab:       isEvm ? fetchBabToken(address)        : Promise.resolve(null),
    nomis:     isEvm ? fetchNomisScore(address)      : Promise.resolve(null),
    humanity:  isEvm ? fetchHumanityProtocol(address): Promise.resolve(null),
    humanTech: isEvm ? fetchHumanTech(address)       : Promise.resolve(null),
    safeWallets: isEvm ? fetchSafeWallets(address)   : Promise.resolve(null),
  };

  const [web3bio, txStats, gitcoin, ens, galxe,
         brightid, bab, nomis, humanity, humanTech, safeWallets] = await Promise.all(
    Object.values(tasks).map(p => p.catch(() => null))
  );

  // Merge: ens overrides web3bio ENS entry if richer
  const profiles = web3bio || [];

  // Deduplicate social links across profiles
  const socialMap = {};
  for (const p of profiles) {
    const key = p.platform?.toLowerCase();
    if (!key) continue;
    if (!socialMap[key]) socialMap[key] = p;
  }

  // Pick best avatar (prefer ENS > first web3bio with avatar)
  const avatar = ens?.avatar
    || profiles.find(p => p.avatar)?.avatar
    || null;

  // Pick display name: ENS name > farcaster > lens > first available
  const displayName = ens?.name
    || profiles.find(p => p.platform === 'farcaster')?.displayName
    || profiles.find(p => p.platform === 'lens')?.displayName
    || profiles.find(p => p.displayName)?.displayName
    || null;

  // Bio: first non-empty description
  const bio = profiles.find(p => p.description)?.description || null;

  // Web3 domains: ENS + any .sol etc. from profiles
  const domains = [];
  if (ens?.name) domains.push({ name: ens.name, platform: 'ENS', url: ens.url });
  for (const p of profiles) {
    if (['ens', 'sns', 'basenames', 'uns'].includes(p.platform?.toLowerCase())) {
      const alreadyHave = domains.some(d => d.name === p.identity);
      if (!alreadyHave) domains.push({ name: p.identity, platform: p.platform, url: p.links?.website?.link });
    }
  }

  // Verified links (Twitter, GitHub, Lens, Farcaster, website, etc.)
  // ─ Domain profiles (ENS, Basenames, SNS) carry nested social links in p.links
  //   e.g. ENS.links = { github: {...}, twitter: {...}, website: {...} }
  // ─ Social profiles (Farcaster, Lens) are themselves a link + may carry extras
  // We iterate ALL link keys for ALL profiles and deduplicate by "platform:handle".
  const DOMAIN_PLATFORMS = new Set(['ens','sns','basenames','uns','unstoppabledomains']);
  const linksMap = {}; // key → link object

  for (const p of profiles) {
    const profilePlatform = p.platform?.toLowerCase();

    if (DOMAIN_PLATFORMS.has(profilePlatform)) {
      // Extract every nested social link from domain profiles (github, twitter, website, …)
      for (const [linkType, linkData] of Object.entries(p.links || {})) {
        if (!linkData?.link) continue;
        const key = `${linkType}:${linkData.handle || linkData.link}`;
        if (!linksMap[key]) {
          linksMap[key] = { platform: linkType, identity: linkData.handle || null,
            displayName: linkData.handle || null, avatar: null, description: null, url: linkData.link };
        }
      }
    } else {
      // Social platform entry — add it as a link itself
      const key = `${profilePlatform}:${p.identity}`;
      if (!linksMap[key]) {
        const selfLink = p.links?.[profilePlatform]?.link || null;
        linksMap[key] = { platform: p.platform, identity: p.identity,
          displayName: p.displayName, avatar: p.avatar, description: p.description, url: selfLink };
      }
      // Also extract any additional nested links it carries
      for (const [linkType, linkData] of Object.entries(p.links || {})) {
        if (linkType === profilePlatform || !linkData?.link) continue;
        const k2 = `${linkType}:${linkData.handle || linkData.link}`;
        if (!linksMap[k2]) {
          linksMap[k2] = { platform: linkType, identity: linkData.handle || null,
            displayName: linkData.handle || null, avatar: null, description: null, url: linkData.link };
        }
      }
    }
  }
  // Merge Galxe profile into links (if found and not already present)
  if (galxe) {
    const galxeKey = `galxe:${galxe.identity}`;
    if (!linksMap[galxeKey]) linksMap[galxeKey] = galxe;
  }

  const links = Object.values(linksMap);

  // Graph data
  const graph = counterparties ? buildGraphData(address, counterparties) : null;

  return {
    address,
    avatar,
    displayName,
    bio,
    domains,
    links,          // social platforms
    gitcoin,        // { score, passing } or null
    txStats,        // { firstTx, lastTx, total } or null
    graph,          // { nodes, edges } or null
    identityProtocols: {
      brightid:  brightid  || null,  // { verified } or { verified: false } or null
      bab:       bab       || null,  // { hasKyc: true } or null
      nomis:     nomis     || null,  // { score: 0-100 } or null
      humanity:  humanity  || null,  // { registered: true } or null
      humanTech: humanTech || null,  // { score } or null
    },
    associatedWallets: safeWallets || null,  // Safe multisig addresses or null
  };
}

module.exports = { enrichProfile };
