#!/usr/bin/env python3
"""Parse the CEEC 高中英文參考詞彙表 PDF (alphabetical section, which carries the level of each entry).
Usage: python3 tools/parse_ceec.py <ceec.pdf> <out.json>"""
import json, re, sys
import pdfplumber

POS = r'(?:n|v|adj|adv|prep|conj|pron|art|aux|interj|det|num|phr|abbr)\.?'
POS_TOKEN = re.compile(r'^(?:\(?%s\)?)(?:/\(?%s\)?)*$' % (POS, POS))


def column(x0):
    return 0 if x0 < 228 else 1 if x0 < 394 else 2


def page_lines(pg):
    ws = [w for w in pg.extract_words() if 55 < w['top'] < 790]
    lines = []
    for c in range(3):
        cw = sorted([w for w in ws if column(w['x0']) == c], key=lambda w: (w['top'], w['x0']))
        cur, top = [], None
        flush = lambda: lines.append(' '.join(x['text'] for x in sorted(cur, key=lambda x: x['x0'])))
        for w in cw:
            if top is None or abs(w['top'] - top) > 2.5:
                if cur: flush()
                cur, top = [w], w['top']
            else:
                cur.append(w)
        if cur: flush()
    return lines


def parse(pdf_path):
    pdf = pdfplumber.open(pdf_path)
    entries, buf = [], ''
    for i, pg in enumerate(pdf.pages):
        head = (pg.extract_text() or '')[:12]
        if '依字母排序' not in head and not (i > 64 and i < 115):
            continue
        if i >= 115: break
        for ln in page_lines(pg):
            if re.fullmatch(r'[A-Z]', ln.strip()) or '依字母排序' in ln:
                continue
            buf = (buf + ' ' + ln).strip()
            m = re.match(r'^(.*\S)\s+([1-6])$', buf)
            if m:
                entries.append((m.group(1), int(m.group(2)))); buf = ''
    return entries, buf


def split_entry(text):
    toks = text.split()
    k = next((j for j, t in enumerate(toks) if j > 0 and POS_TOKEN.match(t)), None)
    if k is None: return None
    return ' '.join(toks[:k]), ' '.join(toks[k:])


if __name__ == '__main__':
    entries, rest = parse(sys.argv[1])
    out, bad = [], []
    for text, lv in entries:
        sp = split_entry(text)
        if not sp: bad.append((text, lv)); continue
        out.append(dict(head=sp[0], pos=sp[1], lv=lv))
    json.dump(out, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    from collections import Counter
    print('entries', len(out), 'by level', sorted(Counter(e['lv'] for e in out).items()), 'bad', bad[:10], 'leftover', repr(rest))
