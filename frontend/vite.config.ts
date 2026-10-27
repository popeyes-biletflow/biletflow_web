import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000', // Укажите порт вашего бэкенда (например: 5000, 8000 или 3000)
        changeOrigin: true,
        secure: false,
      },
    },
  },
})