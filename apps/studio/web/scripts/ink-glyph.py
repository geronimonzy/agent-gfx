# Text-centring check, step 2: per-glyph centring of real elements (from scripts/ink-real.mjs crops at 4x):
# baseline = most common glyph bottom; top = highest glyph top among glyphs sitting on the baseline.
import json
from collections import Counter
from PIL import Image
S = 4
for r in json.load(open('/tmp/real-index.json')):
    if 'err' in r: print(f"{r['name']:24s} {r['err']}"); continue
    im = Image.open(r['file']).convert('RGB'); W, H = im.size; px = im.load()
    bt, bb = round(r['bt'] * S), round(r['bb'] * S)
    bg = Counter(px[x, H // 2] for x in range(W)).most_common(1)[0][0]  # dominant colour on the middle row
    d = lambda a, b: sum(abs(x - y) for x, y in zip(a, b))
    inkcol = lambda x: [y for y in range(bt + 1, H - bb - 1) if d(px[x, y], bg) > 200]
    xmax = int(W * 0.5) if 'menu' in r['name'] else W - 6
    cols = [(x, inkcol(x)) for x in range(6, xmax)]
    runs, cur = [], []
    for x, ys in cols:
        if ys: cur.append((x, ys))
        elif cur: runs.append(cur); cur = []
    if cur: runs.append(cur)
    gl = []
    for run in runs:
        ys = [y for _, c in run for y in c]
        gl.append((min(ys), max(ys), len(run)))
    gl = [g for g in gl if g[1] - g[0] > 6]  # skip specks
    if not gl: print(f"{r['name']:24s} no glyphs"); continue
    top = min(g[0] for g in gl)
    tall = [g for g in gl if g[0] - top <= 2]  # capitals / ascenders: they stand on the baseline
    base = Counter(g[1] for g in tall).most_common(1)[0][0]
    above = (top - bt) / S
    below = (H - bb - 1 - base) / S
    print(f"{r['name']:24s} h={H/S:5.1f}  above caps={above:5.2f}  below baseline={below:5.2f}  -> {'HIGH' if below>above else 'LOW'} by {abs(below-above)/2:4.2f}px  (glyphs {len(gl)})")
