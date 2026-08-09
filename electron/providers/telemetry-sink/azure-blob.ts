// Azure Blob telemetry sink — thin adapter over the existing, already
// org-neutral upload logic in electron/telemetry-uploader.ts (SAS-based PUT,
// no Azure SDK dependency). Not re-implemented here to avoid drift between
// two copies of the same HTTPS PUT/rename-on-success logic; this file exists
// so main.ts selects a sink by `config.telemetry.upload.kind` instead of
// calling uploadBatch() directly and assuming Azure Blob is the only option.

import type { TelemetrySinkProvider, TelemetrySinkUploadResult } from './types';
import { uploadBatch } from '../../telemetry-uploader';
import { getTelemetrySasUrl } from '../../token-vault';
import { computeUserHash } from '../../telemetry-uploader';

export class AzureBlobTelemetrySink implements TelemetrySinkProvider {
  readonly kind = 'azure-blob' as const;

  async upload(workspacePath: string): Promise<TelemetrySinkUploadResult> {
    const sasUrl = await getTelemetrySasUrl();
    if (!sasUrl) {
      return {
        ok: false,
        filesUploaded: 0,
        bytesUploaded: 0,
        lastError: 'No SAS URL configured for the azure-blob telemetry sink.',
        uploadedAt: new Date().toISOString(),
      };
    }
    const userHash = computeUserHash();
    return uploadBatch(workspacePath, sasUrl, userHash);
  }
}
