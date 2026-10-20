#!/usr/bin/env python3
"""Build data/questions.json and data/material.json from tools/units/uNN.txt.

DSL (one record per line, '|' separated):
  U|<unit>
  F|<no>|<sentence with blank>|<answer as written in the blank>|<pos>|<zh>[|<lemma>]
  M|<no>|<stem>|<A>|<B>|<C>|<D>|<letter>|<headword>|<pos>|<zh>
  K|<from>-<to>|<w1>;<w2>;<w3>;<w4>;<w5>;<w6>        (word bank A-F for the match group)
  B|<no>|<sentence>|<letter>|<pos>|<zh>[|<lemma>]     (answer = bank[letter]; lemma defaults to it)
Usage: python3 tools/build_material.py   (run from the app folder)
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNITS = os.path.join(ROOT, 'tools', 'units')
OUT_Q = os.path.join(ROOT, 'data', 'questions.json')
OUT_W = os.path.join(ROOT, 'data', 'material.json')
LET = 'ABCDEF'
BLANK = re.compile(r"[A-Za-z]*_{2,}[A-Za-z]*(?:\s*\([A-Za-z]+\))?")


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def fill(sentence, answer):
    """Put the answer into the first blank (keeps sentence-initial capital)."""
    m = BLANK.search(sentence)
    if not m:
        return sentence
    ans = answer
    before = sentence[:m.start()].rstrip()
    if (not before or before[-1] in '.!?"“') and ans[:1].islower():
        ans = ans[:1].upper() + ans[1:]
    return sentence[:m.start()] + ans + sentence[m.end():]


def parse():
    units, warns = {}, []
    for path in sorted(glob.glob(os.path.join(UNITS, 'u*.txt'))):
        cur, banks = None, {}
        for ln, raw in enumerate(open(path, encoding='utf8').read().splitlines(), 1):
            if not raw.strip():
                continue
            p = raw.split('|')
            t = p[0]
            where = f'{os.path.basename(path)}:{ln}'
            try:
                if t == 'U':
                    cur = int(p[1]); units[cur] = []; banks = {}
                elif t == 'K':
                    a, b = map(int, p[1].split('-'))
                    words = p[2].split(';')
                    assert len(words) == 6, 'bank needs 6 words'
                    for n in range(a, b + 1):
                        banks[n] = words
                elif t == 'F':
                    no = int(p[1]); sent, ans, pos, zh = p[2], p[3], p[4], p[5]
                    lemma = p[6] if len(p) > 6 else ans
                    units[cur].append(dict(unit=cur, no=no, type='fill', q=sent, ans=ans, lemma=lemma.lower(), pos=pos, zh=zh))
                elif t == 'M':
                    no = int(p[1]); opts = p[3:7]; letter = p[7]
                    head, pos, zh = p[8], p[9], p[10]
                    assert letter in 'ABCD', 'bad letter'
                    ans = opts[LET.index(letter)]
                    units[cur].append(dict(unit=cur, no=no, type='mcq', q=p[2], opts=opts, ans=ans, lemma=head.lower(), pos=pos, zh=zh))
                    if head.lower()[:3] != ans.lower()[:3]:
                        warns.append(f'{where} headword "{head}" vs answer "{ans}"')
                elif t == 'B':
                    no = int(p[1]); letter = p[3]; bank = banks[no]
                    assert letter in LET, 'bad letter'
                    ans = bank[LET.index(letter)]
                    lemma = p[6] if len(p) > 6 else ans
                    units[cur].append(dict(unit=cur, no=no, type='match', q=p[2], opts=bank, ans=ans, lemma=lemma.lower(), pos=p[4], zh=p[5]))
                    if lemma.lower()[:3] != ans.lower()[:3]:
                        warns.append(f'{where} lemma "{lemma}" vs answer "{ans}"')
                else:
                    raise ValueError('unknown record type')
            except Exception as e:  # noqa: BLE001
                sys.exit(f'ERROR {where}: {e}\n  {raw}')
    return units, warns


def validate(units, warns):
    errs = []
    for u, qs in sorted(units.items()):
        nos = sorted(q['no'] for q in qs)
        if nos != list(range(1, 21)):
            errs.append(f'Unit {u}: question numbers {nos}')
        # match groups use each bank word at most once
        for lo, hi in ((11, 15), (16, 20)):
            used = [q['ans'] for q in qs if lo <= q['no'] <= hi]
            if len(set(used)) != len(used):
                errs.append(f'Unit {u}: duplicate answers in {lo}-{hi}')
        for q in qs:
            where = f'Unit {u} Q{q["no"]}'
            if q['type'] == 'fill':
                m = re.search(r'([A-Za-z]*)_{2,}([A-Za-z]*)', q['q'])
                if not m:
                    errs.append(f'{where}: no blank'); continue
                pre, suf = m.group(1).lower(), m.group(2).lower()
                a = q['ans'].lower()
                if '(' not in q['q'][m.start():m.end() + 12] and not (a.startswith(pre) and a.endswith(suf) and len(a) >= len(pre) + len(suf)):
                    errs.append(f'{where}: answer "{q["ans"]}" does not fit blank "{m.group(0)}"')
            else:
                if '______' not in q['q']:
                    errs.append(f'{where}: no blank')
                if q['ans'] not in q['opts']:
                    errs.append(f'{where}: answer not in options')
                if len(set(o.lower() for o in q['opts'])) != len(q['opts']):
                    errs.append(f'{where}: duplicate options')
    return errs


def load_key():
    """Official answer key transcription (tools/answers_all.txt): {(unit,no): (type, answer, zh)}."""
    path = os.path.join(ROOT, 'tools', 'answers_all.txt')
    key, cur = {}, None
    if not os.path.exists(path):
        return key
    for ln in open(path, encoding='utf8').read().splitlines():
        p = ln.split('|')
        if p[0] == 'U':
            cur = int(p[1])
        elif ln.strip():
            key[(cur, int(p[1]))] = (p[0], p[2], p[3] if len(p) > 3 else '')
    return key


def apply_key(units):
    """Check every answer against the official key; use the key's Chinese meaning."""
    key, errs = load_key(), []
    for u, qs in units.items():
        for q in qs:
            k = key.get((u, q['no']))
            if not k:
                continue
            kind, ka, kzh = k
            if kind == 'F':
                same = re.sub(r'[\s()]', '', q['ans'].lower()) == re.sub(r'[\s()]', '', ka.lower())
            else:
                same = LET[q['opts'].index(q['ans'])] == ka if q['ans'] in q['opts'] else False
            if not same:
                errs.append(f'Unit {u} Q{q["no"]}: answer "{q["ans"]}" differs from official key "{ka}"')
            if kzh:
                q['zh'] = kzh
    return errs


