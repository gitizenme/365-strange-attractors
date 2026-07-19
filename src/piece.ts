import * as THREE from 'three';
import type { Artwork } from './data';
import { imageUrl, dayToDate } from './data';
import { getFamily } from './attractor/families';
import { LiveAttractor } from './attractor/gpgpu';
import { pickTier } from './attractor/tiers';
import { initialOrbitState, applyOrbitDrag, applyOrbitZoom, orbitCameraPosition, type OrbitState } from './attractor/orbit';
import type { Attractor } from './data';
import type { Controls } from './controls';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Known mathematically degenerate for their one real-world parameter set (see Phase 2
// Task 7 report): polynomial_a (day 72) has no real fixed point and diverges to infinity
// for every starting value; polynomial_b (day 41) collapses to a single attracting fixed
// point within ~150 iterations. Neither throws during construction (the GPU NaN-guard
// resets in-shader rather than raising), so skip live construction explicitly rather than
// showing a broken "Hide Image" toggle for a flickering-noise or invisible cloud.
const KNOWN_DEGENERATE_DAYS = new Set([72, 41]);

export function neighborDay(day: number, dir: 1 | -1): number {
  return ((day - 1 + dir + 365) % 365) + 1;
}

export function captionFor(a: { day: number; title: string }): string {
  const { month, date } = dayToDate(a.day);
  return `${String(a.day).padStart(3, '0')}/365 · ${a.title} · ${MONTHS[month - 1]} ${date}, 2010`;
}

// Deliberately conservative: per the spec's adjacency finding, only 6 day-pairs in the whole
// archive are same-family adjacent (share a `system` and neither is 'static-only'), so those
// are the only ones worth the parameter-interpolation morph; everything else — different
// family, either side static-only or unknown — falls back to the plain dissolve (open()'s
// existing dispose/reconstruct cycle).
export function transitionKind(
  current: { day: number; system: string } | null,
  next: { day: number; system: string } | null,
): 'morph' | 'dissolve' {
  if (!current || !next) return 'dissolve';
  if (current.system === 'static-only' || next.system === 'static-only') return 'dissolve';
  return current.system === next.system ? 'morph' : 'dissolve';
}

// Lorenz-84's natural coordinate range varies a lot from day to day (empirically, half-extents
// across this dataset's lorenz_84 days range from ~3 to ~20 world units depending on a/b/F/G),
// unlike classic Lorenz where a single flat display scale works because rho is the only param
// that materially changes across days and its fixed-point spacing has a simple closed form
// (rho - 1). There's no equivalent closed form for Lorenz-84, and empirical testing in-browser
// confirmed a single flat constant either shrinks the small days to near-invisible dots or
// leaves the large days (e.g. 006-goblet-of-light, half-extent ~14) entirely outside the orbit
// camera's frustum, even at max zoom-out (radius 30). Instead, cheaply simulate the same
// equations as lorenz84.ts's glslStep on the CPU (a few thousand float ops, sub-millisecond)
// once per open() to estimate this specific day's bounding extent, then derive a scale/centerZ
// from that so the cloud lands inside the default framing regardless of parameters.
function estimateLorenz84Display(params: number[]): { scale: number; centerZ: number } {
  const [a, b, F, G, dt] = params;
  let x = 0.1, y = 0.1, z = 0.1;
  const SETTLE = 2000;
  const SAMPLE = 2000;
  const step = () => {
    const dx = -y * y - z * z - a * x + a * F;
    const dy = x * y - b * x * z - y + G;
    const dz = b * x * y + x * z - z;
    x += dx * dt; y += dy * dt; z += dz * dt;
  };
  for (let i = 0; i < SETTLE; i++) step();
  let maxAbs = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < SAMPLE; i++) {
    step();
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y), Math.abs(z));
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const TARGET_HALF_EXTENT = 4; // fits comfortably inside the orbit camera's default frustum (radius 10, 50deg fov => visible half-height ~4.66)
  const scale = maxAbs > 0.001 ? TARGET_HALF_EXTENT / maxAbs : 1;
  const centerZ = isFinite(minZ) && isFinite(maxZ) ? (minZ + maxZ) / 2 : 0;
  return { scale, centerZ };
}

