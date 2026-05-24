<template>
  <div class="about-page">
    <div class="scan-hero">
      <div class="scan-tag">YELLOW PAPER</div>
      <h2 class="scan-title">Proof of Human</h2>
      <p class="scan-sub">A decentralized, AI-augmented protocol for on-chain human identity verification. Mainnet · Solana · May 2026</p>
    </div>

    <!-- Abstract -->
    <section class="yp-section">
      <p class="yp-abstract">
        POH replaces static allow-lists and centralized KYC with a permissionless, stake-weighted signal market: any party can register a verification method ("signal"), the community votes on its validity, and a local AI brain fuses the resulting signal weights into a probabilistic human/bot verdict for any queried wallet. Signal tokens launched on a Meteora Dynamic Bonding Curve ("Conviction Curves") add a market-pricing layer — price action provides an additional, manipulation-resistant confidence signal that feeds directly back into the AI decision engine.
      </p>
    </section>

    <!-- 1. Background -->
    <section class="yp-section">
      <h3 class="yp-h2">1. Background and Motivation</h3>
      <p class="yp-p">
        Sybil resistance is a prerequisite for fair airdrops, governance, quadratic funding, and proof-of-personhood. Existing approaches share a structural flaw: trust is anchored to a central authority (Worldcoin, Gitcoin Passport, Civic) or is trivially gamed by on-chain heuristics alone. POH proposes a different primitive: a living, incentive-aligned signal registry where market participants stake capital on the quality of each verification method, and a continuously-learning AI brain integrates all signals into a calibrated verdict.
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
      <p class="yp-p"><strong>Storage:</strong> signals are persisted in a JSON flat-file (<code>data/methods.json</code>) on the backend node. This is a transitional design; a future version will migrate to on-chain account storage.</p>

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
        <li><code>registerMethod(methodHash)</code> — enforces 1,000 POH listing fee payment, routes 500 POH to SFEE vault</li>
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
        <li>If the submitter provides <code>poolAddress</code> and <code>mintAddress</code>, a Conviction Curve pool record is persisted (<code>data/pools.json</code>).</li>
      </ol>

      <h4 class="yp-h3">Conviction Curve</h4>
      <p class="yp-p">Alongside listing, submitters deploy a Meteora DBC pool for their signal. The full deployment cost is <strong>0.1 SOL</strong> paid by the submitter's wallet:</p>
      <div class="yp-code">
        <pre>{`total_charge   = 0.100 SOL
deploy_rent    = Σ(on-chain account rents) ≈ 0.021 SOL
tx_fee_buffer  = 0.000025 SOL
auto_buy       = total_charge − deploy_rent − tx_fee_buffer ≈ 0.079 SOL`}</pre>
      </div>
      <p class="yp-p">The <code>auto_buy</code> amount is used to purchase signal tokens from the pool immediately at creation, with tokens deposited into the submitter's wallet. This bootstraps the market and gives the creator initial skin in the game.</p>
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
      <p class="yp-p">Votes are boolean (<code>true</code> / <code>false</code>).</p>

      <h4 class="yp-h3">4.2 Stake-Weighted Impact</h4>
      <p class="yp-p">Stakers with more locked POH have proportionally higher influence:</p>
      <div class="yp-code">
        <pre>{`stakeWeight = walletStakedPOH / totalStakedPOH   ∈ [0, 1]
impact      = 1 + stakeWeight × 9                ∈ [1, 10]`}</pre>
      </div>
      <p class="yp-p">For graduated signals (Conviction Curve migrated to DAMM V2):</p>
      <div class="yp-code">
        <pre>{`graduationMult  = pool.migrated ? 1.5 : 1.0
effectiveImpact = impact × graduationMult          ∈ [1, 15]`}</pre>
      </div>

      <h4 class="yp-h3">4.3 Score Update</h4>
      <div class="yp-code">
        <pre>{`// description/method votes:
method.score += vote === true ? effectiveImpact : −effectiveImpact
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
      <p class="yp-p">Weights are bounded to <code>[0.01, 10.0]</code> to prevent collapse or runaway amplification. Graduated pool records are checked; if <code>pool.migrated === true</code>, the returned weight is multiplied by 1.5 at read time (non-destructive).</p>

      <h4 class="yp-h3">5.2 AI Brain Architecture</h4>
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
        <li>Results are normalized and weighted by <code>signal_weight × graduation_mult</code>.</li>
        <li>Weighted signal summary is composed into a structured prompt.</li>
        <li>Evaluator model produces <code>&#123; verdict, confidence, reasoning &#125;</code>.</li>
        <li>Response is cached and returned to the consumer.</li>
      </ol>
      <p class="yp-p"><strong>Continuous learning:</strong> on every vote, the brain receives the vote signal and feedback comment. The Learner model adjusts the brain state narrative; the Compiler periodically synthesizes a new compressed brain state from accumulated feedback.</p>

      <h4 class="yp-h3">5.3 Signal Strength Display</h4>
      <div class="yp-code">
        <pre>signalStrength = score × (1 + ln(1 + supply / 100) × 0.3) × graduationMult</pre>
      </div>
      <p class="yp-p">This grows with both community validation (score) and market adoption (token supply / price).</p>
    </section>

    <!-- 6. Conviction Curves -->
    <section class="yp-section">
      <h3 class="yp-h2">6. Conviction Curves</h3>

      <h4 class="yp-h3">6.1 Design Rationale</h4>
      <p class="yp-p">A pure vote-based system is vulnerable to coordinated Sybil attacks on the voting layer itself. Conviction Curves add a cost-to-attack layer: expressing conviction in a signal requires purchasing its token on an AMM bonding curve. Attackers must put real capital at risk. Honest believers are compensated if the signal gains community acceptance (price appreciation). This creates a prediction-market-like mechanism where price is an independent signal of community confidence.</p>

      <h4 class="yp-h3">6.2 Pool Parameters</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Parameter</th><th>Value</th><th>Rationale</th></tr></thead>
          <tbody>
            <tr><td>Total supply</td><td>1,000,000,000 (1B)</td><td>Sufficient granularity</td></tr>
            <tr><td>Token decimals</td><td>6</td><td>Standard SPL</td></tr>
            <tr><td>Quote token</td><td>SOL (WSOL)</td><td>Liquid, native Solana settlement</td></tr>
            <tr><td>Bonding fee</td><td>100 BPS (1%) base</td><td>Meteora protocol fee</td></tr>
            <tr><td>Creator trading fee</td><td>4% of trade volume</td><td>Incentivizes quality signal creation</td></tr>
            <tr><td>Graduation threshold</td><td>10 SOL raised</td><td>Migration to DAMM V2</td></tr>
            <tr><td>Post-graduation fee</td><td>400 BPS (4%) pool fee</td><td>Sustained fee for DAMM V2</td></tr>
            <tr><td>LP distribution</td><td>100% permanently locked</td><td>Rug-pull prevention</td></tr>
            <tr><td>Supply at migration</td><td>20% of total supply</td><td>Released during bonding phase</td></tr>
          </tbody>
        </table>
      </div>

      <h4 class="yp-h3">6.3 Pool Creation Transaction Flow</h4>
      <p class="yp-p">Pool creation uses two transactions (constrained by Solana's 1,232-byte transaction size limit):</p>
      <div class="yp-code">
        <pre>{`TX1 (629 bytes):  Create pool config (backend signs with configKeypair)
TX2 (888 bytes):  Create pool + first buy (backend signs with baseMintKeypair)`}</pre>
      </div>
      <p class="yp-p">Both are partially signed by the backend and returned to the frontend as base64-encoded serialized transactions. The user signs both in a single <code>signAllTransactions</code> call, then the frontend broadcasts them sequentially.</p>

      <h4 class="yp-h3">6.4 Graduation</h4>
      <p class="yp-p">When <code>quoteReserve ≥ migrationQuoteThreshold</code> (10 SOL), the Meteora program automatically migrates the pool to DAMM V2. The backend detects migration by polling <code>pool.migrated</code> on each state fetch and caches the result to <code>pools.json</code>. Graduated pools receive the 1.5× decision multiplier in all downstream consumers.</p>
    </section>

    <!-- 7. Referral -->
    <section class="yp-section">
      <h3 class="yp-h2">7. Referral System</h3>
      <h4 class="yp-h3">7.1 Referral Link Format</h4>
      <div class="yp-code">
        <pre>https://&#123;domain&#125;/?ref=&#123;base58_wallet_address&#125;&amp;signal=&#123;methodId&#125;</pre>
      </div>
      <h4 class="yp-h3">7.2 Fee Routing</h4>
      <p class="yp-p">When a swap is executed with a <code>referralTokenAccount</code> set, the Meteora on-chain program routes <code>HOST_FEE_PERCENT</code> (20%) of the Meteora protocol fee to the referral account — equal to <code>20% × 20% = 4%</code> of the base fee, or <code>0.04%</code> of the total trade per 100 BPS of base fee. Without a referral, <code>referralTokenAccount</code> defaults to the POH <code>FEE_RECIPIENT</code> — the protocol treasury receives the referral cut on unaffiliated trades.</p>
    </section>

    <!-- 8. API -->
    <section class="yp-section">
      <h3 class="yp-h2">8. API Reference</h3>
      <p class="yp-p">All routes are prefixed with their resource path. The backend runs Express on the configured port.</p>

      <h4 class="yp-h3">Methods / Signals</h4>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><span class="http-get">GET</span></td><td><code>/methods/verifyer</code></td><td>List all signals, stake-weighted shuffle, annotated with myVoted</td></tr>
            <tr><td><span class="http-post">POST</span></td><td><code>/methods/verifyer/vote</code></td><td>Cast signed vote</td></tr>
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
            <tr><td><span class="http-get">GET</span></td><td><code>/checker/profile/:address</code></td><td>Enriched identity profile (web3.bio, protocols, graph)</td></tr>
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
    </section>

    <!-- 9. Data Model -->
    <section class="yp-section">
      <h3 class="yp-h2">9. Data Model</h3>
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
  "created_at":   "ISO 8601",
  "poolAddress":  "base58 (optional)",
  "mintAddress":  "base58 (optional)"
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
      <h4 class="yp-h3">Pool Record (pools.json entry)</h4>
      <div class="yp-code">
        <pre>{`{
  "methodId":     "string",
  "poolAddress":  "base58",
  "mintAddress":  "base58",
  "creatorWallet":"base58",
  "createdAt":    "ISO 8601",
  "txHash":       "base58 tx signature",
  "migrated":     "boolean",
  "trades": [
    { "signature": "base58", "slot": "number",
      "timestamp": "ms epoch", "type": "buy|sell", "solAmount": "lamports" }
  ]
}`}</pre>
      </div>
    </section>

    <!-- 10. Security -->
    <section class="yp-section">
      <h3 class="yp-h2">10. Security Considerations</h3>
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
          <div class="yp-card-title">IP Abuse Detection</div>
          <p class="yp-card-body">Free scan usage is tracked per IP. If an IP address is associated with a different wallet that has already consumed free scans, subsequent wallets from that IP are flagged and denied the free tier.</p>
        </div>
        <div class="yp-card">
          <div class="yp-card-title">Brain Integrity</div>
          <p class="yp-card-body">The brain operates entirely on local infrastructure (Ollama). No training data, brain state, or weights are sent to external servers unless Qvac is explicitly configured. Training data is append-only; weights are bounded.</p>
        </div>
      </div>
    </section>

    <!-- 11. Economics -->
    <section class="yp-section">
      <h3 class="yp-h2">11. Economic Model</h3>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Flow</th><th>Amount</th><th>Recipient</th></tr></thead>
          <tbody>
            <tr><td>Signal listing fee</td><td>1,000 POH</td><td>500 POH → protocol vault; 500 POH → staker SFEE</td></tr>
            <tr><td>Staker rewards</td><td>500 POH per listing (pro-rata)</td><td>POH stakers via <code>claimStakerRewards</code></td></tr>
            <tr><td>Scan fee (paid tier)</td><td>$0.001 per scan (USDC/USDT)</td><td>100% → protocol FEE_RECIPIENT</td></tr>
            <tr><td>Pool deployment</td><td>0.1 SOL</td><td>~0.021 SOL rent (Meteora), ~0.079 SOL auto-buy</td></tr>
            <tr><td>Creator trading fee</td><td>4% per swap</td><td>Signal creator (on-chain claimable)</td></tr>
            <tr><td>Meteora protocol fee</td><td>20% of 1% base fee</td><td>Meteora treasury</td></tr>
            <tr><td>Referral cut (when active)</td><td>20% of Meteora's cut</td><td>Referral wallet or POH treasury</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 12. Roadmap -->
    <section class="yp-section">
      <h3 class="yp-h2">12. Roadmap</h3>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Phase</th><th>Feature</th></tr></thead>
          <tbody>
            <tr><td><span class="yp-badge yp-badge--active">Mainnet (current)</span></td><td>Signal registry, voting, AI brain, Conviction Curves, scan API, profile & billing</td></tr>
            <tr><td>Next</td><td>On-chain staking contract deployment, stake-weighted voting live</td></tr>
            <tr><td>Beta</td><td>On-chain signal storage, DAO governance of brain weights</td></tr>
            <tr><td>V1</td><td>Cross-chain signals, ZK-proof integration for private signals</td></tr>
            <tr><td>V2</td><td>Prediction market settlement, signal expiry, signal composability (AND/OR logic)</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Appendices -->
    <section class="yp-section">
      <h3 class="yp-h2">Appendix A: Conviction Curve Fee Math</h3>
      <p class="yp-p">For a 1 SOL trade on a newly-created curve with <code>startingFeeBps = 100</code>:</p>
      <div class="yp-code">
        <pre>{`total_fee    = 1 SOL × 100/10000    = 0.01 SOL
protocol_fee = 0.01 × 20%           = 0.002 SOL  (Meteora)
referral_fee = 0.002 × 20%          = 0.0004 SOL (referral, if set)
trading_fee  = 0.01 − 0.002         = 0.008 SOL
creator_fee  = 0.008 × creatorFee%  = variable
lp_fee       = 0.008 − creator_fee  = remainder`}</pre>
      </div>
    </section>

    <section class="yp-section">
      <h3 class="yp-h2">Appendix B: Vote Weight Examples</h3>
      <div class="yp-table-wrap">
        <table class="yp-table">
          <thead><tr><th>Staked POH</th><th>Total Staked</th><th>stakeWeight</th><th>impact</th><th>+grad impact</th></tr></thead>
          <tbody>
            <tr><td>0</td><td>any</td><td>0.000</td><td>1.00</td><td>1.50</td></tr>
            <tr><td>100</td><td>10,000</td><td>0.010</td><td>1.09</td><td>1.64</td></tr>
            <tr><td>1,000</td><td>10,000</td><td>0.100</td><td>1.90</td><td>2.85</td></tr>
            <tr><td>10,000</td><td>10,000</td><td>1.000</td><td>10.00</td><td>15.00</td></tr>
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
