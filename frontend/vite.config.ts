import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'lucide-icons',
              test: /node_modules[\\/]lucide-react[\\/]/,
              minSize: 1024,
            },
          ],
        },
      },
    },
  },
})
// Trigger reload
