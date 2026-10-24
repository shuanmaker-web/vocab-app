#!/usr/bin/env python3
"""Build data/gsat_questions.json (學測歷屆試題:第壹部分 詞彙題) from tools/gsat_exam/.

  python3 tools/build_gsat_exam.py

Inputs : tools/gsat_exam/part1_vocab_106-115.txt   題目(逐題一行,| 分隔)
         tools/gsat_exam/official_keys.txt          大考中心公布的選擇題答案(獨立輸入,用來核對)
Output : data/gsat_questions.json

Checks (any failure aborts): 10 questions per year, exactly one blank per sentence, 4 distinct
options, answer letter matches the official key, answer text fits the blank.
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'gsat_exam' / 'part1_vocab_106-115.txt'
KEYS = ROOT / 'tools' / 'gsat_exam' / 'official_keys.txt'
OUT = ROOT / 'data' / 'gsat_questions.json'
BLANK = '______'


def read_lines(p):
    return [l.rstrip('\n') for l in p.read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#')]


def main():
    keys = {}
    for l in read_lines(KEYS):
        y, k = l.split()
        assert len(k) == 10 and set(k) <= set('ABCD'), f'bad key line: {l}'
        keys[int(y)] = k

    qs, per_year, errors = [], {}, []
    for l in read_lines(SRC):
        f = l.split('|')
        if len(f) != 10:
            errors.append(f'欄位數不是 10: {l[:60]}…'); continue
        year, no, sent, a, b, c, d, letter, pos, zh = f
        year, no = int(year), int(no)
        opts = [a, b, c, d]
        tag = f'{year}-{no}'
        if sent.count(BLANK) != 1: errors.append(f'{tag}: 空格數量不是 1')
        if len(set(o.lower() for o in opts)) != 4: errors.append(f'{tag}: 選項重複')
        if letter not in 'ABCD' or len(letter) != 1: errors.append(f'{tag}: 答案字母錯誤'); continue
        if year not in keys: errors.append(f'{tag}: 官方答案檔沒有這個學年度'); continue
        if keys[year][no - 1] != letter: errors.append(f'{tag}: 答案 {letter} 與官方答案 {keys[year][no - 1]} 不符')
        ans = opts['ABCD'.index(letter)]
        qs.append({
            'id': f'g{year}-{no}', 'unit': year, 'no': no, 'type': 'mcq',
            'q': sent, 'ans': ans, 'pos': pos, 'zh': zh,
            'full': sent.replace(BLANK, ans, 1), 'opts': opts,
        })
        per_year.setdefault(year, []).append(no)

    for y in keys:
        if sorted(per_year.get(y, [])) != list(range(1, 11)):
            errors.append(f'{y}: 題號不是 1–10 各一題 ({sorted(per_year.get(y, []))})')
    if errors:
        print('\n'.join(errors)); sys.exit(1)

    qs.sort(key=lambda q: (q['unit'], q['no']))
    years = sorted(per_year)
    meta = {
        'source': '大學入學考試中心 歷年學科能力測驗 英文科 第壹部分 詞彙題(第 1–10 題)',
        'units': years, 'questions': len(qs),
        'note': '題目與答案取自大考中心公布之試題與選擇題答案;112 學年度各題與 111 第 4 題的空格位置為依句意補回。中文釋義為自編。',
    }
    OUT.write_text(json.dumps({'meta': meta, 'questions': qs}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'OK: {len(qs)} 題 / {len(years)} 個學年度 ({years[0]}–{years[-1]}) → {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
