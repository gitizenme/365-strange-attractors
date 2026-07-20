import * as THREE from 'three';
import type { Artwork, Atlas } from './data';
import { spiralPosition } from './timeview';

export function atlasUv(atlas: Atlas, slug: string) {
  const i = atlas.index[slug];
  const col = i % atlas.cols;
  const row = Math.floor(i / atlas.cols);
  const su = 1 / atlas.cols, sv = 1 / atlas.rows;
  return { u: col * su, v: 1 - (row + 1) * sv, su, sv };
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
    // powerPreference: some browsers (notably Safari) pick a lower-power/integrated GPU and a
    // reduced shader float precision by default for an arbitrary page, which changes how fast
    // additively-blended point clouds clip to white (see LiveAttractor's uAlpha comment in
    // gpgpu.ts) — request the discrete GPU explicitly rather than leave it to a heuristic.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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

    const tex = new THREE.TextureLoader().load('/images/atlas.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uAtlas: { value: tex }, uTime: { value: 0 }, uDrift: { value: 1 }, uMix: { value: 0 }, uSize: { value: 1.6 } },
    });
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

  render(timeSec: number): void {
    this.mix += (this.targetMix - this.mix) * 0.08;
    this.material.uniforms.uMix.value = this.mix;
    this.material.uniforms.uTime.value = timeSec;
    let dirty = false;
    for (let i = 0; i < this.scales.length; i++) {
      const d = this.targetScales[i] - this.scales[i];
      if (Math.abs(d) > 0.001) { this.scales[i] += d * 0.2; dirty = true; }
    }
    if (dirty) this.scaleAttr.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
