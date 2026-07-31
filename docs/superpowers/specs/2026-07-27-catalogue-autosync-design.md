# Catalogue auto-sync → PR — design

## Goal

Give the site an on-demand way to keep `public/data/music.json` current with the
"Chaos of Zen" catalogue, without hand-editing. A maintainer clicks **Run
workflow** in GitHub Actions; the job reconciles the live Apple Music + YouTube
catalogue against `music.json` and, if anything is new, opens a **pull request**
with the additions for review. Merging the PR ships through the normal CI/deploy
path.

The current `music.json` was assembled by hand this cycle (2 albums, 54 singles,
51 music videos). This feature removes the manual step for future releases.

## Non-goals (v1)

- **No cron.** Trigger is `workflow_dispatch` (manual) only.
- **No deletion or field-level rewrite of existing entries.** The sync is
  strictly additive; it never mutates or reorders curated entries (see Merge
  semantics). Entries that have disappeared from the APIs are *reported*, not
  removed.
- **Artist block is not synced.** `artist` (name, bio, `appleMusicUrl`,
  `youtubeUrl`, `spotifyUrl`) is hand-curated — left untouched.
- **Spotify is out.** Apple covers albums/singles; Spotify only adds a redundant
  non-Apple URL and no video data. Deferred.
- **No webhook/push.** None of the three platforms offers a usable webhook for a
  static site; this is a poll-on-demand design by construction.

## Architecture

Two files, both in the repo:

1. **`scripts/sync-catalogue.mjs`** — a Node script (repo is Node 20+, native
   `fetch`). Pulls the current catalogue from the Apple Music API and YouTube
   Data API, diffs against `public/data/music.json`, writes additions back, and
   prints a human-readable summary (used as the PR body). Split into a thin I/O
   layer and pure, unit-testable core functions.

2. **`.github/workflows/sync-catalogue.yml`** — `on: workflow_dispatch`. Runs
   the script with the four secrets as env vars; if `music.json` changed, opens
   (or updates) a PR using the built-in `gh` CLI + `GITHUB_TOKEN` — no
   third-party action.

## Sources & auth

Both are headless (no interactive OAuth), keyed entirely by repo secrets.

### Apple Music API (official; paid Apple Developer Program)

- Base `https://api.music.apple.com/v1/catalog/us/artists/424257434`.
- `?views=full-albums,singles` for albums + singles; `/music-videos`
  relationship (paged) for videos.
- **Developer token:** ES256 JWT built at runtime with `node:crypto` (no new
  dependency): header `{alg:"ES256", kid: APPLE_MUSIC_KEY_ID}`, payload
  `{iss: APPLE_MUSIC_TEAM_ID, iat: now, exp: now+1200}` (20-min lifetime),
  signed with the `.p8` EC private key. Sent as `Authorization: Bearer <jwt>`.
- Read-only catalog access needs the developer token only (no user token).

### YouTube Data API v3

- `GET /youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=UU36M5xtxSc9S2bw4NgSM_zA&maxResults=50&key=$YOUTUBE_API_KEY`,
  paging via `pageToken`. `UU36M5xtxSc9S2bw4NgSM_zA` is the uploads playlist of
  the Vevo channel `UC36M5xtxSc9S2bw4NgSM_zA`. 1 quota unit/call.
- Simple API key, no OAuth. Used only to supply per-video `youtubeUrl`.

## Data model (recap)

`music.json`: `{ artist, albums[], musicVideos[], singles[] }`.
`Release` = `{ title, type: 'single'|'ep'|'video', year, artworkUrl,
appleMusicUrl, youtubeUrl? }`. `Album` = `{ title, year, trackCount, artworkUrl,
appleMusicUrl }`. `youtubeUrl` is optional (some videos have none).

## Merge semantics — additive, non-destructive

The reconciliation key for every entry is its **Apple catalogue numeric ID**,
extracted from `appleMusicUrl` (`.../music-video/<slug>/<id>` or
`.../album/<slug>/<id>`).

For each collection (albums, singles, musicVideos):

