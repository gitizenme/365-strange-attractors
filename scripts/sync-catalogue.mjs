import crypto from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

export function buildDeveloperToken({ teamId, keyId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = { iss: teamId, iat, exp: iat + 1200 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput),
    { key: crypto.createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}

export function extractAppleId(url) {
  const m = /\/(\d+)(?:[/?#]|$)/.exec(String(url || ''));
  return m ? m[1] : null;
}

export function videoNumber(title) {
  const m = /52\.(\d{2})/.exec(String(title || ''));
  return m ? `52.${m[1]}` : null;
}

export function fillArtwork(template, size = 1200) {
  return String(template || '').replace('{w}', String(size)).replace('{h}', String(size));
}

export function youtubeMapByNumber(items) {
  const byNum = {};
  const titleFor = {};
  for (const it of items || []) {
    const title = it?.snippet?.title || '';
    const id = it?.snippet?.resourceId?.videoId || it?.contentDetails?.videoId;
    const n = videoNumber(title);
    if (!n || !id) continue;
    if (!(n in byNum) || title.length < titleFor[n].length) {
      byNum[n] = `https://youtube.com/watch?v=${id}`;
      titleFor[n] = title;
    }
  }
  return byNum;
}

const yearOf = (releaseDate) => Number(String(releaseDate || '').slice(0, 4)) || null;

export function buildVideoEntry(appleVideo, youtubeMap) {
  const a = appleVideo.attributes;
  const entry = {
    title: a.name, type: 'video', year: yearOf(a.releaseDate),
    artworkUrl: fillArtwork(a.artwork.url), appleMusicUrl: a.url,
  };
  const yt = youtubeMap[videoNumber(a.name)];
  if (yt) entry.youtubeUrl = yt;
  return entry;
}

export function buildAlbumEntry(appleAlbum) {
  const a = appleAlbum.attributes;
  return {
    title: a.name, year: yearOf(a.releaseDate), trackCount: a.trackCount,
    artworkUrl: fillArtwork(a.artwork.url), appleMusicUrl: a.url,
  };
}

export function buildSingleEntry(appleAlbum) {
  const a = appleAlbum.attributes;
  return {
    title: a.name, type: 'single', year: yearOf(a.releaseDate),
    artworkUrl: fillArtwork(a.artwork.url), appleMusicUrl: a.url,
  };
}

export function reconcile(existing, incoming, keyFn) {
  const existingKeys = new Set(existing.map(keyFn).filter(Boolean));
  const incomingKeys = new Set(incoming.map(keyFn).filter(Boolean));
  const additions = incoming.filter((x) => keyFn(x) && !existingKeys.has(keyFn(x)));
  const orphans = existing.filter((x) => keyFn(x) && !incomingKeys.has(keyFn(x)));
  return { additions, orphans };
}

export function sortVideos(videos) {
  return [...videos].sort((a, b) => {
    const na = videoNumber(a.title), nb = videoNumber(b.title);
    if (na && nb) return na < nb ? -1 : na > nb ? 1 : 0;
    if (na) return -1;
    if (nb) return 1;
    return 0;
  });
}

export function formatMusicJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

async function fetchAppleAll(fetchJson, startUrl, headers) {
  let url = startUrl;
  const out = [];
  while (url) {
    const page = await fetchJson(url, headers);
    out.push(...(page.data || []));
    url = page.next ? `https://api.music.apple.com${page.next}` : null;
  }
  return out;
}

async function fetchYouTubeAll(fetchJson, playlistId, key) {
  const out = [];
  let token = '';
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails`
      + `&playlistId=${playlistId}&maxResults=50&key=${key}${token ? `&pageToken=${token}` : ''}`;
    const page = await fetchJson(url);
    out.push(...(page.items || []));
    token = page.nextPageToken || '';
  } while (token);
  return out;
}

const appleKey = (e) => extractAppleId(e.appleMusicUrl);

export async function runSync({ fetchJson, appleToken, youtubeKey, artistId, uploadsPlaylistId, music }) {
  const headers = { Authorization: `Bearer ${appleToken}` };
  const artist = await fetchJson(
    `https://api.music.apple.com/v1/catalog/us/artists/${artistId}?views=full-albums,singles`, headers);
  const views = artist.data?.[0]?.views || {};
  const appleAlbums = views['full-albums']?.data || [];
  const appleSingles = views.singles?.data || [];
  const appleVideos = await fetchAppleAll(fetchJson,
    `https://api.music.apple.com/v1/catalog/us/artists/${artistId}/music-videos?limit=100`, headers);
  const ytItems = await fetchYouTubeAll(fetchJson, uploadsPlaylistId, youtubeKey);
  const ytMap = youtubeMapByNumber(ytItems);

  const incVideos = appleVideos.map((v) => buildVideoEntry(v, ytMap));
  const incAlbums = appleAlbums.map(buildAlbumEntry);
  const incSingles = appleSingles.map(buildSingleEntry);

  const vids = reconcile(music.musicVideos, incVideos, appleKey);
  const albs = reconcile(music.albums, incAlbums, appleKey);
  const sngs = reconcile(music.singles, incSingles, appleKey);

  const next = {
    ...music,
    albums: [...music.albums, ...albs.additions],
    singles: [...music.singles, ...sngs.additions],
    musicVideos: sortVideos([...music.musicVideos, ...vids.additions]),
  };

  const appleVideoNums = new Set(appleVideos.map((v) => videoNumber(v.attributes.name)).filter(Boolean));
  const existingVideoNums = new Set(music.musicVideos.map((v) => videoNumber(v.title)).filter(Boolean));
  const ytOnly = Object.keys(ytMap).filter((n) => !appleVideoNums.has(n) && !existingVideoNums.has(n));

  const changed = vids.additions.length + albs.additions.length + sngs.additions.length > 0;
  const lines = [];
  lines.push(`## Catalogue sync`, '');
  const list = (label, arr, f) => arr.length && lines.push(`**${label} (${arr.length}):** ${arr.map(f).join(', ')}`);
  list('New albums', albs.additions, (a) => a.title);
  list('New singles', sngs.additions, (s) => s.title);
  list('New videos', vids.additions, (v) => v.title);
  list('On YouTube, awaiting Apple Music', ytOnly.map((n) => ({ n })), (x) => x.n);
  list('In music.json but not in the Apple API — review', [...albs.orphans, ...sngs.orphans, ...vids.orphans], (e) => e.title);
  if (!changed) lines.push('Catalogue already up to date. No additions.');
  return { music: next, summary: lines.join('\n') + '\n', changed };
}

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

async function fetchJsonReal(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function main() {
  const { APPLE_MUSIC_PRIVATE_KEY, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_TEAM_ID, YOUTUBE_API_KEY } = process.env;
  for (const [k, v] of Object.entries({ APPLE_MUSIC_PRIVATE_KEY, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_TEAM_ID, YOUTUBE_API_KEY }))
    if (!v) throw new Error(`missing required env var ${k}`);

  const appleToken = buildDeveloperToken({
    teamId: APPLE_MUSIC_TEAM_ID, keyId: APPLE_MUSIC_KEY_ID, privateKey: APPLE_MUSIC_PRIVATE_KEY });
  const path = 'public/data/music.json';
  const music = JSON.parse(readFileSync(path, 'utf8'));

  const { music: updated, summary, changed } = await runSync({
    fetchJson: fetchJsonReal, appleToken, youtubeKey: YOUTUBE_API_KEY,
    artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

  writeFileSync('sync-summary.md', summary);
  if (changed) writeFileSync(path, formatMusicJson(updated));
  console.log(summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
