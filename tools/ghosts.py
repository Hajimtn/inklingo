"""Hand-drawn line-art templates for Ghost Sketch.

Sources live in tools/ghost_src/<topic>.txt: a line "=== <word-id>" starts a drawing, the lines
after it are the SVG body (paths, lines, circles…) in a 1600×1000 box. Keep the object roughly
inside x 200–1400, y 120–880 so it fits the canvas with a margin.

    python3 tools/ghosts.py build                 # every source -> public/data/ghosts/<id>.svg
    python3 tools/ghosts.py sheet <topic>         # contact sheets tools/cache/sheets/g_<topic>_<k>.jpg
    python3 tools/ghosts.py missing               # words in vocab.json without a template
    python3 tools/ghosts.py put <topic> <id> < body.txt   # replace (or add) one drawing in a source file
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'ghost_src'
OUT = ROOT / 'public' / 'data' / 'ghosts'
CACHE = ROOT / 'tools' / 'cache'
HEAD = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" fill="none" stroke="#222" '
        'stroke-width="9" stroke-linecap="round" stroke-linejoin="round">\n')


def sources(topic=None):
    files = [SRC / f'{topic}.txt'] if topic else sorted(SRC.glob('*.txt'))
    out = {}
    for f in files:
        cur = None
        for line in f.read_text().splitlines():
            if line.startswith('=== '):
                cur = line[4:].strip()
                out[cur] = []
            elif cur and line.strip() and not line.lstrip().startswith('#'):
                out[cur].append('  ' + line.strip())
    return out


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    srcs = sources()
    for wid, body in srcs.items():
        (OUT / f'{wid}.svg').write_text(HEAD + '\n'.join(body) + '\n</svg>\n')
    print(len(srcs), 'templates')


def sheet(topic):
    from PIL import Image, ImageDraw, ImageFont
    build()
    ids = list(sources(topic))
    thumbs = CACHE / 'ghost_thumbs'
    thumbs.mkdir(parents=True, exist_ok=True)
    subprocess.run(['qlmanage', '-t', '-s', '480', '-o', str(thumbs), *[str(OUT / f'{i}.svg') for i in ids]],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    font = ImageFont.load_default(size=20)
    cw, ch, cols, per = 400, 270, 4, 12
    (CACHE / 'sheets').mkdir(parents=True, exist_ok=True)
    for s in range(0, len(ids), per):
        chunk = ids[s:s + per]
        rows = (len(chunk) + cols - 1) // cols
        img = Image.new('RGB', (cols * cw, rows * ch), 'white')
        dr = ImageDraw.Draw(img)
        for n, wid in enumerate(chunk):
            x, y = (n % cols) * cw, (n // cols) * ch
            try:
                im = Image.open(thumbs / f'{wid}.svg.png').convert('RGB')
                im.thumbnail((cw - 10, ch - 34))
                img.paste(im, (x + 5, y + 30))
            except FileNotFoundError:
                dr.text((x + 10, y + 120), 'RENDER FAILED', fill='red', font=font)
            dr.rectangle([x, y, x + cw - 1, y + ch - 1], outline='#ccc')
            dr.text((x + 8, y + 5), wid, fill='#c00', font=font)
        p = CACHE / 'sheets' / f'g_{topic}_{s // per}.jpg'
        img.save(p, quality=85)
        print(p.name)


def put(topic, wid, body):
    f = SRC / f'{topic}.txt'
    lines = f.read_text().splitlines() if f.exists() else []
    out, skip, done = [], False, False
    for line in lines:
        if line.startswith('=== '):
            skip = line[4:].strip() == wid
            if skip:
                out += [line, *body.strip().splitlines(), '']
                done = True
                continue
        if not skip:
            out.append(line)
    if not done:
        out += ['', f'=== {wid}', *body.strip().splitlines()]
    f.write_text('\n'.join(out).strip() + '\n')


def missing():
    v = json.loads((ROOT / 'public' / 'data' / 'vocab.json').read_text())
    have = {p.stem for p in OUT.glob('*.svg')}
    for t in v['topics']:
        m = [w['id'] for w in t['words'] if w['id'] not in have]
        print(t['id'], len(t['words']) - len(m), '/', len(t['words']), ' '.join(m))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'build':
        build()
    elif cmd == 'sheet':
        sheet(sys.argv[2])
    elif cmd == 'missing':
        missing()
    elif cmd == 'put':
        put(sys.argv[2], sys.argv[3], sys.stdin.read())
