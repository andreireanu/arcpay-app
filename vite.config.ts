import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    include: [
      'buffer',
      '@dynamic-labs/sdk-react-core',
      '@dynamic-labs/solana',
      '@dynamic-labs/waas-svm',
      '@dynamic-labs-wallet/core',
      '@dynamic-labs-wallet/forward-mpc-client',
      '@dynamic-labs-wallet/forward-mpc-shared',
      '@dynamic-labs-wallet/browser-wallet-client',
      '@dynamic-labs-wallet/primitives',
      '@turnkey/sdk-browser',
      '@turnkey/http',
      '@turnkey/api-key-stamper',
      '@turnkey/iframe-stamper',
      '@turnkey/webauthn-stamper',
      '@turnkey/indexed-db-stamper',
      '@turnkey/wallet-stamper',
      '@turnkey/sdk-types',
      '@turnkey/encoding',
      '@turnkey/crypto',
      '@turnkey/solana',
    ],
  },
})
