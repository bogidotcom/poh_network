# Brain State — Last updated: 2026-06-05T00:00:00.000Z

## Genesis Knowledge Base

### What PoH Is
Proof of Human (POH) is a decentralized, AI-augmented protocol for on-chain human identity verification. It replaces centralized KYC and static allow-lists with a permissionless, stake-weighted signal market: any party registers a verification method ("signal"), the community votes on its validity, and a local AI brain fuses signal weights into a probabilistic HUMAN / BOT / UNCERTAIN verdict for any queried wallet. Signal tokens launched on Meteora Dynamic Bonding Curves ("Conviction Curves") add market-pricing — price action is a manipulation-resistant confidence signal feeding directly into the AI decision engine.

### Ecosystem Overview
- **proofofhuman.ge** — main web app (frontend + backend Node.js); profiles, scanner, voting, conviction curves, listing
- **PoH Miner Network** — decentralized compute layer; miners race to run inference on scan jobs, earn POH via block rewards + job fees
- **PoH Miner Wallet** — React Native mobile app (Android live, iOS beta); balance, send/receive, AI scanner, QR scan
- **PoH Electron Desktop** — Electron GUI for the miner node; logs, chat (LLM), identity scanner, send/receive, brain sidebar
- **Staking Program** — Anchor/Solana on-chain program for staking POH, voting on signals, claiming rewards
- **SDKs** — TypeScript/JS, Python, Rust, iOS, Android, drop-in widget (reCAPTCHA-style)

### Token Economics
- **POH token**: SPL, 9 decimals. Listing fee: 1,000 POH (500 → deployer, 500 → staker fee vault). Scan fee: $0.001/scan (USDC/USDT). First 100 scans free per wallet.
- **Block reward**: 1 POH per block — 60% to block proposer, 40% split among workers whose results were included.
- **Fair launch**: 80% community rewards, 20% team (1-month cliff, 6-month vesting).
- **Staking**: Non-custodial, stake weight = walletStaked / totalStaked. Vote impact = 1 + stakeWeight × 9 (range [1, 10]). Graduated pool signals get 1.5× multiplier.

### Signal Types
Three signal types supported:
- **EVM**: Call an EVM view function (chainId, address, method, abiTypes, returnTypes, expression)
- **Solana**: Read a Solana account/program state (address, method, expression)
- **REST**: HTTP GET/POST endpoint (address=URL, headers, body, expression)
Results are JS-expression normalized into a score ∈ ℝ. Stored in `data/methods.json` (150 signals as of June 2026).

### Conviction Curves
Each signal can have a Meteora DBC (Dynamic Bonding Curve) pool. Parameters:
- 1B token supply (6 decimals), SOL quote, 1% bonding fee, 4% creator trading fee
- 10 SOL graduation threshold → DAMM V2 migration → 1.5× weight multiplier
- Pool deploy cost: 0.1 SOL (0.021 rent + 0.079 auto-buy tokens for creator)
- LP: 100% permanently locked (rug-pull prevention)
- Pool creation: 2 sequential txs (TX1: 629 bytes config; TX2: 888 bytes pool+buy)
- Referral: `/?ref={wallet}&signal={methodId}` → 20% of Meteora's protocol fee

### Voting Mechanics
- Vote types: `description` (is description accurate?), `method` (is implementation valid?)
- Boolean (true/false). One vote per wallet per signal.
- Score update: `score += vote ? +impact : -impact`; `newWeight = oldWeight × (1 + stakeWeight × 0.1 × (vote ? 1 : -1))`, bounded [0.01, 10.0]
- Anti-replay: ed25519 signature over `poh-vote-v1:{methodId}:{vote}:{type}:{wallet}:{timestamp_ms}`, 5-minute window, recorded and rejected on reuse

### AI Brain Architecture
- **BASE model**: Qwen2.5 (Ollama) — general reasoning, feedback
- **EVALUATOR model**: Qvac SDK (QWEN3_8B_INST_Q4_K_M) — probabilistic verdict; cascades from fast to heavy model if confidence < 0.72 or verdict UNCERTAIN or negative signal hit
- **LEARNER model**: Qwen2.5:1.5b — weight updates on votes, feedback processing
- **COMPILER model**: Periodic consolidation of brain state narrative
- **Verdict pipeline**: execute signals in parallel → normalize → weight by `signal_weight × graduation_mult` → structured prompt → EVALUATOR → {verdict, confidence, reasoning}
- **Continuous learning**: every vote triggers LEARNER; every feedback correction updates brain_state.md; COMPILER periodically synthesizes compressed state
- **Signal strength**: `score × (1 + ln(1 + supply/100) × 0.3) × graduationMult`
- **vibe check**: After verdict, fetch Farcaster casts + Paragraph posts → LLM generates {vibe, topics, humanSignals}

