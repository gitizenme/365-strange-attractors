// The Story destination's interim page: factual description + attribution until the full 2010
// story (roadmap pass 3) replaces the body. Same open/close/Escape contract as MusicView.
export class StoryView {
  private root: HTMLDivElement;
  private openState = false;

  constructor(overlay: HTMLElement, private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'storyview hidden';
    this.root.innerHTML = `
      <button class="story-close" aria-label="Return to the constellation" title="Return to the constellation"><span class="glyph">×</span> Sky</button>
      <div class="story-body">
        <h1>365 Strange Attractors</h1>
        <p>One strange attractor a day, every day of 2010 — 365 fractal works by Joe Chavez,
        each re-rendered live in your browser from its original 2010 parameter file.</p>
        <p class="story-more">The full story of the year is coming.</p>
      </div>`;
    overlay.appendChild(this.root);
    this.root.querySelector('.story-close')!.addEventListener('click', () => this.requestClose());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.requestClose(); });
    addEventListener('keydown', e => {
      if (this.isOpen() && e.key === 'Escape') this.requestClose();
    });
  }

  private requestClose(): void { this.close(); this.onClose(); }
  open(): void { this.openState = true; this.root.classList.remove('hidden'); }
  close(): void { this.openState = false; this.root.classList.add('hidden'); }
  isOpen(): boolean { return this.openState; }
}
