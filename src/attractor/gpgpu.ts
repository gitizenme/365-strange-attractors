import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import type { Tier } from './tiers';

export interface AttractorFamily {
  system: string;
  paramCount: number;
  /** GLSL function body: `vec3 stepAttractor(vec3 p, float params[N])` — N is substituted from paramCount. */
  glslStep: string;
  /** true for discrete maps (pickover, polynomial_*); false for ODEs integrated with a trailing dt param (lorenz, lorenz_84). */
  isDiscreteMap: boolean;
  /** indices into params[] that the disturb gesture perturbs. */
  disturbIndices: number[];
}

const RENDER_VERTEX = /* glsl */ `
uniform sampler2D uPosition;
uniform float uTexSize;
uniform float uPointSize;
varying vec3 vColor;
uniform vec3 uTint;
void main() {
  float index = float(gl_VertexID);
  float x = mod(index, uTexSize);
  float y = floor(index / uTexSize);
  vec2 uv = (vec2(x, y) + 0.5) / uTexSize;
  vec3 pos = texture2D(uPosition, uv).xyz;
  vColor = uTint;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uPointSize;
}`;

const RENDER_FRAGMENT = /* glsl */ `
varying vec3 vColor;
uniform float uAlpha;
uniform float uBrightness;
uniform float uCalibration;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor * uBrightness, (1.0 - d * 2.0) * uAlpha * uCalibration);
}`;

function computeShader(family: AttractorFamily): string {
  return /* glsl */ `
    uniform float uParamsA[${family.paramCount}];
    uniform float uParamsB[${family.paramCount}];
    uniform float uMorphMix;
    uniform float uPerturbation;
    ${family.glslStep}
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec3 p = texture2D(texturePosition, uv).xyz;
      float params[${family.paramCount}];
      for (int i = 0; i < ${family.paramCount}; i++) {
        params[i] = mix(uParamsA[i], uParamsB[i], uMorphMix);
      }
      ${family.disturbIndices.map(i => `params[${i}] += uPerturbation * (0.15 * sin(dot(uv, vec2(12.9898, 78.233)) * 43758.5453 + float(${i})));`).join('\n      ')}
      vec3 next = stepAttractor(p, params);
      if (!(next.x == next.x) || !(next.y == next.y) || !(next.z == next.z) ||
          abs(next.x) > 1.0e4 || abs(next.y) > 1.0e4 || abs(next.z) > 1.0e4) {
        float rx = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        float ry = fract(sin(dot(uv, vec2(93.9898, 67.345))) * 24634.6345) - 0.5;
        float rz = fract(sin(dot(uv, vec2(41.2398, 289.123))) * 12345.6789) - 0.5;
        next = vec3(rx, ry, rz);
      }
      gl_FragColor = vec4(next, 1.0);
    }
  `;
}

// Optional replacement for the default "near-identical random points clustered near the
// origin" initial seeding (see fillSeedTexture below). Slow-mixing systems (small dt, or
// attractors whose nearby trajectories take a long time to decorrelate from each other) only
// visually "fill in" their true shape as fast as the whole ~1M-point cloud's own mixing
// timescale when seeded from near-identical starts — for some days that's minutes of wall-clock
// viewing time (see .superpowers/sdd/task-11.5-report.md). Seeding instead from a diverse set of
// REAL points already sampled along one long, cheap, CPU-computed trajectory (see
// piece.ts's estimate*Display functions) sidesteps that: a single ergodic trajectory naturally
// visits the attractor's true shape, so replicating (with light jitter) across the ~1M texels
// makes the very first GPU frame already look like a populated attractor.
export interface SeedSpec {
  /** Flat [x0,y0,z0, x1,y1,z1, ...] array of real, already-on-attractor points, in the same
   * local coordinate space stepAttractor() operates in (i.e. unscaled, pre-`points.scale`). */
  points: Float32Array;
  /** Half-width of the uniform per-axis jitter added to each texel's replicated point, in the
   * same units as `points`. Keeps texels that land on the same sample point from moving in
   * perfect lockstep forever; should be small relative to the attractor's own extent. */
  jitter: number;
}

// Pure so it's unit-testable without a WebGL context: fills a GPUComputationRenderer
// DataTexture's backing Float32Array (RGBA texels, only RGB used) with initial positions, either
// from `seed` (see SeedSpec above) or, when omitted, the original default — near-identical random
// points in a tiny [-0.05, 0.05]^3 cube near the origin.
export function fillSeedTexture(data: Float32Array, seed?: SeedSpec): void {
  if (seed && seed.points.length >= 3) {
    const count = Math.floor(seed.points.length / 3);
    const j = seed.jitter;
    for (let i = 0; i < data.length; i += 4) {
      const s = Math.floor(Math.random() * count) * 3;
      data[i] = seed.points[s] + (Math.random() - 0.5) * j;
      data[i + 1] = seed.points[s + 1] + (Math.random() - 0.5) * j;
      data[i + 2] = seed.points[s + 2] + (Math.random() - 0.5) * j;
      data[i + 3] = 1;
    }
    return;
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (Math.random() - 0.5) * 0.1;
    data[i + 1] = (Math.random() - 0.5) * 0.1;
    data[i + 2] = (Math.random() - 0.5) * 0.1;
    data[i + 3] = 1;
  }
}

