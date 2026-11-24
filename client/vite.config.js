import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.API_TARGET || 'http://localhost:5050';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // Listen on the local network so judges' devices on the same Wi-Fi can connect (no internet needed)
    host: true,
    // In development the API and uploaded images are proxied, so VITE_API_URL can stay "/api"
    proxy: {
      '/api': API_TARGET,
      '/uploads': API_TARGET,
      '/socket.io': { target: API_TARGET, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          pdf: ['jspdf', 'jspdf-autotable'],
          ui: ['sweetalert2', 'lucide-react', 'axios', 'socket.io-client'],
        },
      },
    },
  },
});
