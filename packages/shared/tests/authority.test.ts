import { describe, expect, it } from 'vitest';
import {
  AuthorityViolation,
  createInitialExperience,
  experienceReducer,
  EvidenceSchema,
  ExperienceEventSchema,
  SearchCriteriaSchema,
} from '../src/index.js';

const base = createInitialExperience('sess-anon-1');

describe('reducer authority invariants', () => {
  it('rejects model payload that tries to write availableOptions', () => {
    expect(() =>
      experienceReducer(base, {
        source: 'model',
        event: {
          type: 'action',
          action: 'ADD_CONSTRAINT',
          payload: { availableOptions: [] },
        },
      }),
    ).toThrow(AuthorityViolation);
  });

  it('rejects model payload that tries to write evidence', () => {
    expect(() =>
      experienceReducer(base, {
        source: 'model',
        event: {
          type: 'action',
          action: 'EXPLAIN_TRADEOFF',
          payload: { evidence: [] },
        },
      }),
    ).toThrow(AuthorityViolation);
  });

  it('rejects model payload that tries to write hold', () => {
    expect(() =>
      experienceReducer(base, {
        source: 'model',
        event: {
          type: 'action',
          action: 'FOCUS_DECISION',
          payload: { hold: { holdId: 'x' } },
        },
      }),
    ).toThrow(AuthorityViolation);
  });

  it('rejects model payload that tries to write bookingContext', () => {
    expect(() =>
      experienceReducer(base, {
        source: 'model',
        event: {
          type: 'action',
          action: 'FOCUS_DECISION',
          payload: { bookingContext: { bookingContextId: 'b' } },
        },
      }),
    ).toThrow(AuthorityViolation);
  });

  it('rejects model payload that tries to alter auth truth', () => {
    expect(() =>
      experienceReducer(base, {
        source: 'model',
        event: {
          type: 'action',
          action: 'ADD_CONSTRAINT',
          payload: { authenticationState: 'authenticated' },
        },
      }),
    ).toThrow(AuthorityViolation);
  });

  it('does not allow model to relax locked preference', () => {
    const locked = experienceReducer(base, {
      source: 'ui',
      event: {
        type: 'LOCK_PREFERENCE',
        criterion: 'cabinType',
        value: 'balcony',
      },
    });
    expect(() =>
      experienceReducer(locked, {
        source: 'model',
        event: {
          type: 'action',
          action: 'RELAX_CONSTRAINT',
          payload: { criterion: 'cabinType' },
        },
      }),
    ).toThrow(AuthorityViolation);
  });

  it('allows deterministic services to write options and evidence', () => {
    const withOptions = experienceReducer(base, {
      source: 'deterministic',
      kind: 'SET_OPTIONS',
      payload: [
        {
          id: 'opt-1',
          sailing: {
            id: 's1',
            shipName: 'Demo Ship',
            destination: 'Caribbean',
            departureDate: '2027-03-07',
            nights: 7,
            ports: ['MIA', 'COZ'],
          },
          cabinType: 'balcony',
          cabinId: 'cab-s1-bal-1',
          fitReasons: ['Matches balcony preference'],
        },
      ],
    });
    expect(withOptions.availableOptions).toHaveLength(1);

    const withEvidence = experienceReducer(withOptions, {
      source: 'deterministic',
      kind: 'ADD_EVIDENCE',
      payload: {
        id: 'ev-price-1',
        type: 'PRICE',
        source: 'deterministic',
        data: { totalUsd: 4280 },
        provenance: { tool: 'get_pricing', requestId: 'r1' },
      },
    });
    expect(withEvidence.evidence).toHaveLength(1);
  });

  it('only SET_AUTH can change authenticationState', () => {
    const afterUi = experienceReducer(base, {
      source: 'ui',
      event: { type: 'SIMULATE_SIGN_IN' },
    });
    expect(afterUi.authenticationState).toBe('anonymous');

    const afterAuth = experienceReducer(afterUi, {
      source: 'deterministic',
      kind: 'SET_AUTH',
      payload: {
        authenticationState: 'authenticated',
        sessionId: 'sess-auth-1',
        guestId: 'guest-demo-1',
      },
    });
    expect(afterAuth.authenticationState).toBe('authenticated');
    expect(afterAuth.sessionId).toBe('sess-auth-1');
  });
});

describe('schema validation', () => {
  it('accepts known-good search criteria', () => {
    const parsed = SearchCriteriaSchema.parse({
      destination: 'Caribbean',
      month: '2027-03',
      nights: 7,
      occupancy: { adults: 2, children: 2 },
      cabinType: 'balcony',
      maxPriceUsd: 5000,
    });
    expect(parsed.nights).toBe(7);
  });

  it('rejects unknown experience event type', () => {
    expect(() =>
      ExperienceEventSchema.parse({ type: 'card', payload: {} }),
    ).toThrow();
  });

  it('accepts evidence envelope', () => {
    const ev = EvidenceSchema.parse({
      id: 'ev-1',
      type: 'AVAILABILITY',
      source: 'deterministic',
      data: { availableCount: 3 },
      asOf: '2026-08-10T00:00:00.000Z',
      provenance: { tool: 'check_availability', requestId: 'req-1' },
    });
    expect(ev.type).toBe('AVAILABILITY');
  });
});
