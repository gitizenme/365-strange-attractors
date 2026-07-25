import { describe, it, expect } from 'vitest';
import {
  parsePar, composeIncendiaBlocks, chaosGame, classify, classifyLiveParams,
  pickFlatAxisSwap, swapTransformAxis, classifyFlow, buildIncendiaEntry, applyIncendia,
} from '../pipeline/incendia.mjs';
import { composeIfsBlocks } from '../src/attractor/families/ifs';

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

// project/105/105_Horn_of_Rings.par -- gen "7 1", 7 transforms, real regression fixture for the
// flat-axis fix (see pickFlatAxisSwap below). Every transform is a pure uniform 0.753020 scale
// (identity-shaped matrix) with translation [x, 0, z] -- the Y component is EXACTLY zero in
// every single block, not just small, which is why the decoded attractor is perfectly flat.
const HORN_OF_RINGS = crlf([
  ...HEADER('7 1', 7),
  '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 1.000000', '0.142857',
  '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 0.000000', '0.753020 0.781831 0.000000 0.623490', '0.142857',
  '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 0.000000', '0.753020 0.974928 0.000000 -0.222521', '0.142857',
  '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 0.000000', '0.753020 0.433884 0.000000 -0.900969', '0.142857',
  '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 0.000000', '0.753020 -0.433884 0.000000 -0.900969', '0.142857',
  '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 0.000000', '0.753020 -0.974928 0.000000 -0.222521', '0.142857',
  '0.753020 0.000000 0.000000 0.000000', '0.753020 0.000000 0.000000 0.000000', '0.753020 -0.781832 0.000000 0.623490', '0.142857',
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

// Harness calibration (spec §7): the plausibility gate must not systematically reject genuine
// structure -- guards against a gate that passes everything, or (as happened during Task 0's
// tightening pass) one that's drifted to reject too much. classify()/isoperimetricRatio were
// calibrated against Incendia's OWN contact-sheet eyeballing; this is an independent check
// using a different, pre-existing, already-shipped ground truth: the real chaoscope 'ifs' days
// (public/data/attractors.json, system 'ifs') -- the only other family that shares Incendia's
// exact affine chaos-game representation, so their live params are directly gate-comparable via
// classifyLiveParams. All 7 are real published 2010 artwork (021-fern, 023-flames, 035-starise,
// 053-fuzzy-logic, 056-evergreen, 062-stairway-to-heaven, 083-galatic-infinity), raw params
// copied verbatim from the shipped attractors.json on 2026-07-25.
describe('harness calibration (real chaoscope ifs days, independent ground truth)', () => {
  const REAL_IFS_DAYS = {
    '021-fern': [0.39, 0.494, 0.959, -0.904, -0.494, 0.352, -0.236, 0.056, 0.188, 0.168, -0.14, -0.146, -0.088, 0.566, -0.426, 0.112446138389753, 0.118, 0.485, 3.046, 0.681, -0.853, -0.941, -0.195, 0.092, -0.131, 0.167, 0.202, 0.058, 0.395, 0.941, -0.906, 0.79345913779707, 1.289, 1.891, 0.026, 0.808, 0.235, -0.254, -0.134, 0.161, -0.232, 0, -0.016, -0.129, -0.154, -0.304, 0.27, 0.0337299197437659, 1.443, 0.799, 2.486, -0.561, 0.346, 0.262, 0.002, -0.129, 0.201, 0.18, -0.183, 0.196, 0.409, -0.309, 0.222, 0.0603648040694105],
    '023-flames': [2.955, 0.041, 0.517, -0.459, 0.717, 0.455, -0.012, 0.109, -0.049, -0.168, -0.085, -0.166, -0.922, -0.808, -0.265, 0.0597717728199027, 2.863, 0.043, 0.083, 0.941, -0.953, -0.443, 0.079, -0.231, -0.035, -0.115, -0.241, 0.171, 0.548, 0.161, 0.591, 0.807968432100209, 2.48, 0.263, 1.978, 0.969, -0.948, -0.349, -0.089, 0, -0.051, -0.162, -0.038, -0.17, -0.096, 0.867, 0.616, 0.118445737864378, 0.645, 1.168, 0.734, 0.512, 0.013, -0.061, 0.128, 0.114, -0.129, 0.157, -0.049, -0.076, 0.955, -0.691, 0.43, 0.0138140572155102],
    '035-starise': [0.239, 2.555, 2.167, -0.494, -0.941, -0.772, 0.116, -0.099, -0.229, -0.095, -0.21, -0.191, -0.739, -0.422, -0.905, 0.409622590345791, 3.118, 0.024, 2.884, 0.321, 0.922, 0.896, 0.033, 0.132, 0, 0.018, 0.063, 0.188, -0.389, -0.123, -0.015, 0.555430624401346, 2.49, 1.216, 1.588, -0.368, 0.105, -0.359, 0.033, 0.188, 0.137, 0.083, 0.134, 0.005, 0.142, 0.209, 0.559, 0.00129496160138827, 1.784, 1.409, 1.374, -0.419, -0.56, 0.218, -0.174, -0.149, -0.13, -0.205, 0.216, -0.088, 0.889, 0.74, -0.258, 0.0336518236514743],
    '053-fuzzy-logic': [0.447, 1.814, 1.19, 0.271, -0.652, 0.693, 0.089, -0.195, -0.242, 0.132, -0.217, 0.084, 0.115, -0.277, 0.552, 0.0704737099136146, 2.9, 2.458, 1.384, -0.53, -0.912, -0.688, -0.214, 0.016, -0.143, 0.106, -0.007, -0.102, 0.243, -0.415, 0.538, 0.0235571230824675, 0.273, 3.077, 0.024, -0.939, -0.979, -0.914, 0.063, -0.157, 0.005, -0.117, 0.12, -0.172, 0.924, 0.215, -0.023, 0.851651716348456, 2.817, 0.651, 1.196, 0.272, 0.188, 0.887, -0.215, -0.124, -0.08, -0.192, 0.177, -0.213, -0.972, -0.768, 0.249, 0.0543174506554619],
    '056-evergreen': [0.866, 0.09, 0.21, 0.837, -0.974, 0.568, -0.031, -0.013, -0.225, -0.241, -0.149, -0.11, -0.626, 0.65, 0.717, 0.738511814807342, 0.488, 1.589, 2.033, -0.228, -0.001, 0.709, 0.009, 0.076, 0.1, 0.223, -0.216, 0.151, -0.021, 0.403, -0.054, 0.0045330967382622, 0.28, 3.019, 3.026, 0.681, -0.828, 0.457, 0.208, -0.173, 0.135, 0.215, -0.159, -0.207, -0.709, -0.066, -0.971, 0.209772670631873, 1.754, 2.303, 2.81, 0.981, -0.233, -0.786, 0.077, 0.074, 0.13, -0.07, 0.168, 0.122, -0.734, 0.969, -0.181, 0.0471824178225229],
    '062-stairway-to-heaven': [3.11, 0.817, 2.605, 0.471, 0.549, -0.008, -0.132, 0.076, 0.023, -0.232, 0.045, 0.117, -0.023, 0.266, -0.797, 0.124069996818326, 3.122, 1.145, 2.666, -0.419, -0.476, -0.418, 0.011, -0.087, 0.126, -0.209, 0.236, 0.181, -0.207, 0.509, -0.381, 0.00496906550979261, 0.305, 0.06, 0.032, 0.941, 0.863, 0.998, 0.241, -0.185, -0.172, -0.017, 0.202, -0.153, -0.109, -0.039, -0.733, 0.852625742873626, 0.805, 0.848, 2.121, 0.142, -0.368, -0.255, -0.066, 0.016, -0.156, 0.199, -0.141, 0.006, 0.455, 0.792, 0.7, 0.0183351947982556],
    '083-galatic-infinity': [2.719, 3.129, 2.674, -0.537, -0.528, 0.593, -0.14, 0.09, 0.17, -0.074, 0.171, 0.11, 0.431, -0.859, 0.947, 0.0323576612803302, 2.294, 1.31, 1.753, 0.56, -0.977, -0.05, -0.241, 0.098, 0.003, -0.072, 0.074, 0.245, -0.673, 0.089, -0.191, 0.00260209377868233, 0.074, 2.694, 0.176, 0.982, -0.984, 0.209, 0.189, 0.185, -0.246, 0.224, 0.093, 0.047, 0.58, 0.373, -0.497, 0.955692757640459, 2.246, 2.091, 2.248, 0.825, -0.141, -0.035, -0.082, 0.12, 0.17, -0.167, -0.05, -0.071, 0.41, -0.806, -0.504, 0.00934748730052827],
  };

  for (const [slug, fileParams] of Object.entries(REAL_IFS_DAYS)) {
    it(`scores ${slug} as plausible through the same CPU gate incendia_ifs uses`, () => {
      const live = composeIfsBlocks(fileParams);
      const result = classifyLiveParams(live);
      expect(result.plausible).toBe(true);
    });
  }

  it('does not pass everything indiscriminately (guards a no-op gate)', () => {
    const degenerate = classifyLiveParams([
      0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.5,
      0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.5,
    ]);
    expect(degenerate.plausible).toBe(false);
  });
});

// Non-degenerate spread smoke test (spec §7): a plausible incendia_ifs day's chaos-game output
// must span real extent, not cluster near a point -- guards against a gate/compose bug that
// technically produces "some" points but not a usable cloud.
describe('non-degenerate spread smoke test', () => {
  it('day 194 (Sky Shell) produces a chaos-game point cloud with real spread on every axis', () => {
    const { transforms } = parsePar(SKY_SHELL);
    const { pts, n } = chaosGame(transforms);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, pts[i * 3]); maxX = Math.max(maxX, pts[i * 3]);
      minY = Math.min(minY, pts[i * 3 + 1]); maxY = Math.max(maxY, pts[i * 3 + 1]);
      minZ = Math.min(minZ, pts[i * 3 + 2]); maxZ = Math.max(maxZ, pts[i * 3 + 2]);
    }
    expect(maxX - minX).toBeGreaterThan(0.01);
    expect(maxY - minY).toBeGreaterThan(0.01);
    expect(maxZ - minZ).toBeGreaterThan(0.01);
  });
});

