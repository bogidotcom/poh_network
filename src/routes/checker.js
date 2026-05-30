'use strict';

const crypto  = require('crypto');
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const { getRpcUrl, callContract } = require('../utils/evm');
const { evaluate }                = require('../eval/evaluator');
const multer                      = require('multer');
const { parse }                   = require('csv-parse/sync');
const { getCachedResponse, setCachedResponse, getSampleProfiles } = require('../utils/redis');
const { verifyStablecoinTransfer } = require('../utils/solana');
const brain                       = require('../utils/brain');
const { recordMethodResult }      = require('../utils/methodHealth');
const { analyzeTransactionGraph, getCounterparties } = require('../utils/txGraph');
const { isOfacSanctioned, isSanctioned } = require('../utils/ofac');
const { enrichProfile }                             = require('../utils/profileEnrich');
const { isInList }                                  = require('../utils/labeledWallets');
const { checkHumanityVerified }   = require('../utils/humanityProtocol');
const { createJob, getJob }       = require('../utils/jobQueue');
const {
  getProfile, getProfiles, upsertProfile, consumeFreeScan, calcScanCost,
  getFreeScansLeft, distributeRewards, isIpAbuse, recordIp,
  getPlan, consumePlanScan, chargeOverage,
} = require('../utils/profiles');

const upload = multer({ dest: 'uploads/' });

const METHODS_PATH = path.join(__dirname, '../../data/methods.json');
const DATASET_PATH = path.join(__dirname, '../../data/dataset.json');

// Async brain verdicts for single-wallet scans
const brainPending = {};

// 7-day full-scan cache (results + brain verdict + enriched profile)
const SCAN_CACHE_TTL = 7 * 24 * 3600;

/**
 * Stable fingerprint of the active method set.
 * Changes whenever signals are added or removed — invalidating old cache entries.
 */
function computeMethodsHash(methods) {
  const ids = methods.map(m => m.id).sort().join(',');
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 12);
}

// ── Address type validation (Task 3 fix) ─────────────────────────────────────
function isSupportedAddress(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const a = raw.trim();

  const isEvm     = /^0x[0-9a-fA-F]{40}$/.test(a);
  const isBitcoin = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(a);
  const isTron    = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  const isTon     = /^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(a);
  const isXlm     = /^G[A-Z2-7]{55}$/.test(a);
  const isSolana  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) && !isTron && !isBitcoin;

  return isEvm || isBitcoin || isTron || isTon || isXlm || isSolana;
}

// ── OFAC sanctions check ──────────────────────────────────────────────────────
// 1. Direct address match — O(1) in-memory lookup.
// 2. 1-hop counterparty check — reuses txGraph cache so no extra API calls if
//    analyzeTransactionGraph already ran during the same scan.
async function checkOfacFull(address) {
  // Direct (OFAC crypto addresses + UK/EU name matching via Task 4)
  const direct = isSanctioned(address);
  if (direct.sanctioned) {
    return {
      ...direct,
      type: 'direct',
      matchedAddress: address,
      list: direct.list || 'OFAC',
    };
  }

  // Counterparties (fail-open if fetch errors)
  try {
    const cps = await getCounterparties(address);
    for (const cp of cps) {
      const r = isOfacSanctioned(cp);
      if (r.sanctioned) return { ...r, type: 'counterparty', matchedAddress: cp };
    }
  } catch (err) {
    console.warn('[ofac] Counterparty check failed:', err.message);
  }
  return { sanctioned: false };
}

// ── Tether USDT blacklist hard override (Task 2) ─────────────────────────────
function checkTetherBlacklist(results) {
  const hit = results.find(r => r.methodId && r.methodId.startsWith('usdt_blacklist') && r.result === true);
  if (hit) {
    return {
      blacklisted: true,
      methodId: hit.methodId,
      description: hit.description,
    };
  }
  return { blacklisted: false };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMethods() {
  try {
    if (!fs.existsSync(METHODS_PATH)) return [];
    const raw = fs.readFileSync(METHODS_PATH, 'utf-8');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('[db] Error reading methods:', err.message);
    return [];
  }
}

function appendToDataset(record) {
  let dataset = [];
  if (fs.existsSync(DATASET_PATH)) {
    try { dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8')); } catch {}
  }
  dataset.push(record);
  const tmp = DATASET_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dataset, null, 2));
  fs.renameSync(tmp, DATASET_PATH);
}

// ── ZNS domain resolution ─────────────────────────────────────────────────────

const ZNS_TLD_CHAIN = {
  ink: 57073, bnb: 56, base: 8453, blast: 81457, polygon: 137,
  zora: 7777777, scroll: 534352, taiko: 167000, bera: 80094,
  sonic: 146, kaia: 8217, abstract: 2741, defi: 1301, unichain: 1301,
  soneium: 1868, plume: 98865, hemi: 43111, xrpl: 1440002,
  coti: 7771, katana: 2020, hyper: 999,
};

