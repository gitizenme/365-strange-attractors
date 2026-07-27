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
