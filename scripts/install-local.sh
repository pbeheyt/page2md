#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="${PAGE2MD_EXT_DIR:-$HOME/.local/share/browser-extensions/page2md}"
VERSION="$(node -p "require('./package.json').version")"

npm run build
npm run zip:firefox

mkdir -p "$EXT_DIR"
rm -rf "$EXT_DIR/chrome" "$EXT_DIR/firefox"
cp -r .output/chrome-mv3 "$EXT_DIR/chrome"
cp -r .output/firefox-mv2 "$EXT_DIR/firefox"
cp ".output/page2md-${VERSION}-firefox.zip" "$EXT_DIR/page2md.xpi"
