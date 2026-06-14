import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Expose VITE_* environment variables to the client bundle
  // These are set via .env.local for local dev or Vercel dashboard for production
})

