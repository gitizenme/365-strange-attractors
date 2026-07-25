#!/usr/bin/env node
// Incendia .par verification harness — Phase 0 spike.
// Parse -> CPU chaos-game point cloud -> project -> density raster -> PNG thumbnail.
// Purpose: confirm the parsed 3x4 affine semantics render the right "living skeleton"
// by eye against the 2010 render, and produce a numeric structure score for a corpus sweep.
//
// Usage:
//   node scripts/spike/incendia_render.mjs <ARCHIVE> render <day> [axis=xy|xz|yz|auto]
//   node scripts/spike/incendia_render.mjs <ARCHIVE> sweep [limit]

import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ARCHIVE = process.argv[2];
const CMD = process.argv[3] || 'render';
const OUT = join(process.cwd(), 'scripts', 'spike', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ---------- parse ----------
function numLine(line) {
  const t = (line || '').trim();
  if (t === '' || t === '#') return null;
  const nums = t.split(/\s+/).map(Number);
  return nums.some(Number.isNaN) ? null : nums;
}
export function parsePar(path) {
  const raw = readFileSync(path, 'latin1').split(/\r?\n/);
  const gen = (raw[0] || '').trim();
  const h6 = numLine(raw[5]);
  const baseShape = h6?.[0] ?? null;
  const count = h6?.[1] ?? 0;
  const START = 20;
  const transforms = [];
  let i = START, clean = true;
  for (let b = 0; b < count; b++) {
    const r0 = numLine(raw[i]), r1 = numLine(raw[i + 1]), r2 = numLine(raw[i + 2]), w = numLine(raw[i + 3]);
    if (r0?.length === 4 && r1?.length === 4 && r2?.length === 4 && w?.length === 1) {
      // CONFIRMED decode (research + Medusa expanded-form cross-check):
      // 12 floats = COLUMN-MAJOR 3x3 linear (first 9) + translation (last 3 of row2). weight separate.
      const flat = [...r0, ...r1, ...r2];
      const m = [
        [flat[0], flat[3], flat[6]],
        [flat[1], flat[4], flat[7]],
        [flat[2], flat[5], flat[8]],
      ];
      transforms.push({ m, t: [flat[9], flat[10], flat[11]], w: w[0] });
      i += 4;
    } else { clean = false; break; }
  }
  return { gen, baseShape, count, transforms, clean };
}

// ---------- chaos game ----------
const TRANSPOSE = process.env.TP === '1';
export function chaosGame(transforms, { iters = 1_500_000, burn = 25 } = {}) {
  if (TRANSPOSE) transforms = transforms.map((tr) => ({
    w: tr.w, t: tr.t,
    m: [[tr.m[0][0], tr.m[1][0], tr.m[2][0]], [tr.m[0][1], tr.m[1][1], tr.m[2][1]], [tr.m[0][2], tr.m[1][2], tr.m[2][2]]],
  }));
  const wsum = transforms.reduce((a, tr) => a + Math.max(tr.w, 0), 0) || transforms.length;
  const cum = [];
  let acc = 0;
  for (const tr of transforms) { acc += Math.max(tr.w, 0) / wsum; cum.push(acc); }
  // deterministic LCG so runs are reproducible
  let seed = 0x2545f491;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let x = 0.05, y = 0.02, z = -0.03;
  const pts = new Float64Array(iters * 3);
  let n = 0, reseeds = 0;
  for (let it = 0; it < iters + burn; it++) {
    const r = rnd();
    let k = 0; while (k < cum.length - 1 && r > cum[k]) k++;
    const tr = transforms[k];
    const nx = tr.m[0][0] * x + tr.m[0][1] * y + tr.m[0][2] * z + tr.t[0];
    const ny = tr.m[1][0] * x + tr.m[1][1] * y + tr.m[1][2] * z + tr.t[1];
    const nz = tr.m[2][0] * x + tr.m[2][1] * y + tr.m[2][2] * z + tr.t[2];
    x = nx; y = ny; z = nz;
    if (!Number.isFinite(x) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e6) {
      x = 0.05; y = 0.02; z = -0.03; reseeds++; continue; // divergence rescue
    }
    if (it >= burn) { pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z; n++; }
  }
  return { pts, n, reseeds };
}

// robust bounds via percentile on each axis
function bounds(pts, n, axisA, axisB) {
  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) { a[i] = pts[i * 3 + axisA]; b[i] = pts[i * 3 + axisB]; }
  const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.floor(p * (n - 1))]; };
  return { aMin: pct(a, 0.005), aMax: pct(a, 0.995), bMin: pct(b, 0.005), bMax: pct(b, 0.995) };
}

