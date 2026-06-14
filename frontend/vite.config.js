import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3004',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
