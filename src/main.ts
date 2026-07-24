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
import { StoryView } from './storyview';
import { Nav } from './nav';
import { resolveToday, settleCamera, todayCaption } from './today';

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
  document.querySelector('.static-nav')?.remove(); // replaced by the live word-row below
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  con.setReducedMotion(reduced.matches);
  const controls = new Controls(canvas, con.camera, bounds, { reducedMotion: reduced.matches });
  // Fits the CURRENT layout's own cloud (not the union pan-clamp bounds above -- fitting the
  // union leaves the visible likeness cloud at ~43% fill, see computeCloudBounds' comment)
  // centered in frame at ~85% of the limiting viewport dimension, replacing the old fixed
  // (0,0,120) camera start. Re-applied on resize/rotate and on layout toggle, but only until
  // the visitor's first pan/zoom -- Controls.hasUserMoved() flips permanently on the first drag
  // or wheel event, after which their own framing choice is never overridden from under them.
  let timeMode = false;
  const applyFraming = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // A canvas that hasn't been laid out yet measures 0x0 — dividing gives an aspect of
    // NaN, which fitCamera propagates into camera z, and a NaN camera never recovers on
    // its own (the resize listener only fires on real resize events). Seen in embedded/
    // pre-rendered contexts where boot's data fetches win the race against first layout.
    // Retry on the next frame until layout exists, and re-run con.resize() then so the
    // renderer size and camera aspect (set from the same 0x0 measurement in the
    // constructor) heal together.
    if (!w || !h) { if (!controls.hasUserMoved()) requestAnimationFrame(applyFraming); return; }
    con.resize();
    const fit = fitCamera(computeCloudBounds(artworks, timeMode ? 'date' : 'likeness'), w / h, con.camera.fov, 0.85);
    con.camera.position.set(fit.x, fit.y, fit.z);
  };
  applyFraming();
  addEventListener('resize', () => { con.resize(); if (!controls.hasUserMoved()) applyFraming(); });
  reduced.addEventListener('change', () => con.setReducedMotion(reduced.matches));

  const overlay = document.getElementById('overlay')!;
  // The date-vs-likeness arrangement is a way of viewing the sky, not a destination — a quiet
  // two-word switch by the minimap instead of a primary nav slot.
  const layoutSwitch = document.createElement('div');
  layoutSwitch.id = 'layout-switch';
  const likenessBtn = document.createElement('button');
  likenessBtn.textContent = 'Likeness';
  likenessBtn.title = 'Arrange the constellation by visual similarity';
  const dateBtn = document.createElement('button');
  dateBtn.textContent = 'Date';
  dateBtn.title = 'Arrange the constellation by calendar date';
  layoutSwitch.append(likenessBtn, dateBtn);
  overlay.appendChild(layoutSwitch);
  const setLayout = (byDate: boolean) => {
    likenessBtn.classList.toggle('active', !byDate);
    dateBtn.classList.toggle('active', byDate);
    likenessBtn.setAttribute('aria-pressed', String(!byDate));
    dateBtn.setAttribute('aria-pressed', String(byDate));
    timeMode = byDate;
    con.setTimeMix(byDate ? 1 : 0);
    // The two layouts have very different extents (~92x52 vs ~93x93) -- refit so the one the
    // visitor just switched to is the one framed at ~85%, unless they've already taken over.
    if (!controls.hasUserMoved()) applyFraming();
  };
  likenessBtn.addEventListener('click', () => setLayout(false));
  dateBtn.addEventListener('click', () => setLayout(true));
  setLayout(false);

  const minimap = new Minimap(overlay, artworks, (x, y) => controls.flyTo(x, y, con.camera.position.z, 0.6));

  // The arrival: today's piece is the daily focal point. The sprite glows from boot; once the
  // small atlas tier is visible the camera makes one eased flight to it (home route only, and
  // only if the visitor hasn't already taken over). Reduced-motion visitors get instant framing
  // via flyTo's own duration-0 path.
  const todayArt = resolveToday(new Date(), artworks);
  const todayIndex = artworks.findIndex(a => a.day === todayArt.day);
  con.setHighlight(todayIndex);
  const captionEl = document.createElement('div');
  captionEl.id = 'today-caption';
  const cap = todayCaption(todayArt);
  const capSmall = document.createElement('small');
  capSmall.textContent = cap.label;
  const capTitle = document.createElement('span');
  capTitle.textContent = cap.title;
  captionEl.append(capSmall, capTitle);
  if (!localStorage.getItem('la-intro-seen')) {
    const hints = document.createElement('p');
    hints.className = 'today-hints';
    hints.textContent = 'drag to wander · scroll to dive · click to open';
    captionEl.appendChild(hints);
  }
  overlay.appendChild(captionEl);
  const dismissCaption = () => {
    captionEl.classList.remove('visible');
    localStorage.setItem('la-intro-seen', '1');
  };
  canvas.addEventListener('pointerdown', dismissCaption, { once: true });
  canvas.addEventListener('wheel', dismissCaption, { once: true });

  const labels = new Labels(overlay, artworks);
  let hovered: number | null = null;
  canvas.addEventListener('pointermove', e => {
    const w = controls.screenToWorld(e.clientX, e.clientY);
    hovered = nearestSprite(w, i => con.positionOf(i), artworks.length, 1.2);
    con.setHover(hovered);
    canvas.style.cursor = hovered !== null ? 'pointer' : 'grab';
  });

  // Image | Orbit: the two modes of viewing a piece — the 2010 static render, or the live
  // re-simulated attractor cloud. Lit word = current mode. Shown only while a live-capable
  // piece is open (piece.open()/close() own its display).
  const modeToggle = document.createElement('div');
  modeToggle.id = 'mode-toggle';
  const imageBtn = document.createElement('button');
  imageBtn.textContent = 'Image';
  imageBtn.title = 'Show the 2010 static render';
  const orbitBtn = document.createElement('button');
  orbitBtn.textContent = 'Orbit';
  orbitBtn.title = 'Show only the live attractor';
  modeToggle.append(imageBtn, orbitBtn);
  const syncModeToggle = () => {
    const orbit = piece.isHidingStatic();
    imageBtn.classList.toggle('active', !orbit);
    orbitBtn.classList.toggle('active', orbit);
    imageBtn.setAttribute('aria-pressed', String(!orbit));
    orbitBtn.setAttribute('aria-pressed', String(orbit));
  };
  imageBtn.addEventListener('click', () => { if (piece.isHidingStatic()) { piece.toggleHideStatic(); syncModeToggle(); } });
  orbitBtn.addEventListener('click', () => { if (!piece.isHidingStatic()) { piece.toggleHideStatic(); syncModeToggle(); } });

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
    { attractors, renderer: con.renderer, liveScene, camera: con.camera, canvas, controls, modeToggle, brightnessSlider });
  // appended after piece.root so it paints on top of the piece backdrop while open (same pattern as indexBtn)
  overlay.appendChild(modeToggle);
  overlay.appendChild(brightnessSlider);
  syncModeToggle();

  // Neither view's DOM is built here any more -- IndexView's ~198 index-thumbnail requests and
  // MusicView's ~45 Apple Music CDN requests (~11.7 MB combined) only fire once a visitor actually
  // opens Index or Music, not on every boot. Both start as null/undefined and are constructed lazily
  // by the router below, on first route hit.
  let index: IndexView | null = null;

  // undefined = not yet attempted; null = attempted and failed (disables the section for the rest
  // of the session, same as before); a MusicView instance = succeeded. null from the start when
  // /data/music.json itself failed to load/parse (see the Promise.all above) -- matches spec §6's
  // "shows nothing rather than crashing the rest of the app" by skipping construction entirely
  // rather than showing a button that opens nothing.
  let music: MusicView | null | undefined = musicData ? undefined : null;

  let story: StoryView | null = null;
  const nav = new Nav(overlay, kind => router.go({ kind }), { hasSound: !!musicData });

  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return; // typing in the search field
    const viewOpen = piece.isOpen() || index?.isOpen() || music?.isOpen() || story?.isOpen();
    if (e.key === '/' && !viewOpen) { e.preventDefault(); router.go({ kind: 'attractors' }); }
    if (e.key === 't' && !viewOpen) router.go({ kind: 'today' });
    if (e.key === 'Escape' && index?.isOpen()) router.go({ kind: 'home' });
  });

  const router = new Router(async r => {
    // Scene chrome (word-row, minimap, layout switch, today caption) belongs to the scene:
    // hidden the moment any veil or piece takes over, back when the visitor returns home.
    overlay.classList.toggle('view-open', r.kind !== 'home');
    nav.setActive(r.kind === 'attractors' || r.kind === 'sound' || r.kind === 'story' ? r.kind : null);
    if (r.kind === 'today') {
      // /today/ is a resolver, not a place: replace onto the real day so a shared URL always
      // captures the specific piece, then let the day handler below run via the re-entrant go().
      router.go({ kind: 'day', slug: resolveToday(new Date(), artworks).slug }, { replace: true });
      return;
    }
    if (r.kind === 'sound') {
      piece.close(); index?.close(); story?.close();
      // First hit only (music === undefined): build the view now. A throw here disables the
      // section for the rest of the session (music = null). musicData is guaranteed non-null
      // here since music only starts `undefined` (not `null`) when it was.
      if (music === undefined) {
        try {
          music = new MusicView(overlay, musicData!, () => router.go({ kind: 'home' }));
        } catch (err) {
          console.error('MusicView failed to construct, disabling Sound section', err);
          music = null;
        }
      }
      music?.open();
      return;
    }
    music?.close();
    if (r.kind === 'attractors') {
      piece.close(); story?.close();
      (index ??= new IndexView(overlay, artworks, slug => { index!.close(); router.go({ kind: 'day', slug }); })).open();
      return;
    }
    index?.close();
    if (r.kind === 'story') {
      piece.close();
      (story ??= new StoryView(overlay, () => router.go({ kind: 'home' }))).open();
      return;
    }
    story?.close();
    if (r.kind === 'day' && bySlug.has(r.slug)) {
      const i = bySlug.get(r.slug)!;
      const p = con.positionOf(i);
      await controls.flyTo(p.x, p.y, 8, 0.9);
      piece.open(r.slug);
      syncModeToggle();
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

  // Honor deep links AND canonicalize legacy URLs (/index/, /music/, /about/) onto the new
  // paths without adding a history entry.
  router.go(router.current(), { replace: true });

  const arrive = async () => {
    await con.atlasReady;
    if (controls.hasUserMoved() || router.current().kind !== 'home') return;
    const p = con.positionOf(todayIndex);
    const s = settleCamera(p, con.camera.fov);
    await controls.flyTo(s.x, s.y, s.z, 2.5, { cancellable: true });
    // flyTo's promise also resolves on cancellation/supersession — re-check that the visitor
    // hasn't taken over (drag/wheel mid-settle) and we're still home before revealing the
    // caption, otherwise it fades in over wherever they panned ("the visitor always wins").
    if (controls.hasUserMoved() || router.current().kind !== 'home') return;
    captionEl.classList.add('visible');
  };
  if (router.current().kind === 'home') arrive();

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
    if (!piece.isOpen() && !index?.isOpen() && !music?.isOpen() && !story?.isOpen()) {
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
