"""Convert the vocabulary photos to WebP (smaller on phones) and point images.json at them.

    python3 tools/to_webp.py          # public/img/w/*.jpg -> .webp (max 640 px, quality 78), JPEGs removed

`curate_images.py finalize` already writes WebP for new photos; this converts older ones.
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / 'public' / 'img' / 'w'
DATA = ROOT / 'public' / 'data' / 'images.json'
MAX_W, QUALITY = 640, 78


def to_webp(src: Path) -> Path:
    dst = src.with_suffix('.webp')
    im = Image.open(src).convert('RGB')
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=QUALITY, method=6)
    return dst


def main():
    images = json.loads(DATA.read_text())
    before = after = 0
    for entries in images.values():
        for e in entries:
            src = ROOT / 'public' / e['file']
            if src.suffix == '.webp':
                continue
            dst = to_webp(src)
            before += src.stat().st_size
            after += dst.stat().st_size
            e['file'] = 'img/w/' + dst.name
    DATA.write_text(json.dumps(images, indent=1, ensure_ascii=False))
    used = {Path(e['file']).name for v in images.values() for e in v}
    for f in IMG.glob('*.jpg'):
        if f.with_suffix('.webp').name in used or f.name not in used:
            f.unlink()
    print(f'{before / 1e6:.1f} MB JPEG -> {after / 1e6:.1f} MB WebP')


if __name__ == '__main__':
    main()