// Flat-axis camera-framing fix, browser-verified regression for real day 105 (Horn of Rings):
// its default Orbit view rendered as a near-invisible edge-on line -- traced to every sample
// point having Y ~ 0 (confirmed here: exactly 0 in every transform's translation, not just
// small). Drag-to-rotate revealed the correct dense disk. Fix: detect the flat axis and swap
// it with Z so the default camera's visible X/Y plane shows the real structure.
describe('pickFlatAxisSwap / swapTransformAxis (flat-attractor camera framing)', () => {
  it('detects axis 1 (Y) as flat for the real Horn of Rings transforms', () => {
    const { transforms } = parsePar(HORN_OF_RINGS);
    expect(pickFlatAxisSwap(transforms)).toBe(1);
  });

  it('does not recommend a swap for a real, already-3D-balanced attractor', () => {
    const { transforms } = parsePar(SKY_SHELL);
    expect(pickFlatAxisSwap(transforms)).toBeNull();
  });

  it('swapTransformAxis correctly conjugates a non-symmetric matrix (M\'[i][j] = M[perm[i]][perm[j]])', () => {
    // hand-constructed so every entry is distinct -- a strong test that the permutation isn't
    // accidentally only correct for the real fixture's symmetric-diagonal special case.
    const transforms = [{
      m: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
      t: [10, 20, 30],
      w: 1,
    }];
    const [swapped] = swapTransformAxis(transforms, 1); // swap Y(1) <-> Z(2)
    // perm = [0, 2, 1]; M'[i][j] = M[perm[i]][perm[j]]
    expect(swapped.m).toEqual([
      [1, 3, 2], // row 0: M[0][0], M[0][2], M[0][1]
      [7, 9, 8], // row 1 (was row 2): M[2][0], M[2][2], M[2][1]
      [4, 6, 5], // row 2 (was row 1): M[1][0], M[1][2], M[1][1]
    ]);
    expect(swapped.t).toEqual([10, 30, 20]);
    expect(swapped.w).toBe(1);
  });

  it('after swapping, the real Horn of Rings attractor has real spread on the former-flat axis and is flat on the new Z instead', () => {
    const { transforms } = parsePar(HORN_OF_RINGS);
    const flatAxis = pickFlatAxisSwap(transforms);
    const swapped = swapTransformAxis(transforms, flatAxis);
    const { pts, n } = chaosGame(swapped);
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minY = Math.min(minY, pts[i * 3 + 1]); maxY = Math.max(maxY, pts[i * 3 + 1]);
      minZ = Math.min(minZ, pts[i * 3 + 2]); maxZ = Math.max(maxZ, pts[i * 3 + 2]);
    }
    // Z isn't bit-for-bit zero: chaosGame seeds z=-0.03 and the 0.753 contraction only decays
    // it toward zero asymptotically (burn=25 steps isn't enough for full convergence at this
    // rate) -- a relative comparison is the honest check, not a fragile absolute threshold.
    expect(maxY - minY).toBeGreaterThan(0.1); // Y now carries the real structure
    expect(maxZ - minZ).toBeLessThan((maxY - minY) * 0.01); // Z is now the negligible axis (was Y)
  });

  it('swapping does not change classify()\'s plausibility verdict (axis-relabeling only)', () => {
    const { transforms } = parsePar(HORN_OF_RINGS);
    const before = classify(transforms);
    const flatAxis = pickFlatAxisSwap(transforms);
    const after = classify(swapTransformAxis(transforms, flatAxis));
    expect(after.plausible).toBe(before.plausible);
    expect(after.D).toBeCloseTo(before.D, 5);
  });

  it('buildIncendiaEntry applies the swap end-to-end: composed params carry the corrected translation', () => {
    const fakeFs = {
      readdirSync: (dir) => (dir.endsWith('105') ? ['105_Horn_of_Rings.par'] : []),
      readFileSync: (path) => (path.endsWith('105_Horn_of_Rings.par') ? HORN_OF_RINGS : (() => { throw new Error(path); })()),
    };
    const outcome = buildIncendiaEntry(105, '105-horn-of-rings', '/archive', fakeFs);
    expect(outcome.status).toBe('live');
    // first transform's translation was [0, 0, 1.0] pre-swap; post-swap Y and Z trade places.
    expect(outcome.entry.params.slice(9, 12)).toEqual([0, 1, 0]);
  });
});

// Real project/236/236_Wheel_in_the_Sky.par -- gen "6 1", 1 transform (pure uniform 0.432713
// scale, translation [-0.053282, 0, 1.848541] -- Y component exactly zero, same pattern as day
// 105's incendia_ifs transforms). Real regression fixture for the single-transform ("Incendia
// Flow") pipeline path.
const WHEEL_IN_THE_SKY = crlf([
  ...HEADER('6 1', 1),
  '0.432713 0.000000 0.000000 0.000000',
  '0.432713 0.000000 0.000000 0.000000',
  '0.432713 -0.053282 0.000000 1.848541',
  '1.000000',
]);

describe('classifyFlow', () => {
  it('accepts a real single-transform day (236, pure 0.432713x scale)', () => {
    const { transforms } = parsePar(WHEEL_IN_THE_SKY);
    expect(classifyFlow(transforms[0]).plausible).toBe(true);
  });
  it('rejects a hand-constructed zero-translation transform (no fixed point to reseed around)', () => {
    const transform = { m: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]], t: [0, 0, 0], w: 1 };
    const result = classifyFlow(transform);
    expect(result.plausible).toBe(false);
    expect(result.reason).toBe('zero-translation');
  });
});
