#!/usr/bin/env bash
#
# Full content deploy to https://chaosofzen.dev/
#
# CI publishes code changes (assets/, index.html, tracked data) on every green
# push to main. Use THIS script when content changes — new artwork, a rerun
# pipeline, regenerated data/*.json — because those files are gitignored and
# only exist on a machine that has run `npm run pipeline`.
#
# Usage:
#   scripts/deploy.sh                 # build, sync, show diff, ask, push
#   scripts/deploy.sh --dry-run       # build and show what would change
#
set -euo pipefail

REPO="git@github.com:gitizenme/chaosofzen.git"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/chaosofzen-deploy"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

cd "$ROOT"

echo "==> Testing"
npm test

echo "==> Building"
npm run build

if [ ! -d dist/images ] || [ -z "$(ls -A dist/images 2>/dev/null)" ]; then
  echo "ERROR: dist/images is empty. Run 'npm run pipeline' first — a deploy" >&2
  echo "       from here would strip every image off the live site." >&2
  exit 1
fi

echo "==> Fetching deploy repo"
if [ -d "$WORK/.git" ]; then
  git -C "$WORK" fetch --depth 1 origin main
  git -C "$WORK" reset --hard origin/main
  git -C "$WORK" clean -fd
else
  rm -rf "$WORK"
  git clone --depth 1 "$REPO" "$WORK"
fi

echo "==> Syncing"
# CNAME lives only in the deploy repo and must survive; .git obviously too.
rsync -a --delete \
  --exclude='.git' --exclude='CNAME' --exclude='.DS_Store' \
  dist/ "$WORK/"

cd "$WORK"
if [ -z "$(git status --porcelain)" ]; then
  echo "==> Already up to date. Nothing to deploy."
  exit 0
fi

echo "==> Changes:"
git add -A
git status --short | head -50
CHANGED=$(git status --porcelain | wc -l | tr -d ' ')
echo "    ($CHANGED files)"

if [ "$DRY_RUN" = "1" ]; then
  echo "==> Dry run — not pushing."
  exit 0
fi

read -r -p "Push these to chaosofzen.dev? [y/N] " reply
case "$reply" in
  [yY]*) ;;
  *) echo "Aborted."; exit 1 ;;
esac

MSG="${DEPLOY_MSG:-Deploy: content update from $(git -C "$ROOT" rev-parse --short HEAD)}"
git commit -m "$MSG"
git push origin main

echo "==> Pushed. Pages build takes ~1 min:"
echo "    gh run watch -R gitizenme/chaosofzen"