async function resolveZnsDomain(name) {
  const tld    = name.split('.').pop()?.toLowerCase();
  const domain = name.split('.').slice(0, -1).join('.');
  const chains = tld && ZNS_TLD_CHAIN[tld]
    ? [ZNS_TLD_CHAIN[tld]]
    : Object.values(ZNS_TLD_CHAIN);
  for (const chain of chains) {
    try {
      const res = await axios.get('https://zns.bio/api/resolveDomain', {
        params: { chain, domain }, timeout: 5000,
      });
      if (res.data?.code === 200 && res.data?.address) return res.data.address;
    } catch { /* try next */ }
  }
  return null;
}

// ── Single-method executor ────────────────────────────────────────────────────

// Per-method wall-clock limit.  REST calls get up to 12 s (some ENS / social
// APIs are slow); the outer race kills anything beyond that.
const METHOD_TIMEOUT_MS     = 14000;
const REST_AXIOS_TIMEOUT_MS = 12000;

async function executeMethod(m, address) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), METHOD_TIMEOUT_MS));
  const run = (async () => {
    if (m.type === 'evm') {
      const { ethers } = require('ethers');
      const rpcUrl   = getRpcUrl(Number(m.chainId));
      const decimals = m.decimals != null ? Number(m.decimals) : 18;
      const network  = new ethers.Network(String(m.chainId), Number(m.chainId));
      let result;
      if (m.method === 'eth_getBalance') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [await p.getBalance(address)];
      } else if (m.method === 'eth_getTransactionCount') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [BigInt(await p.getTransactionCount(address))];
      } else if (m.method === 'eth_getCode') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [await p.getCode(address)];
      } else {
        result = await callContract(rpcUrl, m.address, m.method,
          JSON.parse(m.abiTypes || '[]'), JSON.parse(m.returnTypes || '[]'),
          [address, ...(m.extraParams ? JSON.parse(m.extraParams) : [])], m.chainId);
      }
      return evaluate(m.expression, { result, decimals }, m.lang || 'js');

    } else if (m.type === 'rest') {
      const rawUrl     = m.address;
      const hasHolder  = rawUrl.includes('{address}');
      const url        = hasHolder ? rawUrl.replace(/\{address\}/g, encodeURIComponent(address)) : rawUrl;
      const method     = (m.method || 'GET').toUpperCase();
      const headers    = m.headers ? JSON.parse(m.headers) : {};
      const decimals   = m.decimals != null ? Number(m.decimals) : 18;
      const validate   = s => s < 500;
      let response;
      if (method === 'POST') {
        const body = JSON.parse((m.body || '{}').replace(/\{address\}/g, address));
        response = await axios.post(url, body, { headers, timeout: REST_AXIOS_TIMEOUT_MS, validateStatus: validate });
      } else {
        const params = hasHolder ? {} : { address };
        response = await axios.get(url, { params, headers, timeout: REST_AXIOS_TIMEOUT_MS, validateStatus: validate });
      }
      return evaluate(m.expression, { data: response.data, status: response.status, decimals }, m.lang || 'js');

    } else if (m.type === 'solana') {
      const { Connection, PublicKey }              = require('@solana/web3.js');
      const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
      const conn     = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const pubkey   = new PublicKey(address);
      const decimals = m.decimals != null ? Number(m.decimals) : 9;
      let result = null;
      if (m.method === 'getBalance') {
        result = await conn.getBalance(pubkey);
      } else if (m.method === 'getTransactionCount') {
        result = await conn.getTransactionCount(pubkey);
      } else if (m.method === 'getTokenBalance' && m.address) {
        const mint    = new PublicKey(m.address);
        const ata     = await getAssociatedTokenAddress(mint, pubkey);
        const account = await getAccount(conn, ata);
        result = Number(account.amount);
      } else if (m.method === 'getAccountInfo') {
        const info = await conn.getAccountInfo(pubkey);
        result = info?.executable ?? false;
      } else if (m.method === 'getProgramAccounts' && m.address) {
        const programId = new PublicKey(m.address);
        const accounts  = await conn.getProgramAccounts(programId, {
          filters: [{ memcmp: { offset: 8, bytes: address } }],
        });
        result = accounts.length > 0;
      }
      return evaluate(m.expression, { result, decimals }, m.lang || 'js');

    } else if (m.type === 'labeled') {
      const result = isInList(m.file, address);
      return evaluate(m.expression, { result }, m.lang || 'js');
    }
    return false;
  })();
  return Promise.race([run, timeout]);
}

// ── Scan a single wallet against filtered methods ─────────────────────────────