// chaotic_flow's natural extent varies even more than lorenz_84's across this dataset's 17 days
// (empirically, CPU pre-simulation of all 17 gives half-extents from ~1 to ~40+ world units —
// see Task 11 report) because the family's per-day parameters don't just scale a fixed equation
// shape, they change which variable each of the 9 matrix terms multiplies (see chaoticFlow.ts's
// header comment for the Op-selector mechanism), so there's no closed-form relationship between
// the raw parameters and the resulting attractor's size. Reuse the same CPU pre-simulation
// strategy as estimateLorenz84Display: mirror chaoticFlow.ts's glslStep exactly on the CPU and
// measure the actual settled bounding extent for this specific day's params.
function estimateChaoticFlowDisplay(params: number[]): { scale: number; centerZ: number } {
  const c = params;
  const dT = c[21];
  const opVar = (idx: number, x: number, y: number, z: number) => {
    const i = Math.round(idx);
    if (i <= 0) return 1;
    if (i === 1) return x;
    if (i === 2) return y;
    return z;
  };
  let x = 0.1, y = 0.1, z = 0.1;
  const SETTLE = 2000;
  const SAMPLE = 2000;
  const step = () => {
    const dx = c[0] * opVar(c[1], x, y, z) * x + c[2] * opVar(c[3], x, y, z) * y + c[4] * opVar(c[5], x, y, z) * z + c[6];
    const dy = c[7] * opVar(c[8], x, y, z) * x + c[9] * opVar(c[10], x, y, z) * y + c[11] * opVar(c[12], x, y, z) * z + c[13];
    const dz = c[14] * opVar(c[15], x, y, z) * x + c[16] * opVar(c[17], x, y, z) * y + c[18] * opVar(c[19], x, y, z) * z + c[20];
    x += dx * dT; y += dy * dT; z += dz * dT;
  };
  for (let i = 0; i < SETTLE; i++) step();
  let maxAbs = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < SAMPLE; i++) {
    step();
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y), Math.abs(z));
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const TARGET_HALF_EXTENT = 4; // matches estimateLorenz84Display's target, same orbit camera frustum
  const scale = maxAbs > 0.001 ? TARGET_HALF_EXTENT / maxAbs : 1;
  const centerZ = isFinite(minZ) && isFinite(maxZ) ? (minZ + maxZ) / 2 : 0;
  return { scale, centerZ };
}

export interface LiveDeps {
  attractors: Attractor[];
  renderer: THREE.WebGLRenderer;
  liveScene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  controls: Controls;
  hideImageBtn: HTMLButtonElement;
}

export class PieceView {
  private root: HTMLDivElement;
  private img: HTMLImageElement;
  private sources: { avif: HTMLSourceElement; webp: HTMLSourceElement };
  private caption: HTMLElement;
  private current: Artwork | null = null;
  private bySlug: Map<string, Artwork>;
  private byDay: Map<number, Artwork>;

  private live_!: LiveDeps;
  private attractorsByDay = new Map<number, Attractor>();
  private tier: 256 | 1024 | 2048 | null = null;
  private liveAttractor: LiveAttractor | null = null;
  private orbit: OrbitState | null = null;
  private orbitDragging = false;
  private orbitLast = { x: 0, y: 0 };
  private disturbHeld = false;
  private disturbAmount = 0;

