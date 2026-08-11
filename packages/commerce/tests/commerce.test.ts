import { afterEach, describe, expect, it } from 'vitest';
import {
  compareOptions,
  loadCatalog,
  quotePrice,
  resetCatalogCache,
  searchSailings,
} from '../src/index.js';

afterEach(() => {
  resetCatalogCache();
});

describe('@voyage/commerce (T5)', () => {
  it('loads March 2027 hero sailings with expected balcony prices', () => {
    const catalog = loadCatalog();
    expect(catalog.sailings).toHaveLength(3);
    expect(catalog.pricing.sailingBaseBalconyHeroUsd['sail-serenade-2027-03-06']).toBe(4280);
    expect(catalog.pricing.sailingBaseBalconyHeroUsd['sail-adventure-2027-03-13']).toBe(4620);
    expect(catalog.pricing.sailingBaseBalconyHeroUsd['sail-freedom-2027-03-20']).toBe(4740);
  });

  it('returns same quote for same inputs (deterministic, no LLM)', () => {
    const a = quotePrice('sail-serenade-2027-03-06', 'balcony', {
      adults: 2,
      children: 2,
    });
    const b = quotePrice('sail-serenade-2027-03-06', 'balcony', {
      adults: 2,
      children: 2,
    });
    expect(a).toEqual(b);
    expect(a.totalUsd).toBe(4280);
    expect(a.quoteId).toMatch(/^quote-/);
    expect(a.asOf).toBeTruthy();
    expect(a.validUntil).toBeTruthy();
  });

  it('cabin type and occupancy affect price', () => {
    const balcony = quotePrice('sail-adventure-2027-03-13', 'balcony', {
      adults: 2,
      children: 2,
    });
    const interior = quotePrice('sail-adventure-2027-03-13', 'interior', {
      adults: 2,
      children: 2,
    });
    const suite = quotePrice('sail-adventure-2027-03-13', 'suite', {
      adults: 2,
      children: 2,
    });
    const moreAdults = quotePrice('sail-adventure-2027-03-13', 'balcony', {
      adults: 3,
      children: 2,
    });
    const fewerKids = quotePrice('sail-adventure-2027-03-13', 'balcony', {
      adults: 2,
      children: 0,
    });

    expect(balcony.totalUsd).toBe(4620);
    expect(interior.totalUsd).toBeLessThan(balcony.totalUsd);
    expect(suite.totalUsd).toBeGreaterThan(balcony.totalUsd);
    expect(moreAdults.totalUsd).toBeGreaterThan(balcony.totalUsd);
    expect(fewerKids.totalUsd).toBeLessThan(balcony.totalUsd);
  });

  it('budget filter excludes sailings above maxPriceUsd', () => {
    const under4600 = searchSailings({
      destination: 'Caribbean',
      month: '2027-03',
      nights: 7,
      cabinType: 'balcony',
      occupancy: { adults: 2, children: 2 },
      maxPriceUsd: 4600,
    });
    expect(under4600.map((o) => o.sailing.id)).toEqual(['sail-serenade-2027-03-06']);

    const under5000 = searchSailings({
      destination: 'Caribbean',
      month: '2027-03',
      nights: 7,
      cabinType: 'balcony',
      occupancy: { adults: 2, children: 2 },
      maxPriceUsd: 5000,
    });
    expect(under5000).toHaveLength(3);
  });

  it('comparison delta is computed server-side', () => {
    const options = searchSailings({
      destination: 'Caribbean',
      month: '2027-03',
      nights: 7,
      cabinType: 'balcony',
      occupancy: { adults: 2, children: 2 },
      maxPriceUsd: 5000,
    });
    expect(options.length).toBeGreaterThanOrEqual(2);
    const a = options[0]!;
    const b = options[1]!;
    const delta = compareOptions({
      optionA: a,
      optionB: b,
      occupancy: { adults: 2, children: 2 },
    });
    expect(delta.optionA).toBe(a.id);
    expect(delta.optionB).toBe(b.id);
    expect(delta.priceDeltaUsd).toBe(4620 - 4280);
    expect(delta.nightsDelta).toBe(0);
  });

  it('ports include trusted canvas coordinates without fabricated islands', () => {
    const catalog = loadCatalog();
    for (const port of catalog.ports) {
      expect(port.canvasX).toBeTypeOf('number');
      expect(port.canvasY).toBeTypeOf('number');
      expect(port.name.toLowerCase()).not.toMatch(/atlantis|neverland|fantasy/);
    }
  });
});
