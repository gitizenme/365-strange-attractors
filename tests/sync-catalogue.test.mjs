import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildDeveloperToken, extractAppleId, videoNumber, fillArtwork, youtubeMapByNumber } from '../scripts/sync-catalogue.mjs';

const b64urlToJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

describe('buildDeveloperToken', () => {
  it('builds an ES256 JWT with the right header/claims and a valid signature', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const token = buildDeveloperToken({ teamId: 'TEAM123', keyId: 'KEY456', privateKey: pem, now: 1_700_000_000_000 });

    const [h, p, sig] = token.split('.');
    expect(b64urlToJson(h)).toEqual({ alg: 'ES256', kid: 'KEY456', typ: 'JWT' });
    expect(b64urlToJson(p)).toEqual({ iss: 'TEAM123', iat: 1_700_000_000, exp: 1_700_000_000 + 1200 });

    const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('extractAppleId', () => {
  it('pulls the trailing id from video and album URLs', () => {
    expect(extractAppleId('https://music.apple.com/us/music-video/52-01/1634272910')).toBe('1634272910');
    expect(extractAppleId('https://music.apple.com/us/album/x/921794668')).toBe('921794668');
    expect(extractAppleId('nonsense')).toBe(null);
  });
});

describe('videoNumber', () => {
  it('extracts the 52.NN token, ignoring suffixes', () => {
    expect(videoNumber('52.01')).toBe('52.01');
    expect(videoNumber('52.15 Visualizer Video')).toBe('52.15');
    expect(videoNumber('Chaos of Zen - 52.23')).toBe('52.23');
    expect(videoNumber('no number')).toBe(null);
  });
});

describe('fillArtwork', () => {
  it('fills the {w}x{h} template to 1200x1200', () => {
    expect(fillArtwork('https://x/{w}x{h}bb.jpg')).toBe('https://x/1200x1200bb.jpg');
  });
});

describe('youtubeMapByNumber', () => {
  it('maps 52.NN to a watch URL, preferring the shortest title on dupes', () => {
    const items = [
      { snippet: { title: 'Chaos of Zen - 52.01', resourceId: { videoId: 'AAA' } } },
      { snippet: { title: 'Chaos of Zen - 52.15 Square', resourceId: { videoId: 'BBB' } } },
      { snippet: { title: 'Chaos of Zen - 52.15', resourceId: { videoId: 'CCC' } } },
    ];
    const map = youtubeMapByNumber(items);
    expect(map['52.01']).toBe('https://youtube.com/watch?v=AAA');
    expect(map['52.15']).toBe('https://youtube.com/watch?v=CCC');
  });
});
