import { join } from 'node:path';
import { pickAttractorFile } from './attractors.mjs';

// Incendia .par -> live-orbit attractor entries (phase 2c). See
// docs/superpowers/specs/2026-07-23-phase2c-incendia-design.md and
// docs/superpowers/plans/2026-07-24-phase2c-incendia-plan.md for the full decoding history.
//
// Format (all three generations, decoded and render-confirmed against the 2010 masters):
//   line 1        "<major> 1"           version marker (4 / 6 / 7)
//   line 6        "<baseShapeId> <transformCount>"
//   lines 7-20    camera/render setup (14 lines, ignored)
//   line 21 ...   <transformCount> blocks of 4 lines each:
//                   row0/row1/row2: 4 floats -> 12 floats total
//                   w:              1 float  (weight, NOT globally normalized -- see below)
// The 12 floats are a COLUMN-MAJOR 3x3 linear map (m[i][j] = flat[j*3+i]) plus translation
// = the last 3 floats (flat[9..11]). A naive row-major read makes the matrix singular and
// collapses the chaos game to a starburst -- confirmed both by rendering (Medusa's own
// expanded rotation*scale block cross-checks the column-major reading) and independently by
// a web-research pass that rendered pixel-exact Sierpinski/Menger from real archived Incendia
// sample files using this same layout. Everything after the transform blocks (per-transform
// 2D control pairs, camera, gradients, texture refs, a 256-entry hex palette) is render-only
// noise and is not parsed.

function numLine(line) {
  const t = (line || '').trim();
  if (t === '' || t === '#') return null;
  const nums = t.split(/\s+/).map(Number);
  return nums.some(Number.isNaN) ? null : nums;
}

const HEADER_LINES = 20;

export function parsePar(content) {
  const raw = content.split(/\r?\n/);
  const gen = (raw[0] || '').trim();
  const h6 = numLine(raw[5]);
  const baseShape = h6?.[0] ?? null;
  const declaredCount = h6?.[1] ?? 0;
  const transforms = [];
  let i = HEADER_LINES;
  let clean = declaredCount > 0;
  for (let b = 0; b < declaredCount; b++) {
    const r0 = numLine(raw[i]), r1 = numLine(raw[i + 1]), r2 = numLine(raw[i + 2]), w = numLine(raw[i + 3]);
    // A block that never starts -- r0 is not a 4-float row -- means the transform SECTION has
    // ended and the 2-float per-transform control pairs have begun. That is how every real
    // .par terminates its run; it is not corruption, and the blocks already read are good.
    // declaredCount (header line 6, field 2) is an upper bound, not a reliable count: 4 corpus
    // days over-declare it (87/129/190/320 -- this was the "4 parse failures"), and 67 more
    // UNDER-declare it. See the under-read note on buildIncendiaEntry before changing this.
    if (b > 0 && r0?.length !== 4) break;
    if (r0?.length === 4 && r1?.length === 4 && r2?.length === 4 && w?.length === 1) {
      const flat = [...r0, ...r1, ...r2];
      transforms.push({
        m: [
          [flat[0], flat[3], flat[6]],
          [flat[1], flat[4], flat[7]],
          [flat[2], flat[5], flat[8]],
        ],
        t: [flat[9], flat[10], flat[11]],
        w: w[0],
      });
      i += 4;
    } else {
      clean = false;
      break;
    }
  }
  return { gen, baseShape, declaredCount, transforms, clean };
}

// Composes parsed transforms into the live stride-13 [M(9 row-major), t(3), w(1)] format
// with weights normalized to sum 1 -- the exact contract src/attractor/families/ifs.ts's
// composeIfsBlocks produces and its GLSL/CPU chaos-game step consumes (params[base+0..2]*p +
// params[base+9] etc.). Incendia's weights are per-base-shape relative probabilities, not
// pre-normalized (confirmed empirically: single-transform files carry 0.5 or 1.0, multi-
// transform sums are arbitrary) -- normalize here, once, at the source.
export function composeIncendiaBlocks(transforms) {
  const out = [];
  const weights = [];
  for (const tr of transforms) {
    out.push(
      tr.m[0][0], tr.m[0][1], tr.m[0][2],
      tr.m[1][0], tr.m[1][1], tr.m[1][2],
      tr.m[2][0], tr.m[2][1], tr.m[2][2],
      tr.t[0], tr.t[1], tr.t[2],
      0,
    );
    weights.push(Math.max(0, tr.w));
  }
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  weights.forEach((w, b) => { out[b * 13 + 12] = w / sum; });
  return out;
}

