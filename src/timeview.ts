export function spiralPosition(day: number): { x: number; y: number } {
  const t = (day - 1) / 364;
  const angle = ((day - 1) / 365) * 3 * 2 * Math.PI;
  // Base radius is deliberately well above zero (not a pinpoint centre): the inner turns of a
  // date spiral are where consecutive days crowd, because a small radius has little circumference
  // to spread a fixed angular step over. Starting at r=28 (vs a near-centre origin) gives even the
  // earliest days enough arc between them to clear the fixed-size thumbnails; 55 grows it to 83 by
  // day 365. Uniform scaling can't fix inner crowding — only a larger inner radius can.
  const r = 28 + 55 * t;
  return { x: r * Math.sin(angle), y: r * Math.cos(angle) };
}
