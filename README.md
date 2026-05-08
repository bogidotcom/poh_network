# Proof of Human Network (POH)

A decentralized, AI-enhanced verification layer that identifies human vs. automated behaviour across EVM and Solana ecosystems. Detection methods are community-submitted and community-curated; an on-device multi-role AI brain produces weighted verdicts in real time.

---

## Quick Start

```bash
# Install dependencies (backend + frontend)
npm install
cd frontend && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env — minimum required: SOLANA_RPC, FEE_RECIPIENT
# Optional but recommended:
#   ETHERSCAN_API_KEY  — tx graph analysis on ETH / Base / Arbitrum (free at etherscan.io)
#   QVAC_URL           — set to http://localhost:11435 to enable Qvac brain (recommended)

# Pull Ollama fallback models (used only when Qvac is unavailable)
ollama pull qwen2.5:1.5b      # Learner + Evaluator fallback
ollama pull deepseek-r1:1.5b  # Evaluator fallback
ollama pull mixtral            # Compiler fallback

# Install Qvac CLI + SDK (primary AI runtime for all 3 brain roles)
npm install -g @qvac/cli @qvac/sdk
# Qvac auto-starts via yarn dev:all. Model config in qvac.config.json (Qwen3-8B by default).

# Start everything (Redis + Ollama + Qvac + backend + frontend)
npm run dev:all        # hot-reload (nodemon + vite dev server)
npm run start:all      # production build

# Redis must be installed separately:
# sudo apt-get install -y redis-server && sudo systemctl enable --now redis-server
```

Runs at **http://localhost:3000** (backend + built frontend).  
Dev frontend: **http://localhost:5173**

---

## Architecture

```
poh/dev/
├── src/
│   ├── server.js              Express entry — routes, config endpoint, static
│   ├── routes/
│   │   ├── checker.js         POST /checker — scan address against all methods
│   │   ├── methods.js         POST /methods/listing, GET/POST /methods/verifyer
│   │   ├── profile.js         GET/POST /profile — signup, API keys, rewards, faucet
│   │   ├── abi.js             GET /abi/evm, GET /abi/solana (ABI/IDL fetch)
│   │   ├── evm.js             POST /evm — raw EVM contract eval
│   │   └── rest.js            POST /rest — raw REST eval
│   ├── eval/
│   │   └── evaluator.js       Multi-language expression sandbox (JS/Go/Rust/PHP/Java)
│   └── utils/
│       ├── brain.js           Multi-role AI brain (Evaluator · Learner · Compiler)
│       ├── txGraph.js         Transaction graph analysis — counterparty diversity, timing CV
│       ├── profiles.js        Profile storage — API keys, balances, votes, rewards
│       ├── jobQueue.js        Async job queue — bulk scans, 2 concurrent jobs, 5 wallets/batch
│       ├── scheduler.js       Hourly brain consolidation via node-cron
│       ├── redis.js           Response cache (falls back to in-memory)
│       ├── solana.js          Solana RPC helpers (balance, SPL token, burn verify)
│       └── evm.js             EVM RPC helpers (callContract, toHexSelector)
├── frontend/
│   └── src/components/
│       └── HumanPower.vue     Vue 3 SPA — Landing / Scanner / Listing / Votes / Profile
├── data/
│   ├── methods.json           Registered detection methods
│   ├── weights.json           Per-method AI weights (updated by Learner role)
│   ├── dataset.json           Scan + vote training records (Alpaca format)
│   ├── profiles.json          User profiles, API keys, balances
│   ├── rewards.json           Per-method scan earnings and pending withdrawals
│   ├── method_health.json     Per-method pass/fail stats
│   ├── feedback.json          Verdict correction records (👍/👎 from users)
│   └── brain_state.md         Compiler output — compact system summary (updated hourly)
└── scripts/
    ├── setup.sh               Server provisioning — installs Node, Ollama, Qvac, Redis, builds app
    ├── deploy.sh              One-command deploy to remote server via SSH
    ├── launch.js              Orchestrator: Redis · Ollama · Qvac · backend · frontend
    ├── start-ollama.js        Ensures dedicated Ollama instance on :11434
    └── start-qvac.js          Ensures Qvac OpenAI-compatible server on :11435
```

---

## Core APIs

### `POST /checker`
Scans one or more wallet addresses against all registered methods.

| Field | Description |
|---|---|
| `input` | EVM address, Solana base58, ZNS domain (`.eth`, `.bnb`, `.defi`…), or array |
| `walletAddress` | Connected wallet (for free-tier tracking) |
| `apiKey` | API key from profile (alternative to `walletAddress`) |
| `txHash` | POH burn transaction hash (required for paid scans) |
| `chainIds` | Optional EVM chain filter, e.g. `1,56` |
| `csv` | Multipart CSV upload with `address` column (bulk mode) |

**Single address** → synchronous `{ result, count, brainKey, freeScansLeft }`.  
**Multiple addresses / CSV** → async `{ jobId, status: "queued", total, pollUrl }`.