// ---------- plausibility gate (CPU chaos-game classifier) ----------
// Deterministic LCG so the gate is reproducible build-to-build.
export function chaosGame(transforms, { iters = 400_000, burn = 25 } = {}) {
  const wsum = transforms.reduce((a, tr) => a + Math.max(tr.w, 0), 0) || transforms.length;
  const cum = [];
  let acc = 0;
  for (const tr of transforms) { acc += Math.max(tr.w, 0) / wsum; cum.push(acc); }
  let seed = 0x2545f491;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let x = 0.05, y = 0.02, z = -0.03;
  const pts = new Float64Array(iters * 3);
  let n = 0;
  for (let it = 0; it < iters + burn; it++) {
    const r = rnd();
    let k = 0; while (k < cum.length - 1 && r > cum[k]) k++;
    const tr = transforms[k];
    const nx = tr.m[0][0] * x + tr.m[0][1] * y + tr.m[0][2] * z + tr.t[0];
    const ny = tr.m[1][0] * x + tr.m[1][1] * y + tr.m[1][2] * z + tr.t[1];
    const nz = tr.m[2][0] * x + tr.m[2][1] * y + tr.m[2][2] * z + tr.t[2];
    x = nx; y = ny; z = nz;
    if (!Number.isFinite(x) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e6) {
      x = 0.05; y = 0.02; z = -0.03; continue; // divergence rescue
    }
    if (it >= burn) { pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z; n++; }
  }
  return { pts, n };
}

function bounds(pts, n, axisA, axisB) {
  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) { a[i] = pts[i * 3 + axisA]; b[i] = pts[i * 3 + axisB]; }
  const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.floor(p * (n - 1))]; };
  return { aMin: pct(a, 0.005), aMax: pct(a, 0.995), bMin: pct(b, 0.005), bMax: pct(b, 0.995) };
}

export function raster(pts, n, axisA, axisB, S = 256) {
  const bb = bounds(pts, n, axisA, axisB);
  const spanA = bb.aMax - bb.aMin || 1, spanB = bb.bMax - bb.bMin || 1;
  const span = Math.max(spanA, spanB);
  const grid = new Float64Array(S * S);
  const offA = (span - spanA) / 2, offB = (span - spanB) / 2;
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const va = pts[i * 3 + axisA], vb = pts[i * 3 + axisB];
    const gx = Math.floor(((va - bb.aMin + offA) / span) * (S - 1));
    const gy = Math.floor(((vb - bb.bMin + offB) / span) * (S - 1));
    if (gx >= 0 && gx < S && gy >= 0 && gy < S) { if (grid[gy * S + gx] === 0) filled++; grid[gy * S + gx]++; }
  }
  return { grid, S, coverage: filled / (S * S) };
}

// Box-counting fractal dimension: separates ~1D starbursts/fixed points (D ~ 0-1) from
// genuine 2D+ attractor structure (D ~ 1.5-2). Does NOT separate real fractal detail from a
// solid filled blob -- see isoperimetricRatio for that.
export function boxDim(grid, S) {
  const occ = (size) => {
    const step = S / size;
    const seen = new Set();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (grid[y * S + x] > 0) seen.add(((y / step) | 0) * size + ((x / step) | 0));
    }
    return seen.size;
  };
  const sizes = [8, 16, 32, 64, 128];
  const xs = [], ys = [];
  for (const s of sizes) { const c = occ(s); if (c > 0) { xs.push(Math.log(s)); ys.push(Math.log(c)); } }
  const nn = xs.length; if (nn < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / nn, my = ys.reduce((a, b) => a + b, 0) / nn;
  let num = 0, den = 0; for (let i = 0; i < nn; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

// Isoperimetric ratio (perimeter^2 / area) of the occupied-cell mask. By the isoperimetric
// inequality a disk/convex blob MINIMIZES perimeter for a given area, so a smooth filled
// region (disk/diamond/triangle) scores near a geometric floor regardless of coverage, while
// a genuinely fractal boundary (holes, filaments, branches at many scales) runs far higher --
// the signal boxDim alone cannot provide. Calibrated 2026-07-25 against 16 known-good/12
// known-bad archive days: good clustered 575-9686; bad split into solid-blob (10-278) and
// noisy/divergent speckle-fill (14554-20079, independently confirmed by that population's high
// chaos-game divergence rate). See the plan doc for the full calibration.
export function isoperimetricRatio(grid, S) {
  let area = 0, perim = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!grid[y * S + x]) continue;
    area++;
    const up = y > 0 ? grid[(y - 1) * S + x] : 0;
    const down = y < S - 1 ? grid[(y + 1) * S + x] : 0;
    const left = x > 0 ? grid[y * S + x - 1] : 0;
    const right = x < S - 1 ? grid[y * S + x + 1] : 0;
    if (!up || !down || !left || !right) perim++;
  }
  return area ? (perim * perim) / area : 0;
}

