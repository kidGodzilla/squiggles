#!/bin/bash
# Draws the lead's current look in a rounded square (assets/icon.html) and writes every app icon from it into <data>/icons:
# icon-180|192|512.png (full bleed), favicon-64.png and logo-64.png (face crop, reads at small sizes), and Squiggles.app's icns if installed.
# The server runs it when the lead's look or the room's characters change, and serves these over the shipped ui/ ones; install-app.sh runs it too.
# OUT=<dir> writes the PNGs there instead (used to draw the shipped defaults).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "no Chrome, icons unchanged"; exit 0; }
DATA="$(cd "$ROOT" && node --input-type=module -e "import { dataDir } from './config.mjs'; console.log(dataDir())")"
OUT="${OUT:-$DATA/icons}"
HASH="$(node -e '
const fs = require("fs"), p = require("path"), r = process.argv[1], d = p.join(r, "squiggles");
let gen = "cast"; try { gen = JSON.parse(fs.readFileSync(p.join(r, "room.json"))).characters || gen; } catch {}
let s = {}; try { for (const f of fs.readdirSync(d)) { try { const j = JSON.parse(fs.readFileSync(p.join(d, f, "squiggle.json"))); if (j.lead) { s = { ...j, id: f }; break; } } catch {} } } catch {}
const q = new URLSearchParams({ gen, id: s.id || "lead", look: s.look || "" }); if (s.lookSeed != null && s.lookSeed !== "") q.set("seed", s.lookSeed);
console.log(q.toString());' "$DATA")"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$TMP/p" --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot="$TMP/$1.png" "file://$ROOT/assets/icon.html#$HASH$2" >/dev/null 2>&1 || true; }
shot mac ""; shot full "&full"; shot face "&face"; shot facefull "&face&full"
[ -f "$TMP/mac.png" ] && [ -f "$TMP/full.png" ] && [ -f "$TMP/face.png" ] && [ -f "$TMP/facefull.png" ] || { echo "render failed, icons unchanged"; exit 1; }
mkdir -p "$OUT"
for s in 180 192 512; do sips -z $s $s "$TMP/full.png" --out "$OUT/icon-$s.png" >/dev/null; done
sips -z 64 64 "$TMP/facefull.png" --out "$OUT/logo-64.png" >/dev/null
sips -z 64 64 "$TMP/face.png" --out "$OUT/favicon-64.png" >/dev/null
APP="$HOME/Applications/Squiggles.app"
# Only the workspace the app runs (install-app.sh records it) repaints the app icon, never a test one.
if [ -z "${SKIP_APP:-}" ] && [ "$(cat "$APP/Contents/Resources/data-dir" 2>/dev/null)" = "$DATA" ]; then
  mkdir -p "$TMP/Squiggles.iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/mac.png" --out "$TMP/Squiggles.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$TMP/mac.png" --out "$TMP/Squiggles.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$TMP/Squiggles.iconset" -o "$APP/Contents/Resources/Squiggles.icns" && touch "$APP"
fi
echo "icons drawn: $HASH"
