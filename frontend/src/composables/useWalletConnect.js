import { ref, computed, watch } from 'vue'
import { useWallet } from '@solana/wallet-adapter-vue'
import { Connection, PublicKey } from '@solana/web3.js'

export function useWalletConnect({ SOLANA_RPC, onConnect }) {
  const {
    publicKey,
    connected,
    connecting,
    wallets,
    select: adapterSelect,
    connect: adapterConnect,
    disconnect: adapterDisconnect,
    signMessage: adapterSignMessage,
    signTransaction: adapterSignTx,
    signAllTransactions: adapterSignAllTxs,
  } = useWallet()

  const walletAddress = computed(() => publicKey.value?.toString() ?? null)

  const walletProvider = computed(() => {
    if (!connected.value) return null
    return {
      signTransaction:     (tx)  => adapterSignTx.value(tx),
      signAllTransactions: (txs) => adapterSignAllTxs.value(txs),
    }
  })

  const showWalletModal = ref(false)

  const shortAddress = computed(() => {
    if (!walletAddress.value) return ''
    return `${walletAddress.value.slice(0, 4)}...${walletAddress.value.slice(-4)}`
  })

  async function connectWallet(walletName, walletUrl) {
    const w = wallets.value.find(x => x.adapter.name === walletName)
    const ready = w?.readyState === 'Installed' || w?.readyState === 'Loadable'
    if (!ready) { window.open(walletUrl, '_blank'); return }
    showWalletModal.value = false
    try {
      adapterSelect(walletName)
      await adapterConnect()
    } catch (err) {
      console.error('Wallet connection failed:', err.message)
    }
  }

  async function disconnectWallet() {
    try { await adapterDisconnect() } catch {}
  }

  async function signAndSendTransaction(transaction) {
    if (!connected.value) throw new Error('Wallet not connected')
    const connection = new Connection(SOLANA_RPC.value, 'confirmed')
    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = new PublicKey(walletAddress.value)
    const signed = await adapterSignTx.value(transaction)
    const txHash = await connection.sendRawTransaction(signed.serialize())
    await connection.confirmTransaction(txHash, 'confirmed')
    return txHash
  }

  watch(connected, (val) => {
    if (val && onConnect) onConnect()
  })

  return {
    publicKey,
    connected,
    connecting,
    wallets,
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
