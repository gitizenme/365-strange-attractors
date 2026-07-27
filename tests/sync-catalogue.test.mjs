import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildDeveloperToken } from '../scripts/sync-catalogue.mjs';

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
