import type { MusicData, Release } from './musicdata';
import { platformLinks } from './musicdata';

export class MusicView {
  private root: HTMLDivElement;
  private openState = false;

  constructor(overlay: HTMLElement, private data: MusicData, private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'musicview hidden';
    this.root.innerHTML = `
      <button class="music-close" aria-label="Close" title="Close">×</button>
      <div class="music-header">
        <h1></h1>
        <p class="music-bio"></p>
        <div class="music-artist-links"></div>
      </div>
      <section class="music-albums"><h2>Albums</h2><div class="music-album-grid"></div></section>
      <section class="music-videos"><h2>Music Videos</h2><div class="music-thumb-grid"></div></section>
      <section class="music-singles"><h2>Singles &amp; EPs</h2><div class="music-thumb-grid"></div></section>`;
    overlay.appendChild(this.root);

    this.root.querySelector('h1')!.textContent = data.artist.name;
    this.root.querySelector('.music-bio')!.textContent = data.artist.bio;
    const artistLinks = this.root.querySelector('.music-artist-links')!;
    for (const [label, url] of [
      ['Apple Music', data.artist.appleMusicUrl],
      ['YouTube', data.artist.youtubeUrl],
      ['Spotify', data.artist.spotifyUrl],
    ] as const) {
      artistLinks.appendChild(this.linkButton(label, url));
    }

    const albumGrid = this.root.querySelector('.music-albums .music-album-grid')!;
    for (const a of data.albums) {
      const card = document.createElement('a');
      card.className = 'music-album-card';
      card.href = a.appleMusicUrl;
      card.target = '_blank';
      card.rel = 'noopener';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = a.artworkUrl;
      img.alt = a.title;
      const title = document.createElement('span');
      title.className = 'music-album-title';
      title.textContent = a.title;
      const meta = document.createElement('span');
      meta.className = 'music-album-meta';
      meta.textContent = `${a.year} · ${a.trackCount} tracks`;
      card.append(img, title, meta);
      albumGrid.appendChild(card);
    }

    const videoGrid = this.root.querySelector('.music-videos .music-thumb-grid')!;
    for (const r of data.musicVideos) videoGrid.appendChild(this.thumb(r));

    const singleGrid = this.root.querySelector('.music-singles .music-thumb-grid')!;
    for (const r of data.singles) singleGrid.appendChild(this.thumb(r));

    this.root.querySelector('.music-close')!.addEventListener('click', () => this.requestClose());
    this.root.addEventListener('click', e => { if (e.target === this.root) this.requestClose(); });
    addEventListener('keydown', e => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.requestClose();
    });
  }

  private linkButton(label: string, url: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.className = 'music-link-btn';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    return a;
  }

  private thumb(release: Release): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'music-thumb';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = release.artworkUrl;
    img.alt = release.title;
    const title = document.createElement('span');
    title.className = 'music-thumb-title';
    title.textContent = `${release.title} · ${release.year}`;
    const links = document.createElement('div');
    links.className = 'music-thumb-links';
    for (const { label, url } of platformLinks(release)) links.appendChild(this.linkButton(label, url));
    cell.append(img, title, links);
    return cell;
  }

  private requestClose(): void { this.close(); this.onClose(); }

  open(): void { this.openState = true; this.root.classList.remove('hidden'); }
  close(): void { this.openState = false; this.root.classList.add('hidden'); }
  isOpen(): boolean { return this.openState; }
}
