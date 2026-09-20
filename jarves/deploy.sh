#!/usr/bin/env bash
#
# Ships the app to Cloudflare Pages.
#
# Builds a clean dist/ with only the files the browser needs — the worker
# source and the test suites stay off the public URL — then deploys that.
#
#   ./deploy.sh
#
set -euo pipefail

PROJECT="${1:-jarves}"

rm -rf dist
mkdir -p dist
cp -r index.html manifest.webmanifest sw.js css js icons dist/

echo "dist/ built:"
find dist -type f | sort | sed 's/^/  /'

wrangler pages deploy dist --project-name="$PROJECT"
