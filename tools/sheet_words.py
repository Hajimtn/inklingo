"""Contact sheet for specific words, all candidates (up to 8): python3 tools/sheet_words.py name w1 w2 ..."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
C = Path(__file__).resolve().parent / 'cache'
d = json.load(open(C / 'candidates.json'))
font = ImageFont.load_default(size=14)
import os
OFFSET = os.environ.get("LAST") == "1"
name, words = sys.argv[1], sys.argv[2:]
cw, ch, lw, cols = 165, 125, 100, 8
for s in range(0, len(words), 8):
    chunk = words[s:s + 8]
    img = Image.new('RGB', (lw + cols * cw, len(chunk) * ch), 'white'); dr = ImageDraw.Draw(img)
    for r, w in enumerate(chunk):
        y = r * ch
        dr.text((4, y + ch // 2 - 8), w, fill='black', font=font)
        start = max(0, len(d[w]["candidates"]) - int(os.environ.get("LASTN", cols))) if OFFSET else 0
        for n in range(start, min(start + cols, len(d[w]["candidates"]))):
            try:
                im = Image.open(C / "cand" / f"{w}_{n}.jpg").convert("RGB"); im.thumbnail((cw - 6, ch - 20)); img.paste(im, (lw + (n - start) * cw, y + 2))
            except Exception:
                dr.text((lw + n * cw + 5, y + 40), 'MISSING', fill='red', font=font)
            dr.text((lw + (n - start) * cw, y + ch - 17), f"#{n}", fill="#c00", font=font)
        dr.line([(0, y + ch - 1), (img.width, y + ch - 1)], fill='#ccc')
    p = C / 'sheets' / f'{name}_{s // 8}.jpg'; img.save(p, quality=80); print(p.name)
