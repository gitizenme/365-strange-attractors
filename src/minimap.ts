import type * as THREE from 'three';
import type { Artwork } from './data';
import { worldPerPixel } from './controls';
import { pickTintColor } from './attractor/palette';

const SIZE = 140, WORLD = 60; // world units mapped edge-to-edge

export class Minimap {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dotColors: string[];

  constructor(overlay: HTMLElement, private artworks: Artwork[], onJump: (x: number, y: number) => void) {
    this.cv = document.createElement('canvas');
    this.cv.id = 'minimap';
    this.cv.width = this.cv.height = SIZE * 2;
    overlay.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!;
    // Precomputed once, not in update() (which runs every animation frame): palette[0] is each
    // artwork's near-black background swatch (see pickTintColor's own header comment in
    // attractor/palette.ts), not a usable dot color -- pickTintColor already solves exactly this
    // problem for the live-attractor tint and is reused here for the same reason.
    this.dotColors = artworks.map(a => '#' + pickTintColor(a.palette).getHexString());
    this.cv.addEventListener('click', e => {
      const r = this.cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / SIZE - 0.5) * 2 * WORLD;
      const y = -((e.clientY - r.top) / SIZE - 0.5) * 2 * WORLD;
      onJump(x, y);
    });
  }

  update(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement,
         positionOf: (i: number) => { x: number; y: number }): void {
    const c = this.ctx, S = SIZE * 2;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(10,12,18,0.85)';
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,255,255,0.15)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, S - 1, S - 1);
    const px = (wx: number) => (wx / WORLD / 2 + 0.5) * S;
    const py = (wy: number) => (-wy / WORLD / 2 + 0.5) * S;
    this.artworks.forEach((_, i) => {
      const p = positionOf(i);
      c.fillStyle = this.dotColors[i];
      c.fillRect(px(p.x) - 1.5, py(p.y) - 1.5, 3, 3);
    });
    const wpp = worldPerPixel(camera, canvas.clientHeight);
    const vw = canvas.clientWidth * wpp, vh = canvas.clientHeight * wpp;
    c.strokeStyle = '#cfd3dc';
    c.lineWidth = 2;
    c.strokeRect(px(camera.position.x - vw / 2), py(camera.position.y + vh / 2),
                 (vw / WORLD / 2) * S, (vh / WORLD / 2) * S);
  }
}
