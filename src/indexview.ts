import type { Artwork } from './data';
import { dayToDate, imageUrl } from './data';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function searchArtworks(artworks: Artwork[], query: string): Artwork[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: Artwork[] = [];
  if (/^\d{1,3}$/.test(q)) {
    const n = parseInt(q, 10);
    const hit = artworks.find(a => a.day === n);
    if (hit) results.push(hit);
  }
  for (const a of artworks) {
    if (results.length >= 8) break;
    if (!results.includes(a) && a.title.toLowerCase().includes(q)) results.push(a);
  }
  return results.slice(0, 8);
}

export class IndexView {
  private root: HTMLDivElement;
  private results: HTMLDivElement;
  private openState = false;

  constructor(overlay: HTMLElement, private artworks: Artwork[], private onPick: (slug: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'indexview hidden';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'day number or title…';
    input.setAttribute('aria-label', 'Search artworks');
    this.results = document.createElement('div');
    this.results.className = 'index-results';
    this.root.append(input, this.results);
    input.addEventListener('input', () => this.renderResults(searchArtworks(this.artworks, input.value)));

    const byDay = new Map(artworks.map(a => [a.day, a]));
    for (let m = 0; m < 12; m++) {
      const h = document.createElement('h2');
      h.textContent = MONTHS[m];
      const grid = document.createElement('div');
      grid.className = 'month-grid';
      this.root.append(h, grid);
      for (const a of artworks) {
        if (dayToDate(a.day).month !== m + 1) continue;
        grid.appendChild(this.cell(a));
      }
      void byDay;
    }
    overlay.appendChild(this.root);
  }

  private cell(a: Artwork): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'day-cell';
    btn.title = `${String(a.day).padStart(3, '0')} · ${a.title}`;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = imageUrl(a.slug, 256, 'jpg');
    img.alt = a.title;
    const num = document.createElement('span');
    num.textContent = String(dayToDate(a.day).date);
    btn.append(img, num);
    btn.addEventListener('click', () => this.onPick(a.slug));
    return btn;
  }

  private renderResults(items: Artwork[]): void {
    this.results.innerHTML = '';
    for (const a of items) {
      const b = document.createElement('button');
      b.textContent = `${String(a.day).padStart(3, '0')} · ${a.title}`;
      b.addEventListener('click', () => this.onPick(a.slug));
      this.results.appendChild(b);
    }
  }

  open(): void { this.openState = true; this.root.classList.remove('hidden'); }
  close(): void { this.openState = false; this.root.classList.add('hidden'); }
  isOpen(): boolean { return this.openState; }
}
