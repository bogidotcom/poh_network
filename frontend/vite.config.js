import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    vue(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  optimizeDeps: {
    include: [
      '@meteora-ag/dynamic-bonding-curve-sdk',
      'bn.js',
    ],
  },
  server: {
    proxy: {
      '/config':  'http://localhost:3000',
      '/checker': 'http://localhost:3000',
      '/methods': 'http://localhost:3000',
      '/profile': 'http://localhost:3000',
      '/curves':    'http://localhost:3000',
      '/ecosystem': 'http://localhost:3000',
      '/evm':     'http://localhost:3000',
      '/rest':    'http://localhost:3000',
      '/abi':     'http://localhost:3000',
    }
  }
})
