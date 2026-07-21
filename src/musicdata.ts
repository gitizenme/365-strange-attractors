export interface Artist {
  name: string;
  bio: string;
  appleMusicUrl: string;
  youtubeUrl: string;
  spotifyUrl: string;
}

export interface Album {
  title: string;
  year: number;
  trackCount: number;
  artworkUrl: string;
  appleMusicUrl: string;
}

export interface Release {
  title: string;
  type: 'single' | 'ep' | 'video';
  year: number;
  artworkUrl: string;
  appleMusicUrl: string;
  youtubeUrl?: string;
}

export interface MusicData {
  artist: Artist;
  albums: Album[];
  musicVideos: Release[];
  singles: Release[];
}

export async function loadMusicData(): Promise<MusicData> {
  return fetch('/data/music.json').then(r => r.json());
}

export function platformLinks(release: Release): { label: string; url: string }[] {
  const links = [{ label: 'Apple Music', url: release.appleMusicUrl }];
  if (release.youtubeUrl) links.push({ label: 'YouTube', url: release.youtubeUrl });
  return links;
}
