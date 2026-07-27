import type * as THREE from 'three';

export function stepInertia(v: { x: number; y: number }, dt: number, damping = 4): { x: number; y: number } {
  const f = Math.exp(-damping * dt);
  const out = { x: v.x * f, y: v.y * f };
  return Math.hypot(out.x, out.y) < 0.01 ? { x: 0, y: 0 } : out;
}

export function clampCamera(p: { x: number; y: number; z: number }, bounds: Bounds, zMin: number, zMax: number) {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, p.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, p.y)),
    z: Math.min(zMax, Math.max(zMin, p.z)),
  };
}

export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

// Centers the camera on `bounds` and picks a distance (z) so the box fills `fill` of whichever
// screen dimension is more constraining -- the same "letterboxed contain" fit as CSS
// object-fit:contain, computed from the camera's own vertical FOV the way worldPerPixel already
// does below. Never clips: the non-limiting dimension ends up with unused space instead.
export function fitCamera(bounds: Bounds, aspect: number, fovDeg: number, fill = 0.85): { x: number; y: number; z: number } {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360);
  const zForHeight = bh / fill / (2 * tanHalfFov);
  const zForWidth = bw / fill / (2 * tanHalfFov * aspect);
  const MIN_FIT_Z = 4; // matches Controls' own zMin -- never fit closer than the visitor can zoom
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: Math.max(zForHeight, zForWidth, MIN_FIT_Z),
  };
}

export function zoomToward(cam: { x: number; y: number; z: number }, target: { x: number; y: number }, factor: number) {
  return {
    x: target.x + (cam.x - target.x) * factor,
    y: target.y + (cam.y - target.y) * factor,
    z: cam.z * factor,
  };
}

