import { describe, it, expect } from 'vitest';
import {
  parsePar, composeIncendiaBlocks, chaosGame, classify, buildIncendiaEntry, applyIncendia,
} from '../pipeline/incendia.mjs';

// Real archive fixtures (project/194, project/251, project/316), one per format generation,
// each hand-verified against the confirmed column-major decode. All three are visually
// confirmed genuine fractals (nautilus/frond shapes) in the phase-0 spike's contact sheet.
function crlf(lines) { return lines.join('\r\n'); }

// parsePar only reads line 1 (generation) and line 6 (baseShape/transformCount) from the
// header; the rest is render-only noise it skips over. Real files use exactly 20 header
// lines before the transform blocks start (verified: project/194/194_Sky_Shell.par lines
// 1-20), so this placeholder must match that count exactly or the transform offset shifts.
const HEADER = (gen, count) => {
  const lines = Array.from({ length: 20 }, () => '0 0 0');
  lines[0] = gen;
  lines[5] = `0 ${count}`;
  return lines;
};

// project/194/194_Sky_Shell.par — gen "4 1", 2 transforms
const SKY_SHELL = crlf([
  ...HEADER('4 1', 2),
  '0.915288 0.153114 0.192183 -0.118028',
  '0.924062 -0.174090 -0.215518 0.144202',
  '0.911530 -1.382818 0.354384 -1.400795',
  '0.900000',
  '-0.355732 -0.264121 -0.484088 0.183385',
  '0.486626 -0.400265 0.520069 -0.352253',
  '-0.189981 -0.265924 0.166168 -0.389452',
  '0.100000',
]);

// project/251/251_Feather_Heart.par — gen "6 1", 2 transforms
const FEATHER_HEART = crlf([
  ...HEADER('6 1', 2),
  '0.921999 0.208815 -0.048378 -0.211532',
  '0.920920 -0.056456 0.034613 0.065801',
  '0.943662 -0.665613 0.684127 -1.757535',
  '0.900000',
  '0.526062 -0.042902 0.030483 0.048347',
  '0.514930 -0.109635 -0.020793 0.111878',
  '0.516296 0.183544 0.462663 0.047479',
  '0.100000',
]);

// project/316/316_Wired.par — gen "7 1", 2 transforms
const WIRED = crlf([
  ...HEADER('7 1', 2),
  '0.928615 0.096774 0.107560 -0.056568',
  '0.885881 -0.308667 -0.133170 0.298513',
  '0.881145 -1.343040 1.297729 -0.715641',
  '0.900000',
  '-0.315474 0.207847 -0.513632 -0.506139',
  '-0.348615 0.169801 -0.225480 0.491741',
  '0.337478 0.351327 0.225130 -0.275473',
  '0.100000',
]);

// declares 2 transforms but the second block is malformed (only 3 numbers on its first row)
// -- simulates the ~4 non-contiguous corpus files whose transformCount exceeds the readable run.
const NON_CONTIGUOUS = crlf([
  ...HEADER('7 1', 2),
  '0.9 0 0 0', '0 0.9 0 0', '0 0 0.9 0', '1.0',
  '0.9 0 0', // malformed: 3 numbers, not 4
]);

// single transform, weight irrelevant (only one map is ever selected) -- unaddressable: one
// contractive affine map converges to a single fixed point, no chaos-game structure possible.
const SINGLE_TRANSFORM = crlf([
  ...HEADER('4 1', 1),
  '0.5 0 0 0', '0 0.5 0 0', '0 0 0.5 0', '1.0',
]);

