import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vite config for the renderer process (React app shown inside the Electron BrowserWindow).
// `base: './'` is critical — Electron loads the built HTML from the local filesystem
// (file:// URL) once packaged, and absolute asset paths break under file://.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext'
  }
});
