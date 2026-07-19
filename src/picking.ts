export function nearestSprite(
  world: { x: number; y: number },
  positionOf: (i: number) => { x: number; y: number },
  count: number, maxDist: number,
): number | null {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const p = positionOf(i);
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= maxDist ? best : null;
}