describe('parsePar', () => {
  it('decodes a real gen-4 file: column-major linear + translation, weight separate', () => {
    const p = parsePar(SKY_SHELL);
    expect(p.gen).toBe('4 1');
    expect(p.declaredCount).toBe(2);
    expect(p.clean).toBe(true);
    expect(p.transforms).toHaveLength(2);
    expect(p.transforms[0]).toEqual({
      m: [
        [0.915288, -0.118028, -0.215518],
        [0.153114, 0.924062, 0.144202],
        [0.192183, -0.174090, 0.911530],
      ],
      t: [-1.382818, 0.354384, -1.400795],
      w: 0.9,
    });
    expect(p.transforms[1]).toEqual({
      m: [
        [-0.355732, 0.183385, 0.520069],
        [-0.264121, 0.486626, -0.352253],
        [-0.484088, -0.400265, -0.189981],
      ],
      t: [-0.265924, 0.166168, -0.389452],
      w: 0.1,
    });
  });

  it('decodes a real gen-6 file identically to gen-4 (same layout across generations)', () => {
    const p = parsePar(FEATHER_HEART);
    expect(p.gen).toBe('6 1');
    expect(p.transforms).toHaveLength(2);
    expect(p.transforms[0].t).toEqual([-0.665613, 0.684127, -1.757535]);
    expect(p.transforms[0].w).toBe(0.9);
    expect(p.transforms[1].m[1]).toEqual([-0.042902, 0.514930, 0.111878]);
  });

  it('decodes a real gen-7 file identically to gen-4/6', () => {
    const p = parsePar(WIRED);
    expect(p.gen).toBe('7 1');
    expect(p.transforms).toHaveLength(2);
    expect(p.transforms[0].m[0]).toEqual([0.928615, -0.056568, -0.133170]);
    expect(p.transforms[1].t).toEqual([0.351327, 0.225130, -0.275473]);
  });

  it('flags a non-contiguous transform run as unclean', () => {
    const p = parsePar(NON_CONTIGUOUS);
    expect(p.clean).toBe(false);
    expect(p.transforms).toHaveLength(1); // the one well-formed block before the break
  });

  it('parses a clean single-transform file (addressability is decided downstream)', () => {
    const p = parsePar(SINGLE_TRANSFORM);
    expect(p.clean).toBe(true);
    expect(p.transforms).toHaveLength(1);
  });
});

describe('composeIncendiaBlocks', () => {
  it('flattens to stride-13 row-major [M(9), t(3), w(1)] blocks', () => {
    const { transforms } = parsePar(SKY_SHELL);
    const params = composeIncendiaBlocks(transforms);
    expect(params).toHaveLength(26); // 2 transforms x 13
    // row-major means params[base+0..2] is m's row 0, matching families/ifs.ts's stepAttractor contract
    expect(params.slice(0, 3)).toEqual([0.915288, -0.118028, -0.215518]);
    expect(params.slice(9, 12)).toEqual([-1.382818, 0.354384, -1.400795]);
  });

  it('normalizes weights already summing to 1 unchanged', () => {
    const { transforms } = parsePar(SKY_SHELL);
    const params = composeIncendiaBlocks(transforms);
    expect(params[12]).toBeCloseTo(0.9);
    expect(params[25]).toBeCloseTo(0.1);
  });

  it('normalizes weights that do not sum to 1 (Incendia weights are relative, not pre-normalized)', () => {
    const transforms = [
      { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], w: 2 },
      { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], w: 2 },
    ];
    const params = composeIncendiaBlocks(transforms);
    expect(params[12]).toBeCloseTo(0.5);
    expect(params[25]).toBeCloseTo(0.5);
  });

  it('clamps negative weights to zero before normalizing', () => {
    const transforms = [
      { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], w: -1 },
      { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], w: 1 },
    ];
    const params = composeIncendiaBlocks(transforms);
    expect(params[12]).toBe(0);
    expect(params[25]).toBe(1);
  });
});

describe('classify (plausibility gate)', () => {
  it('accepts a real multi-transform attractor as plausible', () => {
    const { transforms } = parsePar(SKY_SHELL);
    const result = classify(transforms);
    expect(result.plausible).toBe(true);
    expect(result.D).toBeGreaterThanOrEqual(1.3);
  });

  it('rejects a single-transform set (fixed point, no structure)', () => {
    const { transforms } = parsePar(SINGLE_TRANSFORM);
    const result = classify(transforms);
    expect(result.plausible).toBe(false);
    expect(result.reason).toBe('single-transform');
  });

  it('rejects two identical tight contractions to the same point (degenerate, D~0)', () => {
    const transforms = [
      { m: [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]], t: [0, 0, 0], w: 0.5 },
      { m: [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]], t: [0, 0, 0], w: 0.5 },
    ];
    const result = classify(transforms);
    expect(result.plausible).toBe(false);
  });

  it('chaosGame is deterministic across runs (same seed, same output)', () => {
    const { transforms } = parsePar(SKY_SHELL);
    const a = chaosGame(transforms, { iters: 1000 });
    const b = chaosGame(transforms, { iters: 1000 });
    expect(Array.from(a.pts)).toEqual(Array.from(b.pts));
  });
});

