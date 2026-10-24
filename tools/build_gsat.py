#!/usr/bin/env python3
"""Build data/gsat.json from the parsed CEEC list (tools/parse_ceec.py output) + ECDICT (stardict.db).

Chinese meanings are auto-filled from ECDICT (MIT) and converted to Traditional Chinese with OpenCC (s2twp).
They are a FIRST DRAFT: review tools/gsat_review.csv and fix data/gsat.json (or tools/zh_overrides.json).

Usage: python3 tools/build_gsat.py <ceec_entries.json> <stardict.db>
"""
import csv, json, os, re, sqlite3, sys
from opencc import OpenCC

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cc = OpenCC('s2twp')
POSMAP = {'n': 'n', 'v': 'v', 'vi': 'v', 'vt': 'v', 'a': 'adj', 'adj': 'adj', 'ad': 'adv', 'adv': 'adv', 'prep': 'prep', 'conj': 'conj',
          'pron': 'pron', 'art': 'art', 'aux': 'aux', 'int': 'interj', 'interj': 'interj', 'num': 'num', 'abbr': 'abbr', 'det': 'det'}
LINE = re.compile(r'^(vi|vt|adj|adv|prep|conj|pron|art|aux|interj|int|num|abbr|det|ad|a|n|v)\.\s*(.*)$')


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def split_pos(pos):
    return [POSMAP.get(t.strip('().'), None) for t in pos.split('/') if t.strip('().')]


def segments(text, maxlen=13, maxn=3):
    text = re.sub(r'[（(][^）)]*[）)]', '', text)          # drop parenthetical notes
    text = re.sub(r'\[[^\]]*\]\s*', '', text)              # drop [domain] tags
    segs, out, total = [x.strip() for x in re.split(r'[,;，；、]', text) if x.strip()], [], 0
    for s in segs:
        if s in out: continue
        if out and total + len(s) > maxlen: break
        out.append(s); total += len(s)
        if len(out) >= maxn: break
    return out


def zh_for(cur, word, pos):
    row = cur.execute('select translation from stardict where word=? limit 1', (word,)).fetchone()
    if not row or not row[0]:
        row = cur.execute('select translation from stardict where sw=? limit 1', (re.sub(r'[^a-z0-9]', '', word.lower()),)).fetchone()
    if not row or not row[0]: return '', 'missing'
    by_pos, general = {}, []
    for ln in row[0].split('\n'):
        ln = ln.strip()
        if not ln or ln.startswith('['): continue
        if re.search(r'的(过去式|过去分词|现在分词|复数|第三人称)', ln) : continue
        m = LINE.match(ln)
        if m: by_pos.setdefault(POSMAP.get(m.group(1)), []).append(m.group(2))
        else: general.append(ln)
    targets = [p for p in split_pos(pos) if p]
    groups = []
    for p in dict.fromkeys(targets):
        if p in by_pos: groups.append((p, segments('，'.join(by_pos[p]))))
    if not groups and general: groups.append((None, segments('，'.join(general))))
    if not groups and by_pos:
        p0 = next(iter(by_pos)); groups.append((p0, segments('，'.join(by_pos[p0]))))
    if not groups:
        # only domain-tagged lines? fall back to the first line
        first = re.sub(r'^\[[^\]]*\]\s*', '', row[0].split('\n')[0]); groups.append((None, segments(first)))
    groups = [g for g in groups if g[1]][:2]
    if not groups: return '', 'missing'
    if len(groups) == 1: text = ';'.join(groups[0][1])
    else: text = ' ｜ '.join(f'{p}. ' + ';'.join(s) for p, s in groups)
    return cc.convert(text), 'ecdict'


def expand(head, pos):
    """Return [(word, pos)] for one CEEC entry."""
    head = re.sub(r'\s*\(.*?,.*?\)\s*$', '', head.strip())          # he (him, his ...) -> he
    head = re.sub(r'/\s+', '/', head).strip()
    plain = [t.strip('()') for t in pos.split('/') if not t.startswith('(')]
    paren = [t.strip('()') for t in pos.split('/') if t.startswith('(')]
    base_pos = '/'.join(plain) or pos.replace('(', '').replace(')', '')
    der_pos = '/'.join(paren) or base_pos
    out, derived = [], []
    parts = []
    for part in head.split('/'):
        m = re.fullmatch(r'([A-Za-z.]+)\(([A-Za-z]+)\)', part)
        if m:
            b, suf = m.groups(); parts.append(b)
            full = suf if (suf[:3].lower() == b[:3].lower() and len(suf) > 3) else b + suf
            if suf != 's': derived.append(full)
        else: parts.append(part)
    out.append(('/'.join(parts), base_pos))
    for d in derived: out.append((d, der_pos))
    return out


def main():
    entries = json.load(open(sys.argv[1], encoding='utf8'))
    cur = sqlite3.connect(sys.argv[2]).cursor()
    overrides = {}
    ov = os.path.join(ROOT, 'tools', 'zh_overrides.json')
    if os.path.exists(ov): overrides = json.load(open(ov, encoding='utf8'))
    words, seen, rows = [], set(), []
    for e in entries:
        for w, pos in expand(e['head'], e['pos']):
            key = w.lower()
            if key in seen: continue
            seen.add(key)
            zhs, src = [], 'ecdict'
            for part in w.split('/'):
                z, s = zh_for(cur, part, pos)
                if z and z not in zhs: zhs.append(z)
                if s == 'missing' and part == w: src = 'missing'
            zh = ' / '.join(zhs); src = 'ecdict' if zh else 'missing'
            if key in overrides: zh, src = overrides[key], 'manual'
            zh = re.sub(r'\.{2,}|…+', '…', zh)                      # one ellipsis style everywhere: …
            words.append(dict(id='g-' + slug(w), w=w, pos=pos, zh=zh, lv=e['lv']))
            rows.append((e['lv'], w, pos, zh, src))
    missing = [r for r in rows if not r[3]]
    meta = dict(source='大考中心《高中英文參考詞彙表》(111 學年度起適用);中文釋義:ECDICT(MIT)經 OpenCC 轉繁體,待人工校對', words=len(words), missing_zh=len(missing))
    json.dump(dict(meta=meta, words=words), open(os.path.join(ROOT, 'data', 'gsat.json'), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(ROOT, 'tools', 'gsat_review.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        wr = csv.writer(f); wr.writerow(['level', 'word', 'pos', 'zh (請校對/修改)', 'source']); wr.writerows(rows)
    print(f'OK: {len(words)} words ({len(missing)} without Chinese). Review file: tools/gsat_review.csv')


if __name__ == '__main__':
    main()
