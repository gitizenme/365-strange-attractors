#!/usr/bin/env node
// Batch render + contact sheet for Phase 0 spike review.
// Reuses incendia_render.mjs's parse/chaos-game/raster/dimension/isoperimetric logic,
// renders every candidate day once, applies the tightened plausibility gate, and composes
// a labeled grid so a human can eyeball a whole batch at once instead of one file at a time.
//
// Usage: node scripts/spike/contact_sheet.mjs <ARCHIVE> [count=30] [cols=6]

import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { parsePar, chaosGame, raster, boxDim, isoperimetricRatio, gridToBuf } from './incendia_render.mjs';

const ARCHIVE = process.argv[2];
const COUNT = Number(process.argv[3] || 30);
const COLS = Number(process.argv[4] || 6);
const OUT = join(process.cwd(), 'scripts', 'spike', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// same band as incendia_render.mjs's sweep gate — see that file for calibration notes.
const isPlausible = (D, coverage, iso) => D >= 1.3 && coverage >= 0.003 && iso >= 300 && iso <= 12000;

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

// Must match incendia_render.mjs's default raster S (256) — iso is resolution-sensitive
// (coarser grids merge isolated speckle pixels together, artificially lowering it), so
// scoring at a different resolution than the sweep silently disagrees with its gate.
const TILE = 256;
const files = dayFiles(ARCHIVE);
const results = [];
console.log(`scanning ${files.length} days...`);
for (const { day, path, name } of files) {
  let p; try { p = parsePar(path); } catch { continue; }
  if (!p.clean || p.transforms.length < 2) continue; // single-transform is a fixed point, not interesting to preview
  // Must match incendia_render.mjs's sweep iteration count (400k) — iso keeps DECREASING
  // toward the smooth-blob floor as iterations grow (more points fill in internal gaps), so
  // an under-converged run scores solid blobs falsely inside the good band. Confirmed 2026-07-25:
  // day 203 scored iso=693.9 at 250k iters (inside the good band) vs iso=42.2 at 400k (correctly low).
  const { pts, n, reseeds } = chaosGame(p.transforms, { iters: 400_000 });
  if (n < 1000) continue;
  const planes = [[0, 1], [0, 2], [1, 2]];
  let best = null;
  for (const [A, B] of planes) {
    const { grid, S, coverage } = raster(pts, n, A, B, TILE);
    const D = boxDim(grid, S);
    const iso = isoperimetricRatio(grid, S);
    if (!best || coverage > best.coverage) best = { grid, S, coverage, D, iso, plane: `${A}${B}` };
  }
  if (!isPlausible(best.D, best.coverage, best.iso)) continue;
  results.push({ day, name, tf: p.count, gen: p.gen, D: best.D, iso: best.iso, coverage: best.coverage, buf: gridToBuf(best.grid, best.S), reseeds });
}
console.log(`plausible candidates (tightened gate): ${results.length}`);
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
  const label = `${r.day} ${r.name.slice(0, 14)} D${r.D.toFixed(1)} i${Math.round(r.iso)}`;
  const svg = `<svg width="${cellW}" height="${LABEL_H}"><rect width="100%" height="100%" fill="black"/><text x="4" y="15" font-family="monospace" font-size="10" fill="white">${label}</text></svg>`;
  composites.push({ input: Buffer.from(svg), left: col * cellW, top: row * cellH + TILE });
}

const base = sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: { r: 0, g: 0, b: 0 } } });
const outPath = join(OUT, `contact_sheet_tightened_top${top.length}.png`);
await base.composite(composites).png().toFile(outPath);
console.log(`wrote ${outPath} (${cols}x${rows} grid, ${top.length} tiles)`);
console.log('ranked:', top.map((r) => `${r.day}:D${r.D.toFixed(2)}`).join(' '));
