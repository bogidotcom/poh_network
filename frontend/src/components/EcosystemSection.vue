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
  <div class="eco-page">
    <div class="scan-hero">
      <div class="scan-tag">ECOSYSTEM</div>
      <h2 class="scan-title">Integrated Projects</h2>
      <p class="scan-sub">Projects and protocols that use POH's humanity verification. Each integration is manually reviewed before listing.</p>
    </div>

    <!-- Tab toggle -->
    <div class="eco-tabs">
      <button :class="['eco-tab', { active: view === 'list' }]" @click="view = 'list'">Partners</button>
      <button :class="['eco-tab', { active: view === 'apply' }]" @click="view = 'apply'">Apply for Integration</button>
    </div>

    <!-- ── Partner list ─────────────────────────────────────────────────────── -->
    <div v-if="view === 'list'">
      <div v-if="loading" class="empty-state"><p>Loading...</p></div>

      <div v-else-if="projects.length === 0" class="empty-state">
        <Globe :size="36" style="color:#333;margin-bottom:1rem" />
        <p style="margin-bottom:1.25rem">No integrations listed yet.</p>
        <button class="submit-listing-btn" style="max-width:220px;margin:0 auto" @click="view = 'apply'">Be the first →</button>
      </div>

      <div v-else class="eco-grid">
        <div v-for="p in projects" :key="p.id" class="glass-panel eco-card">
          <div class="eco-logo">
            <img v-if="p.logo" :src="p.logo" :alt="p.name" class="eco-logo-img" @error="e => e.target.style.display='none'" />
            <span v-else class="eco-logo-fallback">{{ p.name?.charAt(0)?.toUpperCase() }}</span>
          </div>
          <div class="eco-card-body">
            <div class="eco-card-name">{{ p.name }}</div>
            <p class="eco-card-text">{{ p.description }}</p>
            <div class="eco-integration-row">
              <span class="form-section-label">Integration</span>
              <p class="eco-card-text eco-card-integration">{{ p.integration }}</p>
            </div>
            <a v-if="p.website" :href="p.website" target="_blank" rel="noopener" class="eco-link">
              Visit site <ExternalLink :size="11" />
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Application form ─────────────────────────────────────────────────── -->
    <div v-if="view === 'apply'" style="max-width:640px">
      <div class="form-section">
        <div class="form-label-row">
          <span class="form-section-label">Project Info</span>
        </div>
        <div class="input-group">
          <div>
            <label class="field-label">Project name <span style="color:#e05">*</span></label>
            <input v-model="form.name" class="premium-input" placeholder="e.g. MyProtocol" />
          </div>
          <div>
            <label class="field-label">Website <span style="color:#e05">*</span></label>
            <input v-model="form.website" class="premium-input" placeholder="https://myprotocol.xyz" />
          </div>
          <div>
            <label class="field-label">Logo URL <span style="color:#3a3a3a;font-size:0.68rem">(optional)</span></label>
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
            <label class="field-label">What does your project do? <span style="color:#e05">*</span></label>
            <textarea v-model="form.description" class="premium-input premium-textarea" placeholder="Brief description of your project..." rows="3"></textarea>
          </div>
          <div>
            <label class="field-label">What is the POH integration for? <span style="color:#e05">*</span></label>
            <textarea v-model="form.integration" class="premium-input premium-textarea" placeholder="e.g. We use POH to gate access to our airdrop, ensuring only verified humans can claim..." rows="3"></textarea>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-label-row">
          <span class="form-section-label">Contact</span>
        </div>
        <div>
          <label class="field-label">Email <span style="color:#e05">*</span></label>
          <input v-model="form.contact" class="premium-input" placeholder="team@myprotocol.xyz" type="email" />
        </div>
      </div>

      <div v-if="submitMsg" :class="['eco-msg', submitMsg.ok ? 'eco-msg--ok' : 'eco-msg--err']">
        {{ submitMsg.text }}
      </div>

      <button class="submit-listing-btn" :disabled="submitting" @click="submitApplication">
        {{ submitting ? 'Submitting...' : 'Submit Application' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.eco-page { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 4rem; }

.eco-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 2rem;
  border-bottom: 1px solid #1a1a1a;
}
.eco-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #555;
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.6rem 1.2rem;
  margin-bottom: -1px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.eco-tab.active { color: #eee; border-bottom-color: #fff; }
.eco-tab:hover:not(.active) { color: #aaa; }

/* Cards */
.eco-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 1rem;
}
.eco-card {
  padding: 1.25rem;
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.eco-logo {
  width: 44px;
  height: 44px;
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
.eco-logo-fallback { font-size: 1.2rem; font-weight: 700; color: #555; }
.eco-card-body { flex: 1; min-width: 0; }
.eco-card-name { font-size: 0.95rem; font-weight: 600; color: #eee; margin-bottom: 0.4rem; }
.eco-card-text { font-size: 0.81rem; color: #666; line-height: 1.55; margin: 0; }
.eco-integration-row { margin: 0.65rem 0 0.5rem; }
.eco-card-integration { margin-top: 0.2rem; color: #555; }
.eco-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.76rem;
  color: #555;
  text-decoration: none;
  margin-top: 0.5rem;
  transition: color 0.15s;
}
.eco-link:hover { color: #ccc; }

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
