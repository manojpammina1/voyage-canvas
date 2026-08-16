import { describe, expect, it } from 'vitest';
import {
  HERO_CRITERIA,
  HERO_INTENT,
  parseCriteria,
} from '../src/criteriaParser.js';

describe('criteriaParser (T7)', () => {
  it('parses the locked hero intent string', () => {
    expect(parseCriteria(HERO_INTENT)).toEqual(HERO_CRITERIA);
  });

  it('parses close variants without LLM', () => {
    const parsed = parseCriteria(
      'Looking for a 7 night Caribbean trip March 2027, 2 adults and 2 children, balcony cabin under $5000',
    );
    expect(parsed.destination).toBe('Caribbean');
    expect(parsed.month).toBe('2027-03');
    expect(parsed.nights).toBe(7);
    expect(parsed.occupancy).toEqual({ adults: 2, children: 2 });
    expect(parsed.cabinType).toBe('balcony');
    expect(parsed.maxPriceUsd).toBe(5000);
  });

  it('handles suite and interior cabin aliases', () => {
    expect(parseCriteria('Caribbean suite for 2 adults').cabinType).toBe('suite');
    expect(parseCriteria('interior cabin Caribbean').cabinType).toBe('interior');
  });

  it('ignores invalid budget fragments', () => {
    expect(parseCriteria('Caribbean balcony under $').maxPriceUsd).toBeUndefined();
    expect(parseCriteria('Caribbean balcony under $0').maxPriceUsd).toBeUndefined();
  });
});
