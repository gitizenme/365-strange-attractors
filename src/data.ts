export interface Artwork {
  day: number; title: string; slug: string;
  palette: string[]; brightness: number; x: number; y: number;
  audio?: string; // per-day sonified composition URL; absent everywhere until audio ships
}
export interface Atlas { tile: number; cols: number; rows: number; index: Record<string, number>; files: { small: string; full: string } }

export interface Attractor {
  day: number; slug: string; system: string; params?: number[]; iterations?: number;
}

export async function loadData(): Promise<{ artworks: Artwork[]; atlas: Atlas }> {
  const [artworks, atlas] = await Promise.all([
    fetch('/data/artworks.json').then(r => r.json()),
    fetch('/data/atlas.json').then(r => r.json()),
  ]);
  return { artworks, atlas };
}

export async function loadAttractors(): Promise<Attractor[]> {
  return fetch('/data/attractors.json').then(r => r.json());
}

export function imageUrl(slug: string, size: 256 | 1024 | 2000, ext: 'avif' | 'webp' | 'jpg'): string {
  return `/images/${size}/${slug}.${ext}`;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function dayToDate(day: number): { month: number; date: number } {
  let d = day;
  for (let m = 0; m < 12; m++) {
    if (d <= MONTH_DAYS[m]) return { month: m + 1, date: d };
    d -= MONTH_DAYS[m];
  }
  throw new Error(`invalid day ${day}`);
}
