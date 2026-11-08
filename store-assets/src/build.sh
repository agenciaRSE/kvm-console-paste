#!/usr/bin/env bash
# Renders the Chrome Web Store graphics from shot.html at their exact sizes.
# Needs: python, agent-browser. Run from anywhere: bash store-assets/src/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=store-assets
PORT=8765

python -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; agent-browser close >/dev/null 2>&1 || true' EXIT
sleep 1

render() { # scene lang width height file wait-seconds
  agent-browser set viewport "$3" "$4" >/dev/null
  agent-browser open "http://127.0.0.1:$PORT/store-assets/src/shot.html?scene=$1&lang=$2" >/dev/null
  sleep "$6"
  agent-browser screenshot "$OUT/$5" >/dev/null
  echo "  $5"
}

for lang in en es; do
  render 1 "$lang" 1280 800 "screenshot-1-paste-$lang.png" 2
  render 2 "$lang" 1280 800 "screenshot-2-confirm-$lang.png" 2
  render 3 "$lang" 1280 800 "screenshot-3-progress-$lang.png" 5
  render 4 "$lang" 1280 800 "screenshot-4-sites-$lang.png" 2
  render tile "$lang" 440 280 "promo-tile-440x280-$lang.png" 1
  render marquee "$lang" 1400 560 "marquee-1400x560-$lang.png" 2
done

# Store icon: 96x96 artwork centred in 128x128 transparent (Chrome icon guidelines).
python - <<'PY'
from PIL import Image
src = Image.open('icons/icon128.png').convert('RGBA').resize((96, 96), Image.LANCZOS)
icon = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
icon.paste(src, (16, 16), src)
icon.save('store-assets/store-icon-128x128.png')
for name in ['store-icon-128x128.png']:
    print('  ' + name)
PY

# Every file must be a real PNG of the size the store expects.
python - <<'PY'
import glob, re
from PIL import Image
sizes = {'screenshot': (1280, 800), 'promo-tile': (440, 280), 'marquee': (1400, 560), 'store-icon': (128, 128)}
for f in sorted(glob.glob('store-assets/*.png')):
    im = Image.open(f)
    want = next(v for k, v in sizes.items() if k in f)
    assert im.format == 'PNG' and im.size == want, (f, im.format, im.size)
print('sizes OK')
PY