  constructor(private overlay: HTMLElement, artworks: Artwork[],
              private onNavigate: (slug: string) => void, private onClose: () => void, live: LiveDeps) {
    this.bySlug = new Map(artworks.map(a => [a.slug, a]));
    this.byDay = new Map(artworks.map(a => [a.day, a]));
    this.root = document.createElement('div');
    this.root.className = 'piece hidden';
    this.root.innerHTML = `
      <button class="piece-nav prev" aria-label="Previous day">‹</button>
      <figure>
        <picture>
          <source type="image/avif" /><source type="image/webp" />
          <img alt="" />
        </picture>
        <figcaption></figcaption>
      </figure>
      <button class="piece-nav next" aria-label="Next day">›</button>
      <button class="piece-close" aria-label="Close">×</button>`;
    overlay.appendChild(this.root);
    const [avif, webp] = this.root.querySelectorAll('source');
    this.sources = { avif, webp };
    this.img = this.root.querySelector('img')!;
    this.caption = this.root.querySelector('figcaption')!;
    this.root.querySelector('.prev')!.addEventListener('click', () => this.nav(-1));
    this.root.querySelector('.next')!.addEventListener('click', () => this.nav(1));
    this.root.querySelector('.piece-close')!.addEventListener('click', () => this.requestClose());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.requestClose(); });
    addEventListener('keydown', e => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.requestClose();
      if (e.key === 'ArrowLeft') this.nav(-1);
      if (e.key === 'ArrowRight') this.nav(1);
    });
    this.live_ = live;
    this.attractorsByDay = new Map(live.attractors.map(a => [a.day, a]));
    this.tier = pickTier({ webgl2: live.renderer.capabilities.isWebGL2, isMobile: /Mobi|Android/i.test(navigator.userAgent) });
    this.bindOrbitEvents();
  }

  private bindOrbitEvents(): void {
    const canvas = this.live_.canvas;
    canvas.addEventListener('pointerdown', e => {
      if (!this.liveAttractor) return;
      if ((e.target as HTMLElement).closest('button')) return;
      this.orbitDragging = true;
      this.orbitLast = { x: e.clientX, y: e.clientY };
      // The disturb-hold gesture (Task 8) shares this same pointerdown: a press-and-hold that
      // later moves should keep orbiting AND keep disturbing at once, so both flags are set from
      // the same event rather than wiring a separate listener. Note this listener lives on the
      // canvas, not the piece root: while a live attractor is showing, the root's CSS switches to
      // pointer-events:none (see the `.piece.live-active` rule in style.css) specifically so
      // drag/press input passes through to this canvas — a listener on the root itself would only
      // ever see clicks on the nav/close buttons, never a press in the middle of the cloud.
      this.disturbHeld = true;
    });
    addEventListener('pointermove', e => {
      if (!this.liveAttractor || !this.orbitDragging || !this.orbit) return;
      const dx = e.clientX - this.orbitLast.x;
      const dy = e.clientY - this.orbitLast.y;
      this.orbit = applyOrbitDrag(this.orbit, dx, dy);
      this.orbitLast = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointerup', () => { this.orbitDragging = false; this.disturbHeld = false; });
    canvas.addEventListener('wheel', e => {
      if (!this.liveAttractor || !this.orbit) return;
      e.preventDefault();
      this.orbit = applyOrbitZoom(this.orbit, e.deltaY);
    }, { passive: false });
  }

  private nav(dir: 1 | -1): void {
    if (!this.current) return;
    const next = this.byDay.get(neighborDay(this.current.day, dir))!;
    const curAttr = this.attractorsByDay.get(this.current.day);
    const nextAttr = this.attractorsByDay.get(next.day);
    const kind = transitionKind(
      curAttr ? { day: curAttr.day, system: curAttr.system } : null,
      nextAttr ? { day: nextAttr.day, system: nextAttr.system } : null,
    );
    if (kind === 'morph' && this.liveAttractor && nextAttr?.params) {
      // Capture the live instance we're morphing so a stale rAF tick can never touch a
      // *different* (disposed-and-replaced) instance — see the guard inside step() below.
      const morphing = this.liveAttractor;
      morphing.setMorphTarget(nextAttr.params, 0);
      const start = performance.now();
      const step = () => {
        // open()/close() may have already disposed this exact instance and swapped in a new
        // one (or none) for the next day before this tween finished — e.g. a rapid double-tap
        // of the nav arrow. Bail rather than mutate a disposed GPUComputationRenderer.
        if (this.liveAttractor !== morphing) return;
        const t = Math.min(1, (performance.now() - start) / 800);
        morphing.setMorphTarget(nextAttr.params!, t);
        if (t < 1) requestAnimationFrame(step);
        else { morphing.setParams(nextAttr.params!); morphing.setMorphTarget(null, 0); }
      };
      requestAnimationFrame(step);
    }
    // main.ts's router awaits controls.flyTo(...) (tweening the shared camera's position over
    // ~0.9s) BEFORE calling piece.open(next.slug) — open() isn't called synchronously here, so
    // `this.current`/`this.liveAttractor`/`this.orbit` all still describe the *outgoing* piece
    // for the whole flight. render() repositions the shared camera from `this.orbit` every
    // frame via its own lookAt() (Task 4/8), which — left as-is — fights flyTo's own per-frame
    // position tween for control of the same camera for that entire ~0.9s (Task 4's disclosed
    // risk: two independent rAF loops writing camera.position/quaternion the same frame,
    // ordering-dependent jitter). Clear `orbit` so render()'s `if (this.liveAttractor &&
    // this.orbit)` guard skips the camera write for the remainder of the flight, leaving flyTo
    // as the sole owner of the camera; the outgoing point cloud (and, for 'morph', its running
    // tween) keeps simulating/rendering in place, uncoupled from the camera, which reads as the
    // dissolve/morph "left behind" as the view moves on. open() sets a fresh `orbit` for the
    // next piece once flyTo resolves, healing this back to normal.
    this.orbit = null;
    this.onNavigate(next.slug);
  }

  private requestClose(): void { this.close(); this.onClose(); }

  open(slug: string): void {
    const a = this.bySlug.get(slug);
    if (!a) return;
    this.current = a;
    const srcset = (ext: 'avif' | 'webp' | 'jpg') =>
      `${imageUrl(a.slug, 1024, ext)} 1024w, ${imageUrl(a.slug, 2000, ext)} 2000w`;
    this.sources.avif.srcset = srcset('avif');
    this.sources.webp.srcset = srcset('webp');
    this.img.srcset = srcset('jpg');
    this.img.src = imageUrl(a.slug, 1024, 'jpg');
    this.img.alt = `${a.title} — strange attractor, day ${a.day} of 365, 2010`;
    this.caption.textContent = captionFor(a);
    this.root.classList.remove('hidden');
    // preload neighbors
    for (const dir of [1, -1] as const) {
      const n = this.byDay.get(neighborDay(a.day, dir))!;
      new Image().src = imageUrl(n.slug, 1024, 'jpg');
    }

    this.liveAttractor?.dispose();
    this.liveAttractor = null;
    const attractor = this.attractorsByDay.get(a.day);
    const family = attractor && attractor.system !== 'static-only' ? getFamily(attractor.system) : null;
    if (family && attractor?.params && this.tier && !KNOWN_DEGENERATE_DAYS.has(a.day)) {
      try {
        this.liveAttractor = new LiveAttractor(this.live_.renderer, family, attractor.params, this.tier);
        // LiveAttractor's own settling burst (Task 3, fixed at 150 steps) integrates only
        // 150 * dt simulated time units. That's plenty for this dataset's typical dt (~0.03-0.2)
        // but nowhere near enough for the smallest dt found here (e.g. 0.001, the classic-constants
        // reference day): 150 steps only reaches the vicinity of one fixed point, and the two lobes
        // don't visibly separate until ~20 simulated time units of chaotic mixing. Pre-warm further
        // for ODE families so the cloud starts fully formed instead of a barely-moved dot (measured
        // ~0.02ms/iteration, so even the capped worst case here is a sub-second one-time pause).
        if (!family.isDiscreteMap) {
          const dt = attractor.params[attractor.params.length - 1];
          if (dt > 0) {
            const extraSteps = Math.min(20000, Math.ceil(20 / dt));
            for (let i = 0; i < extraSteps; i++) this.liveAttractor.compute();
          }
        }
        // The raw point cloud is generated in its own local attractor-space coordinates and needs
        // translating into this artwork's constellation position so it lines up with where the
        // camera flew to/orbits (x, y). For Lorenz specifically, the two chaotic lobes straddle
        // fixed points at local z ~= rho - 1 (not local z ~= 0) — e.g. rho=28 centers near z=27 —
        // so translating only by (a.x, a.y, 0) leaves the cloud sitting behind the orbit camera
        // (which parks in front of z = 8, see below) and it never becomes visible. Recenter in z
        // so the cloud's natural cluster lines up with the orbit target instead. Lorenz's natural
        // coordinate scale (fixed points ~8.5 units apart, full chaotic spread tens of units) is
        // also much larger than orbit.ts's fixed default view radius (10, clamped to [3, 30]), so
        // scale the cloud down to fit comfortably within that default framing.
        const LORENZ_DISPLAY_SCALE = 0.2;
        // Pickover's map (x' = sin(A*y) - z*cos(B*x), y' = z*sin(C*x) - cos(D*y), z' = sin(x)) is
        // built entirely from sin/cos terms, which bound its coordinates to roughly [-1.2, 1.2]
        // regardless of the A/B/C/D params — confirmed empirically by simulating both of this
        // dataset's pickover days (026-x, 070-tornado-eye) for thousands of iterations across many
        // random seeds: both settle to maxAbs ~1.19-1.20. Unlike lorenz_84, whose spread varies
        // ~6x across days with no simple predictive parameter, Pickover's range is consistent day
        // to day, so a flat display scale (like Lorenz's) works fine here too. The natural cluster
        // center also sits close to local z=0 for both days (empirically within ±0.15), so unlike
        // Lorenz, no z-recentering formula is needed — it falls through to the 0 default below.
        const PICKOVER_DISPLAY_SCALE = 3.2;
        // lorenz_84's scale/centerZ can't be a flat constant like Lorenz's — see
        // estimateLorenz84Display's comment above for why — so compute it per-day instead.
        const lorenz84Display = attractor.system === 'lorenz_84' ? estimateLorenz84Display(attractor.params) : null;
        // chaotic_flow needs the same per-day treatment, and for the same reason (see
        // estimateChaoticFlowDisplay's comment) — its spread varies even more across days than
        // lorenz_84's does.
        const chaoticFlowDisplay = attractor.system === 'chaotic_flow' ? estimateChaoticFlowDisplay(attractor.params) : null;
        const centerZ = attractor.system === 'lorenz' && attractor.params.length >= 2 ? attractor.params[1] - 1
          : lorenz84Display ? lorenz84Display.centerZ
          : chaoticFlowDisplay ? chaoticFlowDisplay.centerZ
          : 0;
        const scale = attractor.system === 'lorenz' ? LORENZ_DISPLAY_SCALE
          : attractor.system === 'pickover' ? PICKOVER_DISPLAY_SCALE
          : lorenz84Display ? lorenz84Display.scale
          : chaoticFlowDisplay ? chaoticFlowDisplay.scale
          : 1;
        this.liveAttractor.points.scale.setScalar(scale);
        this.liveAttractor.points.position.set(a.x, a.y, 8 - scale * centerZ);
        this.live_.liveScene.add(this.liveAttractor.points);
        this.orbit = initialOrbitState({ x: a.x, y: a.y, z: 8 }); // a.x/a.y = this piece's constellation position; z matches Phase 1's flyTo z target
        this.live_.controls.setEnabled(false);
      } catch (err) {
        console.error('live attractor init failed, falling back to static', err);
        this.liveAttractor = null;
        this.orbit = null;
      }
    }
    this.live_.hideImageBtn.style.display = this.liveAttractor ? 'block' : 'none';
    // The piece backdrop (Phase 1) is a full-viewport pointer-events:auto element that sits on top
    // of the #gl canvas the whole time the piece is open (it needs to catch clicks on empty space
    // to close, per Phase 1's "click outside figure to close"). That would swallow every drag/wheel
    // event aimed at orbiting the live attractor before it ever reaches bindOrbitEvents' canvas
    // listeners. Toggle a class that makes the backdrop pass events through to the canvas whenever
    // a live attractor is showing, leaving only the actual buttons (nav/close) clickable — see
    // the `.piece.live-active` rules in style.css.
    this.root.classList.toggle('live-active', !!this.liveAttractor);
  }

  close(): void {
    this.liveAttractor?.dispose();
    this.liveAttractor = null;
    this.orbit = null;
    this.disturbHeld = false;
    this.disturbAmount = 0;
    this.live_.controls.setEnabled(true);
    this.live_.hideImageBtn.style.display = 'none';
    this.root.classList.remove('live-active');
    this.root.classList.add('hidden');
    this.current = null;
    // The orbit camera (render()) mutates the shared camera's rotation via lookAt() every frame
    // while a live attractor is open. Controls' flat pan/zoom math (screenToWorld, drag, wheel-zoom)
    // assumes an axis-aligned camera looking straight down -Z with no roll/tilt — reset the rotation
    // here so the constellation view isn't left skewed and pan/zoom keep working correctly.
    this.live_.camera.quaternion.identity();
  }

  isOpen(): boolean { return this.current !== null; }

  // True when this device/browser has the WebGL2 + float-texture support LiveAttractor needs
  // (pickTier() returned non-null in the constructor) — NOT whether the currently open day
  // actually has a live cloud showing. A day can be static-only, degenerate (see
  // KNOWN_DEGENERATE_DAYS above), or mid-construction-failure even when this is true, so callers
  // that need "is a live attractor showing right now" should check `this.liveAttractor` (e.g. the
  // hide-image button's visibility below), not this accessor.
  hasLiveSupport(): boolean { return this.tier !== null; }

  toggleHideStatic(): void { this.root.classList.toggle('hide-static'); }

  private updateDisturb(dt: number): void {
    if (!this.liveAttractor) return;
    const target = this.disturbHeld ? 1 : 0;
    const rate = this.disturbHeld ? 1 / 0.3 : 1 / 1.5; // ramp up over 0.3s, ease down over 1.5s
    this.disturbAmount += (target - this.disturbAmount) * Math.min(1, rate * dt);
    this.liveAttractor.setPerturbation(this.disturbAmount);
  }

  render(dt: number): void {
    if (this.liveAttractor && this.orbit) {
      const pos = orbitCameraPosition(this.orbit);
      this.live_.camera.position.set(pos.x, pos.y, pos.z);
      this.live_.camera.lookAt(this.orbit.target.x, this.orbit.target.y, this.orbit.target.z);
    }
    this.updateDisturb(dt);
    this.liveAttractor?.compute();
  }
}
