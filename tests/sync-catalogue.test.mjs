import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildDeveloperToken, extractAppleId, videoNumber, fillArtwork, youtubeMapByNumber, buildVideoEntry, buildAlbumEntry, buildSingleEntry, reconcile, sortVideos, formatMusicJson, coverageReport, runSync } from '../scripts/sync-catalogue.mjs';

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

describe('buildVideoEntry', () => {
  const appleVideo = { attributes: {
    name: '52.29', url: 'https://music.apple.com/us/music-video/52-29/1634973753',
    artwork: { url: 'https://x/{w}x{h}bb.jpg' }, releaseDate: '2021-05-14' } };

  it('maps Apple fields and attaches youtube when matched', () => {
    expect(buildVideoEntry(appleVideo, { '52.29': 'https://youtube.com/watch?v=IFHfhA0lKb4' })).toEqual({
      title: '52.29', type: 'video', year: 2021,
      artworkUrl: 'https://x/1200x1200bb.jpg',
      appleMusicUrl: 'https://music.apple.com/us/music-video/52-29/1634973753',
      youtubeUrl: 'https://youtube.com/watch?v=IFHfhA0lKb4',
    });
  });
  it('omits youtubeUrl when there is no match', () => {
    const e = buildVideoEntry(appleVideo, {});
    expect('youtubeUrl' in e).toBe(false);
  });
});

describe('buildAlbumEntry / buildSingleEntry', () => {
  const appleAlbum = { attributes: {
    name: 'Random Acts of Ambients Vol. 1',
    url: 'https://music.apple.com/us/album/x/921794668',
    artwork: { url: 'https://y/{w}x{h}bb.jpg' }, releaseDate: '2014', trackCount: 10 } };
  it('builds album with trackCount', () => {
    expect(buildAlbumEntry(appleAlbum)).toEqual({
      title: 'Random Acts of Ambients Vol. 1', year: 2014, trackCount: 10,
      artworkUrl: 'https://y/1200x1200bb.jpg',
      appleMusicUrl: 'https://music.apple.com/us/album/x/921794668',
    });
  });
  it('builds single with type single and no trackCount', () => {
    const s = buildSingleEntry(appleAlbum);
    expect(s.type).toBe('single');
    expect('trackCount' in s).toBe(false);
  });
});

const key = (e) => extractAppleId(e.appleMusicUrl);

describe('reconcile', () => {
  it('splits additions and orphans by key', () => {
    const existing = [{ appleMusicUrl: 'a/1' }, { appleMusicUrl: 'a/2' }];
    const incoming = [{ appleMusicUrl: 'a/2' }, { appleMusicUrl: 'a/3' }];
    const { additions, orphans } = reconcile(existing, incoming, key);
    expect(additions.map(key)).toEqual(['3']);
    expect(orphans.map(key)).toEqual(['1']);
  });
});

describe('sortVideos', () => {
  it('orders by 52.NN ascending', () => {
    const out = sortVideos([{ title: '52.03' }, { title: '52.01' }, { title: '52.02' }]);
    expect(out.map((v) => v.title)).toEqual(['52.01', '52.02', '52.03']);
  });
});

describe('formatMusicJson', () => {
  it('uses 2-space indent, trailing newline, unescaped non-ascii, and round-trips', () => {
    const out = formatMusicJson({ a: 1, b: 'café' });
    expect(out).toBe('{\n  "a": 1,\n  "b": "café"\n}\n');
    expect(JSON.parse(out)).toEqual({ a: 1, b: 'café' });
  });
});

function makeFetch(routes) {
  // routes: array of [substring, responseObject]; first match wins
  return async (url) => {
    for (const [needle, resp] of routes) if (url.includes(needle)) return resp;
    throw new Error(`unexpected url ${url}`);
  };
}

describe('coverageReport', () => {
  it('reports received/curated/matched/unmatched per collection', () => {
    const lines = coverageReport([{ label: 'Albums', received: 2, curated: 2, orphans: 0 }]);
    expect(lines).toEqual(['- Albums: Apple returned 2, music.json has 2, matched 2, unmatched 0']);
  });

  it('flags a collection where Apple returned fewer than music.json holds', () => {
    const [thin] = coverageReport([{ label: 'Videos', received: 9, curated: 51, orphans: 42 }]);
    const [full] = coverageReport([{ label: 'Albums', received: 2, curated: 2, orphans: 0 }]);
    expect(thin).toContain('⚠');       // under-read is called out, not buried in numbers
    expect(full).not.toContain('⚠');
  });
});

