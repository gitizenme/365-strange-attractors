#!/usr/bin/env node
// Batch render + contact sheet for Phase 0 spike review.
// Reuses incendia_render.mjs's parse/chaos-game/raster/dimension logic, renders every
// candidate day once, ranks by fractal dimension, and composes a labeled grid so a human
// can eyeball a whole batch at once instead of one file at a time.
//
// Usage: node scripts/spike/contact_sheet.mjs <ARCHIVE> [count=30] [cols=6]

import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { parsePar } from './incendia_render.mjs';

const ARCHIVE = process.argv[2];
const COUNT = Number(process.argv[3] || 30);
const COLS = Number(process.argv[4] || 6);
const OUT = join(process.cwd(), 'scripts', 'spike', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

function chaosGame(transforms, { iters = 300_000, burn = 25 } = {}) {
  const wsum = transforms.reduce((a, tr) => a + Math.max(tr.w, 0), 0) || transforms.length;
  const cum = []; let acc = 0;
  for (const tr of transforms) { acc += Math.max(tr.w, 0) / wsum; cum.push(acc); }
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
    if (!Number.isFinite(x) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e6) { x = 0.05; y = 0.02; z = -0.03; reseeds++; continue; }
    if (it >= burn) { pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z; n++; }
  }
  return { pts, n, reseeds };
}

function bounds(pts, n, axisA, axisB) {
  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) { a[i] = pts[i * 3 + axisA]; b[i] = pts[i * 3 + axisB]; }
  const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.floor(p * (n - 1))]; };
  return { aMin: pct(a, 0.005), aMax: pct(a, 0.995), bMin: pct(b, 0.005), bMax: pct(b, 0.995) };
}

function raster(pts, n, axisA, axisB, S) {
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

function boxDim(grid, S) {
  const occ = (size) => {
    const step = S / size; const seen = new Set();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (grid[y * S + x] > 0) seen.add(((y / step) | 0) * size + ((x / step) | 0));
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

function gridToBuf(grid, S) {
  let max = 0; for (const v of grid) if (v > max) max = v;
  const lg = Math.log1p(max) || 1;
  const buf = Buffer.alloc(S * S);
  for (let i = 0; i < grid.length; i++) buf[i] = grid[i] ? Math.min(255, Math.floor((Math.log1p(grid[i]) / lg) * 255)) : 0;
  return buf;
}

function dayFiles(archive) {
  const PROJECT = join(archive, 'project');
  const out = [];
  for (const dir of readdirSync(PROJECT).sort()) {
    const full = join(PROJECT, dir);
    if (!existsSync(full)) continue;
    let pars; try { pars = readdirSync(full).filter((f) => f.toLowerCase().endsWith('.par')); } catch { continue; }
    if (!pars.length) continue;
    const f = pars.find((p) => /^\d/.test(p)) || pars[0];
    out.push({ day: dir, path: join(full, f), name: f.replace(/\.par$/i, '') });
  }
  return out;
}

const TILE = 160;
const files = dayFiles(ARCHIVE);
const results = [];
console.log(`scanning ${files.length} days...`);
for (const { day, path, name } of files) {
  let p; try { p = parsePar(path); } catch { continue; }
  if (!p.clean || p.transforms.length < 2) continue; // single-transform is a fixed point, not interesting to preview
  const { pts, n, reseeds } = chaosGame(p.transforms, { iters: 250_000 });
  if (n < 1000) continue;
  const planes = [[0, 1], [0, 2], [1, 2]];
  let best = null;
  for (const [A, B] of planes) {
    const { grid, S, coverage } = raster(pts, n, A, B, TILE);
    const D = boxDim(grid, S);
    if (!best || coverage > best.coverage) best = { grid, S, coverage, D, plane: `${A}${B}` };
  }
  if (best.D < 1.3 || best.coverage < 0.003) continue;
  results.push({ day, name, tf: p.count, gen: p.gen, D: best.D, coverage: best.coverage, buf: gridToBuf(best.grid, best.S), reseeds });
}
console.log(`plausible candidates: ${results.length}`);
results.sort((a, b) => b.D - a.D);
const top = results.slice(0, COUNT);

// compose grid with sharp: TILE x TILE tiles + label strip
const LABEL_H = 22;
const cellW = TILE, cellH = TILE + LABEL_H;
const cols = COLS, rows = Math.ceil(top.length / cols);
const sheetW = cols * cellW, sheetH = rows * cellH;

const composites = [];
for (let idx = 0; idx < top.length; idx++) {
  const r = top[idx];
  const col = idx % cols, row = Math.floor(idx / cols);
  const tilePng = await sharp(r.buf, { raw: { width: TILE, height: TILE, channels: 1 } }).png().toBuffer();
  composites.push({ input: tilePng, left: col * cellW, top: row * cellH });
  const label = `${r.day} ${r.name.slice(0, 16)} D${r.D.toFixed(1)}`;
  const svg = `<svg width="${cellW}" height="${LABEL_H}"><rect width="100%" height="100%" fill="black"/><text x="4" y="15" font-family="monospace" font-size="11" fill="white">${label}</text></svg>`;
  composites.push({ input: Buffer.from(svg), left: col * cellW, top: row * cellH + TILE });
}

const base = sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: { r: 0, g: 0, b: 0 } } });
const outPath = join(OUT, `contact_sheet_top${top.length}.png`);
await base.composite(composites).png().toFile(outPath);
console.log(`wrote ${outPath} (${cols}x${rows} grid, ${top.length} tiles)`);
console.log('ranked:', top.map((r) => `${r.day}:D${r.D.toFixed(2)}`).join(' '));
