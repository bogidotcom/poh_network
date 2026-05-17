<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'

const props = defineProps({
  listing:      { type: Object,  required: true },
  headers:      { type: Array,   required: true },
  abiFns:       { type: Array,   default: () => [] },
  abiLoading:   { type: Boolean, default: false },
  abiError:     { type: String,  default: null },
  loading:      { type: Boolean, default: false },
  pohBalance:   { type: Number,  default: 0 },
  LISTING_FEE_POH: { type: Number, default: 1000 },
})

const emit = defineEmits([
  'update:listing',
  'update:headers',
  'fetch-abi',
  'pick-method',
  'add-header',
  'remove-header',
  'submit-listing',
  'auto-expand',
])

function updateListing(key, val) {
  emit('update:listing', { ...props.listing, [key]: val })
}

function updateListingAndReset(key, val) {
  emit('update:listing', { ...props.listing, [key]: val })
  // reset abiFns via parent by re-triggering fetch
}

// ── Test ──────────────────────────────────────────────────────────────────────

const testAddresses = ref([''])
const testRunning   = ref(false)
const testResults   = ref([])   // [{ address, loading, result, error }]

function addTestAddress() {
  testAddresses.value.push('')
}
function removeTestAddress(i) {
  testAddresses.value.splice(i, 1)
  testResults.value.splice(i, 1)
}

function buildMethod() {
  const m = { ...props.listing }
  if (m.type === 'rest') {
    m.method = m.httpMethod
    m.headers = JSON.stringify(
      (props.headers || []).reduce((a, h) => { if (h.key) a[h.key] = h.value; return a }, {})
    )
  }
  return m
}

async function runTest() {
  const addrs = testAddresses.value.map(a => a.trim()).filter(Boolean)
  if (!addrs.length) return
  testRunning.value = true
  testResults.value = addrs.map(address => ({ address, loading: true, result: null, error: null }))

  const m = buildMethod()
  await Promise.all(addrs.map(async (address, i) => {
    try {
      const { data } = await axios.post('/checker/preview', { address, method: m })
      if (data.error) testResults.value[i] = { address, loading: false, result: null, error: data.error, ms: data.ms }
      else            testResults.value[i] = { address, loading: false, result: data, error: null }
    } catch (e) {
      testResults.value[i] = { address, loading: false, result: null, error: e.response?.data?.error || e.message }
    }
  }))
  testRunning.value = false
}

const resolvedUrl = computed(() => {
  if (props.listing.type !== 'rest' || !props.listing.address) return null
  const addr = testAddresses.value[0]?.trim()
  if (!addr) return props.listing.address
  return props.listing.address.replace(/\{address\}/g, addr)
})
</script>

