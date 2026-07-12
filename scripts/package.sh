#!/bin/sh
# Build the Chrome Web Store upload zip from the extension sources.
set -eu
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="readease-v$VERSION.zip"
rm -f "$OUT"
zip -q "$OUT" \
  manifest.json \
  background.js content.js content.css \
  popup.html popup.css popup.js \
  icons/icon16.png icons/icon48.png icons/icon128.png
echo "built $OUT"
unzip -l "$OUT"