### Miner Network
- **Consensus**: Useful PoW + lightweight SHA-256 puzzle; longest-chain with chainWork fork resolution; planned: CometBFT BFT finality
- **Block**: height, previousHash, timestamp, minerWallet, scanResults[], transactions[], coinbaseReward, nonce, difficulty, chainWork, minerSignature
- **P2P**: gossip for `new-block`, `new-tx`, `node-status` (TTL=4); HTTP pull for chain history; IPFS for snapshots/fallback
- **Job routing**: geo-aware scoring — `score = fee × geoMultiplier × loadPenalty`; same-region = up to 2.2× multiplier
- **Work verification**: must use current canonical methodsHash, ≥75% live curve-backed signals, full output (verdict+profile+reasoning), plausible compute time
- **Wallet API** (port 3456): `/status`, `/api/wallet/balance`, `/api/wallet/transactions`, `/api/wallet/send`, `/job`, `/job/:id/result`, `/api/chat`, `/api/brain/state`, `/api/brain/weights`, `/api/brain/feedback`
- **Default bootnode**: `https://bootnode.proofofhuman.ge`; default node: `https://miner.proofofhuman.ge`

### Mobile Wallet (React Native)
- Multi-wallet (create/import PoH addresses), live balance polling (~8s), send/receive with QR scanner
- AI Scanner tab: human/AI verdict + OFAC/EU/UK sanctions + social vibe (Farcaster + Paragraph)
- 16 languages, push notifications, multi-node failover, IPFS peer discovery fallback
- Transaction amounts in μPOH (1 POH = 1,000,000,000 μPOH)
- Screens: HomeScreen, SendScreen, ReceiveScreen, HistoryScreen, WalletsScreen, SettingsScreen, AIScreen

### Staking Contract (Anchor/Solana)
- `initialize`: set up state, vaults, authority, mint
- `stake(amount)`: lock POH in vault, update reward_per_token
- `unstake(amount)`: withdraw POH after cooldown
- `register_method(method_id)`: pay 1000 POH → split 500/500 to deployer/staker fee vault; create method record
- `cast_vote(method_index, vote)`: stake-weighted, allow revoting; update score/count
- `deposit_scan_fees`: accumulate scan fees for staker distribution
- `claimStakerRewards()`: distribute fees pro-rata to stakers
- Constants: LISTING_FEE = 1_000_000_000 (1000 POH, 6 dec), SCALE = 1_000_000_000_000

### SDKs
- **JS/TS** (`poh-sdk`): `POHClient.scan(addr)`, `scanBulk()`, `pollJob()`, `watchJob()`, `scanAndWait()`, `getMethods()`. Full TypeScript types.
- **Python** (`poh-sdk`): async/sync, `PohClient("url")`, `scan()`, `scan_bulk()`, `watch_job()` async generator
- **Rust** (`poh-sdk`): tokio async, `PohClient::new(opts).scan(addr).await`, `scan_and_wait()`, `get_brain_verdict()`. Error enum: Api/Network/Timeout/PollTimeout.
- **Widget**: Drop-in HTML `<div data-poh-widget>`, 12 KB no-dep bundle, auto-detects Phantom/Solflare/Backpack/MetaMask, callback with `{address, verdict, confidence, brainKey}`

### Key Signal Categories (top signals by weight/type)
- **EVM on-chain activity**: Base_-t, xluzjjrep (highest weight), tx_graph_eth
- **Solana activity**: tx_graph_solana
- **Social identity**: Farcaster (fnames + followers), ENS reverse lookup, ZNS domains (Zora/Scroll)
- **Proof of humanity**: Ethereum Proof of Humanity registration, Gitcoin Passport, Human Protocol
- **DeFi participation**: Snapshot governance, Uniswap/DEX history, Coinbase Verified ID
- **Content/publishing**: Paragraph blog (new — `paragraph_blog_evm` signal added June 2026)
- **Negative/blacklists**: OFAC SDN, EU consolidated, UK FCDO, Tether blacklist, CEX wallets

### Important Signal Behaviors
- **Negative signals** (e.g., Tether blacklist, OFAC): `pass=true` means the bad thing happened → hard override to AI verdict with confidence 0.99
- **CEX wallets**: auto-flagged, no AI verdict needed
- **Too few signals** (≤1 with methodsCount >10): domain resolution failed; user should paste raw wallet address
- **Graduated pools** get 1.5× weight at read time (non-destructive, cached from pools.json)
- **Weight bounds**: [0.01, 10.0] to prevent collapse or runaway amplification

### Marketing Articles Published
1. "The End of Pointless Mining" — useful PoW thesis, every block = real human verification
2. "Your Everyday Hardware Can Now Mine" — commodity hardware viable, geography + quality > raw power
3. "Mining Trust in the Age of AI" — decentralized identity layer as internet infrastructure
4. "Why Quality and Honesty Win" — reputation system, methodsHash validation, quality > speed

1. Top methods by weight are:
   - 28.7% for Base_-t (ID 1776780461277)
   - 20% for xluzjjrep (ID 1776669357845)
   - 10.8% for tx\_graph\_solana
   - 10.7% for farcaster (ID 1777400000007)
   - 10.2% for tx\_graph\_eth

### Vote: ZNS domain on Zora — owns at least one ZNS name (positive human signal) | Can this detect human behavior? → YES (stake: 0.010) — 2026-05-22T16:45:16.279Z

### Vote: Ethereum — Proof of Humanity registration (biometrically verified human) | Can this detect human behavior? → YES (stake: 0.010) — 2026-05-22T16:46:12.940Z

### Vote: ENS reverse lookup — owning an ENS name signals identity investment | Can this detect human behavior? → YES (stake: 0.010) — 2026-05-22T16:46:27.661Z

### Vote: ZNS domain on Scroll — owns at least one ZNS name (positive human signal) | Can this detect human behavior? → YES (stake: 0.010) — 2026-05-22T16:46:39.276Z