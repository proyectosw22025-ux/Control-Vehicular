import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Separa las librerías grandes en chunks propios para que el navegador
        // las cachee de forma independiente. leaflet (mapas) y recharts (reportes)
        // solo se descargan junto a las páginas lazy que los usan.
        manualChunks: {
          'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
          'vendor-apollo':  ['@apollo/client', 'graphql'],
          'vendor-leaflet': ['leaflet', 'react-leaflet'],
          'vendor-charts':  ['recharts'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
