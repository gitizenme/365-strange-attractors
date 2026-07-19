import { loadData } from './data';
import { Constellation } from './constellation';

async function boot() {
  const { artworks, atlas } = await loadData();
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const con = new Constellation(canvas, artworks, atlas);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  con.setReducedMotion(reduced.matches);
  addEventListener('resize', () => con.resize());
  const loop = (t: number) => { con.render(t / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
boot();
