/// <reference types="vite/client" />

// Custom build-time env vars consumed by the renderer.
// VITE_TITAN_PO_ENABLED=1 re-enables the sunset PO surfaces (v2.1 hide-not-delete).
interface ImportMetaEnv {
  readonly VITE_TITAN_PO_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
