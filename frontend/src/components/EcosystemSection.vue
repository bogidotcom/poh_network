<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { ExternalLink, Globe } from 'lucide-vue-next'

const projects  = ref([])
const loading   = ref(false)
const view      = ref('list')

const form = ref({ name: '', website: '', logo: '', description: '', integration: '', contact: '' })
const submitting = ref(false)
const submitMsg  = ref(null)

async function loadProjects() {
  loading.value = true
  try {
    const res = await axios.get('/ecosystem')
    projects.value = res.data
  } catch {
    projects.value = []
  } finally {
    loading.value = false
  }
}

async function submitApplication() {
  submitMsg.value = null
  const f = form.value
  if (!f.name || !f.website || !f.description || !f.integration || !f.contact) {
    submitMsg.value = { ok: false, text: 'Please fill in all required fields.' }
    return
  }
  submitting.value = true
  try {
    await axios.post('/ecosystem/apply', f)
    submitMsg.value = { ok: true, text: 'Application submitted — we will review it and get back to you.' }
    form.value = { name: '', website: '', logo: '', description: '', integration: '', contact: '' }
  } catch (err) {
    submitMsg.value = { ok: false, text: err.response?.data?.error || 'Submission failed, try again.' }
  } finally {
    submitting.value = false
  }
}

onMounted(loadProjects)
</script>

<template>
  <div class="content-section">
    <div class="listing-header">
      <div class="scan-tag">ECOSYSTEM</div>
      <h2 class="scan-title">Integrated Projects</h2>
      <p class="scan-sub">Projects and protocols that use POH's humanity verification. Each integration is manually reviewed before listing.</p>
    </div>

    <!-- View switcher — same pill style as Train tabs -->
    <div class="form-section">
      <div class="form-label-row">
        <span class="form-section-label">View</span>
      </div>
      <div class="type-tabs">
        <button :class="['type-tab', { active: view === 'list' }]" @click="view = 'list'">Partners</button>
        <button :class="['type-tab', { active: view === 'apply' }]" @click="view = 'apply'">Apply for Integration</button>
      </div>
    </div>

    <!-- ── Partner list ─────────────────────────────────────────────────────── -->
    <template v-if="view === 'list'">
      <div v-if="loading" class="empty-state"><p>Loading...</p></div>

      <div v-else-if="projects.length === 0" class="form-section" style="text-align:center;padding:2.5rem 1.5rem">
        <Globe :size="32" style="color:#333;margin-bottom:1rem" />
        <p style="color:#555;margin-bottom:1.5rem;font-size:0.9rem">No integrations listed yet.</p>
        <button class="submit-listing-btn" @click="view = 'apply'">Be the first →</button>
      </div>

      <div v-else class="eco-grid">
        <div v-for="p in projects" :key="p.id" class="form-section eco-card">
          <div class="eco-card-top">
            <div class="eco-logo">
              <img v-if="p.logo" :src="p.logo" :alt="p.name" class="eco-logo-img" @error="e => e.target.style.display='none'" />
              <span v-else class="eco-logo-fallback">{{ p.name?.charAt(0)?.toUpperCase() }}</span>
            </div>
            <div>
              <div class="eco-card-name">{{ p.name }}</div>
              <a v-if="p.website" :href="p.website" target="_blank" rel="noopener" class="eco-link">
                {{ p.website.replace(/^https?:\/\//, '') }} <ExternalLink :size="10" />
              </a>
            </div>
          </div>
          <p class="eco-card-text">{{ p.description }}</p>
          <div class="form-label-row" style="margin-top:0.75rem;margin-bottom:0.4rem">
            <span class="form-section-label">Integration</span>
          </div>
          <p class="eco-card-text eco-card-integration">{{ p.integration }}</p>
        </div>
      </div>
    </template>

    <!-- ── Application form ─────────────────────────────────────────────────── -->
    <template v-if="view === 'apply'">
      <div class="form-section">
        <div class="form-label-row">
          <span class="form-section-label">Project Info</span>
        </div>
        <div class="input-group">
          <div>
            <label class="field-label">Project name <span class="field-required">*</span></label>
            <input v-model="form.name" class="premium-input" placeholder="e.g. MyProtocol" />
          </div>
          <div>
            <label class="field-label">Website <span class="field-required">*</span></label>
            <input v-model="form.website" class="premium-input" placeholder="https://myprotocol.xyz" />
          </div>
          <div>
            <label class="field-label">Logo URL <span class="field-hint-inline">optional</span></label>
            <input v-model="form.logo" class="premium-input" placeholder="https://myprotocol.xyz/logo.png" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-label-row">
          <span class="form-section-label">Integration Details</span>
        </div>
        <div class="input-group">
          <div>
            <label class="field-label">What does your project do? <span class="field-required">*</span></label>
            <textarea v-model="form.description" class="premium-textarea" placeholder="Brief description of your project..." rows="3"></textarea>
          </div>
          <div>
            <label class="field-label">What is the POH integration for? <span class="field-required">*</span></label>
            <textarea v-model="form.integration" class="premium-textarea" placeholder="e.g. We use POH to gate access to our airdrop, ensuring only verified humans can claim..." rows="3"></textarea>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-label-row">
          <span class="form-section-label">Contact</span>
        </div>
        <div class="input-group">
          <div>
            <label class="field-label">Email <span class="field-required">*</span></label>
            <input v-model="form.contact" class="premium-input" placeholder="team@myprotocol.xyz" type="email" />
          </div>
        </div>
      </div>

      <div v-if="submitMsg" :class="['eco-msg', submitMsg.ok ? 'eco-msg--ok' : 'eco-msg--err']">
        {{ submitMsg.text }}
      </div>

      <button class="submit-listing-btn" :disabled="submitting" @click="submitApplication">
        {{ submitting ? 'Submitting...' : 'Submit Application' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.field-required { color: #e05050; }
.field-hint-inline { color: #2e2e2e; font-weight: 400; margin-left: 0.3rem; font-size: 0.68rem; }

/* Partner grid */
.eco-grid { display: flex; flex-direction: column; gap: 0.75rem; }
.eco-card { display: flex; flex-direction: column; gap: 0.5rem; }

.eco-card-top {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}
.eco-logo {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #111;
  border: 1px solid #1e1e1e;
  display: flex;
  align-items: center;
  justify-content: center;
}
.eco-logo-img  { width: 100%; height: 100%; object-fit: cover; }
.eco-logo-fallback { font-size: 1.1rem; font-weight: 700; color: #444; }
.eco-card-name { font-size: 0.9rem; font-weight: 600; color: #ddd; }
.eco-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.73rem;
  color: #555;
  text-decoration: none;
  transition: color 0.15s;
}
.eco-link:hover { color: #aaa; }
.eco-card-text { font-size: 0.82rem; color: #666; line-height: 1.55; margin: 0; }
.eco-card-integration { color: #505050; }

/* Feedback messages */
.eco-msg {
  font-size: 0.84rem;
  padding: 0.65rem 1rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
.eco-msg--ok  { background: #061106; color: #4caf50; border: 1px solid #0d2e0d; }
.eco-msg--err { background: #110606; color: #e05050; border: 1px solid #2e0d0d; }
</style>