1. Build the set of existing IDs from `music.json`.
2. For each item the Apple API returns:
   - **Already present** (ID matches) → **skip**, leave the curated entry exactly
     as-is (title, artwork, ordering, any manual `youtubeUrl`).
   - **Missing** → build a new entry from API fields and **add** it.
3. Items present in `music.json` but **absent** from the API are **not touched**;
   their titles are collected into the PR body under "present locally but not in
   the API — review."

New videos are inserted in `52.xx` order. New albums/singles are appended after
the existing list (order otherwise preserved). The file is written with 2-space
indentation and a trailing newline to match the current formatting and keep the
diff minimal. `music.json` is a tracked file inside the gitignored
`public/data/`, so the workflow stages it with `git add -f`.

## Field mapping (new entries)

- **Video:** `title` = Apple `attributes.name`; `appleMusicUrl` = Apple
  `attributes.url`; `artworkUrl` = Apple `artwork.url` template filled to
  `1200x1200`; `year` = year of `attributes.releaseDate`; `youtubeUrl` = YouTube
  match by number (below), omitted if none.
- **Album:** `title`, `year`, `artworkUrl` (1200×1200), `appleMusicUrl` as above;
  `trackCount` = `attributes.trackCount`.
- **Single:** same as album minus `trackCount`, `type: 'single'`.

## Video ↔ YouTube matching

Each Apple video title contains a `52.xx` number (regex `52\.(\d{2})`). The
YouTube uploads are titled `Chaos of Zen - 52.xx`; extract the same number.
Build `num → https://youtube.com/watch?v=<id>`. A new Apple video's
`youtubeUrl` is the map entry for its number, or omitted if absent.

### Mismatch handling (automatic)

- **Apple video, no YouTube match** (e.g. 52.29 historically) → added with no
  `youtubeUrl`.
- **YouTube video, no Apple release** (e.g. 52.23) → **not** added (no
  `appleMusicUrl` to anchor a schema-valid entry) but listed in the PR body as
  "on YouTube, awaiting Apple Music."

## Workflow

```yaml
on: { workflow_dispatch: {} }
```

Steps: checkout → setup-node → `node scripts/sync-catalogue.mjs` (secrets in
env, summary written to a file) → if `git status` shows `music.json` changed:
create branch `autosync/catalogue-<run-id>`, `git add -f public/data/music.json`,
commit, and `gh pr create` with the script's summary as the body. If nothing
changed, the job succeeds with "catalogue already up to date" and opens no PR.
`GITHUB_TOKEN` needs `contents: write` + `pull-requests: write`.

## Secrets (maintainer-provisioned; never handled by the agent)

`APPLE_MUSIC_PRIVATE_KEY` (`.p8` contents), `APPLE_MUSIC_KEY_ID`,
`APPLE_MUSIC_TEAM_ID`, `YOUTUBE_API_KEY`. Added under repo Settings → Secrets and
variables → Actions.

## Testing

- **Unit tests (vitest, runs in CI/`npm test`)** cover the pure core, with no
  network: JWT header/payload construction (structure + fields, not a real
  signature verification against Apple), `52.xx` number extraction, the diff
  (given a fake API result set + a fake `music.json`, assert the correct
  additions / skips / orphan report), entry-building field mapping, video
  insertion order, and byte-exact formatting (2-space + trailing newline).
- **Live API + JWT signature + PR creation** are exercised only when the
  workflow runs with real secrets. This cannot be verified from the dev machine
  (no `.p8`); the first manual run is the integration test. The PR body and the
  workflow log will make any failure explicit.

## Verification limitations (called out honestly)

Until the maintainer adds the four secrets and runs the workflow once, the
end-to-end path (real Apple/YouTube responses, real ES256 signature acceptance,
real PR creation) is unverified. The additive merge semantics bound the blast
radius: a bad run can only *propose* additions in a PR a human reviews — it never
edits existing entries or pushes to `main`.

## Future (not now)

Field-level reconciliation of existing entries; Spotify cross-check; a scheduled
cron once the manual run is trusted; auto-adding YouTube-only videos if the
schema gains an Apple-optional video type.
