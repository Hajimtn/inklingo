"""List the UI strings that need an English translation (keys of public/js/i18n/en.js).

    python3 tools/i18n_keys.py            # keys missing from en.js
    python3 tools/i18n_keys.py --all      # every key

Keys: the first argument of tr('…') in the browser code, plus texts the server sends as finished
Vietnamese (game-core.js, quiz-core.js, server/*.js) that the client passes through tServer().
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VI = re.compile(r'[\u00C0-\u024F\u1E00-\u1EFF]')
SQ = r"'((?:[^'\\\n]|\\.)*)'"


def keys():
    out = []
    for f in sorted((ROOT / 'public/js').glob('**/*.js')):
        if '/i18n/' in str(f):
            continue
        s = f.read_text()
        out += [m.group(1).replace("\\'", "'") for m in re.finditer(r"(?<![\w.$])tr\(" + SQ, s)]
    # finished texts from shared/server code (plain literals without ${…})
    for f in [ROOT / 'public/js/shared/game-core.js', ROOT / 'public/js/shared/quiz-core.js', *sorted((ROOT / 'server').glob('*.js'))]:
        s = re.sub(r'//[^\n]*', '', f.read_text())
        out += [m.group(1).replace("\\'", "'") for m in re.finditer(SQ, s) if VI.search(m.group(1))]
    seen, uniq = set(), []
    for k in out:
        if k not in seen:
            seen.add(k)
            uniq.append(k)
    return uniq


def en_keys():
    js = (ROOT / 'public/js/i18n/en.js').read_text()
    code = "import('" + str(ROOT / 'public/js/i18n/en.js') + "').then(m => console.log(JSON.stringify(Object.keys(m.default))))"
    return set(json.loads(subprocess.check_output(['node', '-e', code], text=True)))


if __name__ == '__main__':
    ks = keys()
    have = en_keys()
    show = ks if '--all' in sys.argv else [k for k in ks if k not in have]
    for k in show:
        print(json.dumps(k, ensure_ascii=False))
    print(f'# {len(ks)} keys, {len([k for k in ks if k not in have])} missing', file=sys.stderr)
