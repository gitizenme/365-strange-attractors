#!/usr/bin/env node
// Incendia .par decoding probe — Phase 0 spike.
// Hypothesis: after a header, the file contains a run of affine IFS transforms,
// each = 3 lines of 4 floats (3x4 affine) + 1 line of 1 float (weight).
// Invariant lever: the weights of a transform set sum to ~1.0.
// This probe scans for the maximal [4,4,4,1] block run and reports the weight sum,
// so we can validate the parse across the whole corpus without knowing exact offsets.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ARCHIVE = process.argv[2] || join(process.cwd(), '..');
const PROJECT = join(ARCHIVE, 'project');

// tokens per line -> array of numbers, or null if any token is non-numeric
function numLine(line) {
  const t = line.trim();
  if (t === '' || t === '#') return null;
  const parts = t.split(/\s+/);
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums;
}

function parseFile(path) {
  const raw = readFileSync(path, 'latin1').split(/\r?\n/);
  const gen = (raw[0] || '').trim();
  // header line 6 (index 5): "<baseShape> <count>"
  const header6 = numLine(raw[5] || '');
  const declaredCount = header6 && header6.length >= 2 ? header6[1] : null;
  const baseShape = header6 && header6.length >= 1 ? header6[0] : null;

  // Find every maximal run of blocks: 3 lines of len-4 followed by 1 line of len-1.
  const lens = raw.map((l) => {
    const n = numLine(l);
    return n ? n.length : -1;
  });

  // ANCHORED parse: header is a fixed 20 lines; transforms start at index 20 (line 21).
  // Read exactly declaredCount blocks of [4,4,4,1].
  const START = 20;
  const blocks = [];
  const weights = [];
  let i = START;
  const want = declaredCount || 0;
  let clean = true;
  for (let b = 0; b < want; b++) {
    if (lens[i] === 4 && lens[i + 1] === 4 && lens[i + 2] === 4 && lens[i + 3] === 1) {
      blocks.push({ rows: [numLine(raw[i]), numLine(raw[i + 1]), numLine(raw[i + 2])], w: numLine(raw[i + 3])[0] });
      weights.push(numLine(raw[i + 3])[0]);
      i += 4;
    } else { clean = false; break; }
  }
  const best = { start: START, count: blocks.length, weights, sum: weights.reduce((a, b) => a + b, 0), blocks, clean };
  return { path, gen, baseShape, declaredCount, best };
}

// pick day-numbered file per project/NNN dir (mirrors pickAttractorFile: NNN_ wins over XXX_)
function dayFiles() {
  const out = [];
  for (const dir of readdirSync(PROJECT).sort()) {
    const full = join(PROJECT, dir);
    if (!statSync(full).isDirectory()) continue;
    const pars = readdirSync(full).filter((f) => f.toLowerCase().endsWith('.par'));
    if (!pars.length) continue;
    // prefer file starting with the day number
    const numbered = pars.find((f) => /^\d/.test(f)) || pars[0];
    out.push({ day: dir, path: join(full, numbered) });
  }
  return out;
}

const files = dayFiles();
const byGen = {};
let matchSum = 0, matchCount = 0, countMatchesDeclared = 0;
const anomalies = [];

for (const { day, path } of files) {
  let r;
  try { r = parseFile(path); } catch (e) { anomalies.push(`${day}: ERR ${e.message}`); continue; }
  const g = r.gen;
  byGen[g] = byGen[g] || { n: 0, sumOk: 0, countOk: 0, counts: {} };
  byGen[g].n++;
  const sumOk = r.best && Math.abs(r.best.sum - 1) < 0.02;
  if (sumOk) { byGen[g].sumOk++; matchSum++; }
  const cnt = r.best ? r.best.count : 0;
  byGen[g].counts[cnt] = (byGen[g].counts[cnt] || 0) + 1;
  if (r.best && r.best.clean && r.declaredCount === r.best.count) { byGen[g].countOk++; countMatchesDeclared++; }
  matchCount++;
  if (!sumOk) anomalies.push(`${day} gen[${g}] declared=${r.declaredCount} found=${cnt} clean=${r.best.clean} sum=${r.best ? r.best.sum.toFixed(4) : 'none'}`);
}

console.log(`\nCorpus: ${files.length} day-files\n`);
for (const g of Object.keys(byGen).sort()) {
  const b = byGen[g];
  console.log(`gen "${g}": n=${b.n}  weightSum≈1: ${b.sumOk}/${b.n}  declaredCount==foundBlocks: ${b.countOk}/${b.n}`);
  console.log(`   found-block-count histogram: ${JSON.stringify(b.counts)}`);
}
console.log(`\nTOTAL weightSum≈1: ${matchSum}/${matchCount}   declaredCount match: ${countMatchesDeclared}/${matchCount}`);
console.log(`\nAnomalies (${anomalies.length}):`);
console.log(anomalies.slice(0, 40).join('\n'));
