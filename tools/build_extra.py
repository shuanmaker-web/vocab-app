#!/usr/bin/env python3
"""Build data/extra.json (寫作升級 + 易混淆字) from tools/extra/upgrade.txt and confuse.txt.
Additive only: touches no existing data file. Run: python3 tools/build_extra.py"""
import json, re, random, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = json.load(open(f'{ROOT}/data/gsat.json'))['words']
gidx = {}
for x in G:
    for p in x['w'].split('/'): gidx.setdefault(p.strip().lower(), x)
err = []
def die(msg): err.append(msg)

# ---------- 寫作升級 ----------
SETS = []  # {id,name,en,bases:[{base,zh,words:[...]}]}
UQ = []
cur = None; base = None
for ln, raw in enumerate(open(f'{ROOT}/tools/extra/upgrade.txt', encoding='utf-8'), 1):
    line = raw.rstrip('\n')
    if not line.strip() or line.startswith('#') and not line.startswith('##'): continue
    if line.startswith('##'):
        name, en = line[2:].strip().split('|')
        cur = {'id': 'ups%d' % (len(SETS) + 1), 'name': name, 'en': en, 'bases': []}; SETS.append(cur); base = None; continue
    if line.startswith('>'):
        b, z = line[1:].strip().split('|'); base = {'base': b, 'zh': z, 'words': []}; cur['bases'].append(base); continue
    p = line.split('|')
    if len(p) != 3 or not base: die(f'upgrade.txt:{ln} bad line: {line}'); continue
    w, zh, sent = [s.strip() for s in p]
    if sent.count('___') != 1: die(f'upgrade.txt:{ln} need exactly one ___: {sent}'); continue
    x = gidx.get(w.lower())
    base['words'].append({'w': w, 'zh': zh, 'lv': x['lv'] if x else 0, 'gsat': bool(x), 'sent': sent.replace('___', w)})
    base['words'][-1]['_raw'] = sent
ALLW = [(s['id'], bw['w']) for s in SETS for b in s['bases'] for bw in b['words']]
BLACK = set('sharp strong soft smooth rough coarse harsh shaky noisy prickly sticky cozy fuzzy bitter sour salty mild plain neat pale messy scruffy unique colorful exotic dynamic active burnt smoky rotten smelly stinky fishy crispy juicy flashing sparkling twinkling lush grand strong fruity greasy oily gooey slippery'.split())
POOL = {'視覺': ['聽覺', '觸覺', '嗅覺', '味覺'], '聽覺': ['觸覺', '嗅覺', '味覺', '個性'], '觸覺': ['聽覺', '個性'],
        '嗅覺': ['聽覺', '觸覺', '個性'], '味覺': ['聽覺', '個性', '外貌'], '外貌': ['聽覺', '觸覺', '味覺'], '個性': ['聽覺', '嗅覺', '味覺', '觸覺']}
PERSON_OK = set('blaring deafening roaring high-pitched melodious whispering hoarse raspy creaky lukewarm ice-cold floppy aromatic fragrant perfumed scented musty rancid appetizing mouth-watering scrumptious delicious tasty palatable nectarous peppery'.split())
words_by_set = {s['id']: [bw['w'] for b in s['bases'] for bw in b['words']] for s in SETS}
name_by_id = {s['id']: s['name'] for s in SETS}
id_by_name = {s['name'].split('|')[0]: s['id'] for s in SETS}
def stem(w): return re.sub(r'(ing|ed|ly|y|e|s)$', '', w.lower())[:5]
def distractors(sid, ans, rnd):
    pools = []
    for nm in POOL[name_by_id[sid]]:
        pools += [w for w in words_by_set[id_by_name[nm]]]
    pools = [w for w in dict.fromkeys(pools) if w not in BLACK or name_by_id[sid] in ('視覺',) and w in ('burnt', 'smoky', 'rotten', 'smelly', 'stinky', 'fishy', 'fruity', 'greasy', 'oily', 'gooey', 'sticky', 'slippery', 'sour', 'salty', 'bitter', 'crispy', 'juicy')]
    if name_by_id[sid] in ('個性', '外貌'): pools = [w for w in pools if w in PERSON_OK]
    pools = [w for w in pools if w != ans and stem(w) != stem(ans) and ' ' not in w or False]
    rnd.shuffle(pools); return pools[:3]
