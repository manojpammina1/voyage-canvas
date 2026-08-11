import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const sasUrl = env.VITE_TELEMETRY_READ_SAS ?? '';

  // Parse the blob base URL for proxying (strips the SAS query string)
  let blobOrigin = '';
  let blobPath   = '';
  try {
    const u   = new URL(sasUrl);
    blobOrigin = u.origin;                      // https://gwsaemdev.blob.core.windows.net
    blobPath   = u.pathname.replace(/\/$/, ''); // /claude-price-dashboard
  } catch { /* no-op if SAS not set */ }

  return {
    plugins: [react()],
    base: '/',
    build: { outDir: 'dist', sourcemap: true },
    server: {
      port: 5174,
      proxy: blobOrigin
        ? {
            // Proxy /api/blob/* → Azure Blob, injecting SAS query string.
            // Two URL patterns:
            //   /api/blob?restype=container&comp=list   → container list request
            //   /api/blob/<hash>/<date>/<file>.jsonl    → individual blob fetch
            '/api/blob': {
              target:       blobOrigin,
              changeOrigin: true,
              rewrite: (path: string) => {
                const sasQs = sasUrl.includes('?') ? sasUrl.split('?')[1] : '';
                const qIdx  = path.indexOf('?');
                const pathOnly = qIdx !== -1 ? path.slice(0, qIdx) : path;
                const origQs   = qIdx !== -1 ? path.slice(qIdx + 1) : '';

                // Strip /api/blob prefix — what remains is the blob sub-path (may be empty)
                const sub = pathOnly.replace(/^\/api\/blob\/?/, '');

                if (sub) {
                  // Individual blob: /api/blob/hash/date/file.jsonl
                  // → /claude-price-dashboard/hash/date/file.jsonl?<sasQs>
                  return `${blobPath}/${sub}?${sasQs}`;
                } else {
                  // Container-level request (list, etc.)
                  // → /claude-price-dashboard?<sasQs>&restype=container&comp=list...
                  return `${blobPath}?${sasQs}${origQs ? '&' + origQs : ''}`;
                }
              },
            },
          }
        : {},
    },
  };
});