async function scanWallet(rawInput, { allMethods, chainFilter }) {
  // ZNS resolution
  const isZnsDomain = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(rawInput) && !/^0x/.test(rawInput);
  let address = rawInput;
  if (isZnsDomain) {
    const resolved = await resolveZnsDomain(rawInput);
    if (!resolved) return [{ input: rawInput, error: 'ZNS domain could not be resolved' }];
    console.log(`[checker] ZNS resolved ${rawInput} → ${resolved}`);
    address = resolved;
  }

  // Chain detection (Tron before Solana — Tron T... base58 can overlap Solana range)
  const isEvm     = /^0x[0-9a-fA-F]{40}$/.test(address);
  const isBitcoin = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(address);
  const isTron    = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  const isTon     = /^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(address);
  const isXlm     = /^G[A-Z2-7]{55}$/.test(address);
  const isSolana  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && !isTron;

  const chain = isEvm ? 'evm' : isBitcoin ? 'bitcoin' : isTron ? 'tron' : isTon ? 'ton' : isXlm ? 'xlm' : isSolana ? 'solana' : null;
  if (!chain) return [{ input: address, error: 'Unrecognised address format' }];

  let methods = [...allMethods];
  if (isEvm) {
    methods = methods.filter(m => m.type === 'evm' || m.type === 'rest' || m.type === 'labeled');
    methods = methods.filter(m => !m.addressType || m.addressType === 'evm');
    if (chainFilter) {
      const allowed = chainFilter.split(',').map(Number);
      methods = methods.filter(m => m.type === 'rest' || allowed.includes(Number(m.chainId)));
    }
  } else if (isSolana) {
    methods = methods.filter(m => m.type === 'solana' || m.type === 'rest' || m.type === 'labeled');
    methods = methods.filter(m => !m.addressType || m.addressType === 'solana');
  } else {
    // Bitcoin, Tron, TON, XLM — allow matching rest methods (by chain) + any native type if present
    const nativeType = chain; // 'bitcoin' | 'tron' | 'ton' | 'xlm'
    methods = methods.filter(m =>
      m.type === nativeType ||
      m.type === 'rest' && (!m.chain || m.chain === chain) ||
      m.type === 'labeled'
    );
  }
  if (methods.length === 0) return [];

  // Cache check
  const cacheKey = `check:${address}:${chainFilter || 'all'}`;
  const cached   = await getCachedResponse(cacheKey);
  if (cached && cached.methodCount === methods.length) return cached.data;

  console.log(`[checker] Scanning ${methods.length} methods for ${address}`);

  const [settled, graphResults, humanityResult] = await Promise.all([
    Promise.allSettled(methods.map(m => executeMethod(m, address))),
    analyzeTransactionGraph(address),
    checkHumanityVerified(address),
  ]);

  const results = settled.map((s, i) => {
    const m       = methods[i];
    const isError = s.status === 'rejected';
    const outcome = s.status === 'fulfilled' ? Boolean(s.value) : false;
    if (isError) console.error(`[checker] ✗ "${m.description.slice(0, 50)}" failed: ${s.reason?.message}`);
    if (m.type === 'rest' || m.type === 'evm') recordMethodResult(m.id, isError);
    appendToDataset({
      instruction: `Verification response for ${address} using ${m.description}`,
      input:  JSON.stringify(m),
      output: outcome ? 'Evidence of human activity' : 'No evidence of human activity',
    });
    return { input: address, methodId: m.id, description: m.description, result: outcome };
  });

  results.push(...graphResults);
  if (humanityResult) results.push(humanityResult);

  await setCachedResponse(cacheKey, { data: results, methodCount: methods.length });
  return results;
}

// ── POST /checker ─────────────────────────────────────────────────────────────