for s in SETS:
    k = 0
    for b in s['bases']:
        for bw in b['words']:
            k += 1; w = bw['w']; rnd = random.Random(f"{s['id']}-{w}")
            slug = re.sub(r'[^a-z]+', '-', w.lower()).strip('-')
            ds = distractors(s['id'], w, rnd)
            if len(ds) < 3: die(f'not enough distractors for {w}')
            opts = ds + [w]; rnd.shuffle(opts)
            raw = bw.pop('_raw')
            UQ.append({'id': f'up-{s["id"]}-{slug}-m', 'unit': s['id'], 'no': k, 'type': 'mcq', 'extra': 'up', 'stage': 2, 'q': raw.replace('___', '______'),
                       'ans': w, 'pos': 'adj.', 'zh': bw['zh'], 'full': bw['sent'], 'opts': opts})
            UQ.append({'id': f'up-{s["id"]}-{slug}-f', 'unit': s['id'], 'no': k, 'type': 'fill', 'extra': 'up', 'stage': 3, 'q': raw.replace('___', w[0] + '_' * max(2, len(w) - 1)),
                       'ans': w, 'pos': 'adj.', 'zh': bw['zh'], 'full': bw['sent']})
# ---------- 易混淆字 ----------
GR = []; CQ = []; g = None
for ln, raw in enumerate(open(f'{ROOT}/tools/extra/confuse.txt', encoding='utf-8'), 1):
    line = raw.rstrip('\n')
    if not line.strip() or (line.startswith('#') and not line.startswith('##')): continue
    if line.startswith('##'):
        name, typ = line[2:].strip().split('|'); g = {'id': 'cfg%d' % (len(GR) + 1), 'name': name.strip(), 'type': typ.strip(), 'note': '', 'members': [], 'qs': []}; GR.append(g); continue
    if line.startswith('note:'): g['note'] = line[5:].strip(); continue
    if line.startswith('?'):
        p = [s.strip() for s in line[1:].split('|')]
        if len(p) < 2: die(f'confuse.txt:{ln} bad question'); continue
        g['qs'].append({'ans': p[0], 'sent': p[1], 'excl': p[2].split() if len(p) > 2 and p[2] else [], 'ln': ln}); continue
    p = [s.strip() for s in line.split('|')]
    x = gidx.get(p[0].lower())
    g['members'].append({'w': p[0], 'pos': p[1] if len(p) > 1 else '', 'zh': p[2] if len(p) > 2 else '', 'lv': x['lv'] if x else 0, 'gsat': bool(x)})
for g in GR:
    ms = [m['w'] for m in g['members']]
    if len(ms) < 2: die(f'{g["name"]}: <2 members')
    for k, q in enumerate(g['qs'], 1):
        if q['ans'] not in ms: die(f'confuse.txt:{q["ln"]} answer {q["ans"]} not in group'); continue
        if q['sent'].count('___') != 1: die(f'confuse.txt:{q["ln"]} need one ___'); continue
        rnd = random.Random(f'{g["id"]}-{k}')
        others = [m for m in ms if m != q['ans'] and m not in q['excl']]
        rnd.shuffle(others); opts = [q['ans']] + others[:3]; rnd.shuffle(opts)
        m = next(m for m in g['members'] if m['w'] == q['ans'])
        CQ.append({'id': f'cf-{g["id"]}-{k}', 'unit': g['id'], 'no': k, 'type': 'mcq', 'extra': 'cf', 'q': q['sent'].replace('___', '______'), 'ans': q['ans'],
                   'pos': m['pos'], 'zh': m['zh'], 'full': q['sent'].replace('___', q['ans']), 'opts': opts, 'note': g['note']})
    for q in g.pop('qs'): pass
if err:
    print('\n'.join(err)); sys.exit(1)
out = {'meta': {'note': '寫作升級 + 易混淆字;由 tools/build_extra.py 自 tools/extra/*.txt 產生', 'upgradeWords': len(ALLW), 'confuseGroups': len(GR)},
       'upgrade': {'sets': SETS, 'questions': UQ}, 'confuse': {'groups': GR, 'questions': CQ}}
json.dump(out, open(f'{ROOT}/data/extra.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'upgrade: {len(SETS)} sets, {len(ALLW)} words, {len(UQ)} questions; confuse: {len(GR)} groups, {len(CQ)} questions')
