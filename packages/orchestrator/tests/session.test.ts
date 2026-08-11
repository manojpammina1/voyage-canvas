import { describe, expect, it } from 'vitest';
import { createMemorySessionStore } from '../src/session.js';

describe('session store (T7)', () => {
  it('stores only safe planning state in memory', async () => {
    const store = createMemorySessionStore();
    const created = await store.create({
      criteria: { destination: 'Caribbean', month: '2027-03' },
      confirmedCriteria: { nights: 7 },
    });

    expect(created.sessionId).toMatch(/^anon-/);
    expect(created.criteria.destination).toBe('Caribbean');
    expect(created.compareOptionIds).toEqual([]);

    const updated = await store.update(created.sessionId, {
      selectedOptionId: 'opt-sail-serenade-2027-03-06-balcony',
      compareOptionIds: ['a', 'b'],
    });
    expect(updated?.selectedOptionId).toBe('opt-sail-serenade-2027-03-06-balcony');
    expect(updated?.compareOptionIds).toEqual(['a', 'b']);

    const loaded = await store.get(created.sessionId);
    expect(loaded?.confirmedCriteria).toEqual({ nights: 7 });

    await store.destroy(created.sessionId);
    expect(await store.get(created.sessionId)).toBeNull();
  });
});
