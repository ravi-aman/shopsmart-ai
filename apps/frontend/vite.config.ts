import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Read the monorepo root .env so frontend and backend share one file.
  const env = loadEnv(mode, path.resolve(import.meta.dirname, '../..'), '')
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:8080'

  return {
    envDir: path.resolve(import.meta.dirname, '../..'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
  }
})
