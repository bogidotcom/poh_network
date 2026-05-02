import { Buffer } from 'buffer'
window.Buffer = Buffer

import { createApp } from 'vue'
import App from './App.vue'
import { initWallet } from '@solana/wallet-adapter-vue'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase'
import { TrustWalletAdapter } from '@solana/wallet-adapter-trust'
import { LedgerWalletAdapter } from '@solana/wallet-adapter-ledger'
import { TorusWalletAdapter } from '@solana/wallet-adapter-torus'
import { NightlyWalletAdapter } from '@solana/wallet-adapter-nightly'
import './assets/solana-wallet.css'

// Fix corrupted localStorage wallet keys
try {
  ;['walletName', 'selectedWallet'].forEach(key => {
    const val = localStorage.getItem(key)
    if (val && !val.startsWith('"')) localStorage.removeItem(key)
  })
} catch {}

initWallet({
  wallets: [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new CoinbaseWalletAdapter(),
    new TrustWalletAdapter(),
    new LedgerWalletAdapter(),
    new TorusWalletAdapter(),
    new NightlyWalletAdapter(),
  ],
  autoConnect: true,
})

createApp(App).mount('#app')