router.post('/', upload.single('csv'), async (req, res, next) => {
  console.log('[checker] Received scan request');
  try {
    const { input, walletAddress, chainIds: chainFilter, txHash } = req.body;
    const apiKey = req.body.apiKey || req.headers['x-api-key'];
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                  || req.socket?.remoteAddress || null;

    // Parse inputs
    let inputs = [];
    if (req.file) {
      const content = fs.readFileSync(req.file.path, 'utf-8');
      const records = parse(content, { columns: true, skip_empty_lines: true });
      inputs = records.map(r => r.address || r.input || Object.values(r)[0]).filter(Boolean);
      fs.unlinkSync(req.file.path);
    } else if (input) {
      inputs = Array.isArray(input) ? input : [input];
    }
    if (inputs.length === 0) return res.status(400).json({ error: 'No input provided' });

    // Early address type validation (Task 3)
    // If an input looks like a raw address (not a name, @handle, or domain), it must match a supported chain.
    // This prevents downstream Solana-specific code (txGraph etc.) from blowing up on BTC etc.
    for (const inp of inputs) {
      const trimmed = String(inp).trim();
      const looksLikeAddress = /^0x|^[13bcTGU]|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
      if (looksLikeAddress && !isSupportedAddress(trimmed)) {
        return res.status(400).json({
          error: `Unrecognised address format: ${trimmed}. Supported: EVM, Bitcoin, Solana, Tron, TON, XLM.`,
        });
      }
    }

    // Auth
    let effectiveWallet = walletAddress;
    if (apiKey) {
      const profiles = getProfiles();
      const match = Object.values(profiles).find(p => p.apiKey === apiKey);
      if (!match) return res.status(401).json({ error: 'Invalid API key' });
      effectiveWallet = match.address;
    }

    const allMethods = getMethods();
    const scanCtx    = { allMethods, chainFilter };

    // ── Full scan cache (single wallet, no payment needed on hit) ─────────
    if (inputs.length === 1) {
      const methodsHash  = computeMethodsHash(allMethods);
      const fullCacheKey = `fullscan:v1:${inputs[0]}:${methodsHash}`;
      const fullCached   = await getCachedResponse(fullCacheKey);
      if (fullCached) {
        console.log(`[checker] Cache hit for ${inputs[0]} (cached ${fullCached.cachedAt})`);
        return res.json({
          result:     fullCached.results,
          count:      fullCached.results.length,
          source:     'cache',
          cachedAt:   fullCached.cachedAt,
          ofac:       fullCached.ofac      || null,
          cex:        fullCached.cex       || null,
          verdict:    fullCached.verdict,
          confidence: fullCached.confidence,
          reasoning:  fullCached.reasoning,
          profile:    fullCached.profile   || null,
          freeScansLeft: effectiveWallet ? getFreeScansLeft(effectiveWallet) : null,
        });
      }
    }

    // ── Free tier / payment ───────────────────────────────────────────────
    const freeLeft = effectiveWallet ? getFreeScansLeft(effectiveWallet) : 0;
    const isFree   = freeLeft >= inputs.length;

    // Track how the scan was paid so we can distribute rewards correctly
    let paidFromBalance = false;

    if (!isFree) {
      const { total, perAddress } = calcScanCost(inputs.length);

      // 1. Check pre-deposited profile balance first (no on-chain tx needed)
      const profile        = effectiveWallet ? (getProfile(effectiveWallet) || {}) : {};
      const profileBalance = profile.balance ?? 0;

      if (profileBalance >= total) {
        // Deduct from pre-paid credits
        upsertProfile(effectiveWallet, { balance: profileBalance - total });
        paidFromBalance = true;
      } else if (!txHash) {
        // Neither balance nor tx hash — tell caller how much is needed
        return res.status(402).json({
          error:        'Payment required',
          required:     total,
          perAddress,
          count:        inputs.length,
          freeScansLeft: freeLeft,
          profileBalance,
        });
      } else {
        // Verify on-chain USDC/USDT transfer
        const isPaid = await verifyStablecoinTransfer(txHash, total, effectiveWallet);
        if (!isPaid) return res.status(402).json({
          error: `Payment not verified — expected $${(total / 1e6).toFixed(4)} USDC/USDT`,
        });
      }
    } else {
      if (effectiveWallet && isIpAbuse(clientIp, effectiveWallet))
        return res.status(403).json({ error: 'Free tier already used from this IP on another wallet' });
      if (effectiveWallet) recordIp(effectiveWallet, clientIp);
    }

    if (isFree && effectiveWallet) {
      for (let i = 0; i < inputs.length; i++) consumeFreeScan(effectiveWallet);
    }

    // ── Bulk: job queue ───────────────────────────────────────────────────
    if (inputs.length > 1) {
      const jobId = createJob(inputs, async input => {
        const results = await scanWallet(input, scanCtx);
        const ofac    = await checkOfacFull(input);
        if (ofac.sanctioned) {
          const cp = ofac.type === 'counterparty';
          results.unshift({
            input,
            methodId:    'ofac_check',
            description: `⛔ ${ofac.list || 'SANCTIONS'} — ${ofac.name}${ofac.program ? ` (${ofac.program})` : ''}${cp ? ` via counterparty ${ofac.matchedAddress?.slice(0, 10)}…` : ''}`,
            result:      false,
            ofac,
          });
        }
        const tetherBlacklist = checkTetherBlacklist(results);
        if (tetherBlacklist.blacklisted) {
          results.unshift({
            input,
            methodId:    tetherBlacklist.methodId,
            description: `⛔ ${tetherBlacklist.description}`,
            result:      true,
            tetherBlacklist: true,
          });
        }
        if (isInList('cex', input)) {
          results.unshift({
            input,
            methodId:    'cex_check',
            description: '🏦 CEX wallet — address belongs to a centralised exchange, not a human',
            result:      false,
            cex:         true,
          });
        }
        return results;
      });

      // Distribute rewards after job completes (fire-and-forget)
      if (!isFree && (txHash || paidFromBalance)) {
        const { total } = calcScanCost(inputs.length);
        const pollRewards = setInterval(() => {
          const job = getJob(jobId);
          if (!job || job.status !== 'done') return;
          clearInterval(pollRewards);
          const executedIds = [...new Set(job.results.map(r => r.methodId).filter(Boolean))];
          distributeRewards(total, executedIds, allMethods, brain.getWeights());
        }, 5000);
      }

      return res.json({
        jobId,
        status:    'queued',
        total:     inputs.length,
        pollUrl:   `/checker/job/${jobId}`,
        freeScansLeft: effectiveWallet ? getFreeScansLeft(effectiveWallet) : null,
      });
    }

    // ── Single wallet: sync (existing behaviour) ──────────────────────────
    const [results, ofac] = await Promise.all([
      scanWallet(inputs[0], scanCtx),
      checkOfacFull(inputs[0]),
    ]);
    const isCex = isInList('cex', inputs[0]);

    // Additional sanctions for badges (Task 4)
    const sanctionsCheck = isSanctioned(inputs[0]);
    const euHit = sanctionsCheck.list === 'EU' ? sanctionsCheck : null;
    const ukHit = sanctionsCheck.list === 'UK-FCDO' ? sanctionsCheck : null;

    if (ofac.sanctioned) {
      const cp = ofac.type === 'counterparty';
      results.unshift({
        input:       inputs[0],
        methodId:    'ofac_check',
        description: `⛔ OFAC SDN — ${ofac.name} (${ofac.program})${cp ? ` via counterparty ${ofac.matchedAddress?.slice(0, 10)}…` : ''}`,
        result:      false,
        ofac,
      });
    }
    if (isCex) {
      results.unshift({
        input:       inputs[0],
        methodId:    'cex_check',
        description: '🏦 CEX wallet — address belongs to a centralised exchange, not a human',
        result:      false,
        cex:         true,
      });
    }

    const tetherBlacklist = checkTetherBlacklist(results);
    if (tetherBlacklist.blacklisted) {
      results.unshift({
        input:       inputs[0],
        methodId:    tetherBlacklist.methodId,
        description: `⛔ ${tetherBlacklist.description}`,
        result:      true,
        tetherBlacklist: true,
      });
    }

    if (!isFree && (txHash || paidFromBalance)) {
      const { total } = calcScanCost(1);
      const executedIds = [...new Set(results.map(r => r.methodId).filter(Boolean))];
      distributeRewards(total, executedIds, allMethods, brain.getWeights());
    }

    const scanKey = inputs[0];
    brainPending[scanKey] = { status: 'pending', startedAt: Date.now() };
    res.json({
      result:   results,
      count:    results.length,
      source:   'processed',
      brainKey: scanKey,
      ofac:     ofac.sanctioned ? ofac : null,
      eu:       euHit,
      uk:       ukHit,
      cex:      isCex || null,
      freeScansLeft: effectiveWallet ? getFreeScansLeft(effectiveWallet) : null,
    });

    brain.analyzeHumanness(scanKey, results, allMethods)
      .then(async verdict => {
        // Hard override for Tether blacklist (Task 2) — on-chain fact trumps LLM
        const tetherHit = results.some(r => r.tetherBlacklist);
        if (tetherHit) {
          verdict = { verdict: 'AI', confidence: 0.99, reasoning: 'Address frozen by Tether USDT (blacklist)' };
        }
        brainPending[scanKey] = { status: 'done', ...verdict, signals: results };
        console.log(`[brain] Verdict for ${scanKey}: ${verdict.verdict} (${(verdict.confidence * 100).toFixed(0)}%)`);

        // ── Cache full scan bundle for 7 days ──────────────────────────────
        try {
          const methodsHash  = computeMethodsHash(allMethods);
          const fullCacheKey = `fullscan:v1:${scanKey}:${methodsHash}`;
          const counterparties = await getCounterparties(scanKey).catch(() => []);
          const profile = await enrichProfile(scanKey, counterparties);
          await setCachedResponse(fullCacheKey, {
            results,
            ofac:       ofac.sanctioned ? ofac : null,
            cex:        isCex || null,
            verdict:    verdict.verdict,
            confidence: verdict.confidence,
            reasoning:  verdict.reasoning,
            profile,
            cachedAt:   new Date().toISOString(),
          }, SCAN_CACHE_TTL);
          console.log(`[checker] Full scan cached for ${scanKey} (7 days)`);
        } catch (cacheErr) {
          console.warn('[checker] Failed to cache full scan:', cacheErr.message);
        }
      })
      .catch(err => {
        brainPending[scanKey] = { status: 'error', reasoning: err.message };
        console.error('[brain] analyzeHumanness failed:', err.message);
      });

  } catch (err) {
    next(err);
  }
});

