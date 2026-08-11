import type { TelemetrySinkProvider } from './types';
import type { TitanConfig } from '../../titan-config';
import { NoneTelemetrySink } from './none';
import { AzureBlobTelemetrySink } from './azure-blob';

export type { TelemetrySinkProvider } from './types';

export function getTelemetrySink(config: TitanConfig): TelemetrySinkProvider {
  if (config.telemetry.upload.kind === 'azure-blob') return new AzureBlobTelemetrySink();
  return new NoneTelemetrySink();
}
