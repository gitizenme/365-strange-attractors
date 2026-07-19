import { loadData } from './data';
import { Constellation } from './constellation';
import { Controls } from './controls';
import { nearestSprite } from './picking';
import { Labels } from './labels';

async function boot() {
  const { artworks, atlas } = await loadData();
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const con = new Constellation(canvas, artworks, atlas);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  con.setReducedMotion(reduced.matches);
  addEventListener('resize', () => con.resize());
  const controls = new Controls(canvas, con.camera, { reducedMotion: reduced.matches });

  const overlay = document.getElementById('overlay')!;
  const labels = new Labels(overlay, artworks);
  let hovered: number | null = null;
  canvas.addEventListener('pointermove', e => {
    const w = controls.screenToWorld(e.clientX, e.clientY);
    hovered = nearestSprite(w, i => con.positionOf(i), artworks.length, 1.2);
    con.setHover(hovered);
    canvas.style.cursor = hovered !== null ? 'pointer' : 'grab';
  });

  let lastT = 0;
  const loop = (t: number) => {
    const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    controls.update(dt);
    con.render(t / 1000);
    labels.update(con.camera, canvas, i => con.positionOf(i));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot();