<template>
  <div class="content-section">
    <div class="listing-header">
      <div class="scan-tag">METHOD LISTING</div>
      <h2 class="scan-title">Submit a detection method</h2>
      <p class="scan-sub">Define a signal and pay 1000 POH to register it. 500 POH goes to stakers immediately, 500 to the protocol. Earn rewards when your method is used in scans.</p>
    </div>

    <div class="form-section">
      <div class="form-label-row">
        <span class="form-section-label">Method Type</span>
      </div>
      <div class="type-tabs">
        <button :class="['type-tab', { active: listing.type === 'evm' }]" @click="updateListing('type', 'evm'); emit('fetch-abi')">EVM Contract</button>
        <button :class="['type-tab', { active: listing.type === 'solana' }]" @click="updateListing('type', 'solana'); emit('fetch-abi')">Solana Program</button>
        <button :class="['type-tab', { active: listing.type === 'rest' }]" @click="updateListing('type', 'rest')">REST API</button>
      </div>
    </div>

    <!-- EVM fields -->
    <div v-if="listing.type === 'evm'" class="form-section">
      <div class="form-label-row"><span class="form-section-label">Contract</span></div>
      <div class="input-group">
        <div class="form-row">
          <div class="form-col-sm">
            <label class="field-label">Chain ID</label>
            <input type="number" :value="listing.chainId" @input="updateListing('chainId', $event.target.value)" placeholder="1" class="premium-input" />
          </div>
          <div class="form-col-lg">
            <label class="field-label">Contract Address</label>
            <div class="flex-input">
              <input type="text" :value="listing.address" @input="updateListing('address', $event.target.value)" placeholder="0x..." class="premium-input flex-grow" @blur="emit('fetch-abi')" />
              <button @click="emit('fetch-abi')" :disabled="abiLoading || !listing.address" class="mini-btn">{{ abiLoading ? '...' : 'Fetch ABI' }}</button>
            </div>
          </div>
        </div>
        <div v-if="abiError" class="field-hint field-hint--warn">{{ abiError }}</div>
        <div v-if="abiFns.length" class="abi-picker">
          <div class="abi-picker-header">
            <span class="abi-picker-label">ABI Methods</span>
            <span class="abi-picker-count">{{ abiFns.length }} found</span>
          </div>
          <div class="abi-picker-list">
            <button v-for="fn in abiFns" :key="fn.name" @click="emit('pick-method', fn)" :class="['abi-fn-btn', { selected: listing.method === fn.name }]">{{ fn.name }}</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-col">
            <label class="field-label">Method Name <span class="field-hint-inline">e.g. balanceOf</span></label>
            <input type="text" :value="listing.method" @input="updateListing('method', $event.target.value)" placeholder="balanceOf" class="premium-input font-mono" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-col">
            <label class="field-label">Input Types <span class="field-hint-inline">JSON array e.g. ["address"]</span></label>
            <input type="text" :value="listing.abiTypes" @input="updateListing('abiTypes', $event.target.value)" placeholder='["address"]' class="premium-input font-mono" />
          </div>
          <div class="form-col">
            <label class="field-label">Return Types <span class="field-hint-inline">JSON array e.g. ["uint256"]</span></label>
            <input type="text" :value="listing.returnTypes" @input="updateListing('returnTypes', $event.target.value)" placeholder='["uint256"]' class="premium-input font-mono" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-col-sm">
            <label class="field-label">Decimals <span class="field-hint-inline">for token values</span></label>
            <input type="number" :value="listing.decimals" @input="updateListing('decimals', $event.target.value)" placeholder="18" class="premium-input" />
          </div>
        </div>
      </div>
    </div>

    <!-- Solana fields -->
    <div v-if="listing.type === 'solana'" class="form-section">
      <div class="form-label-row"><span class="form-section-label">Program</span></div>
      <div class="input-group">
        <div>
          <label class="field-label">Program Address (Mint for token balance)</label>
          <div class="flex-input">
            <input type="text" :value="listing.address" @input="updateListing('address', $event.target.value)" placeholder="Program or mint address" class="premium-input flex-grow" @blur="emit('fetch-abi')" />
            <button @click="emit('fetch-abi')" :disabled="abiLoading || !listing.address" class="mini-btn">{{ abiLoading ? '...' : 'Fetch IDL' }}</button>
          </div>
        </div>
        <div v-if="abiError" class="field-hint field-hint--warn">{{ abiError }}</div>
        <div v-if="abiFns.length" class="abi-picker">
          <div class="abi-picker-header">
            <span class="abi-picker-label">IDL Instructions</span>
            <span class="abi-picker-count">{{ abiFns.length }} found</span>
          </div>
          <div class="abi-picker-list">
            <button v-for="fn in abiFns" :key="fn.name" @click="emit('pick-method', fn)" :class="['abi-fn-btn', { selected: listing.method === fn.name }]">{{ fn.name }}</button>
          </div>
        </div>
        <div>
          <label class="field-label">Method</label>
          <select :value="listing.method" @change="updateListing('method', $event.target.value)" class="premium-select">
            <option value="getBalance">getBalance — native SOL balance</option>
            <option value="getTransactionCount">getTransactionCount — tx history count</option>
            <option value="getTokenBalance">getTokenBalance — SPL token balance (requires mint address above)</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-col-sm">
            <label class="field-label">Decimals</label>
            <input type="number" :value="listing.decimals" @input="updateListing('decimals', $event.target.value)" placeholder="9" class="premium-input" />
          </div>
        </div>
      </div>
    </div>

    <!-- REST fields -->
    <div v-if="listing.type === 'rest'" class="form-section">
      <div class="form-label-row"><span class="form-section-label">Endpoint</span></div>
      <div class="input-group">
        <div>
          <label class="field-label">URL <span class="field-hint-inline">use {address} as placeholder</span></label>
          <input type="text" :value="listing.address" @input="updateListing('address', $event.target.value)" placeholder="https://api.example.com/check?address={address}" class="premium-input font-mono" />
        </div>
        <div class="form-row">
          <div class="form-col-sm">
            <label class="field-label">HTTP Method</label>
            <select :value="listing.httpMethod" @change="updateListing('httpMethod', $event.target.value)" class="premium-select">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </div>
          <div class="form-col-sm">
            <label class="field-label">Decimals <span class="field-hint-inline">optional</span></label>
            <input type="number" :value="listing.decimals" @input="updateListing('decimals', $event.target.value)" placeholder="18" class="premium-input" />
          </div>
        </div>
        <div v-if="listing.httpMethod === 'POST'">
          <label class="field-label">Request Body <span class="field-hint-inline">JSON template, use {address}</span></label>
          <textarea :value="listing.body" @input="updateListing('body', $event.target.value)" placeholder='{"address": "{address}"}' class="premium-textarea font-mono" rows="3"></textarea>
        </div>
        <div>
          <div class="form-label-row">
            <span class="field-label">Headers</span>
            <button class="utility-link" @click="emit('add-header')">+ Add</button>
          </div>
          <div class="input-group" style="gap:0.4rem">
            <div v-for="(h, i) in headers" :key="i" class="flex-input">
              <input type="text" v-model="h.key" placeholder="Header name" class="premium-input flex-grow" />
              <input type="text" v-model="h.value" placeholder="Value" class="premium-input flex-grow" />
              <button @click="emit('remove-header', i)" class="mini-btn" :disabled="headers.length === 1">×</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Expression — shared -->
    <div class="form-section">
      <div class="form-label-row"><span class="form-section-label">Expression</span></div>
      <div class="input-group">
        <div class="form-row">
          <div class="form-col">
            <label class="field-label">
              Logic
              <span v-if="listing.type === 'rest'" class="field-hint-inline">variables: data, status, decimals</span>
              <span v-else class="field-hint-inline">variables: result (array), decimals</span>
            </label>
            <textarea :value="listing.expression" @input="updateListing('expression', $event.target.value)" placeholder="result[0] > 0n" class="premium-textarea font-mono" rows="3"></textarea>
          </div>
          <div class="form-col-sm">
            <label class="field-label">Language</label>
            <select :value="listing.lang" @change="updateListing('lang', $event.target.value)" class="premium-select">
              <option value="js">JavaScript</option>
              <option value="python">Python</option>
              <option value="rust">Rust</option>
              <option value="go">Go</option>
              <option value="php">PHP</option>
              <option value="java">Java</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Test — shared -->
    <div class="form-section">
      <div class="form-label-row">
        <span class="form-section-label">Test</span>
        <span class="field-hint-inline">Run live against real addresses before submitting</span>
      </div>
      <div class="input-group">

        <!-- Address inputs -->
        <div class="test-addr-list">
          <div v-for="(_, i) in testAddresses" :key="i" class="flex-input">
            <input
              v-model="testAddresses[i]"
              type="text"
              :placeholder="listing.type === 'evm' ? '0x… wallet address' : listing.type === 'rest' ? 'Address / identifier' : 'Solana wallet pubkey'"
              class="premium-input flex-grow font-mono"
              @keydown.enter="runTest"
            />
            <button v-if="testAddresses.length > 1" class="mini-btn" @click="removeTestAddress(i)">×</button>
          </div>
          <button class="utility-link" @click="addTestAddress">+ Add address</button>
        </div>

        <!-- Resolved URL preview for REST -->
        <div v-if="listing.type === 'rest' && resolvedUrl" class="test-resolved-url">
          <span class="test-url-label">{{ listing.httpMethod || 'GET' }}</span>
          <span class="test-url-val">{{ resolvedUrl }}</span>
        </div>

        <button
          class="test-run-btn"
          :disabled="testRunning || !testAddresses.some(a => a.trim())"
          @click="runTest"
        >
          <span v-if="testRunning" class="test-spinner"></span>
          {{ testRunning ? 'Running…' : 'Run Test' }}
        </button>

        <!-- Results -->
        <div v-for="r in testResults" :key="r.address" class="test-result-block">
          <div class="test-result-header">
            <code class="test-result-addr">{{ r.address }}</code>
            <span v-if="r.result?.ms != null" class="test-result-ms">{{ r.result.ms }}ms</span>
            <span v-if="r.loading" class="test-result-ms">running…</span>
          </div>

          <div v-if="r.error" class="test-result-error">{{ r.error }}</div>

          <template v-if="r.result">
            <!-- Expression verdict -->
            <div v-if="r.result.expressionResult !== null && r.result.expressionResult !== undefined"
                 class="preview-verdict"
                 :class="r.result.expressionResult ? 'verdict-pass' : 'verdict-fail'">
              <span class="verdict-icon">{{ r.result.expressionResult ? '✓' : '✗' }}</span>
              Expression → <code class="verdict-value">{{ String(r.result.expressionResult) }}</code>
            </div>
            <div v-else-if="listing.expression" class="test-result-no-expr">
              (expression not evaluated — fill in expression above)
            </div>

            <!-- Resolved URL (REST) -->
            <div v-if="r.result.resolvedUrl && r.result.resolvedUrl !== resolvedUrl" class="test-resolved-url" style="margin-top:0.4rem">
              <span class="test-url-label">URL</span>
              <span class="test-url-val">{{ r.result.resolvedUrl }}</span>
            </div>

            <!-- Raw response -->
            <div class="preview-raw">
              <div class="test-raw-header">
                <span class="preview-raw-label">Raw response</span>
                <span v-if="r.result.rawResult?.status" :class="['test-status', r.result.rawResult.status < 400 ? 'test-status-ok' : 'test-status-err']">
                  HTTP {{ r.result.rawResult.status }}
                </span>
              </div>
              <pre class="preview-raw-data">{{ JSON.stringify(
                r.result.rawResult?.data !== undefined ? r.result.rawResult.data : r.result.rawResult,
                null, 2) }}</pre>
            </div>
          </template>
        </div>

      </div>
    </div>

    <!-- Description + submit — shared -->
    <div class="form-section">
      <div class="form-label-row"><span class="form-section-label">Description</span></div>
      <div class="input-group">
        <textarea :value="listing.description" @input="updateListing('description', $event.target.value)" placeholder="What does this method detect? What constitutes human evidence?" class="premium-textarea" rows="2" @input.native="emit('auto-expand', $event)"></textarea>
        <div class="listing-fee-row">
          <span class="listing-fee-label">Listing fee: <strong>1000 POH</strong></span>
          <span class="listing-fee-balance" :class="{ insufficient: pohBalance < 1000 }">
            Balance: {{ pohBalance.toFixed(2) }} POH
          </span>
        </div>
        <button @click="emit('submit-listing')" :disabled="loading || !listing.description || pohBalance < 1000" class="submit-listing-btn">
          {{ loading ? 'Confirming on-chain...' : 'Submit Method — 1000 POH' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Test section ─────────────────────────────────────────────────────────── */
.test-addr-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.test-run-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.25rem;
  background: rgba(74,222,128,0.07);
  border: 1px solid rgba(74,222,128,0.2);
  border-radius: 8px;
  color: #4ade80;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  align-self: flex-start;
}
.test-run-btn:not(:disabled):hover {
  background: rgba(74,222,128,0.13);
  border-color: rgba(74,222,128,0.4);
}
.test-run-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.test-spinner {
  width: 12px; height: 12px;
  border: 1.5px solid rgba(74,222,128,0.3);
  border-top-color: #4ade80;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

.test-resolved-url {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  background: #060606;
  border: 1px solid #141414;
  border-radius: 6px;
  overflow: hidden;
}
.test-url-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: #555;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}
.test-url-val {
  font-size: 0.72rem;
  color: #666;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-result-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem;
  background: #060606;
  border: 1px solid #141414;
  border-radius: 8px;
}
.test-result-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.test-result-addr {
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', monospace;
  color: #888;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.test-result-ms {
  font-size: 0.68rem;
  color: #444;
  font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
}
.test-result-error {
  font-size: 0.8rem;
  color: #e05c5c;
  padding: 0.3rem 0;
}
.test-result-no-expr {
  font-size: 0.75rem;
  color: #333;
}

/* Shared verdict + raw (also used by legacy paths) */
.preview-verdict {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  border: 1px solid;
}
.verdict-pass { color: #4ade80; border-color: #1a3a22; background: #0a1f11; }
.verdict-fail { color: #e05c5c; border-color: #3a1a1a; background: #1f0a0a; }
.verdict-icon { font-size: 1rem; font-weight: 700; }
.verdict-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.82rem;
  background: rgba(255,255,255,0.06);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.preview-raw { display: flex; flex-direction: column; gap: 0.3rem; }
.test-raw-header { display: flex; align-items: center; gap: 0.5rem; }
.preview-raw-label { font-size: 0.7rem; color: #444; text-transform: uppercase; letter-spacing: 0.05em; }
.test-status {
  font-size: 0.68rem;
  font-family: 'JetBrains Mono', monospace;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-weight: 600;
}
.test-status-ok  { color: #4ade80; background: rgba(74,222,128,0.08); }
.test-status-err { color: #e05c5c; background: rgba(224,92,92,0.08); }

.preview-raw-data {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  color: #666;
  background: #030303;
  border: 1px solid #111;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 280px;
  overflow-y: auto;
}
</style>
