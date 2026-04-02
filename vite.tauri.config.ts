import { resolve } from 'path'
import { defineConfig } from 'vite'

const devHost = process.env.TAURI_DEV_HOST || '127.0.0.1'

export default defineConfig({
  clearScreen: false,
  root: resolve(__dirname, 'src/renderer'),
  server: {
    host: devHost,
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, 'dist-tauri'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html')
    }
  }
})
