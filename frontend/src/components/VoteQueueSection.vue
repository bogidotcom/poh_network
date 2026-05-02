<script setup>
import { Code } from 'lucide-vue-next'

const props = defineProps({
  loading:          { type: Boolean, default: false },
  votingList:       { type: Array,   default: () => [] },
  voteIndex:        { type: Number,  default: 0 },
  currentVoteItem:  { type: Object,  default: null },
  voteSubmitting:   { type: Boolean, default: false },
  voteFeedback:     { type: String,  default: '' },
  feedbackValidating: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:voteIndex',
  'update:voteFeedback',
  'cast-vote',
  'auto-expand',
])
</script>

<template>
  <div class="votes-page">
    <div class="votes-header">
      <div class="scan-tag">CONSENSUS QUEUE</div>
      <h2 class="scan-title">Review detection methods</h2>
      <p class="scan-sub">Vote on whether each method reliably distinguishes humans from bots. Your POH stake weight determines your influence.</p>
    </div>

    <div v-if="loading" class="empty-state"><p>Loading...</p></div>

    <div v-else-if="!currentVoteItem" class="empty-state">
      <Code :size="28" />
      <p>{{ votingList.length ? 'All methods reviewed.' : 'Queue is empty.' }}</p>
      <button v-if="votingList.length" class="utility-link" @click="emit('update:voteIndex', 0)">Start over</button>
    </div>

    <div v-else class="vote-single">
      <div class="vote-progress">
        <div class="vote-progress-bar">
          <div class="vote-progress-fill" :style="{ width: (voteIndex / votingList.length * 100) + '%' }"></div>
        </div>
        <span class="vote-progress-label">{{ voteIndex + 1 }} / {{ votingList.length }}</span>
      </div>

      <div class="vote-card-single">
        <div class="vcs-meta">
          <span class="vmc-type">{{ currentVoteItem.type?.toUpperCase() }}</span>
          <span v-if="currentVoteItem.chainId" class="vcs-chain">chain {{ currentVoteItem.chainId }}</span>
          <span class="vmc-score">score {{ currentVoteItem.score?.toFixed(1) ?? '0.0' }}</span>
        </div>

        <p class="vcs-desc">{{ currentVoteItem.description }}</p>

        <div class="vcs-detail" v-if="currentVoteItem.address">
          <span class="vcs-detail-label">{{ currentVoteItem.type === 'rest' ? 'Endpoint' : 'Address' }}</span>
          <span class="vcs-detail-val">{{ currentVoteItem.address }}</span>
        </div>
        <div class="vcs-detail" v-if="currentVoteItem.method">
          <span class="vcs-detail-label">Method</span>
          <span class="vcs-detail-val">{{ currentVoteItem.method }}</span>
        </div>
        <div class="vcs-detail" v-if="currentVoteItem.expression">
          <span class="vcs-detail-label">Expression</span>
          <code class="vcs-code">{{ currentVoteItem.expression }}</code>
        </div>

        <div class="vcs-score-bar">
          <div class="vcs-score-fill" :style="{ width: Math.min(100, Math.max(0, (currentVoteItem.score || 0) * 10)) + '%' }"></div>
        </div>

        <textarea
          :value="voteFeedback"
          @input="emit('update:voteFeedback', $event.target.value)"
          class="vcs-feedback"
          placeholder="Optional: explain your reasoning to help the AI learn…"
          rows="2"
          maxlength="200"
          @input.native="emit('auto-expand', $event)"
        ></textarea>

        <div class="vcs-actions">
          <button class="vcs-btn vcs-btn-yes" :disabled="voteSubmitting || feedbackValidating" @click="emit('cast-vote', true)">
            {{ feedbackValidating ? 'Checking…' : voteSubmitting ? '…' : '✓ Human' }}
          </button>
          <button class="vcs-btn vcs-btn-no" :disabled="voteSubmitting || feedbackValidating" @click="emit('cast-vote', false)">
            {{ feedbackValidating ? 'Checking…' : '✗ Robot' }}
          </button>
          <button class="vcs-btn vcs-btn-skip" :disabled="feedbackValidating" @click="emit('cast-vote', 'skip')">
            Skip →
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
