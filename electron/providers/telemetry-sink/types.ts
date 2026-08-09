// Telemetry-sink provider interface — selected by `config.telemetry.upload.kind`.

export interface TelemetrySinkUploadResult {
  ok: boolean;
  filesUploaded: number;
  bytesUploaded: number;
  lastError: string | null;
  uploadedAt: string;
}

export interface TelemetrySinkProvider {
  readonly kind: 'none' | 'azure-blob';
  /** Upload all pending local JSONL event files for a workspace. */
  upload(workspacePath: string): Promise<TelemetrySinkUploadResult>;
}
