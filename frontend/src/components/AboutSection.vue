<template>
  <div class="about-page">
    <div class="scan-hero">
      <div class="scan-tag">YELLOW PAPER</div>
      <h2 class="scan-title">Proof of Human</h2>
      <p class="scan-sub">A decentralized, AI-augmented protocol for on-chain human identity verification. Mainnet · Solana · 2026</p>
    </div>

    <!-- Abstract -->
    <section class="yp-section">
      <p class="yp-abstract">
        POH replaces static allow-lists and centralized KYC with a permissionless, stake-weighted signal market: any party can register a verification method ("signal"), the community votes on its validity, and a local AI brain fuses the resulting signal weights into a probabilistic human/bot verdict for any queried wallet. A peer-to-peer miner network runs the AI pipeline and earns POH rewards for verified work — no central operator, no single point of failure.
      </p>
    </section>

    <!-- 1. Background -->
    <section class="yp-section">
      <h3 class="yp-h2">1. Background and Motivation</h3>
      <p class="yp-p">
        Sybil resistance is a prerequisite for fair airdrops, governance, quadratic funding, and proof-of-personhood. Existing approaches share a structural flaw: trust is anchored to a central authority (Worldcoin, Gitcoin Passport, Civic) or is trivially gamed by on-chain heuristics alone. POH proposes a different primitive: a living, incentive-aligned signal registry where community members stake capital on the quality of each verification method, and a continuously-learning AI brain integrates all signals into a calibrated verdict.
      </p>
    </section>

    <!-- 2. System Components -->
    <section class="yp-section">
      <h3 class="yp-h2">2. System Components</h3>

      <h4 class="yp-h3">2.1 Signal Registry</h4>
      <p class="yp-p">A signal is any computable predicate over a blockchain address that is plausibly correlated with human behavior. Supported types:</p>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Type</th><th>Description</th><th>Parameters</th></tr></thead>
          <tbody>
            <tr><td><code>evm</code></td><td>Call an EVM view function</td><td>chainId, address, method, abiTypes, returnTypes, expression</td></tr>
            <tr><td><code>solana</code></td><td>Read a Solana account or program state</td><td>address, method, expression</td></tr>
            <tr><td><code>rest</code></td><td>HTTP GET endpoint returning structured data</td><td>address (URL), headers, body, expression</td></tr>
          </tbody>
        </table>
      </div>
      <p class="yp-p"><strong>Result evaluation:</strong> each signal produces a numeric or boolean value normalized by an optional <code>expression</code> (JavaScript) into a score ∈ ℝ.</p>
      <p class="yp-p"><strong>Storage:</strong> signals are persisted in <code>data/methods.json</code> on the backend node. A future version will migrate to on-chain account storage.</p>

      <h4 class="yp-h3">2.2 POH Token (SPL)</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Standard</td><td>Solana SPL Token</td></tr>
            <tr><td>Decimals</td><td>9</td></tr>
            <tr><td>Signal listing fee</td><td>1,000 POH</td></tr>
            <tr><td>Fee split</td><td>500 POH → protocol vault; 500 POH → staker fee vault (SFEE_PDA)</td></tr>
            <tr><td>Staking</td><td>Non-custodial; stake weight used for vote amplification</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">2.3 Staking Contract</h4>
      <p class="yp-p">On-chain Anchor program — <span class="yp-badge yp-badge--soon">contract deployment in progress</span></p>
      <p class="yp-p">Planned entrypoints:</p>
      <ul class="yp-list">
        <li><code>stakeTokens(amount)</code> — locks POH in staker PDA, mints stake receipt</li>
        <li><code>unstakeTokens(amount)</code> — returns POH after cooldown</li>
        <li><code>registerMethod(methodHash)</code> — enforces 1,000 POH listing fee, routes 500 POH to SFEE vault</li>
        <li><code>claimStakerRewards()</code> — distributes accumulated listing fees pro-rata to stakers</li>
      </ul>

      <h4 class="yp-h3">2.4 Scan API & Pricing</h4>
      <p class="yp-p">Any wallet or API key can submit addresses for analysis. Wallets receive <strong>100 free scans</strong> on first use. Beyond the free tier, scans are prepaid in USDC or USDT:</p>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Free tier</td><td>100 scans per wallet</td></tr>
            <tr><td>Paid rate</td><td>$0.001 per scan (1 USDC/USDT per 1,000 scans)</td></tr>
            <tr><td>Payment tokens</td><td>USDC or USDT (SPL, 6 decimals)</td></tr>
            <tr><td>Fee recipient</td><td>100% to protocol FEE_RECIPIENT</td></tr>
            <tr><td>Balance tracking</td><td>Off-chain, credited to <code>profile.balance</code> after on-chain transfer verified</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 3. Signal Listing -->
    <section class="yp-section">
      <h3 class="yp-h2">3. Signal Listing</h3>

      <h4 class="yp-h3">3.1 Listing Flow</h4>
      <ol class="yp-list">
        <li>Submitter pays <strong>1,000 POH</strong> by calling <code>registerMethod</code> on-chain. The transaction hash is submitted to the API.</li>
        <li>Backend verifies the transaction was confirmed on-chain (<code>verifyTxSuccess</code>).</li>
        <li>Duplicate check: REST signals deduplicate by URL; EVM/Solana signals by <code>(address, method)</code> pair.</li>
        <li>Signal is assigned a random UUID, inserted into the registry with <code>score = 0</code>, and a training record is appended to <code>data/dataset.json</code>.</li>
      </ol>
    </section>

    <!-- 4. Voting -->
    <section class="yp-section">
      <h3 class="yp-h2">4. Voting Mechanism</h3>

      <h4 class="yp-h3">4.1 Vote Types</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Type</th><th>Interpretation</th></tr></thead>
          <tbody>
            <tr><td><code>description</code></td><td>Signal description is meaningful and accurate</td></tr>
            <tr><td><code>method</code></td><td>Signal method / implementation is technically valid</td></tr>
          </tbody>
        </table>
      </div>
      <p class="yp-p">Votes are boolean (<code>true</code> / <code>false</code>). Voters also provide a written feedback comment that feeds directly into AI brain training.</p>

      <h4 class="yp-h3">4.2 Stake-Weighted Impact</h4>
      <p class="yp-p">Stakers with more locked POH have proportionally higher influence:</p>
      <div class="yp-code">
        <pre>{`stakeWeight = walletStakedPOH / totalStakedPOH   ∈ [0, 1]
impact      = 1 + stakeWeight × 9                ∈ [1, 10]`}</pre>
      </div>

      <h4 class="yp-h3">4.3 Score Update</h4>
      <div class="yp-code">
        <pre>{`// description/method votes:
method.score += vote === true ? impact : −impact
method.voteCount += 1`}</pre>
      </div>

      <h4 class="yp-h3">4.4 Anti-Replay</h4>
      <p class="yp-p">Votes are authorized by a wallet signature over a structured message:</p>
      <div class="yp-code">
        <pre>poh-vote-v1:{`{methodId}:{vote}:{type}:{walletAddress}:{timestamp_ms}`}</pre>
      </div>
      <p class="yp-p">The backend verifies the ed25519 signature, asserts the message binds to the exact request parameters, rejects messages older than 5 minutes, records the signature as used, and rejects if <code>hasVoted(walletAddress, methodId)</code> — one vote per wallet per signal.</p>
    </section>

    <!-- 5. Brain -->
    <section class="yp-section">
      <h3 class="yp-h2">5. Signal Weights and the Brain</h3>

      <h4 class="yp-h3">5.1 Weight Propagation</h4>
      <p class="yp-p">Each signal carries a <code>score</code> from the voting system. The Brain module maintains a separate <code>weights.json</code> that maps <code>methodId → weight</code>. Weights begin at a prior set by the AI and are updated on each vote:</p>
      <div class="yp-code">
        <pre>newWeight = oldWeight × (1 + stakeWeight × 0.1 × (vote ? 1 : −1))</pre>
      </div>
      <p class="yp-p">Weights are bounded to <code>[0.01, 10.0]</code> to prevent collapse or runaway amplification.</p>

      <h4 class="yp-h3">5.2 AI Verdict Inputs</h4>
      <p class="yp-p">The brain fuses two distinct feedback channels for each signal:</p>
      <ul class="yp-list">
        <li><strong>Vote</strong> — community boolean vote (true/false), stake-weighted</li>
        <li><strong>Feedback</strong> — human correction labels submitted after scans (`HUMAN` / `BOT` correction + comment)</li>
      </ul>
      <p class="yp-p">Both update <code>weights.json</code> on the miner nodes. Brain state is committed to chain via <code>brainStateRoot</code> and <code>stateTransitions</code> in every block.</p>

      <h4 class="yp-h3">5.3 AI Brain Architecture</h4>
      <p class="yp-p">The brain is a local multi-model LLM pipeline running on Ollama (optionally augmented by a Qvac/OpenAI-compatible evaluator):</p>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Role</th><th>Backend</th><th>Responsibility</th></tr></thead>
          <tbody>
            <tr><td>BASE</td><td>Qwen2.5 8B (Ollama)</td><td>General reasoning, feedback processing</td></tr>
            <tr><td>EVALUATOR</td><td>Qvac</td><td>Probabilistic verdict — HUMAN / BOT / UNCERTAIN</td></tr>
          </tbody>
        </table>
      </div>
      <p class="yp-p"><strong>Verdict pipeline for a queried address:</strong></p>
      <ol class="yp-list">
        <li>Each enabled signal is executed against the address (parallel HTTP/RPC calls).</li>
        <li>Results are normalized and weighted by <code>weights[methodId] ?? 1</code>.</li>
        <li>Weighted signal summary is composed into a structured prompt.</li>
        <li>Evaluator model produces <code>&#123; verdict, confidence, reasoning &#125;</code>.</li>
        <li>Response is cached and returned to the consumer.</li>
      </ol>
      <p class="yp-p"><strong>Continuous learning:</strong> on every vote and feedback submission, the brain adjusts weights. The Compiler periodically synthesizes a new compressed brain state from accumulated feedback. Brain state is synchronized across all miner nodes via P2P events and on-chain commitments.</p>
    </section>

    <!-- 6. Skills -->
    <section class="yp-section">
      <h3 class="yp-h2">6. Skills</h3>

      <h4 class="yp-h3">6.1 What Are Skills?</h4>
      <p class="yp-p">Skills extend the miner network's compute capabilities beyond wallet identity verification. Any developer can propose a skill — a sandboxed JavaScript module that miners can execute as part of a scan job. Skills go through community review via POH staking before becoming active.</p>

      <h4 class="yp-h3">6.2 Lifecycle</h4>
      <div class="yp-code">
        <pre>proposed  →  staking  →  graduated (10,000 POH)  →  active  →  deprecated</pre>
      </div>
      <p class="yp-p">Once graduated, the skill is propagated to all nodes via <code>stateTransitions</code> in blocks and becomes available for job routing.</p>

      <h4 class="yp-h3">6.3 Staking Mechanics</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Proposal fee</td><td>1,000 POH</td></tr>
            <tr><td>Graduation threshold</td><td>10,000 POH staked total</td></tr>
            <tr><td>Staking model</td><td>Off-chain (tracked in miner stateTransitions, propagated P2P)</td></tr>
            <tr><td>Unstaking</td><td>Allowed at any time before graduation</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">6.4 Skill Auto-Sync</h4>
      <p class="yp-p">Skills are synchronized across all nodes automatically:</p>
      <ul class="yp-list">
        <li>New proposals are gossiped via <code>skill-proposed</code> P2P topic</li>
        <li>Stake events and graduation are committed as <code>stateTransitions</code> in blocks</li>
        <li>All nodes replay transitions in <code>_appendBlock</code> to rebuild skill state</li>
        <li>Cold-starting nodes restore skill state from chain replay</li>
      </ul>
    </section>

    <!-- 7. API -->
    <section class="yp-section">
      <h3 class="yp-h2">7. API Reference</h3>
      <p class="yp-p">All routes are prefixed with their resource path. The backend runs Express on the configured port.</p>

      <h4 class="yp-h3">Methods / Signals</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><span class="http-get">GET</span></td><td><code>/methods/verifyer</code></td><td>List all signals, stake-weighted shuffle, annotated with myVoted</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/methods/verifyer/vote</code></td><td>Cast signed vote + feedback</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/methods/verifyer/validate-feedback</code></td><td>Pre-vote LLM feedback quality check</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/methods/listing</code></td><td>Register new signal (requires confirmed POH payment tx)</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/methods/listing/validate-description</code></td><td>Pre-submit LLM description quality check</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">Checker</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><span class="http-post">POST</span></td><td><code>/checker</code></td><td>Run full AI verdict on an address (or batch CSV)</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/checker/job/:jobId</code></td><td>Poll async job status</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/checker/feedback</code></td><td>Submit verdict correction for brain training</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/checker/pricing</code></td><td>Current scan pricing (rate, free tier)</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/checker/preview</code></td><td>Dry-run signal execution without verdict</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/checker/brain/:key</code></td><td>Read brain state (weights, narrative)</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/checker/profile/:address</code></td><td>Enriched identity profile</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">Profile</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><span class="http-post">POST</span></td><td><code>/profile/signup</code></td><td>Create profile (requires ed25519 wallet signature)</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/profile/:address</code></td><td>Fetch profile, submitted signals, earned rewards</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/profile/:address/votes</code></td><td>Voting history for wallet</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/profile/deposit</code></td><td>Credit scan balance after USDC/USDT on-chain transfer</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/profile/apikey/rotate</code></td><td>Rotate API key</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/profile</code></td><td>Top earners leaderboard</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">Skills (Miner Node)</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><span class="http-get">GET</span></td><td><code>/api/skills</code></td><td>List all skills with status + total POH staked</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/api/skills/propose</code></td><td>Submit a new skill (manifest + sandboxed JS code)</td></tr>
            <tr><td><span class="http-get">GET</span></td><td><code>/api/skills/:id/stakes</code></td><td>Staker list + total for a skill</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/api/skills/:id/stake</code></td><td>Stake POH toward a skill</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/api/skills/:id/unstake</code></td><td>Unstake POH</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 8. Data Model -->
    <section class="yp-section">
      <h3 class="yp-h2">8. Data Model</h3>
      <h4 class="yp-h3">Signal (methods.json entry)</h4>
      <div class="yp-code">
        <pre>{`{
  "id":           "string (UUID-ish)",
  "type":         "evm | solana | rest",
  "chainId":      "number (EVM only)",
  "address":      "string (contract addr or REST URL)",
  "method":       "string (function name or path)",
  "abiTypes":     "string (JSON array)",
  "returnTypes":  "string (JSON array)",
  "expression":   "string (JS eval expression)",
  "description":  "string",
  "score":        "number",
  "voteCount":    "number",
  "ownerWallet":  "base58 public key",
  "created_at":   "ISO 8601"
}`}</pre>
      </div>
      <h4 class="yp-h3">Profile (profiles.json entry)</h4>
      <div class="yp-code">
        <pre>{`{
  "address":       "base58 public key",
  "apiKey":        "UUID",
  "balance":       "number (USDC/USDT raw units, 6 decimals)",
  "freeScansLeft": "number",
  "totalScans":    "number",
  "stakedAmount":  "number",
  "registeredAt":  "ISO 8601",
  "updatedAt":     "ISO 8601"
}`}</pre>
      </div>
      <h4 class="yp-h3">Skill manifest</h4>
      <div class="yp-code">
        <pre>{`{
  "skillId":      "string",
  "name":         "string",
  "version":      "string (semver)",
  "description":  "string",
  "author":       "base58 wallet",
  "allowedHosts": ["string"],
  "timeout":      "number (ms, max 15000)"
}`}</pre>
      </div>
    </section>

    <!-- 9. Security -->
    <section class="yp-section">
      <h3 class="yp-h2">9. Security Considerations</h3>
      <div class="yp-cards">
        <div class="yp-card">
          <div class="yp-card-title">Vote Signature Verification</div>
          <p class="yp-card-body">All votes require ed25519 signature verification against the voter's public key. The message format binds the signature to the exact (methodId, vote, type, walletAddress, timestamp) tuple. Signatures are recorded and rejected on reuse.</p>
        </div>
        <div class="yp-card">
          <div class="yp-card-title">Transaction Verification</div>
          <p class="yp-card-body">Listing payments are verified by querying the Solana RPC for transaction confirmation status via <code>verifyTxSuccess(txHash)</code>. Failed, unbroadcast, or fabricated transactions are rejected.</p>
        </div>
        <div class="yp-card">
          <div class="yp-card-title">Duplicate Signal Prevention</div>
          <p class="yp-card-body">Before inserting a new signal, the backend checks for exact duplicates: REST signals by URL, EVM/Solana signals by (address, method) pair. Attempting to list a duplicate returns HTTP 409.</p>
        </div>
        <div class="yp-card">
          <div class="yp-card-title">Deposit Verification</div>
          <p class="yp-card-body">Scan balance deposits require an on-chain USDC/USDT transfer verified via <code>verifyStablecoinTransfer(txHash, amount, sender)</code>. Each transaction hash is recorded and rejected on reuse to prevent double-crediting.</p>
        </div>
        <div class="yp-card">
          <div class="yp-card-title">Skill Sandbox</div>
          <p class="yp-card-body">Skill code runs in a <code>worker_threads</code> sandbox. Network access is restricted to the skill's <code>allowedHosts</code> manifest field. Execution is hard-killed after 15 seconds. No filesystem or process access.</p>
        </div>
        <div class="yp-card">
          <div class="yp-card-title">Brain Integrity</div>
          <p class="yp-card-body">The brain operates entirely on local infrastructure (Ollama). Brain state is committed to every block as <code>brainStateRoot</code> — a SHA-256 of <code>weights.json</code>. Peers reject blocks whose brainStateRoot doesn't match their local state.</p>
        </div>
      </div>
    </section>

    <!-- 10. Economics -->
    <section class="yp-section">
      <h3 class="yp-h2">10. Economic Model</h3>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Flow</th><th>Amount</th><th>Recipient</th></tr></thead>
          <tbody>
            <tr><td>Signal listing fee</td><td>1,000 POH</td><td>500 POH → protocol vault; 500 POH → staker SFEE</td></tr>
            <tr><td>Staker rewards</td><td>500 POH per listing (pro-rata)</td><td>POH stakers via <code>claimStakerRewards</code></td></tr>
            <tr><td>Scan fee (paid tier)</td><td>$0.001 per scan (USDC/USDT)</td><td>100% → protocol FEE_RECIPIENT</td></tr>
            <tr><td>Block subsidy</td><td>1 POH per block</td><td>60% → block proposer; 40% → workers</td></tr>
            <tr><td>Job fee</td><td>Set by requester</td><td>100% → winning miner</td></tr>
            <tr><td>Skill proposal fee</td><td>1,000 POH</td><td>Burned / protocol vault</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 11. Roadmap -->
    <section class="yp-section">
      <h3 class="yp-h2">11. Roadmap</h3>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Phase</th><th>Feature</th></tr></thead>
          <tbody>
            <tr><td><span class="yp-badge yp-badge--active">Mainnet (current)</span></td><td>Signal registry, voting, AI brain, scan API, profile &amp; billing, PoH Miner Network, Skills layer, mobile wallet</td></tr>
            <tr><td>Next</td><td>On-chain staking contract deployment, stake-weighted voting live, BFT finality layer</td></tr>
            <tr><td>Beta</td><td>On-chain signal storage, DAO governance of brain weights</td></tr>
            <tr><td>V1</td><td>Cross-chain signals, ZK-proof integration for private signals</td></tr>
            <tr><td>V2</td><td>Skill marketplace with on-chain settlement, signal composability (AND/OR logic)</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 12. Miner Network -->
    <section class="yp-section">
      <h3 class="yp-h2">12. PoH Miner Network</h3>
      <p class="yp-p">
        The PoH Miner Network is a purpose-built Proof-of-Work blockchain where miners earn POH by performing real, useful
        work — executing the full identity verification pipeline (signal evaluation + AI brain inference) on user-submitted
        wallet addresses. Energy is converted into high-integrity compute, not discarded on pure hash puzzles.
      </p>

      <h4 class="yp-h3">12.1 Architecture</h4>
      <div class="yp-code">
        <pre>{`┌──────────────────────────────────────────────────────────────────┐
│                   App Layer  (proofofhuman.ge)                   │
│   Frontend  ·  Profiles  ·  Voting  ·  Skills                   │
└───────────────────────────┬──────────────────────────────────────┘
                            │  submits scan jobs ▼  reads results
┌───────────────────────────▼──────────────────────────────────────┐
│                    PoH Miner Network                             │
│                                                                  │
│   ┌──────────────┐  P2P gossip (blocks, txs, skills, status)    │
│   │  Miner Node  │◄──────────────────────────────► Miner Node  │
│   │              │                                              │
│   │ • PoW mining │  ← race to compute first valid verdict →    │
│   │ • LLM brain  │                                              │
│   │ • Chain sync │  ← bootnode for peer discovery / catch-up → │
│   │ • Skills     │                                              │
│   │ • Wallet API │                                              │
│   └──────────────┘                                              │
│                                                                  │
│   IPFS durability (chain snapshots, brain state, peer list)     │
└──────────────────────────────────────────────────────────────────┘`}</pre>
      </div>

      <h4 class="yp-h3">12.2 Block Structure</h4>
      <p class="yp-p">Each block is a self-contained record of verified identity work:</p>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Field</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>height</code>, <code>previousHash</code>, <code>timestamp</code></td><td>Standard chain linkage</td></tr>
            <tr><td><code>minerWallet</code></td><td>PoH address of the block proposer</td></tr>
            <tr><td><code>scanResults[]</code></td><td>Verified wallet verdicts: requestId, address, verdict, confidence, reasoning, signalsUsed, minerWallet, signature</td></tr>
            <tr><td><code>transactions[]</code></td><td>Signed POH token transfers with nonces</td></tr>
            <tr><td><code>stateTransitions[]</code></td><td>On-chain events: brain feedback, skill proposals, skill stakes, skill graduation</td></tr>
            <tr><td><code>stateRoot</code></td><td>SHA-256 of all wallet balances (tamper-evident)</td></tr>
            <tr><td><code>brainStateRoot</code></td><td>SHA-256 of brain weights (tamper-evident)</td></tr>
            <tr><td><code>coinbaseReward</code></td><td>1 POH per block — 60% to block proposer, 40% split among contributing workers</td></tr>
            <tr><td><code>nonce</code>, <code>difficulty</code>, <code>chainWork</code></td><td>Lightweight PoW fields for Sybil resistance</td></tr>
            <tr><td><code>minerSignature</code></td><td>ed25519 block authentication by the proposing miner</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">12.3 P2P Sync Summary</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Data</th><th>Transport</th></tr></thead>
          <tbody>
            <tr><td>New blocks</td><td>P2P gossip <code>new-block</code> (flood-fill, TTL=4)</td></tr>
            <tr><td>Pending transactions</td><td>P2P gossip <code>new-tx</code></td></tr>
            <tr><td>Skill proposals</td><td>P2P gossip <code>skill-proposed</code></td></tr>
            <tr><td>Node status (methodsHash, region, load)</td><td>P2P gossip <code>node-status</code></td></tr>
            <tr><td>Chain history (cold start)</td><td>HTTP pull from bootnode <code>/chain/blocks</code></td></tr>
            <tr><td>Brain snapshot (cold start)</td><td>IPFS CID stored in <code>state-snapshot</code> stateTransition</td></tr>
            <tr><td>Canonical signal set + hash</td><td>HTTP from proofofhuman.ge + IPFS fallback</td></tr>
            <tr><td>Brain feedback events &amp; weight updates</td><td>Peer-to-peer push + bootnode <code>/brain/events</code></td></tr>
            <tr><td>Peer records</td><td>Bootnode <code>/peers</code> + IPFS peer directory</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">12.4 Running a Miner</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Method</th><th>How</th><th>Best for</th></tr></thead>
          <tbody>
            <tr><td><strong>GUI app</strong></td><td>Download <code>.deb</code> / <code>.AppImage</code> / <code>.dmg</code>. Ollama + <code>qwen2.5:1.5b</code> installed automatically.</td><td>Non-technical operators; home miners</td></tr>
            <tr><td><strong>CLI</strong></td><td><code>npm install &amp;&amp; cp config.example.json config.json &amp;&amp; npm start</code></td><td>Servers; automation; custom config</td></tr>
            <tr><td><strong>Docker</strong></td><td><code>docker run -v ~/.poh-miner:/root/.poh-miner ghcr.io/poh/miner:latest</code></td><td>Cloud VMs; containerized deployments</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Appendix -->
    <section class="yp-section">
      <h3 class="yp-h2">Appendix A: Vote Weight Examples</h3>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Staked POH</th><th>Total Staked</th><th>stakeWeight</th><th>impact</th></tr></thead>
          <tbody>
            <tr><td>0</td><td>any</td><td>0.000</td><td>1.00</td></tr>
            <tr><td>100</td><td>10,000</td><td>0.010</td><td>1.09</td></tr>
            <tr><td>1,000</td><td>10,000</td><td>0.100</td><td>1.90</td></tr>
            <tr><td>10,000</td><td>10,000</td><td>1.000</td><td>10.00</td></tr>
          </tbody>
        </table>
      </div>
    </section>

  </div>
