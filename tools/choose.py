"""Merge reviewed picks into tools/image_choices.json: python3 tools/choose.py 'word=0,2' 'other=1' ..."""
import json, sys
from pathlib import Path
p = Path(__file__).resolve().parent / 'image_choices.json'
d = json.loads(p.read_text())
for arg in sys.argv[1:]:
    w, v = arg.split('=', 1)
    d[w] = [int(x) if x.lstrip('-').isdigit() else x for x in v.split(',')] if v else []
    if not d[w]:
        del d[w]
p.write_text('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}\n')
print(len([k for k in d if not k.startswith('_')]), 'choices')
