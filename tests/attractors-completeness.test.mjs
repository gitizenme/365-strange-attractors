import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { IN_SCOPE_FAMILIES } from '../pipeline/attractors.mjs';

const DATA = 'public/data/attractors.json';

describe.skipIf(!existsSync(DATA))('attractors.json completeness', () => {
  const attractors = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : [];
  it('has exactly 365 entries, one per day, in order', () => {
    expect(attractors.length).toBe(365);
    attractors.forEach((a, i) => expect(a.day).toBe(i + 1));
  });
  it('every entry is either static-only or a recognized in-scope family with params', () => {
    for (const a of attractors) {
      if (a.system === 'static-only') {
        expect(a.params).toBeUndefined();
      } else {
        expect(IN_SCOPE_FAMILIES.has(a.system)).toBe(true);
        expect(Array.isArray(a.params)).toBe(true);
        expect(a.params.length).toBeGreaterThan(0);
      }
    }
  });
  it('in-scope days total 85', () => {
    expect(attractors.filter(a => a.system !== 'static-only').length).toBe(85);
  });
});