// minD recalibrated 2026-07-25 (see github.com/gitizenme/365-strange-attractors/issues/24):
// the original 1.3 floor wrongly excluded genuine thin, self-similar fractal curves (real
// examples: days 139/147/149/154/158/120/202/281/330/334/337/365 -- confirmed by rendering
// and looking, not just by the number) because a thin curling curve that never fills 2D area
// scores nearly as low a box-counting dimension as a degenerate straight line -- D alone
// cannot tell them apart; a hand-authored R^2-of-the-log-log-fit discriminator was tried and
// rejected (only 5 box-count scale points, so even a literal straight line fits at R^2>0.999,
// no separation at all). What actually separates them is NOT a new metric: the isoperimetric
// band already does the real discrimination (it's what rejects the divergent/noisy and
// solid-blob clusters at every D), so minD only needs to sit above the degenerate-line
// cluster's ceiling. Confirmed straight lines cluster tightly at D 0.93-1.03 (stable across
// 400k vs 1.5M iterations); confirmed genuine curves start at D 1.058, also stable across
// iteration counts -- the two clusters are genuinely, robustly separated, just not at 1.3.
// 1.05 sits in that stable gap. Recovers 12/51 previously-"implausible" days, all individually
// visually confirmed against their 2010 renders; zero previously-correctly-excluded days
// (blobs, noise, lines) newly pass -- the iso band alone still excludes every one of them.
const GATE = { minD: 1.05, minCoverage: 0.003, minIso: 300, maxIso: 12000 };

// De-flattens live stride-13 params (row-major M(9), t(3), w(1)) back into {m,t,w} triples --
// the inverse of composeIncendiaBlocks. Lets classify() run against already-composed live
// params from any stride-13-compatible source, not just freshly parsed Incendia transforms --
// used by the harness-calibration test to sanity-check the gate against real, independently-
// verified chaoscope ifs days (composed via that family's own composeIfsBlocks).
export function classifyLiveParams(liveParams) {
  const transforms = [];
  for (let i = 0; i + 13 <= liveParams.length; i += 13) {
    const b = liveParams.slice(i, i + 13);
    transforms.push({ m: [[b[0], b[1], b[2]], [b[3], b[4], b[5]], [b[6], b[7], b[8]]], t: [b[9], b[10], b[11]], w: b[12] });
  }
  return classify(transforms);
}

export function classify(transforms) {
  if (transforms.length < 2) return { plausible: false, reason: 'single-transform' };
  const { pts, n } = chaosGame(transforms);
  if (n < 1000) return { plausible: false, reason: 'insufficient-points' };
  const planes = [[0, 1], [0, 2], [1, 2]];
  let best = null;
  for (const [A, B] of planes) {
    const { grid, S, coverage } = raster(pts, n, A, B);
    const D = boxDim(grid, S);
    const iso = isoperimetricRatio(grid, S);
    if (!best || coverage > best.coverage) best = { D, iso, coverage };
  }
  const plausible = best.D >= GATE.minD && best.coverage >= GATE.minCoverage
    && best.iso >= GATE.minIso && best.iso <= GATE.maxIso;
  return { plausible, ...best };
}

// ---------- default-camera framing: flat-attractor axis correction ----------
// Some decoded attractors are genuinely flat -- every sampled point has near-zero variance on
// one axis (confirmed on real day 105/Horn of Rings: Y ~ 1e-26, floating-point noise around
// exact zero). The app's default camera looks along -Z with Y as the up/visible axis and Z as
// depth, so a flat-Y attractor renders as a near-invisible edge-on line until the user drags to
// rotate -- browser-verified: dragging to look top-down reveals the correct dense disk, exactly
// matching the phase-0 spike's CPU thumbnail. Not a bug in the decode/compose, purely a default-
// orientation problem. Fix: detect the flat axis and swap it into Z (depth) so the two axes with
// real structure land in the default-visible X/Y plane -- a coordinate relabeling, not a change
// to the attractor's actual shape.
const FLAT_AXIS_RATIO = 0.1; // an axis under 10% of the largest span counts as "the flat one"

// Returns 0 or 1 (the flat axis to swap with Z), or null if no axis is meaningfully flatter
// than the others (most attractors don't need this).
export function pickFlatAxisSwap(transforms) {
  const { pts, n } = chaosGame(transforms);
  if (n < 100) return null;
  const spans = [0, 1, 2].map((axis) => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { const v = pts[i * 3 + axis]; if (v < min) min = v; if (v > max) max = v; }
    return max - min;
  });
  const maxSpan = Math.max(...spans);
  if (maxSpan <= 0) return null;
  const flatAxis = spans.findIndex((s) => s / maxSpan < FLAT_AXIS_RATIO);
  return flatAxis === -1 || flatAxis === 2 ? null : flatAxis;
}

