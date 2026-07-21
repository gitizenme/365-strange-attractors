import * as THREE from 'three';
import { loadData, loadAttractors } from './data';
import { Constellation } from './constellation';
import { Controls } from './controls';
import { nearestSprite } from './picking';
import { Labels } from './labels';
import { Router } from './router';
import { PieceView } from './piece';
import { IndexView } from './indexview';
import { Minimap } from './minimap';

async function boot() {
  const [{ artworks, atlas }, attractors] = await Promise.all([loadData(), loadAttractors()]);
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  let con: Constellation;
  try {
    con = new Constellation(canvas, artworks, atlas);
  } catch (err) {
    console.error('WebGL unavailable, falling back to static page', err);
    return; // .static-piece (if present) stays visible; no interactive UI is built
  }
  document.querySelector('.static-piece')?.remove();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  con.setReducedMotion(reduced.matches);
  addEventListener('resize', () => con.resize());
  const controls = new Controls(canvas, con.camera, { reducedMotion: reduced.matches });
  reduced.addEventListener('change', () => con.setReducedMotion(reduced.matches));

  const overlay = document.getElementById('overlay')!;
  const timeBtn = document.createElement('button');
  timeBtn.id = 'time-toggle';
  timeBtn.textContent = 'Time';
  timeBtn.title = 'Arrange by date instead of visual similarity';
  timeBtn.setAttribute('aria-pressed', 'false');
  overlay.appendChild(timeBtn);
  let timeMode = false;
  timeBtn.addEventListener('click', () => {
    timeMode = !timeMode;
    timeBtn.setAttribute('aria-pressed', String(timeMode));
    con.setTimeMix(timeMode ? 1 : 0);
  });

  const minimap = new Minimap(overlay, artworks, (x, y) => controls.flyTo(x, y, con.camera.position.z, 0.6));

  if (!localStorage.getItem('la-intro-seen')) {
    const intro = document.createElement('div');
    intro.id = 'intro-card';
    intro.innerHTML = '<h1>365 Strange Attractors</h1><p>One attractor a day, 2010.<br>Drag to wander · scroll to dive · click to open.</p>';
    overlay.appendChild(intro);
    const dismiss = () => { intro.classList.add('gone'); localStorage.setItem('la-intro-seen', '1'); };
    setTimeout(dismiss, 6000);
    canvas.addEventListener('pointerdown', dismiss, { once: true });
  }

  const labels = new Labels(overlay, artworks);
  let hovered: number | null = null;
  canvas.addEventListener('pointermove', e => {
    const w = controls.screenToWorld(e.clientX, e.clientY);
    hovered = nearestSprite(w, i => con.positionOf(i), artworks.length, 1.2);
    con.setHover(hovered);
    canvas.style.cursor = hovered !== null ? 'pointer' : 'grab';
  });

  const hideImageBtn = document.createElement('button');
  hideImageBtn.id = 'hide-image-toggle';
  hideImageBtn.textContent = 'Hide Image';
  hideImageBtn.title = 'Hide the static image and show only the live attractor';

  const brightnessSlider = document.createElement('input');
  brightnessSlider.id = 'brightness-slider';
  brightnessSlider.type = 'range';
  brightnessSlider.min = '0.4';
  brightnessSlider.max = '6';
  brightnessSlider.step = '0.1';
  brightnessSlider.setAttribute('aria-label', 'Live attractor brightness');

  const liveScene = new THREE.Scene();

  const bySlug = new Map(artworks.map((a, i) => [a.slug, i]));
  const piece = new PieceView(overlay,
    artworks,
    slug => router.go({ kind: 'day', slug }),
    () => router.go({ kind: 'home' }),
    { attractors, renderer: con.renderer, liveScene, camera: con.camera, canvas, controls, hideImageBtn, brightnessSlider });
  // appended after piece.root so it paints on top of the piece backdrop while open (same pattern as indexBtn)
  overlay.appendChild(hideImageBtn);
  overlay.appendChild(brightnessSlider);
  // Reflects which action clicking will perform next, not just the button's own name -- otherwise
  // the label reads "Hide Image" even after the image is already hidden, with nothing on screen
  // indicating that clicking again would bring it back.
  const syncHideImageLabel = () => {
    const hiding = piece.isHidingStatic();
    hideImageBtn.textContent = hiding ? 'Show Image' : 'Hide Image';
    hideImageBtn.title = hiding ? 'Show the static image again' : 'Hide the static image and show only the live attractor';
    hideImageBtn.setAttribute('aria-pressed', String(hiding));
  };
  syncHideImageLabel();
  hideImageBtn.addEventListener('click', () => { piece.toggleHideStatic(); syncHideImageLabel(); });

  const index = new IndexView(overlay, artworks, slug => {
    index.close();
    router.go({ kind: 'day', slug });
  });
  const indexBtn = document.createElement('button');
  indexBtn.id = 'index-toggle';
  indexBtn.textContent = 'Index';
  indexBtn.title = 'Browse all 365 days (or press /)';
  overlay.appendChild(indexBtn);
  indexBtn.addEventListener('click', () => router.go({ kind: 'index' }));
  addEventListener('keydown', e => {
    if (e.key === '/' && !piece.isOpen() && !index.isOpen()) { e.preventDefault(); router.go({ kind: 'index' }); }
    if (e.key === 'Escape' && index.isOpen()) router.go({ kind: 'home' });
  });

  const router = new Router(async r => {
    if (r.kind === 'index') { piece.close(); index.open(); return; }
    index.close();
    if (r.kind === 'day' && bySlug.has(r.slug)) {
      const i = bySlug.get(r.slug)!;
      const p = con.positionOf(i);
      await controls.flyTo(p.x, p.y, 8, 0.9);
      piece.open(r.slug);
      syncHideImageLabel();
    } else {
      piece.close();
    }
  });

  controls.onTap = (sx, sy) => {
    if (piece.isOpen()) return;
    const w = controls.screenToWorld(sx, sy);
    const i = nearestSprite(w, k => con.positionOf(k), artworks.length, 1.2);
    if (i !== null) router.go({ kind: 'day', slug: artworks[i].slug });
  };

  router.go(router.current()); // honor deep links like /day/042-spirality/

  let lastT = 0;
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    controls.update(dt);
    con.render(t / 1000, piece.isShowingLiveFullscreen());
    if (piece.isOpen()) {
      piece.render(dt);
      con.renderer.autoClear = false;
      con.renderer.render(liveScene, con.camera);
      con.renderer.autoClear = true;
    }
    if (!piece.isOpen() && !index.isOpen()) {
      labels.update(con.camera, canvas, i => con.positionOf(i));
      minimap.update(con.camera, canvas, i => con.positionOf(i));
    } else {
      // update() also stops running here, but that only freezes each label's display state where
      // it was — any that were visible (display:block) the moment the piece/index opened stay
      // visible with stale text/position. The piece backdrop dimmed that into invisibility before;
      // now that hide-static drops the backdrop to transparent (see style.css) for the live cloud,
      // stale labels show through undimmed. Explicitly hide them instead of relying on the backdrop.
      labels.hide();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot();
