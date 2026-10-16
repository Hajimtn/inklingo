"""Append words written in a compact text format to content/*.json and tools/image_queries.json.

    python3 tools/add_words.py tools/new_words/*.txt

File format: a line "## <topic-id>" starts a topic; every other non-empty line is one word with
fields separated by " | ":

    id | en | alt1, alt2 | vi | ipa | pos | example EN | example VI | explain (VI) | wiki article | search query | idea1 | idea2

An idea is "scene ; element / element / … ; step / step / … [; ghost-layout]".
Existing word ids are skipped, so the script can be re-run safely.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'content'
QUERIES = ROOT / 'tools' / 'image_queries.json'
GHOSTS = {'person', 'two-people', 'group', 'before-after'}


def idea(text):
    parts = [p.strip() for p in text.split(' ; ')]
    if len(parts) < 3:
        raise ValueError(f'idea needs scene ; elements ; steps: {text!r}')
    out = {'scene': parts[0], 'elements': [e.strip() for e in parts[1].split(' / ') if e.strip()], 'steps': [s.strip() for s in parts[2].split(' / ') if s.strip()]}
    if len(parts) > 3 and parts[3]:
        if parts[3] not in GHOSTS:
            raise ValueError(f'unknown ghost layout {parts[3]!r}')
        out['ghost'] = parts[3]
    return out


def parse(path):
    topic, words = None, {}
    for n, line in enumerate(Path(path).read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#!'):
            continue
        if line.startswith('## '):
            topic = line[3:].strip()
            continue
        f = [x.strip() for x in line.split(' | ')]
        if len(f) != 13:
            raise ValueError(f'{path}:{n}: expected 13 fields, got {len(f)}')
        wid, en, alt, vi, ipa, pos, ex_en, ex_vi, explain, wiki, query, i1, i2 = f
        words.setdefault(topic, []).append({
            'word': {'id': wid, 'en': en, 'alt': [a.strip() for a in alt.split(',') if a.strip() and a.strip() not in ('—', '-')], 'vi': vi, 'ipa': ipa, 'pos': pos,
                     'ex': [ex_en, ex_vi], 'explain': explain, 'ideas': [idea(i1), idea(i2)]},
            'query': {'wiki': wiki, 'q': [query, en]} if wiki and wiki != '-' else {'q': [query, en]},
        })
    return words


J = lambda v: json.dumps(v, ensure_ascii=False)


def dump_topic(d):
    """Same layout as the hand-written files: one line per word, its ideas on the next line."""
    head = ', '.join(f'{J(k)}: {J(d[k])}' for k in d if k != 'words')
    rows = []
    for w in d['words']:
        first = ', '.join(f'{J(k)}: {J(v)}' for k, v in w.items() if k != 'ideas')
        rows.append(f'    {{{first},\n     "ideas": {J(w["ideas"])}}}')
    return '{\n  ' + head + ',\n  "words": [\n' + ',\n'.join(rows) + '\n  ]\n}\n'


def dump_queries(q):
    parts = []
    for k, v in q.items():
        if isinstance(v, dict) and all(isinstance(x, dict) for x in v.values()):
            inner = ',\n'.join(f'    {J(w)}: {J(spec)}' for w, spec in v.items())
            parts.append(f'  {J(k)}: {{\n{inner}\n  }}')
        else:
            parts.append(f'  {J(k)}: {J(v)}')
    return '{\n' + ',\n'.join(parts) + '\n}\n'


def main():
    files = {json.loads(p.read_text())['id']: p for p in sorted(CONTENT.glob('*.json'))}
    queries = json.loads(QUERIES.read_text())
    all_ids = {w['id'] for p in files.values() for w in json.loads(p.read_text())['words']}
    added = 0
    for path in sys.argv[1:]:
        for topic, items in parse(path).items():
            p = files[topic]
            data = json.loads(p.read_text())
            for it in items:
                w = it['word']
                if w['id'] in all_ids:
                    print(f'skip existing {w["id"]}')
                    continue
                data['words'].append(w)
                queries.setdefault(topic, {})[w['id']] = it['query']
                all_ids.add(w['id'])
                added += 1
            p.write_text(dump_topic(data))
    QUERIES.write_text(dump_queries(queries))
    print(f'{added} words added')


if __name__ == '__main__':
    main()
