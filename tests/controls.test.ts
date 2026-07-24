import { describe, it, expect } from 'vitest';
import { stepInertia, clampCamera, zoomToward, fitCamera, Controls } from '../src/controls';

describe('stepInertia', () => {
  it('decays velocity exponentially and snaps to zero', () => {
    const v1 = stepInertia({ x: 10, y: 0 }, 1 / 60);
    expect(v1.x).toBeLessThan(10);
    expect(v1.x).toBeGreaterThan(0);
    let v = { x: 0.5, y: 0.5 };
    for (let i = 0; i < 600; i++) v = stepInertia(v, 1 / 60);
    expect(v).toEqual({ x: 0, y: 0 });
  });
});

describe('clampCamera', () => {
  it('clamps xy independently to a center+extent box and z to range', () => {
    const bounds = { minX: -60, maxX: 60, minY: -30, maxY: 30 };
    expect(clampCamera({ x: 100, y: -100, z: 1 }, bounds, 4, 140)).toEqual({ x: 60, y: -30, z: 4 });
    expect(clampCamera({ x: 0, y: 0, z: 200 }, bounds, 4, 140)).toEqual({ x: 0, y: 0, z: 140 });
  });
});

describe('zoomToward', () => {
  it('moves camera xy toward target when zooming in', () => {
    const cam = { x: 0, y: 0, z: 100 };
    const out = zoomToward(cam, { x: 10, y: 0 }, 0.5); // halve distance
    expect(out.z).toBe(50);
    expect(out.x).toBeCloseTo(5); // xy interpolates by same factor
  });
  it('is identity at factor 1', () => {
    expect(zoomToward({ x: 3, y: 4, z: 80 }, { x: 0, y: 0 }, 1)).toEqual({ x: 3, y: 4, z: 80 });
  });
});

function visibleSize(z: number, aspect: number, fovDeg: number) {
  const h = 2 * z * Math.tan((fovDeg * Math.PI) / 360);
  return { w: h * aspect, h };
}

describe('fitCamera', () => {
  it('centers on bounds regardless of aspect', () => {
    const bounds = { minX: -10, maxX: 30, minY: -4, maxY: 6 };
    const fit = fitCamera(bounds, 1.5, 50);
    expect(fit.x).toBe(10);
    expect(fit.y).toBe(1);
  });

  it('is height-limited for a wide viewport with square bounds', () => {
    const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    const fit = fitCamera(bounds, 2, 50, 0.85);
    const vis = visibleSize(fit.z, 2, 50);
    expect(vis.h).toBeCloseTo(20 / 0.85, 5);
    expect(vis.w).toBeGreaterThan(20 / 0.85); // extra width unused, nothing clipped
  });

  it('is width-limited for a tall viewport with square bounds', () => {
    const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    const fit = fitCamera(bounds, 0.5, 50, 0.85);
    const vis = visibleSize(fit.z, 0.5, 50);
    expect(vis.w).toBeCloseTo(20 / 0.85, 5);
    expect(vis.h).toBeGreaterThan(20 / 0.85);
  });

  it('scales z inversely with fill factor', () => {
    const bounds = { minX: -10, maxX: 10, minY: -5, maxY: 5 };
    const loose = fitCamera(bounds, 1, 50, 0.5);
    const tight = fitCamera(bounds, 1, 50, 1.0);
    expect(loose.z).toBeGreaterThan(tight.z);
    expect(loose.z / tight.z).toBeCloseTo(1.0 / 0.5, 5);
  });

  it('clamps z to a positive minimum for degenerate single-point bounds', () => {
    const fit = fitCamera({ minX: 5, maxX: 5, minY: 5, maxY: 5 }, 1.5, 50);
    expect(fit.z).toBeGreaterThan(0);
    expect(Number.isFinite(fit.z)).toBe(true);
    expect(fit.x).toBe(5);
    expect(fit.y).toBe(5);
  });
});

describe('Controls.flyTo landed outcome', () => {
  // Minimal DOM/camera stubs: Controls only calls addEventListener on the canvas in its
  // constructor, and reads/writes camera.position. No rendering involved.
  const stubCanvas = () => ({ addEventListener() {}, setPointerCapture() {}, clientWidth: 800, clientHeight: 450 });
  const stubCamera = () => ({
    position: { x: 0, y: 0, z: 100, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    fov: 50,
  });
  const bounds = { minX: -60, maxX: 60, minY: -60, maxY: 60 };

  it('resolves true when a duration-0 flight lands, camera exactly on target', async () => {
    const cam = stubCamera();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new Controls(stubCanvas() as any, cam as any, bounds);
    const landed = await c.flyTo(3, -2, 11.4, 0);
    expect(landed).toBe(true);
    expect({ x: cam.position.x, y: cam.position.y, z: cam.position.z }).toEqual({ x: 3, y: -2, z: 11.4 });
  });

  it('resolves false when a cancellable flight is cancelled mid-flight', async () => {
    let pending: (() => void) | null = null;
    const realRaf = globalThis.requestAnimationFrame;
    // capture the tween's next step instead of scheduling it
    (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: () => void) => { pending = cb; return 0; };
    try {
      const cam = stubCamera();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = new Controls(stubCanvas() as any, cam as any, bounds);
      const flight = c.flyTo(3, -2, 11.4, 5, { cancellable: true });
      c.cancelFlight();
      pending!(); // drive the captured tween step; it must observe the cancellation
      await expect(flight).resolves.toBe(false);
    } finally {
      (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = realRaf;
    }
  });
});