export class LiveAttractor {
  readonly points: THREE.Points;
  private gpuCompute: GPUComputationRenderer;
  private positionVariable: ReturnType<GPUComputationRenderer['addVariable']>;
  private material: THREE.ShaderMaterial;
  private tier: Tier;

  constructor(renderer: THREE.WebGLRenderer, family: AttractorFamily, params: number[], tier: Tier, seed?: SeedSpec, tint?: THREE.Color) {
    this.tier = tier;
    this.gpuCompute = new GPUComputationRenderer(tier, tier, renderer);
    const initial = this.gpuCompute.createTexture();
    const data = initial.image.data as Float32Array;
    fillSeedTexture(data, seed);
    this.positionVariable = this.gpuCompute.addVariable('texturePosition', computeShader(family), initial);
    this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable]);
    this.positionVariable.material.uniforms.uParamsA = { value: params.slice() };
    this.positionVariable.material.uniforms.uParamsB = { value: params.slice() };
    this.positionVariable.material.uniforms.uMorphMix = { value: 0 };
    this.positionVariable.material.uniforms.uPerturbation = { value: 0 };
    const error = this.gpuCompute.init();
    if (error !== null) throw new Error(`GPUComputationRenderer init failed: ${error}`);

    // settling burst: iterate several times before first visible frame
    for (let i = 0; i < 150; i++) this.gpuCompute.compute();

    const n = tier * tier;
    // tier 256 (true mobile — phones, where the UA sniff in piece.ts actually fires) gets a much
    // bigger point size than the ink formula below would otherwise pick: at only 65,536 points,
    // even a fully-opaque (alpha=1) cloud leaves most pixels with zero points landing on them —
    // confirmed on real iPhone hardware as a near-black frame with only a faint hint of color at
    // the manifold's densest fold, unlike the 1024/2048 tiers where alpha is the limiting factor.
    // More screen-space coverage per point is the only remaining lever once alpha is maxed out.
    const pointSize = tier >= 2048 ? 1.2 : tier >= 1024 ? 1.6 : 3.5;
    // With THREE.AdditiveBlending, each overlapping point ADDS its (color * alpha) to the
    // framebuffer with no upper bound until the GPU clips it to white — so the cumulative
    // brightness in dense, overlapping regions of the cloud scales with point COUNT * point
    // AREA * alpha, not just alpha alone. A flat alpha meant higher tiers (far more points)
    // summed to much more total "ink" than lower tiers at similar point area. Scale alpha
    // inversely with (count * pointSize^2) so total ink stays roughly constant across tiers —
    // in practice tier 256 always hits the alpha ceiling regardless (see pointSize comment
    // above), so this mainly modulates the 1024/2048 tiers relative to each other.
    // Note iPadOS Safari reports a desktop-class user agent (no "Mobi" token), so iPads land on
    // the same non-mobile tier as desktop here, not the 256 mobile tier — confirmed too dim on
    // real iPad hardware at the original baseline, so the baseline itself (not just the relative
    // scaling) needed to go up: BASE_MULTIPLIER lifts every tier's ink together.
    const BASE_MULTIPLIER = 1.7;
    const TARGET_INK = 1024 * 1024 * 1.6 * 1.6 * 0.5 * BASE_MULTIPLIER;
    const alpha = Math.min(1.0, Math.max(0.12, TARGET_INK / (n * pointSize * pointSize)));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: RENDER_VERTEX, fragmentShader: RENDER_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: {
        // Constructor's settling burst above calls the GPUComputationRenderer's own compute()
        // directly (cheaper in a 150-iteration loop than this class's compute() wrapper, which
        // also does an uniform-value assignment each call) — but that means uPosition was never
        // pointed at the result. Point it at the just-settled texture now, or every render before
        // the game loop's first compute() tick (including calibrate() below) samples a null
        // sampler, which silently rasterizes nothing — confirmed as the reason a real oversaturated
        // day was measuring zero rendered coverage and skipping calibration entirely.
        uPosition: { value: this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture },
        uTexSize: { value: tier },
        uPointSize: { value: pointSize },
        uAlpha: { value: alpha },
        uBrightness: { value: 1 },
        uCalibration: { value: 1 },
        uTint: { value: tint ? tint.clone() : new THREE.Color(1, 1, 1) },
      },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setParams(params: number[]): void { this.positionVariable.material.uniforms.uParamsA.value = params.slice(); }
  setMorphTarget(paramsB: number[] | null, mix: number): void {
    if (paramsB) this.positionVariable.material.uniforms.uParamsB.value = paramsB.slice();
    this.positionVariable.material.uniforms.uMorphMix.value = mix;
  }
  setPerturbation(amount: number): void { this.positionVariable.material.uniforms.uPerturbation.value = amount; }

  // Some days' geometry concentrates far more of the simulated point mass into the same screen-
  // space area than the tier-based ink formula above assumes — e.g. a near-limit-cycle lorenz_84
  // orbit, or a family/day whose display `scale` renders it small — which saturates the whole
  // cloud to flat white regardless of tier or the user's brightness slider (confirmed on real
  // hardware: still fully white even at the slider's minimum). A CPU-side density estimate from
  // the raw simulated positions was tried and discarded — it doesn't correlate with the actual
  // on-screen result (verified empirically: some visually-fine days scored WORSE than the broken
  // ones, because the real saturation the additive shader produces depends on the final on-screen
  // projection — camera distance, this piece's display `scale`, point size in device pixels — not
  // just the point cloud's own shape in simulation space).
  //
  // This instead measures the actual rendered outcome directly: render the real points with the
  // real camera into a small offscreen target, read back a sample, and see what fraction of pixels
  // that have any coverage are already fully clipped to white. If too many are, scale the ink down
  // and measure again. Self-correcting regardless of *why* a given day oversaturates, since it
  // reacts to the true result rather than predicting it from geometry. Call once after the points'
  // final scale/position are set and the camera is at its opening position, before the first
  // user-visible frame. Defensive: falls back to no adjustment (today's existing behavior) if
  // render-target readback fails or is unsupported on this device.
  calibrate(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    // Grayscale/near-noise palettes deliberately render in plain white (see palette.ts's
    // MIN_MEANINGFUL_SATURATION fallback) — that's the intended look, not saturation to correct.
    // At tier 256 in particular, alpha is unconditionally 1.0 by design (see its comment above), so
    // even a single non-overlapping white-tinted point's center pixel legitimately reads as pure
    // white — indistinguishable from this method's "clipped" signal. Skip entirely for white tints
    // rather than risk needlessly darkening an intentionally white cloud.
    const tintColor = this.material.uniforms.uTint.value as THREE.Color;
    if (tintColor.r > 0.99 && tintColor.g > 0.99 && tintColor.b > 0.99) return;
    // Match the real camera's aspect ratio rather than forcing a square target — otherwise the
    // sampled framing is a stretched version of the actual on-screen composition. ~512x512's worth
    // of total texels: some of the days this exists to catch (e.g. a family/day whose display
    // `scale` renders it small on screen — see piece.ts) occupy only a small fraction of the frame,
    // and a coarser sample can miss enough of that shape's pixels to fall under the `covered` floor
    // below, silently skipping calibration for exactly the cloud that needs it most (confirmed: a
    // 128x128 sample missed a real tiny-on-screen case that this resolution catches).
    const aspect = camera.aspect || 1;
    const AREA = 512 * 512;
    const H = Math.max(1, Math.round(Math.sqrt(AREA / aspect)));
    const W = Math.max(1, Math.round(H * aspect));
    let target: THREE.WebGLRenderTarget | null = null;
    try {
      target = new THREE.WebGLRenderTarget(W, H);
      const scratchScene = new THREE.Scene();
      scratchScene.add(this.points);
      const prevTarget = renderer.getRenderTarget();
      const buf = new Uint8Array(W * H * 4);
      for (let attempt = 0; attempt < 3; attempt++) {
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scratchScene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
        let covered = 0, saturated = 0;
        for (let i = 0; i < W * H; i++) {
          const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
          if (r < 4 && g < 4 && b < 4) continue; // background, no point coverage here
          covered++;
          if (r > 250 && g > 250 && b > 250) saturated++;
        }
        if (covered < 8) break; // nothing meaningful landed in the sample; leave calibration alone
        const saturatedFraction = saturated / covered;
        if (saturatedFraction < 0.35) break; // acceptable — most of the visible cloud isn't clipped
        // Scale down proportionally to how bad it is, floor well above zero so the cloud never
        // fully vanishes; re-measure to confirm rather than assuming one correction is enough.
        this.material.uniforms.uCalibration.value = Math.max(0.02, this.material.uniforms.uCalibration.value * (1 - saturatedFraction));
      }
      renderer.setRenderTarget(prevTarget);
    } catch { /* render-target readback unsupported on this device — leave uncalibrated */ }
    finally { target?.dispose(); }
  }

  // User-facing brightness control (see the piece-view slider). A pure color-intensity multiplier
  // on top of the already-tuned per-tier alpha/point-size (which stay fixed) — deliberately NOT
  // implemented by growing point size or alpha: an earlier version did that, and past a modest
  // factor the enlarged, more-opaque points merge into a blurry, structureless blob (confirmed on
  // real iPad hardware — it read as a flat gray wash over the whole cloud, not "brighter"). Scaling
  // the emitted color directly instead keeps every point's footprint and coverage identical, so the
  // cloud's fine structure stays crisp at any brightness — only the densest, most-overlapping
  // regions clip to white sooner, exactly like overexposing a bright light source.
  setBrightness(factor: number): void {
    this.material.uniforms.uBrightness.value = Math.max(0.1, factor);
  }

  compute(): void {
    this.gpuCompute.compute();
    this.material.uniforms.uPosition.value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.gpuCompute.dispose();
  }
}
