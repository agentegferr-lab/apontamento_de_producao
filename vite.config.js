import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Em dev o front roda no Vite e o Express fica no 3000; em producao o Express serve o dist.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