// Pinch-to-zoom factor from the change in finger separation, in the same sign convention as
// wheel zoom (factor < 1 zooms IN): spreading the fingers apart (curDist > prevDist) shrinks
// camera z. Returns 1 (no-op) when either distance is absent/zero so the first move of a pinch —
// before a baseline separation exists — never divides by zero or snaps the camera.
export function pinchFactor(prevDist: number, curDist: number): number {
  if (prevDist <= 0 || curDist <= 0) return 1;
  return prevDist / curDist;
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
  // Active pointers, keyed by pointerId — one entry per finger/mouse down. Single entry = pan;
  // two entries = pinch-zoom. Tracked here (not just `last`) because pinch needs BOTH fingers'
  // live positions to measure their separation.
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  // True once a gesture has had >= 2 pointers down, so lifting the last finger after a pinch
  // isn't misread as a tap-select. Reset when all pointers are up.
  private multiTouch = false;
  private flying = false;
  private reduced: boolean;
  private ac = new AbortController();
  private enabled = true;
  private userMoved = false;
  private flightId = 0;
  private cancellableFlight = false;

  constructor(private canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera,
              private bounds: Bounds, opts: { reducedMotion?: boolean } = {}) {
    this.reduced = opts.reducedMotion ?? false;
    const s = this.ac.signal;
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      this.cancelFlight();
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        // Second finger down → this gesture is a pinch, not a pan. Abandon any pan-in-progress
        // and seed the baseline separation the first pinch-move will measure against.
        this.multiTouch = true;
        this.dragging = false;
        this.vel = { x: 0, y: 0 };
        this.pinchDist = this.currentPinchDist();
      } else {
        this.dragging = true; this.moved = 0; this.vel = { x: 0, y: 0 };
        this.last = { x: e.clientX, y: e.clientY };
      }
    }, { signal: s });
    canvas.addEventListener('pointermove', e => {
      if (!this.enabled || this.flying) return;
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size >= 2) {
        // Pinch-zoom toward the midpoint of the two fingers — the same zoomToward+clamp math
        // wheel zoom uses, so touch and trackpad/wheel share one zoom model.
        const dist = this.currentPinchDist();
        const factor = pinchFactor(this.pinchDist, dist);
        if (factor !== 1) {
          this.userMoved = true;
          const mid = this.pinchMidpoint();
          const t = this.screenToWorld(mid.x, mid.y);
          const np = zoomToward(this.camera.position, t, factor);
          Object.assign(this.camera.position, clampCamera(np, this.bounds, 4, this.fitZ() * 1.1));
        }
        this.pinchDist = dist;
        return;
      }
      if (!this.dragging) return;
      this.userMoved = true;
      const wpp = worldPerPixel(this.camera, canvas.clientHeight);
      const dx = (e.clientX - this.last.x), dy = (e.clientY - this.last.y);
      this.moved += Math.hypot(dx, dy);
      this.camera.position.x -= dx * wpp;
      this.camera.position.y += dy * wpp;
      this.vel = { x: -dx * wpp * 60, y: dy * wpp * 60 };
      this.last = { x: e.clientX, y: e.clientY };
      this.clamp();
    }, { signal: s });
    const endPointer = (e: PointerEvent) => {
      if (!this.enabled) return;
      const had = this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) {
        // Pinch dropped to one finger: hand control back to pan from the finger that remains,
        // with no positional jump and no spurious tap when it eventually lifts.
        const rem = this.pointers.values().next().value!;
        this.last = { x: rem.x, y: rem.y };
        this.dragging = true; this.moved = 5; this.vel = { x: 0, y: 0 };
        return;
      }
      if (this.pointers.size === 0) {
        this.dragging = false;
        if (had && !this.multiTouch && this.moved < 5) { this.vel = { x: 0, y: 0 }; this.onTap?.(e.clientX, e.clientY); }
        this.multiTouch = false;
      }
    };
    canvas.addEventListener('pointerup', endPointer, { signal: s });
    canvas.addEventListener('pointercancel', endPointer, { signal: s });
    // iOS Safari fires these WebKit-only gesture events for its visual-viewport (whole-window)
    // pinch-zoom. touch-action:none on #gl stops the standard path, but preventing these too is
    // the belt-and-suspenders that keeps a two-finger pinch zooming the constellation (handled via
    // the pointer events above) instead of the Safari window. They carry no zoom info we use — the
    // pointer handlers already do the zoom — so we only cancel their default.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      canvas.addEventListener(type, (e: Event) => { if (this.enabled) e.preventDefault(); }, { signal: s, passive: false });
    }
    canvas.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      this.cancelFlight();
      if (this.flying) return;
      this.userMoved = true;
      const factor = Math.exp(e.deltaY * 0.0015);
      const t = this.screenToWorld(e.clientX, e.clientY);
      const p = zoomToward(this.camera.position, t, factor);
      Object.assign(this.camera.position, clampCamera(p, this.bounds, 4, this.fitZ() * 1.1));
    }, { signal: s, passive: false });
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  hasUserMoved(): boolean { return this.userMoved; }

  private currentPinchDist(): number {
    const it = this.pointers.values();
    const a = it.next().value, b = it.next().value;
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchMidpoint(): { x: number; y: number } {
    const it = this.pointers.values();
    const a = it.next().value!, b = it.next().value!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private fitZ(): number {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    return fitCamera(this.bounds, aspect, this.camera.fov, 0.85).z;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const wpp = worldPerPixel(this.camera, this.canvas.clientHeight);
    return {
      x: this.camera.position.x + (sx - this.canvas.clientWidth / 2) * wpp,
      y: this.camera.position.y - (sy - this.canvas.clientHeight / 2) * wpp,
    };
  }

  private clamp() { Object.assign(this.camera.position, clampCamera(this.camera.position, this.bounds, 4, this.fitZ() * 1.1)); }

  update(dt: number): void {
    if (this.dragging || this.flying || this.reduced) return;
    if (this.vel.x || this.vel.y) {
      this.camera.position.x += this.vel.x * dt;
      this.camera.position.y += this.vel.y * dt;
      this.vel = stepInertia(this.vel, dt);
      this.clamp();
    }
  }

  // `cancellable` flights (the home-arrival settle) end instantly on any pan/zoom — the visitor
  // always wins. Non-cancellable flights (day-open, minimap jumps) behave exactly as before:
  // the router awaits them and input stays deferred until they land.
  // Resolves `true` only when the flight actually LANDED on its target; `false` when it was
  // cancelled or superseded — callers gating follow-up UI (the arrival caption) on the outcome
  // must not treat a mere resolution as arrival.
  flyTo(x: number, y: number, z: number, durationSec: number, opts: { cancellable?: boolean } = {}): Promise<boolean> {
    if (this.reduced) durationSec = 0;
    this.flying = true;
    this.cancellableFlight = opts.cancellable ?? false;
    const id = ++this.flightId;
    const from = { ...this.camera.position };
    const t0 = performance.now();
    return new Promise(resolve => {
      const step = () => {
        if (this.flightId !== id) { resolve(false); return; } // cancelled (or superseded) mid-flight
        const t = durationSec === 0 ? 1 : Math.min(1, (performance.now() - t0) / (durationSec * 1000));
        if (t < 1) {
          const k = ease(t);
          this.camera.position.set(from.x + (x - from.x) * k, from.y + (y - from.y) * k, from.z + (z - from.z) * k);
          requestAnimationFrame(step);
        } else {
          // Land EXACTLY on the target, never on the lerp's final sample: `from + (to - from) * 1`
          // re-derives the target THROUGH `from`, so a non-finite starting position (e.g. a camera
          // poisoned by a pre-layout NaN aspect) would otherwise survive the whole flight.
          this.camera.position.set(x, y, z);
          this.flying = false; this.cancellableFlight = false; resolve(true);
        }
      };
      step();
    });
  }

  cancelFlight(): void {
    if (this.flying && this.cancellableFlight) {
      this.flying = false;
      this.cancellableFlight = false;
      this.flightId++;
    }
  }

  dispose(): void { this.ac.abort(); }
}
