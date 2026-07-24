import * as THREE from 'three';
import type { Artwork, Atlas } from './data';
import type { Bounds } from './controls';
import { spiralPosition } from './timeview';

export function atlasUv(atlas: Atlas, slug: string) {
  const i = atlas.index[slug];
  const col = i % atlas.cols;
  const row = Math.floor(i / atlas.cols);
  const su = 1 / atlas.cols, sv = 1 / atlas.rows;
  return { u: col * su, v: 1 - (row + 1) * sv, su, sv };
}

// Bounds of the cloud, padded ~10% on each axis so the visitor never sees content flush against
// the edge. Two distinct consumers need two distinct shapes:
// - 'union' (default): UMAP layout (a.x, a.y) ∪ time-spiral layout (spiralPosition(a.day)) — the
//   PAN CLAMP. Unioned so switching to Time mode never strands sprites outside the pannable range;
//   the spiral's radius (up to 50, see spiralPosition) doesn't always agree with the UMAP extent.
// - 'likeness' / 'date': one layout only — the FRAMING fit. Fitting the union instead visibly
//   breaks the ~85%-fill goal: the real archive's UMAP layout is ~92x52 world units while the
//   union is ~106x102 (near-square), so on a wide viewport fitCamera(union) is height-limited and
//   the actually-visible likeness cloud fills only ~43% of the screen (measured, Task 9).
export function computeCloudBounds(artworks: { day: number; x: number; y: number }[],
                                   layout: 'union' | 'likeness' | 'date' = 'union'): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of artworks) {
    const pts = layout === 'likeness' ? [{ x: a.x, y: a.y }]
      : layout === 'date' ? [spiralPosition(a.day)]
      : [{ x: a.x, y: a.y }, spiralPosition(a.day)];
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const padX = (maxX - minX) * 0.1, padY = (maxY - minY) * 0.1;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

const VERT = /* glsl */ `
uniform float uTime; uniform float uDrift; uniform float uMix; uniform float uSize;
attribute vec2 aPosA; attribute vec2 aPosB; attribute vec4 aUv; attribute float aScale;
attribute float aGlow;
varying vec2 vUv; varying float vGlow;
void main() {
  vec2 base = mix(aPosA, aPosB, uMix);
  vec2 drift = uDrift * 0.12 * vec2(sin(uTime * 0.11 + base.y * 0.7), cos(uTime * 0.13 + base.x * 0.7));
  vec3 world = vec3(base + drift + position.xy * uSize * aScale, 0.0);
  vUv = vec2(aUv.x + uv.x * aUv.z, aUv.y + uv.y * aUv.w);
  // Pulse amplitude rides uDrift so prefers-reduced-motion (uDrift = 0) gets a STEADY glow
  // instead of an animated one -- the highlight survives, the motion doesn't.
  vGlow = aGlow * (0.7 + 0.3 * uDrift * sin(uTime * 2.2));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uBrightness;
varying vec2 vUv; varying float vGlow;
void main() {
  vec4 c = texture2D(uAtlas, vUv);
  gl_FragColor = vec4(min(c.rgb * uBrightness * (1.0 + 0.9 * vGlow), vec3(1.0)), c.a);
}`;

export class Constellation {
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private material: THREE.ShaderMaterial;
  private scaleAttr: THREE.InstancedBufferAttribute;
  private scales: Float32Array;
  private targetScales: Float32Array;
  private posA: Float32Array;
  private posB: Float32Array;
  private mix = 0; private targetMix = 0;
  private glow: Float32Array;
  private glowAttr: THREE.InstancedBufferAttribute;
  readonly atlasReady: Promise<void>;

  constructor(private canvas: HTMLCanvasElement, private artworks: Artwork[], atlas: Atlas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.camera.position.set(0, 0, 120);

    const n = artworks.length;
    this.posA = new Float32Array(n * 2);
    this.posB = new Float32Array(n * 2);
    const uvs = new Float32Array(n * 4);
    this.scales = new Float32Array(n).fill(1);
    this.targetScales = new Float32Array(n).fill(1);
    this.glow = new Float32Array(n);
    artworks.forEach((a, i) => {
      this.posA[i * 2] = a.x; this.posA[i * 2 + 1] = a.y;
      const s = spiralPosition(a.day);
      this.posB[i * 2] = s.x; this.posB[i * 2 + 1] = s.y;
      const t = atlasUv(atlas, a.slug);
      uvs.set([t.u, t.v, t.su, t.sv], i * 4);
    });

    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    geo.setAttribute('aPosA', new THREE.InstancedBufferAttribute(this.posA, 2));
    geo.setAttribute('aPosB', new THREE.InstancedBufferAttribute(this.posB, 2));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvs, 4));
    this.scaleAttr = new THREE.InstancedBufferAttribute(this.scales, 1);
    geo.setAttribute('aScale', this.scaleAttr);
    this.glowAttr = new THREE.InstancedBufferAttribute(this.glow, 1);
    geo.setAttribute('aGlow', this.glowAttr);
    geo.instanceCount = n;

    let atlasLoaded!: () => void;
    this.atlasReady = new Promise<void>(res => { atlasLoaded = res; });
    const smallTex = new THREE.TextureLoader().load(atlas.files.small, () => atlasLoaded());
    smallTex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: smallTex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 }, uBrightness: { value: 1.25 } },
    });
    // Full-resolution tile atlas loads in the background and swaps in on arrival (single-frame
    // texture-uniform swap, no geometry/shader change) -- the preview tier above is already
    // visible by then, so this reads as a seamless upgrade, not a pop-in. Disposing the old
    // (small) texture frees its GPU memory once nothing references it any more.
    new THREE.TextureLoader().load(
      atlas.files.full,
      fullTex => {
        fullTex.colorSpace = THREE.SRGBColorSpace;
        const old = this.material.uniforms.uAtlas.value as THREE.Texture;
        this.material.uniforms.uAtlas.value = fullTex;
        old.dispose();
      },
      undefined,
      err => console.warn('full-resolution atlas failed to load, staying on the preview tier', err),
    );
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.resize();
  }

  setHover(index: number | null): void {
    this.targetScales.fill(1);
    if (index !== null) this.targetScales[index] = 1.35;
  }

  // At most one sprite glows (today's). The pulse itself is computed in the vertex shader from
  // uTime, so nothing per-frame happens on the CPU here.
  setHighlight(index: number | null): void {
    this.glow.fill(0);
    if (index !== null) this.glow[index] = 1;
    this.glowAttr.needsUpdate = true;
  }

  setTimeMix(t: number): void { this.targetMix = t; }

  positionOf(index: number): { x: number; y: number } {
    const a = { x: this.posA[index * 2], y: this.posA[index * 2 + 1] };
    const b = { x: this.posB[index * 2], y: this.posB[index * 2 + 1] };
    return { x: a.x + (b.x - a.x) * this.mix, y: a.y + (b.y - a.y) * this.mix };
  }

  setReducedMotion(on: boolean): void { this.material.uniforms.uDrift.value = on ? 0 : 1; }

  resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // skipDraw: keep animation state (mix/scale easing) advancing so nothing jumps when it resumes
  // drawing, but clear to black instead of actually drawing the constellation — used while the
  // piece view's live attractor cloud is showing full-brightness with the static image hidden, so
  // the constellation isn't sitting underneath competing for contrast (see style.css's
  // `.piece.hide-static` rule, which drops the DOM backdrop's dimming overlay for the same reason).
  render(timeSec: number, skipDraw = false): void {
    this.mix += (this.targetMix - this.mix) * 0.08;
    this.material.uniforms.uMix.value = this.mix;
    this.material.uniforms.uTime.value = timeSec;
    let dirty = false;
    for (let i = 0; i < this.scales.length; i++) {
      const d = this.targetScales[i] - this.scales[i];
      if (Math.abs(d) > 0.001) { this.scales[i] += d * 0.2; dirty = true; }
    }
    if (dirty) this.scaleAttr.needsUpdate = true;
    if (skipDraw) { this.renderer.clear(); return; }
    this.renderer.render(this.scene, this.camera);
  }
}
