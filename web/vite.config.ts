import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 生产由 Express 挂在 /app 下（与 BrowserRouter 的 basename 一致）
  base: '/app/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 开发期把 API 与静态资源转给后端（生产由 Express 统一服务）
    proxy: {
      '/api': 'http://127.0.0.1:8935',
      '/static': 'http://127.0.0.1:8935',
    },
  },
})
