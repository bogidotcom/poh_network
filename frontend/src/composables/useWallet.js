import { ref, computed } from 'vue'

// Module-level singleton — shared across all importers
const walletAddress   = ref(null)
const walletProvider  = ref(null)
const showWalletModal = ref(false)

const connected    = computed(() => !!walletAddress.value)
const shortAddress = computed(() => {
  if (!walletAddress.value) return ''
  return `${walletAddress.value.slice(0, 4)}…${walletAddress.value.slice(-4)}`
})

function getPhantomProvider() {
  return ('phantom' in window && window.phantom?.solana?.isPhantom) ? window.phantom.solana : null
}

function getSolflareProvider() {
  return ('solflare' in window && window.solflare?.isSolflare) ? window.solflare : null
}

async function connectWallet(type) {
  showWalletModal.value = false
  const provider = type === 'phantom' ? getPhantomProvider() : getSolflareProvider()
  if (!provider) {
    window.open(type === 'phantom' ? 'https://phantom.app/' : 'https://solflare.com/', '_blank')
    return
  }
  const resp = await provider.connect()
  walletAddress.value  = resp.publicKey.toString()
  walletProvider.value = provider
  provider.on('disconnect', () => { walletAddress.value = null; walletProvider.value = null })
  provider.on('accountChanged', (pk) => {
    walletAddress.value = pk ? pk.toString() : null
    if (!pk) walletProvider.value = null
  })
}

async function disconnectWallet() {
  try { await walletProvider.value?.disconnect() } catch {}
  walletAddress.value  = null
  walletProvider.value = null
}

export function useWallet() {
  return { walletAddress, walletProvider, showWalletModal, connected, shortAddress, connectWallet, disconnectWallet }
}