// ── GET /checker/job/:jobId ───────────────────────────────────────────────────

router.get('/job/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    jobId:       job.id,
    status:      job.status,
    total:       job.total,
    done:        job.done,
    percent:     Math.round((job.done / job.total) * 100),
    results:     job.results,
    errors:      job.errors,
    createdAt:   job.createdAt,
    completedAt: job.completedAt,
  });
});

// ── GET /checker/brain/:key ───────────────────────────────────────────────────

router.get('/brain/:key', (req, res) => {
  const entry = brainPending[req.params.key];
  if (!entry) return res.json({ status: 'not_found' });
  res.json(entry);
});

// ── POST /checker/feedback ────────────────────────────────────────────────────
// Body: { brainKey, address, aiVerdict, correction: 'HUMAN'|'AI', comment? }

router.post('/feedback', async (req, res) => {
  const { brainKey, address, aiVerdict, correction, comment } = req.body || {};
  if (!address || !aiVerdict || !correction) {
    return res.status(400).json({ error: 'address, aiVerdict and correction are required' });
  }
  if (!['HUMAN', 'AI', 'UNCERTAIN'].includes(correction)) {
    return res.status(400).json({ error: 'correction must be HUMAN, AI, or UNCERTAIN' });
  }

  // Grab the signals from the stored verdict if available
  const entry = brainKey ? brainPending[brainKey] : null;
  const signals = entry?.signals || [];

  // Fire-and-forget — don't block the response on LLM call
  brain.onVerdictFeedback(address, aiVerdict, correction, comment || null, signals)
    .catch(err => console.error('[feedback] onVerdictFeedback failed:', err.message));

  res.json({ ok: true });
});

