#!/usr/bin/env python3
"""Real-photo curation pipeline for Inklingo (Wikimedia Commons / Wikipedia).

  python3 tools/curate_images.py candidates   # gather licensed photo candidates per word
  python3 tools/curate_images.py sheets       # build labelled contact sheets for human review
  python3 tools/curate_images.py finalize     # download chosen photos + write public/data/images.json

Rules enforced automatically (a human then reviews every chosen photo on the contact sheets):
  * JPEG photographs only (no SVG/PNG/GIF drawings), width >= 600 px
  * licence must be CC0 / Public domain / CC BY / CC BY-SA (no NC/ND, no fair use)
  * files in AI-generated / illustration / painting / drawing categories are rejected
  * source page, author, licence and licence URL are stored for attribution
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / 'tools'
CACHE = TOOLS / 'cache'
CAND_DIR = CACHE / 'cand'
OUT_IMG = ROOT / 'public' / 'img' / 'w'
UA = 'InklingoCurator/1.0 (educational vocabulary prototype; non-commercial)'
COMMONS = 'https://commons.wikimedia.org/w/api.php'
WIKI = 'https://en.wikipedia.org/w/api.php'

LICENSE_OK = re.compile(r'^(cc0|public domain|pd\b|pd-|cc[ -]by(-sa)?[ -]\d(\.\d)?)', re.I)
BAD_CATS = re.compile(r'(ai[- ]generated|artificial intelligence|midjourney|dall[- ]?e|stable diffusion|generative|computer[- ]generated|'
                      r'illustration|drawing|painting|cartoon|clip ?art|diagram|logo|icon|sketch|render|3d model|caricature|poster|stamp)', re.I)
BAD_TITLE = re.compile(r'(painting|drawing|illustration|cartoon|sketch|\.svg|\.png|\.gif|\.tif|icon|logo|diagram|map\b|engraving|lithograph|poster)', re.I)
# Words whose subject is itself something the generic filters block: a photo of real posters on a wall is
# fine for "poster" (manual review still checks it is a photograph).
WORD_ALLOW = {'poster': {'poster'}}
CONCRETE = {'office', 'travel', 'hospitality', 'shopping', 'housing', 'health', 'industry', 'finance', 'media'}


def _wait(err, i):
    retry = 0
    if isinstance(err, urllib.error.HTTPError):
        try:
            retry = int(err.headers.get('Retry-After') or 0)
        except ValueError:
            retry = 0
        print(f'   HTTP {err.code}, waiting {max(retry, 5 * (i + 1) ** 2)}s', flush=True)
    time.sleep(max(retry + 2, 5 * (i + 1) ** 2))


def get(url, params, tries=8):
    q = url + '?' + urllib.parse.urlencode({**params, 'format': 'json', 'formatversion': 2, 'maxlag': 5})
    for i in range(tries):
        try:
            req = urllib.request.Request(q, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            _wait(e, i)


def download(url, dest, tries=8):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            dest.write_bytes(data)
            time.sleep(0.6)
            return len(data)
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            _wait(e, i)


def strip_html(s):
    s = re.sub(r'<[^>]+>', '', s or '')
    return html.unescape(re.sub(r'\s+', ' ', s)).strip()


def file_info(titles, thumb=240):
    """Metadata for File: titles (batched by 40)."""
    out = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        data = get(COMMONS, {
            'action': 'query', 'titles': '|'.join(chunk), 'prop': 'imageinfo|categories', 'cllimit': 'max',
            'iiprop': 'url|mime|size|extmetadata', 'iiurlwidth': thumb, 'redirects': 1,
        })
        for p in data.get('query', {}).get('pages', []):
            if 'imageinfo' not in p:
                continue
            ii = p['imageinfo'][0]
            em = ii.get('extmetadata', {})
            val = lambda k: (em.get(k) or {}).get('value', '')  # noqa: E731
            out[p['title']] = {
                'title': p['title'], 'mime': ii.get('mime'), 'width': ii.get('width'), 'height': ii.get('height'),
                'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'),
                'license': strip_html(val('LicenseShortName')), 'licenseUrl': strip_html(val('LicenseUrl')),
                'author': strip_html(val('Artist'))[:160], 'credit': strip_html(val('Credit'))[:200],
                'description': strip_html(val('ImageDescription'))[:300],
                'categories': [c['title'][9:] for c in p.get('categories', [])] + [c.strip() for c in strip_html(val('Categories')).split('|') if c.strip()],
            }
        time.sleep(0.3)
    return out


LICENSE_CAT = re.compile(r'^(CC-BY(-SA)?-[\d.]+|CC-Zero|Public domain|PD[- ])', re.I)


def _bad(regex, text, allowed):
    for m in regex.finditer(text):
        if m.group(0).lower() not in allowed:
            return m.group(0)
    return None


def acceptable(info, wid=None):
    allowed = WORD_ALLOW.get(wid, set())
    if not info or info['mime'] != 'image/jpeg':
        return 'not jpeg'
    if (info['width'] or 0) < 600:
        return 'too small'
    if not LICENSE_OK.search(info['license'] or ''):
        # Dual-licensed (e.g. GFDL + CC BY-SA): use the Creative Commons licence category.
        alt = next((c for c in info['categories'] if LICENSE_CAT.search(c)), None)
        if not alt:
            return 'license ' + (info['license'] or '?')
        m = re.match(r'CC-(BY(?:-SA)?)-([\d.]+)', alt, re.I)
        if m:
            ver = m.group(2).split(',')[0]
            info['license'] = f'CC {m.group(1).upper()} {ver}'
            info['licenseUrl'] = f'https://creativecommons.org/licenses/{m.group(1).lower()}/{ver}/'
        elif alt.lower().startswith('cc-zero'):
            info['license'], info['licenseUrl'] = 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'
        else:
            info['license'], info['licenseUrl'] = 'Public domain', ''
        info['licenseNote'] = 'dual-licensed; CC licence chosen'
    if re.search(r'\bnc\b|\bnd\b|non-?commercial|noderiv', info['license'] or '', re.I):
        return 'NC/ND licence'
    if _bad(BAD_TITLE, info['title'], allowed):
        return 'title'
    cats = ' | '.join(info['categories'])
    hit = _bad(BAD_CATS, cats, allowed)
    if hit:
        return 'category: ' + hit
    if re.search(r'\b(ai[- ]generated|generated (with|by) ai|midjourney|stable diffusion)\b', info['description'], re.I):
        return 'description mentions AI'
    return None


def search(query, limit=8, quality=False):
    s = query + ' filetype:bitmap'
    if quality:
        s += ' incategory:"Quality images"'
    data = get(COMMONS, {'action': 'query', 'list': 'search', 'srnamespace': 6, 'srlimit': limit, 'srsearch': s})
    time.sleep(0.8)
    return [r['title'] for r in data.get('query', {}).get('search', [])]


def lead_images(titles):
    out = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        data = get(WIKI, {'action': 'query', 'prop': 'pageimages', 'piprop': 'name', 'redirects': 1, 'titles': '|'.join(chunk)})
        q = data.get('query', {})
        back = {n['to']: n['from'] for n in q.get('redirects', []) + q.get('normalized', [])}
        for p in q.get('pages', []):
            if 'pageimage' in p:
                src = p['title']
                while src in back:
                    src = back[src]
                out[src] = 'File:' + p['pageimage'].replace('_', ' ')
        time.sleep(0.3)
    return out


def search_infos(query, limit=10, thumb=250):
    """One request: Commons full-text search (or 'Category:…' members) + imageinfo/categories of the hits."""
    if query.startswith('Category:'):
        gen = {'generator': 'categorymembers', 'gcmtitle': query, 'gcmtype': 'file', 'gcmlimit': limit}
    else:
        gen = {'generator': 'search', 'gsrnamespace': 6, 'gsrlimit': limit, 'gsrsearch': query + ' filetype:bitmap'}
    data = get(COMMONS, {
        'action': 'query', **gen,
        'prop': 'imageinfo|categories', 'cllimit': 'max', 'iiprop': 'url|mime|size|extmetadata', 'iiurlwidth': thumb,
    })
    time.sleep(1.5)
    pages = sorted(data.get('query', {}).get('pages', []), key=lambda p: p.get('index', 99))
    out = []
    for p in pages:
        if 'imageinfo' not in p:
            continue
        ii = p['imageinfo'][0]
        em = ii.get('extmetadata', {})
        val = lambda k: (em.get(k) or {}).get('value', '')  # noqa: E731
        out.append({
            'title': p['title'], 'mime': ii.get('mime'), 'width': ii.get('width'), 'height': ii.get('height'),
            'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'),
            'license': strip_html(val('LicenseShortName')), 'licenseUrl': strip_html(val('LicenseUrl')),
            'author': strip_html(val('Artist'))[:160], 'credit': strip_html(val('Credit'))[:200],
            'description': strip_html(val('ImageDescription'))[:300],
            'categories': [c['title'][9:] for c in p.get('categories', [])] + [c.strip() for c in strip_html(val('Categories')).split('|') if c.strip()],
        })
    return out


def cmd_candidates():
    import os
    plan = json.loads((TOOLS / 'image_queries.json').read_text())
    CAND_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE / 'candidates.json'
    result = json.loads(path.read_text()) if path.exists() else {}
    for extra in ('candidates_b.json', 'candidates_c.json'):
        ep = CACHE / extra
        if ep.exists():
            result.update(json.loads(ep.read_text()))
    only = set(sys.argv[2:])
    words = [(t, wid, spec) for t, ws in plan.items() if not t.startswith('_') for wid, spec in ws.items()
             if (not only or wid in only) and (only or wid not in result)]
    print(f'{len(words)} words to process', flush=True)
    # Phase A: lead images of the Wikipedia articles, batched.
    leads = lead_images(sorted({s['wiki'] for _, _, s in words if s.get('wiki')}))
    lead_info = file_info(sorted(set(leads.values())), thumb=250)
    for topic, wid, spec in words:
        want = 3 if topic in CONCRETE else 4
        cands, rejected, seen = [], [], set()
        lead = leads.get(spec.get('wiki'))
        if lead:
            seen.add(lead)
            why = acceptable(lead_info.get(lead))
            if why:
                rejected.append((lead, why))
            else:
                cands.append(lead_info[lead])
        # Phase B: search only when needed.
        if True:
            queries = spec.get('q', [])
            for q in (queries[:1] if topic in CONCRETE and cands else queries):
                if len(cands) >= want:
                    break
                for info in search_infos(q):
                    if info['title'] in seen:
                        continue
                    seen.add(info['title'])
                    why = acceptable(info)
                    if why:
                        rejected.append((info['title'], why))
                    elif len(cands) < want:
                        cands.append(info)
        for n, c in enumerate(cands):
            dest = CAND_DIR / f'{wid}_{n}.jpg'
            if not dest.exists() and c.get('thumb'):
                try:
                    download(c['thumb'], dest)
                except Exception as e:  # noqa: BLE001
                    print('   download failed', wid, n, e, flush=True)
                time.sleep(0.8)
        result[wid] = {'topic': topic, 'candidates': cands, 'rejected': rejected[:12]}
        print(f'{topic:13} {wid:16} {len(cands)} candidates ({len(rejected)} rejected)', flush=True)
        path.write_text(json.dumps(result, indent=1, ensure_ascii=False))
    path.write_text(json.dumps(result, indent=1, ensure_ascii=False))


def cmd_more():
    """python3 tools/curate_images.py more WORD "query" ["query" ...]  -> append up to 4 candidates"""
    path = CACHE / 'candidates.json'
    result = json.loads(path.read_text())
    wid, queries = sys.argv[2], sys.argv[3:]
    entry = result[wid]
    have = {c['title'] for c in entry['candidates']}
    added = 0
    for q in queries:
        for info in search_infos(q, limit=30 if q.startswith('Category:') else 12):
            if added >= 6 or info['title'] in have:
                continue
            why = acceptable(info, wid)
            if why:
                continue
            n = len(entry['candidates'])
            entry['candidates'].append(info)
            have.add(info['title'])
            try:
                download(info['thumb'], CAND_DIR / f'{wid}_{n}.jpg')
            except Exception as e:  # noqa: BLE001
                print('   download failed', e)
            added += 1
    path.write_text(json.dumps(result, indent=1, ensure_ascii=False))
    print(f'{wid}: +{added} (total {len(entry["candidates"])})', flush=True)


def cmd_sheets():
    from PIL import Image, ImageDraw, ImageFont
    data = json.loads((CACHE / 'candidates.json').read_text())
    sheets = CACHE / 'sheets'
    sheets.mkdir(exist_ok=True)
    font = ImageFont.load_default(size=15)
    small = ImageFont.load_default(size=11)
    cw, ch, cols = 210, 158, 6
    by_topic = {}
    for wid, d in data.items():
        by_topic.setdefault(d['topic'], []).append((wid, d))
    for topic, items in by_topic.items():
        rows_per_sheet = 8
        for s in range(0, len(items), rows_per_sheet):
            chunk = items[s:s + rows_per_sheet]
            img = Image.new('RGB', (cols * cw + 130, len(chunk) * (ch + 22)), 'white')
            dr = ImageDraw.Draw(img)
            for r, (wid, d) in enumerate(chunk):
                y = r * (ch + 22)
                dr.text((6, y + ch // 2), wid, fill='black', font=font)
                for n, c in enumerate(d['candidates'][:cols]):
                    p = CAND_DIR / f'{wid}_{n}.jpg'
                    if not p.exists():
                        continue
                    try:
                        im = Image.open(p).convert('RGB')
                    except Exception:  # noqa: BLE001
                        continue
                    im.thumbnail((cw - 8, ch - 4))
                    x = 130 + n * cw
                    img.paste(im, (x, y + 2))
                    dr.text((x, y + ch), f'#{n} {c["license"][:14]}', fill='#a00', font=small)
            out = sheets / f'{topic}_{s // rows_per_sheet}.jpg'
            img.save(out, quality=80)
            print(out)


def _webp_module():
    # loaded by path: `python3 -I` does not put tools/ on sys.path
    import importlib.util
    spec = importlib.util.spec_from_file_location('to_webp', TOOLS / 'to_webp.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cmd_finalize():
    data = json.loads((CACHE / 'candidates.json').read_text())
    choices = json.loads((TOOLS / 'image_choices.json').read_text())
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    picks = {}
    for wid, choice in choices.items():
        if wid.startswith('_'):
            continue
        titles = []
        for pick in (choice if isinstance(choice, list) else [choice]):
            titles.append(data[wid]['candidates'][pick]['title'] if isinstance(pick, int) else pick)
        picks[wid] = titles
    infos = file_info(sorted({t for ts in picks.values() for t in ts}), thumb=640)  # batched metadata
    images = {}
    for wid, titles in picks.items():
        entries = []
        for title in titles:
            full = infos.get(title)
            why = acceptable(dict(full), wid) if full else 'missing'
            if why:
                print(f'!! {wid}: {title} rejected ({why})')
                continue
            full = dict(full)
            acceptable(full)  # fills licence fields for dual-licensed files
            k = len(entries)
            name = f'{wid}.webp' if k == 0 else f'{wid}-{k + 1}.webp'
            dest = OUT_IMG / name
            if not dest.exists():
                # download the JPEG thumbnail, store it as WebP (see tools/to_webp.py)
                tmp = dest.with_suffix('.jpg')
                download(full['thumb'], tmp)
                _webp_module().to_webp(tmp)
                tmp.unlink()
            entries.append({
                'file': f'img/w/{name}', 'remote': full['thumb'], 'page': full['page'], 'title': full['title'][5:],
                'author': full['author'] or full['credit'] or 'Unknown', 'license': full['license'], 'licenseUrl': full['licenseUrl'],
                'source': 'Wikimedia Commons',
            })
        if entries:
            images[wid] = entries
        print(f'ok {wid} ({len(entries)})', flush=True)
    (ROOT / 'public' / 'data' / 'images.json').write_text(json.dumps(images, indent=1, ensure_ascii=False))
    print(len(images), 'words with verified images')


if __name__ == '__main__':
    {'candidates': cmd_candidates, 'more': cmd_more, 'sheets': cmd_sheets, 'finalize': cmd_finalize}[sys.argv[1]]()
