export type NavKind = 'today' | 'attractors' | 'sound' | 'story';

const ENTRIES: { kind: NavKind; label: string; title: string }[] = [
  { kind: 'today', label: 'Today', title: "Today — this date's attractor (or press t)" },
  { kind: 'attractors', label: 'Attractors', title: 'Attractors — browse all 365 days (or press /)' },
  { kind: 'sound', label: 'Sound', title: 'Sound — music from the attractors' },
  { kind: 'story', label: 'Story', title: 'Story — one attractor a day, 2010' },
];

// The four destinations as a serif word-row woven into the scene (bottom center). Real <a> links
// so middle-click/hover-preview/crawlers work; normal clicks are intercepted and routed.
export class Nav {
  private root: HTMLElement;
  private links = new Map<NavKind, HTMLAnchorElement>();

  constructor(overlay: HTMLElement, onGo: (kind: NavKind) => void, opts: { hasSound: boolean }) {
    this.root = document.createElement('nav');
    this.root.id = 'nav-row';
    for (const e of ENTRIES) {
      if (e.kind === 'sound' && !opts.hasSound) continue;
      const a = document.createElement('a');
      a.href = `/${e.kind}/`;
      a.textContent = e.label;
      a.title = e.title;
      a.addEventListener('click', ev => { ev.preventDefault(); onGo(e.kind); });
      this.root.appendChild(a);
      this.links.set(e.kind, a);
    }
    overlay.appendChild(this.root);
  }

  setActive(kind: NavKind | null): void {
    for (const [k, a] of this.links) a.classList.toggle('active', k === kind);
  }
}
