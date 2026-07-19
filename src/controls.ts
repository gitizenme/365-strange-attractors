import type * as THREE from 'three';

export function stepInertia(v: { x: number; y: number }, dt: number, damping = 4): { x: number; y: number } {
  const f = Math.exp(-damping * dt);
  const out = { x: v.x * f, y: v.y * f };
  return Math.hypot(out.x, out.y) < 0.01 ? { x: 0, y: 0 } : out;
}

export function clampCamera(p: { x: number; y: number; z: number }, bounds: number, zMin: number, zMax: number) {
  return {
    x: Math.min(bounds, Math.max(-bounds, p.x)),
    y: Math.min(bounds, Math.max(-bounds, p.y)),
    z: Math.min(zMax, Math.max(zMin, p.z)),
  };
}

export function zoomToward(cam: { x: number; y: number; z: number }, target: { x: number; y: number }, factor: number) {
  return {
    x: target.x + (cam.x - target.x) * factor,
    y: target.y + (cam.y - target.y) * factor,
    z: cam.z * factor,
  };
}

export function worldPerPixel(camera: THREE.PerspectiveCamera, viewportHeight: number): number {
  const h = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
  return h / viewportHeight;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export class Controls {
  onTap?: (x: number, y: number) => void;
  private vel = { x: 0, y: 0 };
  private dragging = false;
  private moved = 0;
  private last = { x: 0, y: 0 };
  private flying = false;
  private reduced: boolean;
  private ac = new AbortController();

  constructor(private canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera,
              opts: { reducedMotion?: boolean } = {}) {
    this.reduced = opts.reducedMotion ?? false;
    const s = this.ac.signal;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true; this.moved = 0; this.vel = { x: 0, y: 0 };
      this.last = { x: e.clientX, y: e.clientY };
    }, { signal: s });
    canvas.addEventListener('pointermove', e => {
      if (!this.dragging || this.flying) return;
      const wpp = worldPerPixel(this.camera, canvas.clientHeight);
      const dx = (e.clientX - this.last.x), dy = (e.clientY - this.last.y);
      this.moved += Math.hypot(dx, dy);
      this.camera.position.x -= dx * wpp;
      this.camera.position.y += dy * wpp;
      this.vel = { x: -dx * wpp * 60, y: dy * wpp * 60 };
      this.last = { x: e.clientX, y: e.clientY };
      this.clamp();
    }, { signal: s });
    canvas.addEventListener('pointerup', e => {
      this.dragging = false;
      if (this.moved < 5) { this.vel = { x: 0, y: 0 }; this.onTap?.(e.clientX, e.clientY); }
    }, { signal: s });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.flying) return;
      const factor = Math.exp(e.deltaY * 0.0015);
      const t = this.screenToWorld(e.clientX, e.clientY);
      const p = zoomToward(this.camera.position, t, factor);
      Object.assign(this.camera.position, clampCamera(p, 60, 4, 140));
    }, { signal: s, passive: false });
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const wpp = worldPerPixel(this.camera, this.canvas.clientHeight);
    return {
      x: this.camera.position.x + (sx - this.canvas.clientWidth / 2) * wpp,
      y: this.camera.position.y - (sy - this.canvas.clientHeight / 2) * wpp,
    };
  }

  private clamp() { Object.assign(this.camera.position, clampCamera(this.camera.position, 60, 4, 140)); }

  update(dt: number): void {
    if (this.dragging || this.flying || this.reduced) return;
    if (this.vel.x || this.vel.y) {
      this.camera.position.x += this.vel.x * dt;
      this.camera.position.y += this.vel.y * dt;
      this.vel = stepInertia(this.vel, dt);
      this.clamp();
    }
  }

  flyTo(x: number, y: number, z: number, durationSec: number): Promise<void> {
    if (this.reduced) durationSec = 0;
    this.flying = true;
    const from = { ...this.camera.position };
    const t0 = performance.now();
    return new Promise(resolve => {
      const step = () => {
        const t = durationSec === 0 ? 1 : Math.min(1, (performance.now() - t0) / (durationSec * 1000));
        const k = ease(t);
        this.camera.position.set(from.x + (x - from.x) * k, from.y + (y - from.y) * k, from.z + (z - from.z) * k);
        if (t < 1) requestAnimationFrame(step);
        else { this.flying = false; resolve(); }
      };
      step();
    });
  }

  dispose(): void { this.ac.abort(); }
}
