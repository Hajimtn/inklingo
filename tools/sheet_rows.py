"""Contact sheet, one row per word: python3 tools/sheet_rows.py topic [topic...]"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
C = Path(__file__).resolve().parent / 'cache'
d = json.load(open(C / 'candidates.json'))
font = ImageFont.load_default(size=15)
out = C / 'sheets'; out.mkdir(exist_ok=True)
for t in sys.argv[1:]:
    ws = [(w, v) for w, v in d.items() if v['topic'] == t]
    cw, ch, lw = 230, 165, 120
    for s in range(0, len(ws), 7):
        chunk = ws[s:s + 7]
        img = Image.new('RGB', (lw + 4 * cw, len(chunk) * ch), 'white'); dr = ImageDraw.Draw(img)
        for r, (w, v) in enumerate(chunk):
            y = r * ch
            dr.text((4, y + ch // 2 - 8), w, fill='black', font=font)
            for n in range(min(4, len(v['candidates']))):
                try:
                    im = Image.open(C / 'cand' / f'{w}_{n}.jpg').convert('RGB'); im.thumbnail((cw - 6, ch - 22)); img.paste(im, (lw + n * cw, y + 2))
                except Exception:
                    dr.text((lw + n * cw + 5, y + 40), 'MISSING', fill='red', font=font)
                dr.text((lw + n * cw, y + ch - 19), f'#{n}', fill='#c00', font=font)
            dr.line([(0, y + ch - 1), (img.width, y + ch - 1)], fill='#ccc')
        p = out / f'{t}_r{s // 7}.jpg'; img.save(p, quality=80); print(p)
