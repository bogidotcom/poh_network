<script setup>
const emit = defineEmits(['show-section', 'load-profile', 'load-my-votes'])
</script>

<template>
  <div class="api-page">
    <div class="scan-hero">
      <div class="scan-tag">API REFERENCE</div>
      <h2 class="scan-title">Integrate POH</h2>
      <p class="scan-sub">Simple HTTP API. First 100 scans free per wallet. Authenticate with an API key from your profile.</p>
    </div>

    <!-- Pricing table -->
    <div class="api-section">
      <div class="api-section-title">Pricing</div>
      <div class="pricing-table">
        <div class="pt-row pt-head">
          <span>Batch size</span><span>Rate</span><span>Example</span>
        </div>
        <div class="pt-row">
          <span>1 – 9 addresses</span><span>1.00 POH / addr</span><span>5 addrs = 5 POH</span>
        </div>
        <div class="pt-row">
          <span>10 – 49 addresses</span><span>0.85 POH / addr</span><span>20 addrs = 17 POH</span>
        </div>
        <div class="pt-row">
          <span>50 – 99 addresses</span><span>0.70 POH / addr</span><span>70 addrs = 49 POH</span>
        </div>
        <div class="pt-row">
          <span>100 – 499 addresses</span><span>0.55 POH / addr</span><span>200 addrs = 110 POH</span>
        </div>
        <div class="pt-row">
          <span>500+ addresses</span><span>0.40 POH / addr</span><span>1000 addrs = 400 POH</span>
        </div>
        <div class="pt-row pt-free">
          <span>Free tier</span><span>0 POH</span><span>First 100 scans per wallet</span>
        </div>
      </div>
    </div>

    <!-- Endpoint docs -->
    <div class="api-section">
      <div class="api-section-title">POST /checker</div>
      <div class="api-card">
        <div class="api-desc">Scan one or more wallet addresses against all registered detection methods. Single address → synchronous result with <code>brainKey</code>. Multiple addresses or CSV upload → async job with <code>jobId</code> to poll.</div>
        <div class="api-params">
          <div class="param-row"><code>input</code><span>string or array — wallet address(es) to scan</span></div>
          <div class="param-row"><code>walletAddress</code><span>your Solana wallet (for free tier tracking)</span></div>
          <div class="param-row"><code>apiKey</code><span>API key from your profile (alternative to walletAddress)</span></div>
          <div class="param-row"><code>txHash</code><span>POH burn transaction hash (required for paid scans)</span></div>
          <div class="param-row"><code>chainIds</code><span>comma-separated chain IDs to filter EVM methods (optional)</span></div>
          <div class="param-row"><code>csv</code><span>multipart file upload — CSV with address column (bulk mode)</span></div>
        </div>
        <div class="code-block">
          <div class="code-lang">curl — single</div>
          <pre class="code-pre">curl -X POST https://proofofhuman.ge/checker \
  -H "Content-Type: application/json" \
  -d '{
    "input": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "apiKey": "your-api-key-here"
  }'
# → { result: [...], brainKey, freeScansLeft }</pre>
        </div>
        <div class="code-block">
          <div class="code-lang">curl — bulk (CSV)</div>
          <pre class="code-pre">curl -X POST https://proofofhuman.ge/checker \
  -F "csv=@wallets.csv" \
  -F "apiKey=your-api-key-here" \
  -F "txHash=your-payment-tx"
# → { jobId, status: "queued", total, pollUrl }</pre>
        </div>
        <div class="code-block">
          <div class="code-lang">JavaScript</div>
          <pre class="code-pre">const res = await fetch('/checker', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    apiKey: 'your-api-key-here'
  })
})
const { result, brainKey, freeScansLeft } = await res.json()</pre>
        </div>
      </div>
    </div>

    <div class="api-section">
      <div class="api-section-title">GET /checker/job/:jobId</div>
      <div class="api-card">
        <div class="api-desc">Poll the status of a bulk scan job. <code>jobId</code> is returned by POST /checker when more than one address is submitted. Jobs are retained for 2 hours after completion.</div>
        <div class="api-params">
          <div class="param-row"><code>status</code><span>queued | running | done</span></div>
          <div class="param-row"><code>total</code><span>total addresses in the job</span></div>
          <div class="param-row"><code>done</code><span>addresses processed so far</span></div>
          <div class="param-row"><code>percent</code><span>completion percentage (0–100)</span></div>
          <div class="param-row"><code>results</code><span>array of per-method scan results (grows incrementally)</span></div>
          <div class="param-row"><code>errors</code><span>array of error messages for failed addresses</span></div>
        </div>
        <div class="code-block">
          <div class="code-lang">JavaScript — poll until done</div>
          <pre class="code-pre">const { jobId } = await fetch('/checker', { method: 'POST', ... }).then(r => r.json())

async function pollJob(jobId) {
  while (true) {
    const job = await fetch(`/checker/job/${jobId}`).then(r => r.json())
    console.log(`${job.percent}% — ${job.done}/${job.total}`)
    if (job.status === 'done') return job.results
    await new Promise(r => setTimeout(r, 3000))
  }
}

const results = await pollJob(jobId)</pre>
        </div>
      </div>
    </div>

    <div class="api-section">
      <div class="api-section-title">GET /checker/brain/:key</div>
      <div class="api-card">
        <div class="api-desc">Poll for the async AI verdict after a scan. <code>brainKey</code> is returned by POST /checker. Returns <code>status: "pending" | "done" | "error"</code>.</div>
        <div class="code-block">
          <div class="code-lang">curl</div>
          <pre class="code-pre">curl https://proofofhuman.ge/checker/brain/0xabc123...</pre>
        </div>
        <div class="api-params">
          <div class="param-row"><code>verdict</code><span>HUMAN | AI | UNCERTAIN | UNKNOWN</span></div>
          <div class="param-row"><code>confidence</code><span>0.0 – 1.0</span></div>
          <div class="param-row"><code>reasoning</code><span>short technical explanation</span></div>
        </div>
      </div>
    </div>

    <div class="api-section">
      <div class="api-section-title">GET /checker/pricing?count=N</div>
      <div class="api-card">
        <div class="api-desc">Returns cost breakdown for a given batch size before committing.</div>
        <div class="code-block">
          <div class="code-lang">curl</div>
          <pre class="code-pre">curl "https://proofofhuman.ge/checker/pricing?count=100"
# → { count: 100, perAddress: 0.55, total: 55000000, tiers: [...] }</pre>
        </div>
      </div>
    </div>

    <div class="api-section">
      <div class="api-section-title">GET /profile/:address</div>
      <div class="api-card">
        <div class="api-desc">Returns profile stats, submitted methods, and reward totals for a wallet address.</div>
        <div class="code-block">
          <div class="code-lang">curl</div>
          <pre class="code-pre">curl https://proofofhuman.ge/profile/YourSolanaWalletAddressHere</pre>
        </div>
      </div>
    </div>

    <div class="api-cta">
      <p>Get your API key from your <button class="utility-link" @click="emit('show-section', 'profile'); emit('load-profile'); emit('load-my-votes')">profile →</button></p>
    </div>
  </div>
</template>