describe('runSync', () => {
  it('adds new Apple entries, matches youtube, reports orphans and youtube-only', async () => {
    const music = {
      artist: { name: 'Chaos of Zen' },
      albums: [{ title: 'A1', appleMusicUrl: 'https://music.apple.com/us/album/a/100' }],
      singles: [{ title: 'S1', type: 'single', appleMusicUrl: 'https://music.apple.com/us/album/s/200' }],
      musicVideos: [{ title: '52.01', type: 'video', appleMusicUrl: 'https://music.apple.com/us/music-video/52-01/300' }],
    };
    const art = { url: 'https://img/{w}x{h}bb.jpg' };
    const fetchJson = makeFetch([
      ['/artists/424257434?views', { data: [{ views: {
        'full-albums': { data: [
          { attributes: { name: 'A1', url: 'https://music.apple.com/us/album/a/100', artwork: art, releaseDate: '2014', trackCount: 5 } },
          { attributes: { name: 'A2', url: 'https://music.apple.com/us/album/a/101', artwork: art, releaseDate: '2015', trackCount: 7 } },
        ] },
        singles: { data: [
          { attributes: { name: 'S1', url: 'https://music.apple.com/us/album/s/200', artwork: art, releaseDate: '2021' } },
        ] },
      } }] }],
      ['/music-videos', { data: [
        { attributes: { name: '52.01', url: 'https://music.apple.com/us/music-video/52-01/300', artwork: art, releaseDate: '2022-01-01' } },
        { attributes: { name: '52.02', url: 'https://music.apple.com/us/music-video/52-02/301', artwork: art, releaseDate: '2022-02-01' } },
      ] }],
      ['playlistItems', { items: [
        { snippet: { title: 'Chaos of Zen - 52.02', resourceId: { videoId: 'YT2' } } },
        { snippet: { title: 'Chaos of Zen - 52.23', resourceId: { videoId: 'YT23' } } },
      ] }],
    ]);

    const res = await runSync({ fetchJson, appleToken: 't', youtubeKey: 'k',
      artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

    expect(res.changed).toBe(true);
    expect(res.music.albums.map((a) => a.title)).toEqual(['A1', 'A2']);       // A2 added
    expect(res.music.musicVideos.map((v) => v.title)).toEqual(['52.01', '52.02']); // 52.02 added, sorted
    const v2 = res.music.musicVideos.find((v) => v.title === '52.02');
    expect(v2.youtubeUrl).toBe('https://youtube.com/watch?v=YT2');            // matched
    expect(res.summary).toContain('52.23');                                    // youtube-only flagged
  });

  it('does not add an entry to a different collection when Apple misclassifies an id already curated elsewhere', async () => {
    const music = {
      artist: { name: 'Chaos of Zen' },
      albums: [],
      singles: [{ title: 'S200', type: 'single', appleMusicUrl: 'https://music.apple.com/us/album/s/200' }],
      musicVideos: [],
    };
    const art = { url: 'https://img/{w}x{h}bb.jpg' };
    const fetchJson = makeFetch([
      ['/artists/424257434?views', { data: [{ views: {
        'full-albums': { data: [
          // Apple misclassifies id 200 (curated as a single) as a full album:
          { attributes: { name: 'S200', url: 'https://music.apple.com/us/album/s/200', artwork: art, releaseDate: '2021', trackCount: 1 } },
          { attributes: { name: 'A101', url: 'https://music.apple.com/us/album/a/101', artwork: art, releaseDate: '2015', trackCount: 7 } },
        ] },
        singles: { data: [] },
      } }] }],
      ['/music-videos', { data: [] }],
      ['playlistItems', { items: [] }],
    ]);

    const res = await runSync({ fetchJson, appleToken: 't', youtubeKey: 'k',
      artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

    expect(res.music.albums.map((a) => extractAppleId(a.appleMusicUrl))).toEqual(['101']); // only the genuinely new album is added
    const allIds = [...res.music.albums, ...res.music.singles, ...res.music.musicVideos].map((e) => extractAppleId(e.appleMusicUrl));
    expect(new Set(allIds).size).toBe(allIds.length); // no Apple id appears in more than one collection
  });

  it('dedupes the summary too: a cross-collection-only duplicate reports no new additions and changed stays false', async () => {
    const music = {
      artist: { name: 'Chaos of Zen' },
      albums: [],
      singles: [{ title: 'S200', type: 'single', appleMusicUrl: 'https://music.apple.com/us/album/s/200' }],
      musicVideos: [],
    };
    const art = { url: 'https://img/{w}x{h}bb.jpg' };
    const fetchJson = makeFetch([
      ['/artists/424257434?views', { data: [{ views: {
        'full-albums': { data: [
          // Apple misclassifies id 200 (curated as a single) as a full album; not genuinely new anywhere:
          { attributes: { name: 'S200', url: 'https://music.apple.com/us/album/s/200', artwork: art, releaseDate: '2021', trackCount: 1 } },
        ] },
        singles: { data: [] },
      } }] }],
      ['/music-videos', { data: [] }],
      ['playlistItems', { items: [] }],
    ]);

    const res = await runSync({ fetchJson, appleToken: 't', youtubeKey: 'k',
      artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

    expect(res.changed).toBe(false);
    expect(res.summary).not.toContain('New albums'); // summary must agree with the deduped data, not the raw reconcile
  });

  it('follows the artist views next cursor so singles past the 10-item view cap are seen', async () => {
    // Reproduces run 30773815403: views.singles caps at 10 and advertises a next href.
    const music = { artist: {}, albums: [], singles: [], musicVideos: [] };
    const art = { url: 'https://img/{w}x{h}bb.jpg' };
    const single = (n) => ({ attributes: { name: `52.${String(n).padStart(2, '0')}`, url: `https://music.apple.com/us/album/s/${200 + n}`, artwork: art, releaseDate: '2021' } });
    const fetchJson = makeFetch([
      ['view/singles?offset=20', { data: [single(21)] }],                                                  // last page, no next
      ['view/singles?offset=10', { data: Array.from({ length: 10 }, (_, i) => single(11 + i)), next: '/v1/catalog/us/artists/424257434/view/singles?offset=20' }],
      ['/artists/424257434?views', { data: [{ views: {
        'full-albums': { data: [] },
        singles: {
          data: Array.from({ length: 10 }, (_, i) => single(1 + i)),
          next: '/v1/catalog/us/artists/424257434/view/singles?offset=10',
        },
      } }] }],
      ['/music-videos', { data: [] }],
      ['playlistItems', { items: [] }],
    ]);

    const res = await runSync({ fetchJson, appleToken: 't', youtubeKey: 'k',
      artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

    expect(res.music.singles).toHaveLength(21);                       // 10 + 10 + 1, not just the first page
    expect(res.summary).toContain('- Singles: Apple returned 21');    // and no under-read warning
    expect(res.summary).toContain('singles: 3 page(s)');
  });

  it('follows the next cursor for full-albums too, so a third album is not silently truncated', async () => {
    const music = { artist: {}, albums: [], singles: [], musicVideos: [] };
    const art = { url: 'https://img/{w}x{h}bb.jpg' };
    const album = (n) => ({ attributes: { name: `A${n}`, url: `https://music.apple.com/us/album/a/${100 + n}`, artwork: art, releaseDate: '2014', trackCount: 5 } });
    const fetchJson = makeFetch([
      ['view/full-albums?offset=10', { data: [album(11)] }],
      ['/artists/424257434?views', { data: [{ views: {
        'full-albums': {
          data: Array.from({ length: 10 }, (_, i) => album(1 + i)),
          next: '/v1/catalog/us/artists/424257434/view/full-albums?offset=10',
        },
        singles: { data: [] },
      } }] }],
      ['/music-videos', { data: [] }],
      ['playlistItems', { items: [] }],
    ]);

    const res = await runSync({ fetchJson, appleToken: 't', youtubeKey: 'k',
      artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

    expect(res.music.albums).toHaveLength(11);
    expect(res.summary).toContain('- Albums: Apple returned 11');
  });

  it('attributes coverage and orphans per collection when Apple under-reads the video catalogue', async () => {
    // Mirrors run 30673843138: Apple returns 1 of the 2 curated videos, albums/singles complete.
    const music = {
      artist: { name: 'Chaos of Zen' },
      albums: [{ title: 'A1', appleMusicUrl: 'https://music.apple.com/us/album/a/100' }],
      singles: [{ title: 'S1', type: 'single', appleMusicUrl: 'https://music.apple.com/us/album/s/200' }],
      musicVideos: [
        { title: '52.01', type: 'video', appleMusicUrl: 'https://music.apple.com/us/music-video/52-01/300' },
        { title: '52.02', type: 'video', appleMusicUrl: 'https://music.apple.com/us/music-video/52-02/301' },
      ],
    };
    const art = { url: 'https://img/{w}x{h}bb.jpg' };
    const fetchJson = makeFetch([
      ['/artists/424257434?views', { data: [{ views: {
        'full-albums': { data: [
          { attributes: { name: 'A1', url: 'https://music.apple.com/us/album/a/100', artwork: art, releaseDate: '2014', trackCount: 5 } },
        ] },
        singles: { data: [
          { attributes: { name: 'S1', url: 'https://music.apple.com/us/album/s/200', artwork: art, releaseDate: '2021' } },
        ] },
      } }] }],
      ['/music-videos', { data: [
        { attributes: { name: '52.01', url: 'https://music.apple.com/us/music-video/52-01/300', artwork: art, releaseDate: '2022-01-01' } },
      ] }],
      ['playlistItems', { items: [] }],
    ]);

    const res = await runSync({ fetchJson, appleToken: 't', youtubeKey: 'k',
      artistId: '424257434', uploadsPlaylistId: 'UU36M5xtxSc9S2bw4NgSM_zA', music });

    expect(res.changed).toBe(false);
    // the shortfall is attributed to videos, and albums/singles are shown as complete
    expect(res.summary).toContain('- ⚠ Videos: Apple returned 1, music.json has 2, matched 1, unmatched 1');
    expect(res.summary).toContain('- Albums: Apple returned 1, music.json has 1, matched 1, unmatched 0');
    expect(res.summary).toContain('- Singles: Apple returned 1, music.json has 1, matched 1, unmatched 0');
    // orphans are attributed to their collection rather than pooled into one list
    expect(res.summary).toContain('Videos in music.json but not in the Apple API');
    expect(res.summary).not.toContain('Albums in music.json but not in the Apple API');
    // page counts distinguish "one short page" from "pagination stopped early"
    expect(res.summary).toContain('music-videos: 1 page(s)');
  });
});
