// Génère les icônes PNG de l'extension (le manifeste Chrome n'accepte pas le SVG) et le logo de l'interface
// à partir de branding/logo-original.png (nécessite Python 3 + Pillow). Les fichiers générés sont déjà fournis.
import { execFileSync } from 'node:child_process';
const py = `
from PIL import Image
import os
src = Image.open('branding/logo-original.png').convert('RGBA')
# nettoie le halo quasi transparent des bords, rogne, puis centre dans un carré avec une petite marge
src.putdata([(r, g, b, 0 if a < 24 else a) for r, g, b, a in src.getdata()])
src = src.crop(src.getbbox())
side = int(max(src.size) * 1.08)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(src, ((side - src.width) // 2, (side - src.height) // 2), src)
os.makedirs('public/icons', exist_ok=True)
for n in (16, 32, 48, 128):
    sq.resize((n, n), Image.LANCZOS).save(f'public/icons/icon-{n}.png')
sq.resize((160, 160), Image.LANCZOS).save('public/logo.png')
`;
execFileSync('python3', ['-c', py], { stdio: 'inherit' });
