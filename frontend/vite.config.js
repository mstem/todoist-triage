import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend port moves whenever another project has already claimed one, so
// a hardcoded proxy target silently sends dev traffic to whatever app is on
// that port. Read the port the server was last started on instead.
const root = path.dirname(fileURLToPath(import.meta.url));
function backendPort() {
  if (process.env.BACKEND_PORT) return process.env.BACKEND_PORT;
  const portFile = path.join(root, '..', '.port');
  if (fs.existsSync(portFile)) {
    const port = fs.readFileSync(portFile, 'utf8').trim();
    if (/^\d+$/.test(port)) return port;
  }
  return '3004';
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': `http://localhost:${backendPort()}`,
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
