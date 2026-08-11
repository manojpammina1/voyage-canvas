import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CabinType, Port, Sailing } from '@voyage/shared';
import { PortSchema, SailingSchema } from '@voyage/shared';
import { z } from 'zod';
import { resolveDataDir } from './paths.js';

const PricingFixtureSchema = z.object({
  asOfFixed: z.string(),
  validForSeconds: z.number().int().positive(),
  heroOccupancy: z.object({
    adults: z.number().int().min(1),
    children: z.number().int().min(0),
  }),
  heroCabinType: z.enum(['interior', 'ocean_view', 'balcony', 'suite']),
  cabinMultipliers: z.record(z.number().positive()),
  adultWeight: z.number().positive(),
  childWeight: z.number().positive(),
  taxesFeesUsd: z.number().nonnegative(),
  sailingBaseBalconyHeroUsd: z.record(z.number().positive()),
});

export type PricingFixture = z.infer<typeof PricingFixtureSchema>;

export interface Catalog {
  sailings: Sailing[];
  ports: Port[];
  pricing: PricingFixture;
}

let cached: Catalog | undefined;

function readJson<T>(path: string, schema: z.ZodType<T>): T {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return schema.parse(raw);
}

export function loadCatalog(dataDir = resolveDataDir()): Catalog {
  if (cached) return cached;

  const sailings = readJson(join(dataDir, 'sailings.json'), z.array(SailingSchema));
  const ports = readJson(join(dataDir, 'ports.json'), z.array(PortSchema));
  const pricing = readJson(join(dataDir, 'pricing.json'), PricingFixtureSchema);

  for (const sailing of sailings) {
    if (pricing.sailingBaseBalconyHeroUsd[sailing.id] === undefined) {
      throw new Error(`Missing hero balcony base price for sailing ${sailing.id}`);
    }
  }

  for (const cabin of ['interior', 'ocean_view', 'balcony', 'suite'] as CabinType[]) {
    if (pricing.cabinMultipliers[cabin] === undefined) {
      throw new Error(`Missing cabin multiplier for ${cabin}`);
    }
  }

  cached = { sailings, ports, pricing };
  return cached;
}

/** Test helper — clears module cache between suites. */
export function resetCatalogCache(): void {
  cached = undefined;
}

export function getSailing(sailingId: string, catalog = loadCatalog()): Sailing | undefined {
  return catalog.sailings.find((s) => s.id === sailingId);
}

export function getPort(portId: string, catalog = loadCatalog()): Port | undefined {
  return catalog.ports.find((p) => p.id === portId);
}

export function cabinIdFor(sailingId: string, cabinType: CabinType): string {
  return `cabin-${sailingId}-${cabinType}`;
}