describe('buildIncendiaEntry', () => {
  const fakeFs = {
    readdirSync(dir) {
      if (dir.endsWith('194')) return ['194_Sky_Shell.par'];
      if (dir.endsWith('999')) return ['999_Broken.par'];
      if (dir.endsWith('998')) return ['998_Single.par'];
      if (dir.endsWith('997')) return [];
      throw new Error(`unexpected dir ${dir}`);
    },
    readFileSync(path) {
      if (path.endsWith('194_Sky_Shell.par')) return SKY_SHELL;
      if (path.endsWith('999_Broken.par')) return NON_CONTIGUOUS;
      if (path.endsWith('998_Single.par')) return SINGLE_TRANSFORM;
      throw new Error(`unexpected file ${path}`);
    },
  };

  it('returns a live incendia_ifs entry for a plausible day', () => {
    const outcome = buildIncendiaEntry(194, '194-sky-shell', '/archive', fakeFs);
    expect(outcome.gen).toBe('4 1');
    expect(outcome.status).toBe('live');
    expect(outcome.entry).toEqual({
      day: 194, slug: '194-sky-shell', system: 'incendia_ifs', matrices: 2,
      params: composeIncendiaBlocks(parsePar(SKY_SHELL).transforms),
    });
  });

  it('returns status parse-failed with a null entry for a non-contiguous file', () => {
    const outcome = buildIncendiaEntry(999, '999-broken', '/archive', fakeFs);
    expect(outcome.status).toBe('parse-failed');
    expect(outcome.entry).toBeNull();
  });

  it('returns status single-transform with a null entry', () => {
    const outcome = buildIncendiaEntry(998, '998-single', '/archive', fakeFs);
    expect(outcome.status).toBe('single-transform');
    expect(outcome.entry).toBeNull();
  });

  it('returns null when there is no .par file for the day', () => {
    expect(buildIncendiaEntry(997, '997-none', '/archive', fakeFs)).toBeNull();
  });
});

describe('applyIncendia', () => {
  const days = [
    { day: 1, slug: '001-already-live' },
    { day: 194, slug: '194-sky-shell' },
    { day: 999, slug: '999-broken' },
    { day: 997, slug: '997-none' },
  ];
  const fakeFs = {
    readdirSync(dir) {
      if (dir.endsWith('001')) throw new Error('must not read a day that already has a live Chaoscope entry');
      if (dir.endsWith('194')) return ['194_Sky_Shell.par'];
      if (dir.endsWith('999')) return ['999_Broken.par'];
      if (dir.endsWith('997')) return [];
      throw new Error(`unexpected dir ${dir}`);
    },
    readFileSync(path) {
      if (path.endsWith('194_Sky_Shell.par')) return SKY_SHELL;
      if (path.endsWith('999_Broken.par')) return NON_CONTIGUOUS;
      throw new Error(`unexpected file ${path}`);
    },
  };
  const attractors = [
    { day: 1, slug: '001-already-live', system: 'lorenz', iterations: 1, params: [1] },
    { day: 194, slug: '194-sky-shell', system: 'static-only' },
    { day: 999, slug: '999-broken', system: 'static-only' },
    { day: 997, slug: '997-none', system: 'static-only' },
  ];

  it('never touches (or even reads) a day that already has a live Chaoscope entry', () => {
    const { attractors: result } = applyIncendia(attractors, days, '/archive', fakeFs);
    expect(result[0]).toEqual(attractors[0]);
  });

  it('promotes a plausible static-only day to incendia_ifs', () => {
    const { attractors: result } = applyIncendia(attractors, days, '/archive', fakeFs);
    const entry = result.find(a => a.day === 194);
    expect(entry.system).toBe('incendia_ifs');
    expect(entry.matrices).toBe(2);
  });

  it('leaves a static-only day static-only when parsing fails or no .par exists', () => {
    const { attractors: result } = applyIncendia(attractors, days, '/archive', fakeFs);
    expect(result.find(a => a.day === 999)).toEqual({ day: 999, slug: '999-broken', system: 'static-only' });
    expect(result.find(a => a.day === 997)).toEqual({ day: 997, slug: '997-none', system: 'static-only' });
  });

  it('reports parsed/plausible counts per generation, only over days it attempted', () => {
    const { stats } = applyIncendia(attractors, days, '/archive', fakeFs);
    expect(stats['4 1']).toEqual({ total: 1, parsed: 1, plausible: 1 }); // day 194
    expect(stats['7 1']).toEqual({ total: 1, parsed: 0, plausible: 0 }); // day 999, parse-failed
    expect(stats['1 1']).toBeUndefined(); // day 1 was never attempted (precedence)
  });
});