// ── GET /checker/particles — background animation data from cached profiles ───
// Returns a flat list of particles: { kind, label, avatar?, address? }
// Kinds: 'address' | 'name' | 'domain' | 'handle' | 'avatar'
// Falls back to a built-in seed list when the cache is sparse.

const PARTICLE_SEED = [
  { kind:'address', label:'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { kind:'address', label:'0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B' },
  { kind:'address', label:'0x4Fabb145d64652a948d72533023f6E7A623C7C53' },
  { kind:'address', label:'0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE' },
  { kind:'name',    label:'Vitalik Buterin' },
  { kind:'name',    label:'hayden.eth' },
  { kind:'name',    label:'stani.eth' },
  { kind:'name',    label:'dwr.eth' },
  { kind:'name',    label:'jessepollak.eth' },
  { kind:'domain',  label:'vitalik.eth' },
  { kind:'domain',  label:'uniswap.eth' },
  { kind:'domain',  label:'aave.eth' },
  { kind:'domain',  label:'lens.xyz' },
  { kind:'domain',  label:'ens.eth' },
  { kind:'handle',  label:'@VitalikButerin' },
  { kind:'handle',  label:'@hayden' },
  { kind:'handle',  label:'@jessepollak' },
  { kind:'handle',  label:'@dwr' },
  { kind:'handle',  label:'@stani' },
  { kind:'handle',  label:'@camila' },
];

router.get('/particles', async (req, res) => {
  try {
    const profiles = await getSampleProfiles(80);
    const particles = [];

    for (const p of profiles) {
      if (p.address) {
        particles.push({ kind: 'address', label: p.address, address: p.address });
      }
      if (p.displayName && p.displayName !== p.address) {
        particles.push({ kind: 'name', label: p.displayName, avatar: p.avatar || null, address: p.address });
      }
      if (p.avatar) {
        particles.push({ kind: 'avatar', label: p.displayName || '', avatar: p.avatar, address: p.address });
      }
      for (const d of p.domains || []) {
        if (d.name) particles.push({ kind: 'domain', label: d.name, address: p.address });
      }
      for (const h of p.handles || []) {
        const tag = h.identity.startsWith('@') ? h.identity : '@' + h.identity;
        particles.push({ kind: 'handle', label: tag, platform: h.platform, address: p.address });
      }
      if (p.link3) {
        particles.push({ kind: 'handle', label: '@' + p.link3, platform: 'link3', address: p.address });
      }
    }

    // Pad with seed items so there are always enough particles even on a fresh install
    if (particles.length < 30) {
      for (const s of PARTICLE_SEED) {
        if (!particles.find(p => p.label === s.label)) particles.push(s);
      }
    }

    // Shuffle
    for (let i = particles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [particles[i], particles[j]] = [particles[j], particles[i]];
    }

    res.set('Cache-Control', 'public, max-age=60');
    res.json(particles.slice(0, 120));
  } catch (err) {
    res.json(PARTICLE_SEED);
  }
});

// ── GET /checker/pricing?count=N ─────────────────────────────────────────────

router.get('/pricing', (req, res) => {
  const count = Math.max(1, parseInt(req.query.count) || 1);
  const { total, perAddress } = calcScanCost(count);
  res.json({
    count, perAddress, total,
    currency: 'USDC/USDT',
    tiers: [
      { minAddresses: 1, rate: 0.001, label: 'Any volume — $1 per 1000 scans' },
    ],
  });
});

// ── GET /checker/resolve?q= — resolve any identity to wallet address(es) ──────
// Accepts:
//   • EVM / Solana address → returned as-is
//   • ENS / .sol / ZNS domain → resolved via existing resolvers
//   • platform:handle  (e.g. twitter:VitalikButerin, farcaster:dwr, lens:vitalik.lens)
//   • @handle          → tries Farcaster first, then Twitter via web3.bio
//   • free-text name   → web3.bio /search endpoint
//
// Returns: { results: [{ address, platform, handle, displayName, avatar }] }

const WEB3BIO_API = 'https://api.web3.bio';

async function resolveIdentity(raw) {
  const q = raw.trim();
  if (!q) return [];

  const isEvmAddr    = /^0x[0-9a-fA-F]{40}$/.test(q);
  const isBitcoin    = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(q);
  const isTron       = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(q);
  const isTon        = /^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(q);
  const isXlm        = /^G[A-Z2-7]{55}$/.test(q);
  const isSolanaAddr = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) && !isTron;

  if (isEvmAddr || isSolanaAddr || isBitcoin || isTron || isTon || isXlm) {
    return [{ address: q, platform: null, handle: null, displayName: null, avatar: null }];
  }

  // Helper: fetch web3.bio profile for an identity string → array of profile objects
  async function w3bProfile(identity) {
    try {
      const res = await axios.get(`${WEB3BIO_API}/profile/${encodeURIComponent(identity)}`,
        { timeout: 7000, validateStatus: () => true });
      if (!Array.isArray(res.data) || !res.data.length) return [];
      return res.data;
    } catch { return []; }
  }

  // Helper: turn a web3.bio profile array into result items (de-dup by address)
  function toResults(profiles) {
    const seen = new Set();
    const out  = [];
    for (const p of profiles) {
      const addr = p.address;
      if (!addr || seen.has(addr.toLowerCase())) continue;
      seen.add(addr.toLowerCase());
      out.push({
        address:     addr,
        platform:    p.platform  || null,
        handle:      p.identity  || null,
        displayName: p.displayName || null,
        avatar:      p.avatar    || null,
      });
    }
    return out;
  }

  // ── platform:handle syntax ────────────────────────────────────────────────
  const colonIdx = q.indexOf(':');
  if (colonIdx > 0 && colonIdx < 20 && !q.startsWith('0x') && !q.includes('://')) {
    const platform = q.slice(0, colonIdx).toLowerCase().trim();
    const handle   = q.slice(colonIdx + 1).replace(/^@/, '').trim();
    if (handle) {
      // web3.bio understands "twitter,handle", "farcaster,handle", etc.
      const identity = `${platform},${handle}`;
      const profiles = await w3bProfile(identity);
      if (profiles.length) return toResults(profiles);
      // fallback: try bare handle
      const fallback = await w3bProfile(handle);
      return toResults(fallback);
    }
  }

  // ── @handle → Farcaster / Twitter via web3.bio ────────────────────────────
  if (q.startsWith('@')) {
    const handle   = q.slice(1);
    const profiles = await w3bProfile(`farcaster,${handle}`);
    if (profiles.length) return toResults(profiles);
    const tw = await w3bProfile(`twitter,${handle}`);
    if (tw.length) return toResults(tw);
    // last-ditch: bare handle
    return toResults(await w3bProfile(handle));
  }

  // ── known domain suffixes → existing domain resolvers ────────────────────
  const lq  = q.toLowerCase();
  const tld = lq.split('.').pop();
  if (lq.endsWith('.sol')) {
    try {
      const res = await axios.get(
        `https://sns-sdk-proxy.bonfida.workers.dev/resolve/${lq.slice(0, -4)}`,
        { timeout: 5000 }
      );
      if (res.data?.result) return [{ address: res.data.result, platform: 'sns', handle: q, displayName: null, avatar: null }];
    } catch { /* fall through */ }
  }
  if (lq.endsWith('.eth') || lq.endsWith('.bnb') || lq.endsWith('.base') || lq.endsWith('.arb')) {
    try {
      const res = await axios.get('https://nameapi.space.id/getAddress', { params: { domain: lq }, timeout: 5000 });
      if (res.data?.code === 0 && res.data.address) {
        return [{ address: res.data.address, platform: 'ens', handle: q, displayName: null, avatar: null }];
      }
    } catch { /* fall through */ }
    // Try web3.bio for ENS-style names
    const profiles = await w3bProfile(lq);
    if (profiles.length) return toResults(profiles);
  }
  if (ZNS_TLD_CHAIN[tld]) {
    const resolved = await resolveZnsDomain(lq);
    if (resolved) return [{ address: resolved, platform: 'zns', handle: q, displayName: null, avatar: null }];
  }

  // ── free text / bare handle — no dot, no prefix ─────────────────────────
  // web3.bio /search only accepts valid identity handles, not display names.
  // Strategy:
  //   1. Try exact handle on web3.bio (/profile/{q})
  //   2. If input has spaces (display name like "Vitalik Buterin"):
  //      a. Each word as a handle with common TLDs (.eth, .lens, .fc)
  //      b. Concatenated no-space version, with same TLDs
  //   3. Single word with common TLDs (.eth first — most likely for human names)
  const lq2    = q.toLowerCase().trim();
  const words  = lq2.split(/\s+/).filter(Boolean);
  const noSpace = words.join('');
  const TLDS   = ['.eth', '.lens', '.fc', '.base', '.bnb'];

  // 1. Exact handle
  const exactProfiles = await w3bProfile(lq2);
  if (exactProfiles.length) return toResults(exactProfiles);

  // Build candidate list
  const candidates = new Set();
  if (words.length > 1) {
    // multi-word: each word + concatenated, with TLDs
    for (const word of words) {
      for (const tld of TLDS) candidates.add(word + tld);
    }
    for (const tld of TLDS) candidates.add(noSpace + tld);
    candidates.add(noSpace); // bare concatenated
  } else {
    // single word: try with TLDs
    for (const tld of TLDS) candidates.add(lq2 + tld);
  }

  // Fan out in parallel batches of 4 to stay under rate limits
  const candidateArr = [...candidates];
  for (let i = 0; i < candidateArr.length; i += 4) {
    const batch = candidateArr.slice(i, i + 4);
    const settled = await Promise.allSettled(batch.map(c => w3bProfile(c)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value.length) {
        const results = toResults(r.value);
        if (results.length) return results;
      }
    }
  }

  return [];
}

