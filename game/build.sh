#!/usr/bin/env bash
# Builds a compact deployable bundle into dist/: minified index.html + gzip'd JS bundle
# loaded through a tiny inline loader (DecompressionStream). Requires: npm i terser html-minifier-terser
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/js
npx terser js/noise.js js/blocks.js js/world.js js/gl.js js/audio.js js/main.js js/app.js --compress --mangle -o dist/js/game.min.js
gzip -9 -n dist/js/game.min.js
python3 - <<'PY'
import re
s = open('index.html').read()
s = re.sub(r'<script src="js/[a-z]+\.js"></script>\n', '', s)
loader = '''<script>
(async()=>{try{const r=await fetch('js/game.min.js.gz?v=1');if(!r.ok)throw new Error('HTTP '+r.status);let buf=await r.arrayBuffer();const u=new Uint8Array(buf);if(u[0]===0x1f&&u[1]===0x8b){const s=new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));buf=await new Response(s).arrayBuffer();}const el=document.createElement('script');el.textContent=new TextDecoder().decode(buf);document.body.appendChild(el);}catch(e){const n=document.getElementById('nogl');n.style.display='block';n.textContent='Failed to load the game: '+e;}})();
</script>
</body>'''
open('dist/index.src.html', 'w').write(s.replace('</body>', loader))
PY
npx html-minifier-terser dist/index.src.html --collapse-whitespace --minify-css true --remove-comments -o dist/index.html
rm dist/index.src.html
ls -la dist dist/js