// project to density grid on plane (axisA, axisB)
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

// box-counting fractal dimension of the occupied cells: separates ~1D starbursts (rays
// through a fixed point, D≈1) from genuine 2D+ attractor structure (D≈1.6–2).
// NOTE: does NOT separate real fractal detail from a solid filled blob (disk/diamond/triangle)
// — a uniformly-filled region also scores D≈2. See isoperimetricRatio for that.
export function boxDim(grid, S) {
  const occ = (size) => {
    const step = S / size;
    const seen = new Set();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (grid[y * S + x] > 0) seen.add(((y / step) | 0) * size + ((x / step) | 0));
    }
    return seen.size;
  };
  // regression of log(count) vs log(scale) over a few box sizes
  const sizes = [8, 16, 32, 64, 128];
  const xs = [], ys = [];
  for (const s of sizes) { const c = occ(s); if (c > 0) { xs.push(Math.log(s)); ys.push(Math.log(c)); } }
  const nn = xs.length; if (nn < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / nn, my = ys.reduce((a, b) => a + b, 0) / nn;
  let num = 0, den = 0; for (let i = 0; i < nn; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

// Isoperimetric ratio (perimeter^2 / area) of the occupied-cell mask, 4-connected boundary
// (a pixel adjacent to any empty neighbor — including neighbors inside an internal hole —
// counts as boundary, so holes/branches contribute).
// By the isoperimetric inequality a disk MINIMIZES perimeter for a given area — so a smooth
// filled blob (disk/diamond/triangle) scores near the theoretical floor (~4·pi for a disk on
// a square grid, roughly constant regardless of size), while a genuinely fractal boundary
// (holes, filaments, branches at many scales) has no such bound and runs far higher.
// This is the metric that separates "real fractal detail" from "chaos game just fills a
// simple convex region" — boxDim alone cannot make that distinction.
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

export function gridToBuf(grid, S) {
  let max = 0; for (const v of grid) if (v > max) max = v;
  const lg = Math.log1p(max) || 1;
  const buf = Buffer.alloc(S * S);
  for (let i = 0; i < grid.length; i++) buf[i] = grid[i] ? Math.min(255, Math.floor((Math.log1p(grid[i]) / lg) * 255)) : 0;
  return buf;
}

function toPng(grid, S, path) {
  return sharp(gridToBuf(grid, S), { raw: { width: S, height: S, channels: 1 } }).png().toFile(path);
}

// ---------- day file selection ----------
function dayPath(archive, day) {
  const dir = join(archive, 'project', String(day).padStart(3, '0'));
  const pars = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.par'));
  const f = pars.find((p) => /^\d/.test(p)) || pars[0];
  return { path: join(dir, f), name: f.replace(/\.par$/i, '') };
}
function renderAsset(archive, name) {
  for (const [d, ext] of [['generated', 'jpg'], ['pngs', 'png'], ['resized', 'jpg']]) {
    const p = join(archive, d, `${name}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

// ---------- structure score vs 2010 render ----------
async function structureScore(grid, S, assetPath) {
  // load 2010 render as SxS grayscale, build silhouette (ink) masks, compare IoU + centroid dist.
  const img = await sharp(assetPath).greyscale().resize(S, S, { fit: 'fill' }).raw().toBuffer();
  // Incendia renders are usually light fractal on dark bg OR dark on light — detect by mean.
  let sum = 0; for (const v of img) sum += v; const mean = sum / img.length;
  const inkImg = new Uint8Array(S * S);
  for (let i = 0; i < img.length; i++) inkImg[i] = (mean < 128 ? img[i] > mean + 20 : img[i] < mean - 20) ? 1 : 0;
  const inkGrid = new Uint8Array(S * S);
  for (let i = 0; i < grid.length; i++) inkGrid[i] = grid[i] > 0 ? 1 : 0;
  // dilate the sparse point grid a touch so thin skeletons overlap the shaded render
  const dil = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inkGrid[y * S + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < S && xx >= 0 && xx < S) dil[yy * S + xx] = 1;
    }
  }
  let inter = 0, uni = 0;
  for (let i = 0; i < S * S; i++) { const a = dil[i], b = inkImg[i]; if (a || b) uni++; if (a && b) inter++; }
  return { iou: uni ? inter / uni : 0 };
}

// ---------- commands ----------
// Guarded so other spike scripts can `import` this module's exports (parsePar, chaosGame,
// raster, boxDim, isoperimetricRatio, gridToBuf) without triggering the CLI side effects below.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && CMD === 'render') {
  const day = process.argv[4];
  const axisArg = process.argv[5] || 'auto';
  const { path, name } = dayPath(ARCHIVE, day);
  const p = parsePar(path);
  const { pts, n, reseeds } = chaosGame(p.transforms);
  const planes = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
  const chosen = axisArg === 'auto' ? Object.keys(planes) : [axisArg];
  let bestPlane = null;
  for (const pl of chosen) {
    const [A, B] = planes[pl];
    const { grid, S, coverage } = raster(pts, n, A, B);
    const out = join(OUT, `${name}_${pl}.png`);
    await toPng(grid, S, out);
    const D = boxDim(grid, S);
    const iso = isoperimetricRatio(grid, S);
    const asset = renderAsset(ARCHIVE, name);
    const sc = asset ? await structureScore(grid, S, asset) : { iou: null };
    console.log(`${name} gen[${p.gen}] tf=${p.count} plane=${pl} coverage=${coverage.toFixed(3)} D=${D.toFixed(2)} iso=${iso.toFixed(1)} iou=${sc.iou?.toFixed(3)} reseeds=${reseeds} -> ${out}`);
    if (!bestPlane || coverage > bestPlane.coverage) bestPlane = { pl, coverage };
  }
  const asset = renderAsset(ARCHIVE, name);
  console.log(`2010 render: ${asset || 'NONE'}`);
  console.log(`best-spread plane: ${bestPlane.pl}`);
} else if (CMD === 'calibrate') {
  // Calibrate the isoperimetric-ratio threshold against the known good/bad split observed
  // by eye in the first contact sheet (2026-07-25).
  const GOOD = [223, 194, 106, 171, 156, 151, 126, 168, 115, 260, 316, 312, 251, 270, 135, 86];
  const BAD = [203, 105, 293, 101, 122, 357, 172, 347, 243, 240, 318, 107];
  for (const [label, days] of [['GOOD', GOOD], ['BAD', BAD]]) {
    console.log(`--- ${label} ---`);
    for (const day of days) {
      const { path, name } = dayPath(ARCHIVE, String(day).padStart(3, '0'));
      const p = parsePar(path);
      if (!p.clean || p.transforms.length < 2) { console.log(`${day} ${name}: skip (parse/single-transform)`); continue; }
      const { pts, n } = chaosGame(p.transforms, { iters: 400_000 });
      const planes = [[0, 1], [0, 2], [1, 2]];
      let best = null;
      for (const [A, B] of planes) {
        const { grid, S, coverage } = raster(pts, n, A, B);
        if (!best || coverage > best.coverage) best = { grid, S, coverage };
      }
      const D = boxDim(best.grid, best.S);
      const iso = isoperimetricRatio(best.grid, best.S);
      console.log(`${day} ${name}: D=${D.toFixed(2)} iso=${iso.toFixed(1)} coverage=${best.coverage.toFixed(3)}`);
    }
  }
} else if (CMD === 'sweep') {
  const limit = Number(process.argv[4] || 300);
  const dirs = readdirSync(join(ARCHIVE, 'project')).filter((d) => /^\d+$/.test(d)).sort().slice(0, limit);
  const rows = [];
  for (const day of dirs) {
    let name;
    try {
      const dp = dayPath(ARCHIVE, day); name = dp.name;
      const p = parsePar(dp.path);
      if (!p.clean || !p.transforms.length) { rows.push({ day, gen: p.gen, ok: false, why: 'parse' }); continue; }
      const { pts, n, reseeds } = chaosGame(p.transforms, { iters: 400_000 });
      const planes = [[0, 1], [0, 2], [1, 2]];
      let best = { coverage: 0, D: 0, iso: 0 };
      for (const [A, B] of planes) {
        const { grid, S, coverage } = raster(pts, n, A, B);
        const D = boxDim(grid, S);
        const iso = isoperimetricRatio(grid, S);
        if (coverage > best.coverage) best = { coverage, D, iso };
      }
      rows.push({ day, gen: p.gen, tf: p.count, ok: true, coverage: +best.coverage.toFixed(3), D: +best.D.toFixed(2), iso: +best.iso.toFixed(1), reseeds });
    } catch (e) { rows.push({ day, ok: false, why: e.message }); }
  }
  const good = rows.filter((r) => r.ok);
  // plausible = non-degenerate structure (D>=1.3, rays are ~1.0) AND a mid-band isoperimetric
  // ratio: too LOW means a solid convex blob (disk/diamond/triangle, smooth boundary), too
  // HIGH means noisy ergodic speckle-fill (near-isolated pixels inflate perimeter). Band
  // calibrated 2026-07-25 against a 16-good/12-bad set eyeballed from the first contact sheet:
  // good clustered 575-9686, bad split into two clusters (10-278 and 14554-20079).
  const isPlausible = (r) => r.D >= 1.3 && r.coverage >= 0.003 && r.iso >= 300 && r.iso <= 12000;
  const plausible = good.filter(isPlausible);
  console.log(`swept ${rows.length}: parsed ${good.length}, plausible(D>=1.3, cov>=.003, iso in [300,12000]) ${plausible.length}, rejected ${good.length - plausible.length}`);
  const byGen = {};
  for (const r of good) { byGen[r.gen] = byGen[r.gen] || { n: 0, cov: 0, D: 0, plaus: 0 }; const g = byGen[r.gen]; g.n++; g.cov += r.coverage; g.D += r.D; if (isPlausible(r)) g.plaus++; }
  for (const g of Object.keys(byGen).sort()) { const b = byGen[g]; console.log(`gen[${g}] n=${b.n} avgCoverage=${(b.cov / b.n).toFixed(3)} avgD=${(b.D / b.n).toFixed(2)} plausible=${b.plaus}/${b.n}`); }
  console.log('lowest D (starburst suspects):', good.sort((a, b) => a.D - b.D).slice(0, 12).map((r) => `${r.day}:${r.D}`).join(' '));
  console.log('low-iso rejects (solid blob):', good.filter((r) => r.D >= 1.3 && r.iso < 300).map((r) => `${r.day}:${r.iso}`).join(' ') || 'none');
  console.log('high-iso rejects (noise fill):', good.filter((r) => r.D >= 1.3 && r.iso > 12000).map((r) => `${r.day}:${r.iso}`).join(' ') || 'none');
  console.log('reseed(divergent) days:', good.filter((r) => r.reseeds > 1000).map((r) => r.day).join(' ') || 'none');
}
