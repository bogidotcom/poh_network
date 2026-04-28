<script setup>
import { useWallet } from '../composables/useWallet.js'
const { showWalletModal, connectWallet } = useWallet()
</script>

<template>
  <div v-if="showWalletModal" class="modal-overlay" @click.self="showWalletModal = false">
    <div class="glass-panel modal">
      <h3 class="modal-title">Select Wallet</h3>
      <button class="wallet-option" @click="connectWallet('phantom')">Phantom</button>
      <button class="wallet-option" @click="connectWallet('solflare')">Solflare</button>
      <button class="modal-close" @click="showWalletModal = false">Cancel</button>
    </div>
  </div>
</template>
