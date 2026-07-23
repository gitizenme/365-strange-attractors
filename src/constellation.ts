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

// Union of the UMAP layout (a.x, a.y) and the time-spiral layout (spiralPosition(a.day)),
// padded ~10% on each axis. Padded so the visitor never sees content flush against the edge, and
// unioned (not just UMAP) so switching to Time mode never pushes sprites out of frame -- the
// spiral's radius (up to 50, see spiralPosition) doesn't always agree with the UMAP layout's own
// extent.
export function computeCloudBounds(artworks: { day: number; x: number; y: number }[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of artworks) {
    const s = spiralPosition(a.day);
    for (const p of [{ x: a.x, y: a.y }, s]) {
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
varying vec2 vUv;
void main() {
  vec2 base = mix(aPosA, aPosB, uMix);
  vec2 drift = uDrift * 0.12 * vec2(sin(uTime * 0.11 + base.y * 0.7), cos(uTime * 0.13 + base.x * 0.7));
  vec3 world = vec3(base + drift + position.xy * uSize * aScale, 0.0);
  vUv = vec2(aUv.x + uv.x * aUv.z, aUv.y + uv.y * aUv.w);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uAtlas, vUv); }`;

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
    geo.instanceCount = n;

    const smallTex = new THREE.TextureLoader().load(atlas.files.small);
    smallTex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: smallTex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 } },
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
