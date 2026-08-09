/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TELEMETRY_READ_SAS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