</template>

<style scoped>
.about-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 1rem 6rem;
}

/* ── Sections ──────────────────────────────────────────────────────────────── */
.yp-section {
  margin-bottom: 3rem;
  padding-bottom: 3rem;
  border-bottom: 1px solid #111;
}
.yp-section:last-child {
  border-bottom: none;
}

/* ── Abstract ─────────────────────────────────────────────────────────────── */
.yp-abstract {
  font-size: 1.05rem;
  line-height: 1.75;
  color: #999;
  border-left: 2px solid #333;
  padding: 1.25rem 1.5rem;
  background: #ffffff05;
  border-radius: 0 8px 8px 0;
  margin: 0;
}

/* ── Headings ──────────────────────────────────────────────────────────────── */
.yp-h2 {
  font-size: 1.2rem;
  font-weight: 700;
  color: #ccc;
  margin: 0 0 1.25rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #1a1a1a;
  font-family: monospace;
  letter-spacing: 0.02em;
}
.yp-h3 {
  font-size: 0.9rem;
  font-weight: 600;
  color: #aaa;
  margin: 1.75rem 0 0.75rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* ── Body text ────────────────────────────────────────────────────────────── */
.yp-p {
  font-size: 0.9375rem;
  line-height: 1.75;
  color: #777;
  margin: 0 0 0.875rem;
}
.yp-p strong { color: #aaa; font-weight: 600; }
.yp-p code, .yp-list code {
  font-family: monospace;
  font-size: 0.85em;
  color: #c7c7c7;
  background: #1a1a1a;
  padding: 0.1em 0.35em;
  border-radius: 3px;
}

/* ── Lists ────────────────────────────────────────────────────────────────── */
.yp-list {
  color: #777;
  font-size: 0.9375rem;
  line-height: 1.75;
  padding-left: 1.5rem;
  margin: 0 0 0.875rem;
}
.yp-list li { margin-bottom: 0.35rem; }

/* ── Tables ───────────────────────────────────────────────────────────────── */
.yp-table-wrap {
  overflow-x: auto;
  margin-bottom: 0.875rem;
}
.yp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.yp-table th {
  text-align: left;
  padding: 0.6rem 0.875rem;
  border-bottom: 1px solid #222;
  color: #666;
  font-weight: 500;
  font-family: monospace;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}
.yp-table td {
  padding: 0.6rem 0.875rem;
  border-bottom: 1px solid #111;
  color: #888;
  vertical-align: top;
  line-height: 1.5;
}
.yp-table tr:last-child td { border-bottom: none; }
.yp-table td code {
  font-family: monospace;
  font-size: 0.82em;
  color: #c7c7c7;
  background: #1a1a1a;
  padding: 0.1em 0.35em;
  border-radius: 3px;
}

/* ── Code blocks ──────────────────────────────────────────────────────────── */
.yp-code {
  background: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 6px;
  margin-bottom: 0.875rem;
  overflow-x: auto;
}
.yp-code pre {
  margin: 0;
  padding: 1rem 1.25rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8125rem;
  line-height: 1.65;
  color: #9a9a9a;
  white-space: pre;
}

/* ── Security cards ───────────────────────────────────────────────────────── */
.yp-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 600px) {
  .yp-cards { grid-template-columns: 1fr; }
}
.yp-card {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 1rem 1.125rem;
}
.yp-card-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #aaa;
  margin-bottom: 0.5rem;
  letter-spacing: 0.03em;
}
.yp-card-body {
  font-size: 0.8125rem;
  color: #666;
  line-height: 1.65;
  margin: 0;
}
.yp-card-body code {
  font-family: monospace;
  font-size: 0.85em;
  color: #c7c7c7;
  background: #1a1a1a;
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

/* ── HTTP method badges ───────────────────────────────────────────────────── */
.http-get  { color: #4ade80; font-family: monospace; font-size: 0.78rem; font-weight: 700; }
.http-post { color: #facc15; font-family: monospace; font-size: 0.78rem; font-weight: 700; }

/* ── Roadmap / status badges ──────────────────────────────────────────────── */
.yp-badge {
  display: inline-block;
  font-size: 0.75rem;
  padding: 0.15em 0.5em;
  border-radius: 4px;
  font-weight: 600;
  white-space: nowrap;
}
.yp-badge--active {
  background: rgba(99,102,241,0.12);
  color: #a5b4fc;
  border: 1px solid rgba(99,102,241,0.3);
}
.yp-badge--soon {
  background: rgba(234,179,8,0.10);
  color: #eab308;
  border: 1px solid rgba(234,179,8,0.25);
  font-size: 0.78rem;
  font-weight: 500;
}
</style>
