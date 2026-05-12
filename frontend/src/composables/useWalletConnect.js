import { ref, computed, shallowRef } from 'vue'
import { Connection, PublicKey } from '@solana/web3.js'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase'
import { TrustWalletAdapter } from '@solana/wallet-adapter-trust'
import { LedgerWalletAdapter } from '@solana/wallet-adapter-ledger'
import { TorusWalletAdapter } from '@solana/wallet-adapter-torus'
import { NightlyWalletAdapter } from '@solana/wallet-adapter-nightly'

// Module-level singletons — created once, never re-instantiated
const _adapters = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new CoinbaseWalletAdapter(),
  new TrustWalletAdapter(),
  new LedgerWalletAdapter(),
  new TorusWalletAdapter(),
  new NightlyWalletAdapter(),
]

const wallets    = shallowRef([..._adapters])
const publicKey  = ref(null)
const connected  = ref(false)
const connecting = ref(false)
const showWalletModal = ref(false)
const _active    = shallowRef(null)   // currently connected adapter
const _signMsg   = ref(null)
const _signTx    = ref(null)
const _signAllTx = ref(null)

// Re-render wallet list when any adapter's readyState changes
_adapters.forEach(a => a.on('readyStateChange', () => { wallets.value = [..._adapters] }))

function _reset() {
  publicKey.value = null
  connected.value = false
  _active.value   = null
  _signMsg.value  = null
  _signTx.value   = null
  _signAllTx.value = null
}

// Auto-reconnect last wallet on page load
;(async () => {
  try {
    const saved = localStorage.getItem('walletName')
    if (!saved) return
    const name = JSON.parse(saved)
    const adapter = _adapters.find(a => a.name === name)
    if (!adapter) return
    // Wait briefly for extension detection
    await new Promise(r => setTimeout(r, 500))
    if (adapter.readyState !== 'Installed') return
    await adapter.connect()
    publicKey.value  = adapter.publicKey
    connected.value  = true
    _active.value    = adapter
    _signMsg.value   = 'signMessage'          in adapter ? msg  => adapter.signMessage(msg)          : null
    _signTx.value    = 'signTransaction'      in adapter ? tx   => adapter.signTransaction(tx)       : null
    _signAllTx.value = 'signAllTransactions'  in adapter ? txs  => adapter.signAllTransactions(txs)  : null
    adapter.on('disconnect', _reset)
    adapter.on('accountChanged', pk => { publicKey.value = pk ?? null; if (!pk) _reset() })
  } catch {}
})()

export function useWalletConnect({ SOLANA_RPC, onConnect } = {}) {
  const walletAddress = computed(() => publicKey.value?.toString() ?? null)

  const shortAddress = computed(() => {
    if (!walletAddress.value) return ''
    return `${walletAddress.value.slice(0, 4)}...${walletAddress.value.slice(-4)}`
  })

  const adapterSignMessage = computed(() => _signMsg.value)

  const walletProvider = computed(() => {
    if (!connected.value || !_active.value) return null
    return {
      signTransaction:     tx  => _signTx.value?.(tx),
      signAllTransactions: txs => _signAllTx.value?.(txs),
    }
  })

  async function connectWallet(walletName, walletUrl) {
    const adapter = _adapters.find(a => a.name === walletName)
    const ready   = adapter?.readyState === 'Installed' || adapter?.readyState === 'Loadable'
    if (!adapter || !ready) {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      if (isMobile) {
        const encoded = encodeURIComponent(window.location.href)
        if (walletName === 'Phantom')  { window.location.href = `https://phantom.app/ul/browse/${encoded}?ref=${encoded}`; return }
        if (walletName === 'Solflare') { window.location.href = `https://solflare.com/ul/v1/browse/${encoded}?ref=${encoded}`; return }
      }
      window.open(walletUrl || 'https://phantom.app', '_blank')
      return
    }
    showWalletModal.value = false
    try {
      connecting.value = true
      await adapter.connect()
      publicKey.value  = adapter.publicKey
      connected.value  = true
      _active.value    = adapter
      _signMsg.value   = 'signMessage'          in adapter ? msg  => adapter.signMessage(msg)          : null
      _signTx.value    = 'signTransaction'      in adapter ? tx   => adapter.signTransaction(tx)       : null
      _signAllTx.value = 'signAllTransactions'  in adapter ? txs  => adapter.signAllTransactions(txs)  : null
      adapter.on('disconnect', _reset)
      adapter.on('accountChanged', pk => { publicKey.value = pk ?? null; if (!pk) _reset() })
      try { localStorage.setItem('walletName', JSON.stringify(walletName)) } catch {}
      if (onConnect) onConnect()
    } catch (err) {
      console.error('Wallet connection failed:', err.message)
      _reset()
    } finally {
      connecting.value = false
    }
  }

  async function disconnectWallet() {
    try { await _active.value?.disconnect() } catch {}
    _reset()
    try { localStorage.removeItem('walletName') } catch {}
  }

  async function signAndSendTransaction(transaction) {
    if (!connected.value) throw new Error('Wallet not connected')
    const connection = new Connection(SOLANA_RPC.value, 'confirmed')
    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer        = new PublicKey(walletAddress.value)
    const signed  = await _signTx.value(transaction)
    const txHash  = await connection.sendRawTransaction(signed.serialize())
    await connection.confirmTransaction(txHash, 'confirmed')
    return txHash
  }

  const walletName = computed(() => _active.value?.name ?? null)

  return {
    publicKey,
    connected,
    connecting,
    wallets,
    walletName,
    adapterSignMessage,
    walletAddress,
    walletProvider,
    showWalletModal,
    shortAddress,
    connectWallet,
    disconnectWallet,
    signAndSendTransaction,
  }
}