def main():
    units, warns = parse()
    errs = validate(units, warns) + apply_key(units)
    for w in warns:
        print('warn:', w)
    if errs:
        print('\n'.join('ERROR ' + e for e in errs)); sys.exit(1)

    questions, words, order = [], {}, []
    for u in sorted(units):
        for q in sorted(units[u], key=lambda x: x['no']):
            wid = 'm-' + slug(q['lemma'])
            sentence = fill(q['q'], q['ans'])
            rec = dict(id=f'u{u}-{q["no"]}', unit=u, no=q['no'], type=q['type'], q=q['q'], ans=q['ans'], wid=wid, pos=q['pos'], zh=q['zh'], full=sentence)
            if q['type'] != 'fill':
                rec['opts'] = q['opts']
            questions.append(rec)
            w = words.get(wid)
            if not w:
                words[wid] = dict(id=wid, w=q['lemma'], pos=q['pos'], zh=q['zh'], list=f'Unit {u}', unit=u, ex=sentence)
                order.append(wid)
            elif not w.get('ex'):
                w['ex'] = sentence
    meta = dict(source='教材 Level 3–5 練習題(照片轉錄)', units=sorted(units), questions=len(questions), words=len(words),
                note='題目為照片轉錄;答案與中文釋義已與教材官方解答逐題核對')
    os.makedirs(os.path.dirname(OUT_Q), exist_ok=True)
    json.dump(dict(meta=meta, questions=questions), open(OUT_Q, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(dict(meta=dict(source=meta['source'], note=meta['note']), words=[words[i] for i in order]), open(OUT_W, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
    print(f'OK: {len(units)} units, {len(questions)} questions, {len(words)} distinct words')


if __name__ == '__main__':
    main()
