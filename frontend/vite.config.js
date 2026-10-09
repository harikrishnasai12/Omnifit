import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // No VITE_ prefix: this value stays in the dev server and is never bundled
  // into the browser code.
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.OMNIFIT_BACKEND_URL

  if (command === 'serve' && !backendUrl) {
    throw new Error(
      'OMNIFIT_BACKEND_URL is not set. Add it to frontend/.env (see frontend/.env.example).'
    )
  }

  return {
    plugins: [react()],
    // Body Scan imports MediaPipe only when used; preparing it up front stops
    // the dev server reloading the page mid-scan the first time it is needed
    optimizeDeps: {
      include: ['@mediapipe/tasks-vision', '@vladmandic/face-api'],
    },
    server: {
      // Lets a phone reach the dev server through a Cloudflare quick tunnel
      // (https://<random>.trycloudflare.com) for the Share to OmniFit test
      allowedHosts: ['.trycloudflare.com'],
      proxy: backendUrl
        ? {
            '/api': {
              target: backendUrl,
              changeOrigin: true,
            },
          }
        : undefined,
    },
  }
})
