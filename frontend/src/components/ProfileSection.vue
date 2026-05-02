<script setup>
const props = defineProps({
  connected:         { type: Boolean, default: false },
  profileData:       { type: Object,  default: null },
  profileLoading:    { type: Boolean, default: false },
  profileError:      { type: String,  default: null },
  signupLoading:     { type: Boolean, default: false },
  myVotesData:       { type: Array,   default: () => [] },
  offchainClaimLoading: { type: Boolean, default: false },
})

const emit = defineEmits([
  'show-wallet-modal',
  'show-deposit-modal',
  'signup-profile',
  'rotate-api-key',
  'claim-offchain-balance',
  'copy-text',
  'show-section',
  'load-voting',
])
</script>

<template>
  <div class="profile-page">
    <div class="scan-hero">
      <div class="scan-tag">PROFILE</div>
      <h2 class="scan-title">Your POH Account</h2>
      <p class="scan-sub">Sign in with your Solana wallet to access your API key, track rewards, and manage your submitted methods.</p>
    </div>

    <div v-if="!connected" class="profile-connect-prompt">
      <p class="prompt-text">Connect your Solana wallet to view your profile.</p>
      <button class="submit-listing-btn" @click="emit('show-wallet-modal')">Connect Wallet</button>
    </div>

    <template v-else>
      <div v-if="profileError" class="profile-error">{{ profileError }}</div>

      <div v-if="profileLoading" class="empty-state"><p>Loading profile...</p></div>

      <div v-else-if="!profileData" class="profile-signup-card">
        <p class="signup-desc">No profile found for this wallet. Create one to get your API key and start earning rewards from submitted methods.</p>
        <button class="submit-listing-btn" :disabled="signupLoading" @click="emit('signup-profile')">
          {{ signupLoading ? 'Signing...' : 'Create Profile' }}
        </button>
      </div>

      <template v-else>
        <!-- Stats row -->
        <div class="profile-stats">
          <div class="pstat-card">
            <div class="pstat-val">{{ profileData.profile?.freeScansLeft ?? 100 }}</div>
            <div class="pstat-label">Free Scans Left</div>
          </div>
          <div class="pstat-card">
            <div class="pstat-val">{{ profileData.profile?.totalScans ?? 0 }}</div>
            <div class="pstat-label">Total Scans</div>
          </div>
          <div class="pstat-card deposit-stat" @click="emit('show-deposit-modal')" title="Click to deposit POH">
            <div class="pstat-val">{{ ((profileData.profile?.balance ?? 0) / 1e6).toFixed(2) }}</div>
            <div class="pstat-label">Account Balance (POH) <br><span class="pstat-deposit-hint">Tap to Deposit</span></div>
          </div>
          <div class="pstat-card">
            <div class="pstat-val">{{ profileData.earned ? (profileData.earned / 1e6).toFixed(2) : '0.00' }}</div>
            <div class="pstat-label">Total Earned</div>
          </div>
        </div>

        <!-- Claimable scan earnings -->
        <div v-if="(profileData.pending ?? 0) > 0" class="profile-card profile-claim-card">
          <div class="profile-card-header">
            <span class="profile-card-title">Scan Earnings</span>
            <span class="claim-amount">{{ (profileData.pending / 1e6).toFixed(4) }} POH</span>
          </div>
          <p class="profile-hint">Your methods earned this from paid scans. Claim to receive tokens on-chain.</p>
          <button class="submit-listing-btn claim-btn" :disabled="offchainClaimLoading" @click="emit('claim-offchain-balance')">
            {{ offchainClaimLoading ? 'Claiming...' : 'Claim Earnings' }}
          </button>
        </div>

        <!-- API Key -->
        <div class="profile-card">
          <div class="profile-card-header">
            <span class="profile-card-title">API Key</span>
            <button class="mini-btn" @click="emit('rotate-api-key')">Rotate</button>
          </div>
          <div class="apikey-row">
            <code class="apikey-display">{{ profileData.profile?.apiKey }}</code>
            <button class="mini-btn" @click="emit('copy-text', profileData.profile?.apiKey)">Copy</button>
          </div>
          <p class="profile-hint">Pass as <code>apiKey</code> in POST /checker body. Identify scans without wallet interaction.</p>
        </div>

        <!-- Submitted methods -->
        <div class="profile-card">
          <div class="profile-card-header">
            <span class="profile-card-title">Submitted Methods</span>
            <span class="profile-card-count">{{ profileData.methods?.length ?? 0 }}</span>
          </div>
          <div v-if="!profileData.methods?.length" class="profile-empty">
            No methods submitted yet.
            <button class="utility-link no-margin" @click="emit('show-section', 'listing')">Submit one →</button>
          </div>
          <div v-else class="method-list-profile">
            <div v-for="m in profileData.methods" :key="m.id" class="mlist-row">
              <div class="mlist-main">
                <span class="mlist-type">{{ m.type?.toUpperCase() }}</span>
                <span class="mlist-desc">{{ m.description }}</span>
              </div>
              <div class="mlist-meta">
                <span class="mlist-score">score {{ m.score?.toFixed(1) ?? '0.0' }}</span>
                <span class="mlist-earned">{{ ((profileData.pending || 0) / 1e6).toFixed(4) }} POH pending</span>
              </div>
            </div>
          </div>
        </div>

        <!-- My Votes -->
        <div class="profile-card">
          <div class="profile-card-header">
            <span class="profile-card-title">My Votes</span>
            <span class="profile-card-count">{{ myVotesData.length }}</span>
          </div>
          <div v-if="!myVotesData.length" class="profile-empty">
            No votes cast yet.
            <button class="utility-link no-margin" @click="emit('show-section', 'votes'); emit('load-voting')">Go vote →</button>
          </div>
          <div v-else class="method-list-profile">
            <div v-for="v in myVotesData" :key="v.methodId" class="mlist-row">
              <div class="mlist-main">
                <span class="mlist-type">{{ v.type?.toUpperCase() }}</span>
                <span class="mlist-desc">{{ v.description }}</span>
              </div>
              <div v-if="v.feedback" class="mlist-feedback">"{{ v.feedback }}"</div>
              <div class="mlist-meta">
                <span :class="['vote-badge', v.vote ? 'vote-human' : 'vote-bot']">
                  {{ v.vote ? '✓ Human' : '✗ Bot' }}
                </span>
                <span class="mlist-score">{{ new Date(v.at).toLocaleDateString() }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
