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
  it('in-scope days total at least 85 (a floor, not an exact count — Incendia coverage in ' +
     'phase 2c is best-effort and grows as the pipeline/gate improve; live count should never ' +
     'regress below the pre-2c Chaoscope-only baseline)', () => {
    expect(attractors.filter(a => a.system !== 'static-only').length).toBeGreaterThanOrEqual(85);
  });
  it('days 87 and 129 stay live — their headers over-declare the transform count, and trusting it discarded them', () => {
    // Both .par files declare more transform blocks (4 and 3) than they carry (2 each); the
    // parser used to run off the end of the transform section and drop the day entirely.
    // Days 190 and 320 have the same header defect but are legitimately gated out as
    // implausible once parsed, so they are deliberately NOT pinned here.
    for (const day of [87, 129]) {
      const a = attractors[day - 1];
      expect(a.day).toBe(day);
      expect(a.system).toBe('incendia_ifs');
      expect(a.matrices).toBe(2);
    }
  });
  it('every incendia_ifs or incendia_flow entry carries a matrices count consistent with its stride-13 params', () => {
    for (const a of attractors) {
      if (a.system !== 'incendia_ifs' && a.system !== 'incendia_flow') continue;
      expect(a.params.length % 13).toBe(0);
      expect(a.matrices).toBe(a.params.length / 13);
    }
  });
});
