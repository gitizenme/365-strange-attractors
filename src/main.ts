import * as THREE from 'three';
import { loadData, loadAttractors } from './data';
import { Constellation, computeCloudBounds } from './constellation';
import { Controls, fitCamera } from './controls';
import { nearestSprite } from './picking';
import { Labels } from './labels';
import { Router } from './router';
import { PieceView } from './piece';
import { IndexView } from './indexview';
import { Minimap } from './minimap';
import { MusicView } from './musicview';
import { loadMusicData } from './musicdata';

async function boot() {
  // music.json is a supplementary, link-out showcase, unlike artworks/atlas/attractors (which the
  // rest of boot() can't function without at all) -- so its failure must not reject this Promise.all
  // and take the whole site down with it. Per spec §6, MusicView should "show nothing rather than
  // crashing the rest of the app" if its data fails to load/parse; catching here and falling back to
  // null (handled below, where MusicView/musicBtn are only constructed when musicData is non-null)
  // is what actually delivers that guarantee -- everything after this line runs regardless of
  // whether /data/music.json 404s, fails to parse, or the network hiccups.
  const [{ artworks, atlas }, attractors, musicData] = await Promise.all([loadData(), loadAttractors(), loadMusicData().catch(() => null)]);
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const bounds = computeCloudBounds(artworks);
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
  const controls = new Controls(canvas, con.camera, bounds, { reducedMotion: reduced.matches });
  // Fits the whole cloud (UMAP layout union time-spiral layout, padded -- see computeCloudBounds)
  // centered in frame at ~85% of the limiting viewport dimension, replacing the old fixed
  // (0,0,120) camera start. Re-applied on resize/rotate (viewport aspect changed) but only until
  // the visitor's first pan/zoom -- Controls.hasUserMoved() flips permanently on the first drag
  // or wheel event, after which their own framing choice is never overridden from under them.
  const applyFraming = () => {
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const fit = fitCamera(bounds, aspect, con.camera.fov, 0.85);
    con.camera.position.set(fit.x, fit.y, fit.z);
  };
  applyFraming();
  addEventListener('resize', () => { con.resize(); if (!controls.hasUserMoved()) applyFraming(); });
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
    if (e.key === '/' && !piece.isOpen() && !index.isOpen() && !music?.isOpen()) { e.preventDefault(); router.go({ kind: 'index' }); }
    if (e.key === 'Escape' && index.isOpen()) router.go({ kind: 'home' });
  });

  // null when /data/music.json failed to load/parse (see the Promise.all above) -- in that case,
  // skip building MusicView and its nav button entirely rather than showing a button that opens
  // nothing, matching spec §6's "shows nothing rather than crashing the rest of the app".
  //
  // The load succeeding (musicData truthy) doesn't guarantee its SHAPE is right, though -- e.g. a
  // music.json missing `artist` would let MusicView's constructor run and throw synchronously the
  // first time it dereferences a missing field. That throw would happen before `const router = new
  // Router(...)` and `requestAnimationFrame(loop)` below, aborting the rest of boot(): no router, no
  // click handling, no animation loop, the whole page frozen non-interactive -- the same failure
  // class as the load-failure case above (MusicView's data problem taking down the entire site), just
  // a different trigger. Wrap construction in try/catch, mirroring the `new Constellation(...)`
  // try/catch a few lines up, so any throw here also just disables the Music section.
  let music: MusicView | null = null;
  if (musicData) {
    try {
      music = new MusicView(overlay, musicData, () => router.go({ kind: 'home' }));
      const musicBtn = document.createElement('button');
      musicBtn.id = 'music-toggle';
      musicBtn.textContent = 'Music';
      musicBtn.title = 'Chaos of Zen discography';
      overlay.appendChild(musicBtn);
      musicBtn.addEventListener('click', () => router.go({ kind: 'music' }));
    } catch (err) {
      console.error('MusicView failed to construct, disabling Music section', err);
      music = null;
    }
  }

  const router = new Router(async r => {
    // music?. -- music is null when musicData failed to load (see above); a deep link to /music/
    // in that case should also just show nothing rather than throw.
    if (r.kind === 'music') { piece.close(); index.close(); music?.open(); return; }
    music?.close();
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
    if (!piece.isOpen() && !index.isOpen() && !music?.isOpen()) {
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
