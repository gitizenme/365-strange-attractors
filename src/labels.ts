import type * as THREE from 'three';
import type { Artwork } from './data';
import { worldPerPixel } from './controls';

export class Labels {
  private els: HTMLDivElement[] = [];
  constructor(private overlay: HTMLElement, private artworks: Artwork[]) {
    for (let i = 0; i < 12; i++) {
      const el = document.createElement('div');
      el.className = 'sprite-label';
      el.style.display = 'none';
      overlay.appendChild(el);
      this.els.push(el);
    }
  }

  update(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement,
         positionOf: (i: number) => { x: number; y: number }, zThreshold = 40): void {
    if (camera.position.z >= zThreshold) { this.els.forEach(e => (e.style.display = 'none')); return; }
    const wpp = worldPerPixel(camera, canvas.clientHeight);
    const ranked = this.artworks
      .map((a, i) => { const p = positionOf(i); return { a, p, d: Math.hypot(p.x - camera.position.x, p.y - camera.position.y) }; })
      .sort((q, r) => q.d - r.d).slice(0, 12);
    this.els.forEach((el, j) => {
      const item = ranked[j];
      if (!item) { el.style.display = 'none'; return; }
      const sx = canvas.clientWidth / 2 + (item.p.x - camera.position.x) / wpp;
      const sy = canvas.clientHeight / 2 - (item.p.y - camera.position.y) / wpp;
      el.textContent = `${String(item.a.day).padStart(3, '0')} · ${item.a.title}`;
      el.style.display = 'block';
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy + 14 / wpp * wpp + 18)}px) translateX(-50%)`;
    });
  }
}