### `GET /checker/job/:jobId`
Poll the status of a bulk scan job. Retained for 2 hours after completion.

```json
{
  "jobId": "...",
  "status": "queued | running | done",
  "total": 1000,
  "done": 423,
  "percent": 42,
  "results": [...],
  "errors": [...]
}
```

**Concurrency limits:** 2 jobs run simultaneously; within each job, 5 wallets are processed in parallel. Up to 10 concurrent API requests map onto 2 running jobs — additional jobs queue automatically.

```js
// Poll until complete
async function pollJob(jobId) {
  while (true) {
    const job = await fetch(`/checker/job/${jobId}`).then(r => r.json())
    if (job.status === 'done') return job.results
    await new Promise(r => setTimeout(r, 3000))
  }
}
```

### `GET /checker/brain/:key`
Poll for the async AI verdict after a single-wallet scan. `brainKey` is returned by `POST /checker`.

```json
{
  "status": "done",
  "verdict": "HUMAN | AI | UNCERTAIN",
  "confidence": 0.0,
  "reasoning": "...",
  "signal_contributions": { "method_name": 0.0 },
  "conflicts": []
}
```

### `GET /checker/pricing?count=N`
Returns cost breakdown for a given batch size before committing.

```json
{ "count": 100, "perAddress": 0.55, "total": 55000000, "tiers": [...] }
```

### `POST /methods/listing`
Register a new detection method. Costs **0.01 SOL** per method.

Supported types: `evm` · `solana` · `rest`

### `GET /methods/verifyer`
Returns all registered methods for the community voting queue.

### `POST /methods/verifyer/vote`
Community vote on a method. Vote weight is proportional to POH token stake. Uses ed25519 `signMessage` — no on-chain transaction required.

| Field | Type |
|---|---|
| `methodId` | string |
| `type` | `description` \| `method` \| `risk` |
| `vote` | boolean |
| `walletAddress` | string |
| `signature` | string — base58 ed25519 signature of `poh-vote-v1:{methodId}:{vote}:{timestamp}` |
| `message` | string — the signed message |
| `feedback` | string (optional) — LLM-validated before storing |

### `POST /methods/verifyer/validate-feedback`
LLM pre-check for vote feedback and method descriptions. Rejects gibberish, spam, and off-topic content.

```json
{ "feedback": "your comment", "context": "vote | description" }
→ { "valid": true | false, "reason": "..." }
```

### `GET /abi/evm?address=&chainId=`
Fetches verified ABI from Etherscan → Sourcify fallback. Returns function list with input/output types for the listing UI picker.

### `GET /abi/solana?programId=`
Fetches Anchor IDL from apr.dev registry or on-chain IDL account.

---

## Profile API

### `POST /profile/signup`
Create or update a profile. Requires ed25519 signature of `poh-profile-v1:{address}:{timestamp}`.

Returns `{ profile: { apiKey, balance, freeScansLeft, totalScans, stakedAmount } }`.

### `GET /profile/:address`
Returns profile stats, submitted methods, and reward totals.

### `GET /profile/:address/votes`
Returns the wallet's full vote history with method descriptions and feedback.

### `POST /profile/deposit`
Credit profile balance from a verified POH token transfer.

### `POST /profile/claim`
Withdraw off-chain balance + scan earnings as on-chain POH tokens.

### `POST /profile/apikey/rotate`
Rotate the API key for a profile.

### `GET /profile`
Leaderboard — top 20 method earners by total POH earned.

### `POST /profile/faucet`
**Devnet only.** Sends 10 000 POH to the caller. 24-hour cooldown per address.

---

## AI Brain

POH runs a **multi-role brain** entirely on-device. All three roles route through **Qvac** as primary, with Ollama as automatic fallback if Qvac's circuit breaker opens.

### Qvac (primary — all roles)

