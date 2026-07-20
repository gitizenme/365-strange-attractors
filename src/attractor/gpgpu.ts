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
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, (1.0 - d * 2.0) * uAlpha);
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
  private basePointSize: number;
  private baseAlpha: number;

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
    this.basePointSize = pointSize;
    this.baseAlpha = alpha;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: RENDER_VERTEX, fragmentShader: RENDER_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: {
        uPosition: { value: null }, uTexSize: { value: tier },
        uPointSize: { value: pointSize },
        uAlpha: { value: alpha },
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

  // User-facing brightness control (see the piece-view slider): alpha alone has a hard ceiling —
  // once every point is fully opaque at its center, more alpha does nothing — so above that
  // ceiling this also grows point size, which has no such limit, to keep the slider's full range
  // visibly effective even on tiers (like mobile's 256) that are already alpha-maxed by default.
  setBrightness(factor: number): void {
    const f = Math.max(0.1, factor);
    this.material.uniforms.uAlpha.value = Math.min(1.0, this.baseAlpha * f);
    this.material.uniforms.uPointSize.value = this.basePointSize * Math.max(1, Math.sqrt(f));
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
