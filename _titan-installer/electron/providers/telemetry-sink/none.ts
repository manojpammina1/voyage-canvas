import type { TelemetrySinkProvider, TelemetrySinkUploadResult } from './types';

/** Default sink — `config.telemetry.upload.kind: "none"`. No egress; used
 *  so an adopter who hasn't set up a central telemetry endpoint gets a
 *  clean no-op instead of an implicit Azure Blob upload firing by
 *  default. Ships as the default `titan.config.json` value (§ plan C.6). */
export class NoneTelemetrySink implements TelemetrySinkProvider {
  readonly kind = 'none' as const;

  async upload(): Promise<TelemetrySinkUploadResult> {
    return {
      ok: true,
      filesUploaded: 0,
      bytesUploaded: 0,
      lastError: null,
      uploadedAt: new Date().toISOString(),
    };
  }
}