[Qvac](https://qvac.tether.io) is Tether's on-device OpenAI-compatible inference server. POH ships with `qvac.config.json` pre-configured for **Qwen3-8B Q4_K_M** — downloaded automatically on first start (~4.7 GB).

```bash
# Already handled by yarn dev:all / yarn start:all.
# Manual start:
yarn qvac

# .env:
QVAC_URL=http://localhost:11435
QVAC_MODEL=evaluator
```

Config (`qvac.config.json`):
```json
{
  "serve": {
    "models": {
      "evaluator": {
        "model": "QWEN3_8B_INST_Q4_K_M",
        "default": true,
        "preload": true,
        "config": { "ctx_size": 8192 }
      }
    }
  }
}
```

Any OpenAI-compatible server works in place of Qvac (LM Studio, llama.cpp ≥ b3670, Ollama with `/v1` prefix).

### Ollama (fallback models)

```bash
ollama pull qwen2.5:1.5b      # Learner + Evaluator fallback
ollama pull deepseek-r1:1.5b  # Evaluator fallback
ollama pull mixtral            # Compiler fallback
```

Ollama is used automatically only when Qvac is unavailable (circuit breaker open after 3 consecutive failures, retries every 5 minutes).

### Role 1 — Evaluator (`analyzeHumanness`)
Called after every scan. Uses strict signal interpretation — no free-form guessing.

- Sends all passing signals + top-10 failing signals by weight (compact format)
- Scores each signal contribution, detects conflicts between signals
- Weak or conflicting signals → outputs `UNCERTAIN` instead of a false positive
- Runs a **second verification pass**: checks overconfidence (>0.85 requires strong multi-signal support) and ignored weights
- Injects the last 5 user verdict corrections into the prompt to learn from past mistakes

**Output schema:**
```json
{
  "verdict": "HUMAN | AI | UNCERTAIN",
  "confidence": 0.82,
  "signal_contributions": { "ETH Balance": 0.4, "ENS Name": 0.3 },
  "conflicts": [],
  "reasoning": "strong on-chain activity across 3 independent signals"
}
```

### Role 2 — Learner (`onVote`, `onVerdictFeedback`)
Called on every community vote and every user verdict correction (👍/👎).

- Adjusts per-method weights gradually — max ±0.05 per vote
- Weights clamped to 0.1–3.0; no single action can cause large drift
- Records corrections to `data/feedback.json`; appends insights to `brain_state.md`
- User 👎 feedback identifies misleading signals (−0.03 weight); 👍 reinforces them (+0.02)

### Role 3 — Compiler (`consolidate`)
Runs hourly via scheduler. Rewrites `data/brain_state.md`.

- Reads top/weak methods by weight, last 8 scans, last 8 votes
- Outputs a ≤400-word technical summary — no speculation, no repetition

### Method assessment (`onNewMethod`)
Called when a listing is submitted. Evaluates signal quality and edge-case risk (`none | low | medium | high`). Result is appended to `brain_state.md`.

### JSON contract enforcement
All brain calls use `evaluatorChatJSON()` / `learnerChatJSON()` / `compilerChat()`:
1. Extracts the first `{...}` block from model output (handles `<think>` blocks and markdown fences)
2. Validates required fields are present
3. On failure, retries once with explicit field list

---

## Transaction Graph Analysis

Every scan automatically runs `src/utils/txGraph.js` in parallel with the registered detection methods. It fetches the last 50 transactions and computes:

| Metric | Signal |
|---|---|
| `uniqueCounterparties` | Low count → bot (interacts with few addresses) |
| `repeatRatio` | High → bot (same counterparties over and over) |
| `timingCv` | Low (< 0.3) → bot (regular intervals = scripted) |
| `selfRatio` | High → bot (self-transfers, wash activity) |

A result is `true` (human signal) when: ≥ 8 unique counterparties, repeat ratio < 50%, self-transfer ratio < 30%, timing CV > 0.3.

**Data sources:**

| Chain | Source |
|---|---|
| ETH | Etherscan v2 API (`ETHERSCAN_API_KEY`) |
| Base | Etherscan v2 API (`ETHERSCAN_API_KEY`) |
| Arbitrum | Etherscan v2 API (`ETHERSCAN_API_KEY`) |
| BNB | Alchemy `getAssetTransfers` (`RPC_56`) |
| Solana | `getSignaturesForAddress` + `getTransaction` via `SOLANA_RPC` |

Results appear in the scan output as `tx_graph_eth`, `tx_graph_base`, etc. and are included in the brain's verdict context.

---

## Expression Sandbox

Methods use expressions evaluated in a sandboxed VM. Available variables:

| Variable | Type | Description |
|---|---|---|
| `result` | `any[]` | ABI-decoded return values (EVM) |
| `data` | `object` | Parsed response body (REST) |
| `status` | `number` | HTTP status code (REST) |
| `decimals` | `number` | Configured decimals (default: 18 EVM, 9 Solana) |

```js
result[0] > 0n                           // BigInt token balance > 0
result[0] / 10n ** BigInt(decimals) > 1  // normalised balance > 1
data.has_active_stake === 1              // REST field check
data.totalCount > 0                      // NFT count
```

Supported languages: **JS · Go · Rust · PHP · Java** (all normalised to JS sandbox internally)

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js · Express · ethers.js v6 · @solana/web3.js |
| Frontend | Vue 3 · Vite · Lucide icons |
| AI (all roles — primary) | Qvac 0.3.0 · Qwen3-8B Q4_K_M · 8192 ctx |
| AI (all roles — fallback) | Ollama — qwen2.5:1.5b · deepseek-r1:1.5b · mixtral |
| Tx graph | Etherscan v2 (ETH · Base · Arbitrum) · Alchemy (BNB) · Solana RPC |
| Cache | Redis (in-memory fallback) |
| Scheduler | node-cron (hourly brain consolidation) |
| Wallet | @solana/wallet-adapter (Phantom · Solflare · Coinbase · Trust · Ledger · Torus · Nightly + Wallet Standard) |
| Multi-chain | 32 EVM chains via Alchemy + built-in RPC registry |

---

## Community

- Telegram: https://t.me/poh_network_group  
- X / Twitter: https://x.com/poh_network

---
