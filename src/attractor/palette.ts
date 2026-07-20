import * as THREE from 'three';

// Each artwork's `palette` is 5 dominant colors sorted by pixel-count (see pipeline/analyze.py),
// so palette[0] is almost always the near-black background, not a usable point-cloud tint.
// Pick the most saturated non-background swatch instead, then clamp its lightness into a range
// that stays visible against the black canvas under additive blending (too dark disappears, too
// light washes out toward plain white) while keeping the artwork's actual hue/saturation.
export function pickTintColor(palette: string[]): THREE.Color {
  const candidates = palette.map(hex => {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    return hsl;
  });
  const vivid = candidates.filter(c => c.l > 0.08 && c.l < 0.95);
  const pool = vivid.length > 0 ? vivid : candidates;
  const best = pool.reduce((a, b) => (b.s > a.s ? b : a));
  const l = Math.min(0.7, Math.max(0.45, best.l));
  return new THREE.Color().setHSL(best.h, Math.max(best.s, 0.35), l);
}