router.get('/resolve', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q param required' });
    const results = await resolveIdentity(q);
    res.json({ query: q, results });
  } catch (err) { next(err); }
});

// ── POST /checker/preview ─────────────────────────────────────────────────────
// Test a method definition against an address without writing to dataset.
// Body: { address, method: { type, address, method, expression, ... } }

router.post('/preview', async (req, res) => {
  const { address, method: m } = req.body || {};
  if (!address || !m) return res.status(400).json({ error: 'address and method required' });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout after 8s')), 8000)
  );

  const serialize = v => {
    if (typeof v === 'bigint') return v.toString();
    if (Array.isArray(v)) return v.map(serialize);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, serialize(val)]));
    }
    return v;
  };

  const run = (async () => {
    if (m.type === 'evm') {
      const { ethers } = require('ethers');
      const rpcUrl   = getRpcUrl(Number(m.chainId));
      const decimals = m.decimals != null ? Number(m.decimals) : 18;
      const network  = new ethers.Network(String(m.chainId), Number(m.chainId));
      let result;
      if (m.method === 'eth_getBalance') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [await p.getBalance(address)];
      } else if (m.method === 'eth_getTransactionCount') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [BigInt(await p.getTransactionCount(address))];
      } else if (m.method === 'eth_getCode') {
        const p = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        result = [await p.getCode(address)];
      } else {
        result = await callContract(rpcUrl, m.address, m.method,
          JSON.parse(m.abiTypes || '[]'), JSON.parse(m.returnTypes || '[]'),
          [address, ...(m.extraParams ? JSON.parse(m.extraParams) : [])], m.chainId);
      }
      const expressionResult = await evaluate(m.expression, { result, decimals }, m.lang || 'js');
      return { rawResult: serialize(result), expressionResult };

    } else if (m.type === 'rest') {
      const rawUrl    = m.address;
      const hasHolder = rawUrl.includes('{address}');
      const url       = hasHolder ? rawUrl.replace(/\{address\}/g, encodeURIComponent(address)) : rawUrl;
      const method    = (m.method || 'GET').toUpperCase();
      const headers   = m.headers
        ? (typeof m.headers === 'string' ? JSON.parse(m.headers) : m.headers)
        : {};
      const decimals  = m.decimals != null ? Number(m.decimals) : 18;
      const validate  = s => s < 500;
      let response;
      if (method === 'POST') {
        const body = JSON.parse((m.body || '{}').replace(/\{address\}/g, address));
        response = await axios.post(url, body, { headers, timeout: REST_AXIOS_TIMEOUT_MS, validateStatus: validate });
      } else {
        const params = hasHolder ? {} : { address };
        response = await axios.get(url, { params, headers, timeout: REST_AXIOS_TIMEOUT_MS, validateStatus: validate });
      }
      const expressionResult = await evaluate(
        m.expression, { data: response.data, status: response.status, decimals }, m.lang || 'js'
      );
      return { rawResult: { status: response.status, data: response.data }, expressionResult };

    } else if (m.type === 'solana') {
      const { Connection, PublicKey }              = require('@solana/web3.js');
      const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
      const conn     = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const pubkey   = new PublicKey(address);
      const decimals = m.decimals != null ? Number(m.decimals) : 9;
      let result = null;
      if (m.method === 'getBalance') {
        result = await conn.getBalance(pubkey);
      } else if (m.method === 'getTransactionCount') {
        result = await conn.getTransactionCount(pubkey);
      } else if (m.method === 'getTokenBalance' && m.address) {
        const mint    = new PublicKey(m.address);
        const ata     = await getAssociatedTokenAddress(mint, pubkey);
        const account = await getAccount(conn, ata);
        result = Number(account.amount);
      } else if (m.method === 'getAccountInfo') {
        const info = await conn.getAccountInfo(pubkey);
        result = info?.executable ?? false;
      } else if (m.method === 'getProgramAccounts' && m.address) {
        const programId = new PublicKey(m.address);
        const accounts  = await conn.getProgramAccounts(programId, {
          filters: [{ memcmp: { offset: 8, bytes: address } }],
        });
        result = accounts.length > 0;
      }
      const expressionResult = await evaluate(m.expression, { result, decimals }, m.lang || 'js');
      return { rawResult: serialize(result), expressionResult };
    }
    throw new Error('Unknown method type: ' + m.type);
  })();

  try {
    const result = await Promise.race([run, timeout]);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ── GET /checker/profile/:address — enriched wallet profile ──────────────────

router.get('/profile/:address', async (req, res) => {
  const { address } = req.params;
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const profileCacheKey = `profile:v1:${address}`;
    const cachedProfile   = await getCachedResponse(profileCacheKey);
    if (cachedProfile) return res.json(cachedProfile);

    // Reuse counterparty cache if address was recently scanned (zero extra calls)
    const counterparties = await getCounterparties(address);
    const profile = await enrichProfile(address, counterparties);
    await setCachedResponse(profileCacheKey, profile, SCAN_CACHE_TTL);
    res.json(profile);
  } catch (err) {
    console.error('[profile] enrichment failed:', err.message);
    res.status(500).json({ error: 'Profile enrichment failed' });
  }
});

module.exports = router;
