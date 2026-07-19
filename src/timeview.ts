export function spiralPosition(day: number): { x: number; y: number } {
  const t = (day - 1) / 364;
  const angle = ((day - 1) / 365) * 3 * 2 * Math.PI;
  const r = 8 + 42 * t;
  return { x: r * Math.sin(angle), y: r * Math.cos(angle) };
}