// Swaps axis `flatAxis` (0=X or 1=Y) with axis 2 (Z) throughout every transform: conjugates M
// by the swap permutation (M'[i][j] = M[perm[i]][perm[j]]) and permutes t the same way, so the
// SAME dynamical system keeps iterating correctly (the shared state must be permuted
// consistently across every transform and every step, not just relabeled at the output) --
// only the embedding orientation changes, never the attractor's intrinsic shape. Applying it
// doesn't affect classify()'s verdict: the gate already tries all 3 projection planes and picks
// the best, which is invariant to axis relabeling.
export function swapTransformAxis(transforms, flatAxis) {
  const perm = [0, 1, 2];
  perm[flatAxis] = 2;
  perm[2] = flatAxis;
  return transforms.map(({ m, t, w }) => ({
    m: perm.map((i) => perm.map((j) => m[i][j])),
    t: perm.map((i) => t[i]),
    w,
  }));
}

// ---------- single-transform ("Incendia Flow") quality gate ----------
// Calibration (2026-07-25, see docs/superpowers/specs/2026-07-25-incendia-flow-design.md) checked
// every one of the 124 real single-transform days' contraction factor (Frobenius-norm scale of
// the linear part) and found the whole population genuinely contractive: range 0.25-0.9468,
// median 0.39, zero days at or above 0.95 -- none are near-identity, none are non-contracting.
// There is no real threshold to calibrate: every one of the 124 real days is expected to pass.
// The one defensive guard is a transform with zero translation, which has no meaningful fixed
// point or scale reference to reseed around (not observed in the real corpus, but a `.par` file
// could in principle produce one).
export function classifyFlow(transform) {
  const tLen = Math.hypot(transform.t[0], transform.t[1], transform.t[2]);
  if (tLen === 0) return { plausible: false, reason: 'zero-translation' };
  return { plausible: true };
}

// ---------- pipeline entry points ----------

// Returns null only when the day has no .par file at all. Otherwise always returns
// {gen, status, entry}, entry non-null only when status is 'live' -- this lets applyIncendia
// report per-generation parsed/plausible counts uniformly (spec: "the metric we drive down").
export function buildIncendiaEntry(day, slug, archiveRoot, fs) {
  const dir = join(archiveRoot, 'project', String(day).padStart(3, '0'));
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.par'));
  const chosen = pickAttractorFile(day, files, slug);
  if (!chosen) return null;
  const p = parsePar(fs.readFileSync(join(dir, chosen), 'utf8'));
  if (!p.clean) return { gen: p.gen, status: 'parse-failed', entry: null };
  if (p.transforms.length === 1) {
    const flow = classifyFlow(p.transforms[0]);
    if (!flow.plausible) return { gen: p.gen, status: 'flow-implausible', entry: null };
    // Deliberately NOT applying pickFlatAxisSwap/swapTransformAxis here -- see the design spec's
    // finding: that correction's detection method compares axis spans across one settled
    // trajectory, meaningful for a multi-transform attractor's genuine spread but not for a
    // single-transform trajectory that converges to one point on every axis simultaneously.
    const entry = { day, slug, system: 'incendia_flow', matrices: 1, params: composeIncendiaBlocks(p.transforms) };
    return { gen: p.gen, status: 'live', entry };
  }
  const cls = classify(p.transforms);
  if (!cls.plausible) return { gen: p.gen, status: 'implausible', entry: null };
  const flatAxis = pickFlatAxisSwap(p.transforms);
  const transforms = flatAxis === null ? p.transforms : swapTransformAxis(p.transforms, flatAxis);
  const entry = { day, slug, system: 'incendia_ifs', matrices: transforms.length, params: composeIncendiaBlocks(transforms) };
  return { gen: p.gen, status: 'live', entry };
}

// Fills in live incendia_ifs/incendia_flow entries for days that are currently static-only. Precedence:
// a day with an existing (non-static) Chaoscope entry is never touched -- shipped orbits
// never change -- so buildIncendiaEntry is not even called for it (no wasted .par reads).
export function applyIncendia(attractors, days, archiveRoot, fs) {
  const slugByDay = new Map(days.map(d => [d.day, d.slug]));
  const stats = {};
  const bump = (gen) => (stats[gen] ??= { total: 0, parsed: 0, plausible: 0 });
  const result = attractors.map((a) => {
    if (a.system !== 'static-only') return a;
    const slug = slugByDay.get(a.day) ?? a.slug;
    const outcome = buildIncendiaEntry(a.day, slug, archiveRoot, fs);
    if (!outcome) return a;
    const g = bump(outcome.gen);
    g.total++;
    if (outcome.status !== 'parse-failed') g.parsed++;
    if (outcome.status === 'live') { g.plausible++; return outcome.entry; }
    return a;
  });
  return { attractors: result, stats };
}
