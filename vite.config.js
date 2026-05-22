import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/coverage-evidence-match/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    // emptyOutDir disabled because macOS-mounted sandbox can't unlink existing files.
    // GitHub Actions CI always starts with a clean workspace, so this is safe.
    emptyOutDir: false,
  },
})
