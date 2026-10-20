#!/usr/bin/env python3
"""Compare tools/units/uNN.txt against the official key transcription tools/answers_all.txt."""
import glob, os, re, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
def load_key():
    key, cur = {}, None
    for ln in open(os.path.join(ROOT, 'answers_all.txt'), encoding='utf8'):
        p = ln.rstrip('\n').split('|')
        if p[0] == 'U': cur = int(p[1]); continue
        key[(cur, int(p[1]))] = (p[0], p[2], p[3] if len(p) > 3 else '')
    return key
def load_units():
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'units', 'u*.txt'))):
        cur = None
        for raw in open(path, encoding='utf8').read().splitlines():
            if not raw.strip(): continue
            p = raw.split('|')
            if p[0] == 'U': cur = int(p[1])
            elif p[0] == 'F': out[(cur, int(p[1]))] = ('F', p[3], p[5])
            elif p[0] == 'M': out[(cur, int(p[1]))] = ('M', p[7], p[10])
            elif p[0] == 'B': out[(cur, int(p[1]))] = ('B', p[3], p[5])
    return out
def norm(s): return re.sub(r'[\s()（）]', '', s.lower())
if __name__ == '__main__':
    key, units = load_key(), load_units()
    ans_bad, zh_diff, missing = [], [], []
    for k, (t, a, zh) in sorted(units.items()):
        if k not in key: missing.append(k); continue
        kt, ka, kzh = key[k]
        if t == 'F':
            if norm(a) != norm(ka): ans_bad.append((k, t, a, ka))
        elif a != ka: ans_bad.append((k, t, a, ka))
        if norm(zh) != norm(kzh): zh_diff.append((k, zh, kzh))
    print('units compared:', len(units), ' not in key:', missing)
    print('ANSWER MISMATCHES:', len(ans_bad))
    for x in ans_bad: print('  ', x)
    print('zh differences:', len(zh_diff))
    if '-v' in sys.argv:
        for x in zh_diff: print('  ', x)
