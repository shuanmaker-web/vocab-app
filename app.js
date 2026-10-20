/* Vocaboo — flashcards / multiple choice / spelling with FSRS.
   Two word banks: "gsat" (CEEC Level 1–6) and "material" (teacher's list). */
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const BANKS = {
  gsat: { name: '學測單字表', file: 'data/gsat.json' },
  material: { name: '字彙王 Level 3-5', file: 'data/material.json' },
};
const MODES = { flash: '字卡', mcq: '選擇題', spell: '拼字' };
const QTYPES = { fill: '一、文意字彙', mcq: '二、選擇題', match: '三、配合題' };
const EXAM_PRESETS = [
  { name: '學測', date: '2027-01-22' },
  { name: '分科測驗', date: '2027-07-10' },
  { name: '國中會考', date: '' },
  { name: '統測', date: '' },
  { name: '段考', date: '' },
  { name: '期末考', date: '' },
];
const DEFAULTS = { newPerDay: 20, sessionSize: 20, retention: 0.9, examName: '學測', examDate: '2027-01-22', progressDays: 0, levels: [3, 4, 5], unitFrom: null, unitTo: null, dailyGoal: 10, lastBackupAt: 0 };

/* ---------- storage (IndexedDB, with in-memory fallback) ---------- */
const store = (() => {
  let db = null; const mem = { cards: new Map(), logs: [], kv: new Map(), q: new Map() }; let volatile = false;
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function init() {
    try {
      if (!window.indexedDB) throw new Error('no idb');
      db = await new Promise((res, rej) => {
        const o = indexedDB.open('vocab-app', 2);
        o.onupgradeneeded = () => {
          const d = o.result, has = n => d.objectStoreNames.contains(n);
          if (!has('cards')) d.createObjectStore('cards', { keyPath: 'id' });
          if (!has('logs')) d.createObjectStore('logs', { autoIncrement: true });
          if (!has('kv')) d.createObjectStore('kv');
          if (!has('qstats')) d.createObjectStore('qstats', { keyPath: 'id' });
        };
        o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error);
      });
    } catch (e) { volatile = true; db = null; }
    try { navigator.storage?.persist?.(); } catch (e) { /* ignore */ }
  }
  const tx = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  return {
    init, get volatile() { return volatile; },
    async allCards() { if (!db) return new Map(mem.cards); const list = await req(tx('cards').getAll()); return new Map(list.map(c => [c.id, c])); },
    async putCard(c) { if (!db) { mem.cards.set(c.id, c); return; } await req(tx('cards', 'readwrite').put(c)); },
    async allQ() { if (!db) return new Map(mem.q); const list = await req(tx('qstats').getAll()); return new Map(list.map(c => [c.id, c])); },
    async putQ(c) { if (!db) { mem.q.set(c.id, c); return; } await req(tx('qstats', 'readwrite').put(c)); },
    async addLog(l) { if (!db) { mem.logs.push(l); return; } await req(tx('logs', 'readwrite').add(l)); },
    async allLogs() { if (!db) return mem.logs.slice(); return req(tx('logs').getAll()); },
    async getKV(k) { if (!db) return mem.kv.get(k); return req(tx('kv').get(k)); },
    async setKV(k, v) { if (!db) { mem.kv.set(k, v); return; } await req(tx('kv', 'readwrite').put(v, k)); },
    async clear() {
      if (!db) { mem.cards.clear(); mem.logs = []; mem.kv.clear(); mem.q.clear(); return; }
      for (const n of ['cards', 'logs', 'kv', 'qstats']) await req(tx(n, 'readwrite').clear());
    },
    async exportAll() {
      return { app: 'gsat-vocab', version: 2, exportedAt: Date.now(), cards: [...(await this.allCards()).values()], qstats: [...(await this.allQ()).values()], logs: await this.allLogs(), settings: await this.getKV('settings'), daily: await this.getKV('daily') };
    },
    async importAll(o) {
      if (!o || o.app !== 'gsat-vocab') throw new Error('不是本 App 匯出的備份檔');
      await this.clear();
      for (const c of o.cards || []) await this.putCard(c);
      for (const c of o.qstats || []) await this.putQ(c);
      for (const l of o.logs || []) await this.addLog(l);
      if (o.settings) await this.setKV('settings', o.settings);
      if (o.daily) await this.setKV('daily', o.daily);
    },
  };
})();

/* ---------- state ---------- */
const S = {
  settings: { ...DEFAULTS }, daily: {}, cards: new Map(), words: { gsat: [], material: [] },
  tab: 'home', bank: null, session: null, fsrs: null, questions: [], qstats: new Map(), pview: 'main', wrongType: 'all', punit: null,
};
const wordById = {}, qById = {};
const cardId = (bank, wid, type) => `${bank}:${wid}:${type}`;
const typeOf = mode => (mode === 'spell' ? 'spell' : 'recog');

function makeFsrs() {
  S.fsrs = FSRS.fsrs(FSRS.generatorParameters({ request_retention: S.settings.retention, enable_fuzz: true, learning_steps: [], relearning_steps: [] }));
}
const toFsrsCard = c => ({ due: new Date(c.due), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days, reps: c.reps, lapses: c.lapses, learning_steps: c.learning_steps || 0, state: c.state, last_review: c.last_review ? new Date(c.last_review) : undefined });
const fromFsrsCard = (rec, f) => ({ ...rec, due: +f.due, stability: f.stability, difficulty: f.difficulty, elapsed_days: f.elapsed_days, scheduled_days: f.scheduled_days, reps: f.reps, lapses: f.lapses, learning_steps: f.learning_steps, state: f.state, last_review: f.last_review ? +f.last_review : null });
const blankCard = (bank, wid, type) => fromFsrsCard({ id: cardId(bank, wid, type), bank, wid, type }, FSRS.createEmptyCard(new Date()));

/* ---------- data ---------- */
async function loadBank(bank) {
  try {
    const r = await fetch(BANKS[bank].file, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    S.words[bank] = (j.words || []).map((w, i) => ({ ...w, bank, idx: i, id: w.id || `${bank}-${i}` }));
    BANKS[bank].meta = j.meta || {};
  } catch (e) { S.words[bank] = []; BANKS[bank].meta = { error: true }; }
  for (const w of S.words[bank]) wordById[`${bank}:${w.id}`] = w;
}
async function loadQuestions() {
  try {
    const r = await fetch('data/questions.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); S.questions = j.questions || []; S.qmeta = j.meta || {};
  } catch (e) { S.questions = []; S.qmeta = { error: true }; }
  for (const q of S.questions) qById[q.id] = q;
}
const answers = w => String(w.w).split('/').map(s => s.trim()).filter(Boolean);
const unitNums = () => [...new Set(S.words.material.map(w => w.unit).filter(n => n != null))].sort((a, b) => a - b);
function scopeWords(bank) {
  const ws = S.words[bank];
  if (bank === 'gsat') { const lv = S.settings.levels; return ws.filter(w => lv.includes(w.lv)); }
  const u = unitNums(), lo = S.settings.unitFrom ?? u[0], hi = S.settings.unitTo ?? u[u.length - 1];
  return ws.filter(w => w.unit == null || (w.unit >= lo && w.unit <= hi));
}

/* ---------- queue ---------- */
function countsFor(bank, mode) {
  const type = typeOf(mode), now = Date.now(), words = scopeWords(bank);
  let due = 0, fresh = 0;
  for (const w of words) { const c = S.cards.get(cardId(bank, w.id, type)); if (!c) fresh++; else if (c.due <= now) due++; }
  const used = (S.daily[dayKey()]?.new?.[`${bank}:${type}`]) || 0;
  return { due, fresh, newLeft: Math.max(0, Math.min(fresh, S.settings.newPerDay + (S.daily[dayKey()]?.bonus?.[`${bank}:${type}`] || 0) - used)), total: words.length };
}
function buildQueue(bank, mode, practice = false) {
  const type = typeOf(mode), now = Date.now(), words = scopeWords(bank), size = S.settings.sessionSize;
  if (practice) {
    let seen = words.filter(w => S.cards.has(cardId(bank, w.id, type))); if (!seen.length) seen = S.words[bank].filter(w => S.cards.has(cardId(bank, w.id, type)));
    return shuffle(seen).slice(0, 10).map(w => w.id);
  }
  const due = words.map(w => ({ w, c: S.cards.get(cardId(bank, w.id, type)) })).filter(x => x.c && x.c.due <= now).sort((a, b) => a.c.due - b.c.due).map(x => x.w.id);
  const { newLeft } = countsFor(bank, mode);
  const fresh = words.filter(w => !S.cards.has(cardId(bank, w.id, type))).slice(0, newLeft).map(w => w.id);
  return [...due, ...fresh].slice(0, size);
}

/* ---------- grading ---------- */
async function grade(bank, wid, mode, rating, extra = {}) {
  const type = typeOf(mode), id = cardId(bank, wid, type), isNew = !S.cards.has(id);
  let rec = S.cards.get(id) || blankCard(bank, wid, type);
  if (!S.session?.practice) {
    const next = S.fsrs.next(toFsrsCard(rec), new Date(), rating).card;
    rec = fromFsrsCard(rec, next); S.cards.set(id, rec); await store.putCard(rec);
  }
  const key = dayKey(); const d = (S.daily[key] ||= { reviews: 0, correct: 0, new: {} });
  d.reviews++; if (rating >= 3) d.correct++;
  if (isNew && !S.session?.practice) d.new[`${bank}:${type}`] = (d.new[`${bank}:${type}`] || 0) + 1;
  await store.setKV('daily', S.daily);
  await store.addLog({ ts: Date.now(), cardId: id, rating, source: mode, ...extra });
  return rec;
}
function previewIntervals(bank, wid) {
  const rec = S.cards.get(cardId(bank, wid, 'recog')) || blankCard(bank, wid, 'recog');
  const r = S.fsrs.repeat(toFsrsCard(rec), new Date());
  return [1, 2, 3, 4].map(k => fmtIv(+r[k].card.due - Date.now()));
}
function fmtIv(ms) {
  const d = ms / DAY; if (d < 0.5) return '今天'; if (d < 30) return `${Math.max(1, Math.round(d))} 天`; if (d < 365) return `${Math.round(d / 30)} 個月`; return `${(d / 365).toFixed(1)} 年`;
}

/* ---------- streak ---------- */
function streak() {
  const goal = S.settings.dailyGoal; const ok = k => (S.daily[k]?.reviews || 0) >= goal;
  let n = 0, gaps = [], d = new Date(); if (!ok(dayKey(d))) d = new Date(+d - DAY); // today not finished yet: don't break
  for (let i = 0; i < 1000; i++, d = new Date(+d - DAY)) {
    const k = dayKey(d);
    if (ok(k)) { n++; continue; }
    gaps = gaps.filter(t => +d - t < 7 * DAY); // up to 2 free "freeze" days per rolling week
    if (gaps.length < 2) { gaps.push(+d); continue; }
    break;
  }
  return n;
}

/* ---------- distractors ---------- */
function suffix(w) { return w.slice(-3); }
function distractors(target, bank, field) {
  const pool = S.words[bank].filter(w => w.id !== target.id && w[field] && w[field] !== target[field]);
  const score = w => (w.pos && w.pos === target.pos ? 2 : 0) + (target.lv && w.lv === target.lv ? 2 : target.lv && Math.abs(w.lv - target.lv) === 1 ? 1 : 0)
    + (target.list && w.list === target.list ? 1 : 0) + (field === 'w' && suffix(w.w) === suffix(target.w) ? 1 : 0) + Math.random() * 1.5;
  const seen = new Set([target[field]]), out = [];
  for (const w of pool.sort((a, b) => score(b) - score(a))) { if (!seen.has(w[field])) { seen.add(w[field]); out.push(w); } if (out.length === 3) break; }
  return out;
}

/* ---------- speech ---------- */
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).split('/')[0]); u.lang = 'en-US'; u.rate = 0.9;
    const v = speechSynthesis.getVoices().find(v => /^en[-_]US/i.test(v.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

/* ---------- spelling diff ---------- */
function editOps(a, b) { // levenshtein with backtrace; returns per-char status for `a` (user input) vs b (target)
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i; for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const flags = new Array(n).fill(true), missing = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { flags[i - 1] = a[i - 1] === b[j - 1]; i--; j--; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { flags[i - 1] = false; i--; }
    else { missing.push(j - 1); j--; }
  }
  return { dist: dp[n][m], flags };
}
function checkSpelling(input, w) {
  const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const user = norm(input), opts = answers(w).map(norm);
  if (opts.includes(user)) return { kind: 'ok', best: answers(w)[opts.indexOf(user)], user };
  let best = null;
  for (const [i, o] of opts.entries()) { const r = editOps(user, o); if (!best || r.dist < best.dist) best = { ...r, target: answers(w)[i] }; }
  const close = best.dist === 1 && best.target.length >= 4;
  return { kind: close ? 'typo' : 'wrong', best: best.target, user, flags: best.flags };
}

/* ---------- views ---------- */
const app = $('#app');
function setTab(t) { S.tab = t; S.pview = 'main'; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); render(); }
function renderBankSwitch() {
  $('#bankswitch').innerHTML = '<div class="bs-track">' + Object.keys(BANKS).map(k => `<button role="tab" class="${S.bank === k ? 'on' : ''}" aria-selected="${S.bank === k}" data-bank="${k}">${esc(BANKS[k].name)}</button>`).join('') + '</div>';
}
function setBank(b) {
  if (!BANKS[b] || b === S.bank) return;
  const fromLanding = !S.bank; S.bank = b;
  if (fromLanding || b !== 'material' && S.tab === 'practice') S.tab = 'home';
  S.pview = 'main';
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === S.tab));
  render();
}
function render() {
  document.body.classList.toggle('in-session', !!S.session);
  document.body.classList.toggle('landing', !S.bank && !S.session);
  document.body.dataset.bank = S.bank || '';
  document.documentElement.dataset.view = S.bank || 'landing';
  const pt = document.querySelector('#tabs [data-tab="practice"]'); if (pt) pt.hidden = S.bank !== 'material';
  renderBankSwitch();
  if (S.session) return renderSession();
  if (!S.bank) { renderLanding(); window.scrollTo(0, 0); return; }
  ({ home: renderHome, practice: renderPractice, progress: renderProgress, settings: renderSettings }[S.tab])();
  window.scrollTo(0, 0);
}

const starPts = (n, ro, ri) => Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / n; return (12 + r * Math.cos(a)).toFixed(2) + ',' + (12.4 + r * Math.sin(a)).toFixed(2); }).join(' ');
const STAR5 = starPts(5, 11, 4.8), STAR8 = starPts(8, 11.5, 6.6);
const starCell = (k, n, cls, lv) => `<i class="${cls}" title="${k}${n == null ? '' : ': ' + n}"${lv == null ? '' : ` data-l="${lv}"`}><svg viewBox="0 0 24 24" aria-hidden="true">${cls.includes('exday') ? `<polygon points="${STAR8}" stroke-linejoin="round"/>` : `<circle class="c" cx="12" cy="12" r="9.5"/>${cls.includes('today') ? '<circle class="dot" cx="12" cy="12" r="3.8"/>' : ''}`}</svg></i>`;
function examLine() {
  const e = S.settings.examDate; if (!e) return '';
  const days = Math.ceil((new Date(e + 'T00:00:00') - new Date()) / DAY); if (days < 0) return '';
  const name = S.settings.examName || '考試', fs = days >= 1000 ? 13 : days >= 100 ? 16 : 21;
  return `<span class="exam-badge" role="img" aria-label="距離${esc(name)}還有 ${days} 天" title="距離${esc(name)}還有 ${days} 天"><svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true"><circle class="bd" cx="26" cy="27" r="22"/><rect class="ring" x="15" y="1.5" width="5" height="11" rx="2.5"/><rect class="ring" x="32" y="1.5" width="5" height="11" rx="2.5"/><text x="26" y="${days >= 100 ? 33 : 35}" text-anchor="middle" font-size="${fs}" font-weight="800" font-family="inherit">${days}</text></svg><span class="dl">Days<br>Left</span></span>`;
}
function examCal() {
  const e = S.settings.examDate; if (!e) return '';
  const days = Math.ceil((new Date(e + 'T00:00:00') - new Date()) / DAY); if (days < 0) return '';
  const name = S.settings.examName || '考試', fs = days >= 1000 ? 22 : days >= 100 ? 28 : 34;
  return `<span class="exam-badge exam-cal" role="img" aria-label="距離${esc(name)}還有 ${days} 天" title="距離${esc(name)}還有 ${days} 天"><svg viewBox="0 0 80 84" width="80" height="84" aria-hidden="true"><circle class="bd" cx="40" cy="46" r="34"/><rect class="ring" x="22" y="2" width="7" height="16" rx="3.5"/><rect class="ring" x="51" y="2" width="7" height="16" rx="3.5"/><text x="40" y="52" text-anchor="middle" font-size="${fs}" font-weight="800" font-family="inherit">${days}</text><text class="dl2" x="40" y="66" text-anchor="middle" font-size="10" font-weight="800" font-family="inherit">Days Left</text></svg></span>`;
}
function iosHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!ios || standalone) return '';
  return `<div class="ios-hint">📱 <b>請先加入主畫面再開始背!</b> 點 Safari 的「分享」→「加入主畫面」。只在 Safari 分頁使用的話,一週沒開,學習進度可能會被清除。</div>`;
}
function bankCard(bank) {
  const info = BANKS[bank], ws = S.words[bank];
  const sample = info.meta?.sample ? `<div class="sample-banner">目前是<b>示範資料</b>(${esc(info.meta.note || '請以正式單字庫取代')})</div>` : '';
  let chips = '';
  if (bank === 'gsat') chips = `<div class="chips" data-chips="levels">${[1, 2, 3, 4, 5, 6].map(l => `<button class="chip ${S.settings.levels.includes(l) ? 'on' : ''}" data-level="${l}">L${l}</button>`).join('')}</div>`;
  else if (unitNums().length > 1) {
    const u = unitNums(), lo = S.settings.unitFrom ?? u[0], hi = S.settings.unitTo ?? u[u.length - 1], opt = v => u.map(n => `<option value="${n}" ${n === v ? 'selected' : ''}>Unit ${n}</option>`).join('');
    chips = `<div class="row wrap" style="margin:10px 0 12px"><span class="muted small">單元範圍</span><select id="u-from">${opt(lo)}</select><span class="muted small">到</span><select id="u-to">${opt(hi)}</select></div>`;
  }
  if (!ws.length) return `<section class="card"><h2>${info.name}</h2><p class="muted">尚未匯入單字庫(<code>${info.file}</code>)。</p></section>`;
  const modes = Object.keys(MODES).map(m => {
    const c = countsFor(bank, m), n = c.due + c.newLeft;
    return `<button class="mode" data-start="${bank}:${m}" ${c.total ? '' : 'disabled'}><b>${MODES[m]}</b><span>${n ? `${c.due} 複習 · ${c.newLeft} 新` : '今日完成 ✓'}</span></button>`;
  }).join('');
  const learned = ws.filter(w => S.cards.has(cardId(bank, w.id, 'recog'))).length;
  return `<section class="card bank"><div class="row between"><h2>${info.name}</h2><span class="bank-stat"><b>${learned}</b> / ${ws.length}<small>已學</small></span></div><p class="muted small" style="margin:2px 0 0">目前範圍 ${scopeWords(bank).length} 字</p>${chips}<div class="modes">${modes}</div>${sample}</section>`;
}
const deco = (x, y, size, color, rot = 0, burst = false) => `<svg class="deco" style="left:${x};top:${y};width:${size}px;height:${size}px;transform:rotate(${rot}deg)" viewBox="0 0 24 24" aria-hidden="true"><polygon points="${burst ? STAR8 : STAR5}" fill="${color}" stroke-linejoin="round"/></svg>`;
const FACES = {
  material: '<svg class="face" viewBox="0 0 100 72" aria-hidden="true">'
    + '<circle cx="30" cy="22" r="14" fill="#fff" stroke="#1a1a1a" stroke-width="3"/>'
    + '<circle cx="70" cy="22" r="14" fill="#fff" stroke="#1a1a1a" stroke-width="3"/>'
    + '<circle cx="33" cy="22" r="8" fill="#1a1a1a"/>'
    + '<circle cx="73" cy="22" r="8" fill="#1a1a1a"/>'
    + '<circle cx="30" cy="18" r="3.5" fill="#fff"/>'
    + '<circle cx="70" cy="18" r="3.5" fill="#fff"/>'
    + '<path d="M25 48c0 16 50 16 50 0z" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="2"/>'
    + '<rect x="35" y="48" width="30" height="5" rx="1" fill="#fff"/>'
    + '<ellipse cx="50" cy="62" rx="8" ry="5" fill="#ff6b9d"/>'
    + '</svg>',
  gsat: '<svg class="face" viewBox="0 0 100 72" aria-hidden="true">'
    + '<circle cx="30" cy="24" r="14" fill="#fff" stroke="#1a1a1a" stroke-width="3"/>'
    + '<circle cx="70" cy="20" r="11" fill="#fff" stroke="#1a1a1a" stroke-width="3"/>'
    + '<circle cx="33" cy="24" r="8" fill="#1a1a1a"/>'
    + '<circle cx="72" cy="20" r="6" fill="#1a1a1a"/>'
    + '<circle cx="30" cy="20" r="3.5" fill="#fff"/>'
    + '<circle cx="70" cy="17" r="2.5" fill="#fff"/>'
    + '<path d="M28 50q22 18 44 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'
    + '<circle cx="22" cy="42" r="6" fill="#ff6b9d" opacity=".5"/>'
    + '<circle cx="78" cy="42" r="6" fill="#ff6b9d" opacity=".5"/>'
    + '</svg>',
};
function circleBtn(bank) {
  const info = BANKS[bank];
  return `<button class="circle c-${bank}" data-enter="${bank}" aria-label="${info.name}">${FACES[bank]}<span class="cn">${(([h, ...r]) => esc(h) + (r.length ? '<br><span class="nw">' + esc(r.join(' ')) + '</span>' : ''))(info.name.split(' '))}</span></button>`;
}
function renderLanding() {
  const st = streak();
  app.innerHTML = `${iosHint()}
    <div class="land">
      <div class="land-top"><div class="row" style="gap:8px">${examLine()}</div></div>
      <img class="land-logo" src="icons/logo.png" alt="Vocaboo" draggable="false">
      <div class="duo-img"><img src="icons/landing-duo.png" alt="學測單字表、字彙王 Level 3-5" draggable="false"><button class="hit hit-gsat" data-enter="gsat" aria-label="學測單字表"></button><button class="hit hit-material" data-enter="material" aria-label="字彙王 Level 3-5"></button></div>
      ${store.volatile ? '<p class="small" style="color:#fff"><b>⚠ 此瀏覽器無法儲存資料,關閉後進度會消失</b></p>' : ''}
    </div>`;
}
function renderHome() {
  const st = streak(), today = S.daily[dayKey()]?.reviews || 0;
  app.innerHTML = `${iosHint()}
    <div class="hero"><h1>${BANKS[S.bank].name}</h1>${examCal()}</div>
    <div class="stack">${bankCard(S.bank)}
    <p class="today-n">今天已練習 ${today} 題${store.volatile ? '<br><b style="color:var(--bad)">⚠ 此瀏覽器無法儲存資料,關閉後進度會消失</b>' : ''}</p></div>`;
  const uf = $('#u-from'), ut = $('#u-to');
  if (uf && ut) { const h = async () => { let a = +uf.value, b = +ut.value; if (a > b) [a, b] = [b, a]; S.settings.unitFrom = a; S.settings.unitTo = b; await saveSettings(); render(); }; uf.onchange = h; ut.onchange = h; }
}


function renderProgress() {
  const now = Date.now(); let html = '<h1>進度</h1><div class="stack" style="margin-top:12px">';
  // ---- 教材:練習題本 + 單字,同一個框 ----
  const mat = S.words.material || [];
  if (S.bank === 'material' && (S.questions.length || mat.length)) {
    html += '<section class="card"><h2>字彙王 Level 3-5</h2>';
    if (S.questions.length) {
      const t = qTotals(), pct = t.ok / t.total * 100, units = unitList();
      const full = units.filter(u => { const x = qTotals(q => q.unit === u); return x.ok === x.total; }).length;
      html += `<div class="sec-t">練習題本</div>
      <div class="pbar"><i class="g" style="width:${pct}%"></i><i class="r" style="width:${t.wrong / t.total * 100}%"></i><em>${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</em></div>
      <div class="stat-grid" style="margin-top:12px"><div class="stat pstat"><b>${t.tried}</b><span>已作答</span></div><div class="stat pstat"><b>${t.wrong}</b><span>錯題</span></div><div class="stat pstat"><b>${full}</b><span>全對單元 / ${units.length}</span></div></div>`;
    }
    if (mat.length) {
      let learned = 0, mastered = 0, due = 0;
      for (const w of mat) { const c = S.cards.get(cardId('material', w.id, 'recog')); if (c) { learned++; if (c.stability >= 21) mastered++; if (c.due <= now) due++; } }
      html += `<div class="sec-t" style="margin-top:18px">單字學習</div><div class="stat-grid"><div class="stat pstat"><b>${learned}</b><span>已學 / ${mat.length}</span></div><div class="stat pstat"><b>${mastered}</b><span>已精熟</span></div><div class="stat pstat"><b>${due}</b><span>待複習</span></div></div>
      <div class="pbar" style="margin-top:10px"><i class="g" style="width:${learned / mat.length * 100}%"></i><em>${Math.round(learned / mat.length * 100)}%</em></div><div class="small muted" style="margin-top:6px">已學的單字佔全部 ${mat.length} 個的比例</div>
      <p class="small muted" style="margin-top:6px">「精熟」= 記憶穩定度超過 21 天</p>`;
    }
    html += '</section>';
  }
  for (const bank of Object.keys(BANKS).filter(k => k !== 'material' && k === S.bank)) {
    const ws = S.words[bank]; if (!ws.length) continue;
    let learned = 0, mastered = 0, due = 0;
    const byLv = {};
    for (const w of ws) {
      const c = S.cards.get(cardId(bank, w.id, 'recog')), l = w.lv || 0; (byLv[l] ||= { n: 0, m: 0, l: 0 }).n++;
      if (c) { learned++; byLv[l].l++; if (c.stability >= 21) { mastered++; byLv[l].m++; } if (c.due <= now) due++; }
    }
    html += `<section class="card"><h2>${BANKS[bank].name}</h2><div class="stat-grid" style="margin-top:8px">
      <div class="stat pstat"><b>${learned}</b><span>已學 / ${ws.length}</span></div><div class="stat pstat"><b>${mastered}</b><span>已精熟</span></div><div class="stat pstat"><b>${due}</b><span>待複習</span></div></div>`;
    if (bank === 'gsat') html += '<div style="margin-top:12px">' + Object.keys(byLv).sort().map(l => { const v = byLv[l]; return `<div class="lvl"><span>L${l}</span><div class="track"><i class="m" style="width:${v.m / v.n * 100}%"></i><i class="l" style="width:${(v.l - v.m) / v.n * 100}%"></i></div><span class="muted small">${v.m}/${v.n}</span></div>`; }).join('') + '</div>';
    html += '<p class="small muted">「精熟」= 記憶穩定度超過 21 天</p></section>';
  }
  const goal = S.settings.dailyGoal, lvl = n => n === 0 ? 0 : n <= 20 ? 1 : 2;
  const exD = S.settings.examDate ? new Date(S.settings.examDate + 'T00:00:00') : null, left = exD ? Math.ceil((exD - new Date()) / DAY) : -1;
  const toExam = !S.settings.progressDays && left >= 0, cells = [];
  let nd, calTitle;
  if (toExam) {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0); const sd = new Date((S.settings.startDate || dayKey()) + 'T00:00:00'), back = Math.max(0, Math.min(365, Math.round((t0 - sd) / DAY))); nd = back + left + 1; calTitle = `${esc(S.settings.examName || '考試')}倒數`;
    for (let i = -back; i <= left; i++) {
      const k = dayKey(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i)), n = S.daily[k]?.reviews || 0;
      cells.push(i > 0 ? starCell(k, null, i === left ? 'exday' : 'f') : starCell(k, n, i === 0 ? 'today' : '', lvl(n)));
    }
  } else {
    nd = Math.min(365, Math.max(7, S.settings.progressDays || 45)); calTitle = `最近 ${nd} 天`;
    for (let i = nd - 1; i >= 0; i--) { const k = dayKey(new Date(Date.now() - i * DAY)), n = S.daily[k]?.reviews || 0; cells.push(starCell(k, n, '', lvl(n))); }
  }
  const sIcon = (cls, lv) => starCell('', null, cls, lv).replace(' title=""', '');
  const legend = [[sIcon('f'), '沒有練習 / 未到'], [sIcon('', 1), '1–20 題'], [sIcon('', 2), '20 題以上']];
  if (toExam) legend.push([sIcon('today', 0), '今天'], [sIcon('exday'), `${esc(S.settings.examName || '考試')}日`]);
  const legendHtml = `<div class="star-legend">${legend.map(([ic, t]) => `<div class="sl">${ic}<span>${t}</span></div>`).join('')}</div>`;
  html += `<section class="card"><div class="row between"><h2>${calTitle}</h2><div class="row" style="gap:8px">${examLine()}</div></div><div class="heat">${cells.join('')}</div>${legendHtml}</section></div>`;
  app.innerHTML = html;
}

const APP_VERSION = 'v72';
function renderSettings() {
  const s = S.settings;
  const days = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / DAY) : null;
  app.innerHTML = `<h1>設定</h1><div class="stack" style="margin-top:12px">
  <section class="card">
    <label class="set"><span>每天新字上限</span><input type="number" id="s-new" min="0" max="200" value="${s.newPerDay}"></label>
    <label class="set"><span>每回題數</span><input type="number" id="s-size" min="5" max="100" value="${s.sessionSize}"></label>
    <label class="set"><span>每天幾題算一天</span><input type="number" id="s-goal" min="1" max="200" value="${s.dailyGoal}"></label>
    <label class="set"><span>目標記憶保留率</span><select id="s-ret">${[0.85, 0.9, 0.95].map(v => `<option value="${v}" ${v === s.retention ? 'selected' : ''}>${v * 100}%</option>`).join('')}</select></label>
    <label class="set"><span>常用考試</span><select id="s-preset">${EXAM_PRESETS.map((x, i) => `<option value="${i}" ${x.name === s.examName ? 'selected' : ''}>${x.name}${x.date ? '(' + x.date + ')' : ''}</option>`).join('')}<option value="-1" ${EXAM_PRESETS.some(x => x.name === s.examName) ? '' : 'selected'}>自訂</option></select></label>
    <label class="set"><span>考試名稱</span><input type="text" id="s-ename" maxlength="12" placeholder="例如:學測、會考、段考" value="${esc(s.examName)}"></label>
    <label class="set"><span>考試日期</span><input type="date" id="s-exam" value="${esc(s.examDate)}"></label>
    <label class="set"><span>進度日曆天數(0 = 到考試日)</span><input type="number" id="s-pdays" min="0" max="365" value="${s.progressDays}"></label>
    <div class="row wrap" style="margin-top:6px"><button class="btn ghost" id="p-exam">日曆顯示到考試日</button></div>
  </section>
  <section class="card"><h2>備份</h2>
    <p class="small muted">${days === null ? '尚未備份過。' : `上次備份在 ${days} 天前。`}換手機或清除瀏覽器資料前,請先匯出。</p>
    <div class="row wrap" style="margin-top:8px"><button class="btn" id="b-export">匯出進度</button><label class="btn ghost" style="display:inline-flex;align-items:center">匯入進度<input type="file" id="b-import" accept="application/json" hidden></label></div>
    <p class="small muted" style="margin-top:12px">${store.volatile ? '⚠ 無法使用瀏覽器儲存。' : '資料只存在這支手機的瀏覽器中。'}</p>
    <button class="btn ghost danger-btn" id="b-reset" style="margin-top:6px">清除所有進度</button>
  </section>
  <section class="card credits"><h2>關於與致謝</h2>
    <p>學測詞彙等級:大學入學考試中心《高中英文參考詞彙表》(111 學年度起適用)。著作權屬財團法人大學入學考試中心基金會所有,僅供非營利目的使用。</p>
    <p>中文釋義(若有):ECDICT(MIT License),經轉換為繁體中文。例句(若有):<a href="https://tatoeba.org" target="_blank" rel="noopener">Tatoeba</a>(CC BY 2.0 FR)或自編。</p>
    <p>複習排程:<a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank" rel="noopener">ts-fsrs</a>(MIT)。</p>
  </section><p class="small muted" style="text-align:center">Vocaboo ${APP_VERSION}</p></div>`;
  const num = (id, key) => $(id).addEventListener('change', async e => { s[key] = Math.max(0, +e.target.value || 0); await saveSettings(); });
  num('#s-new', 'newPerDay'); num('#s-size', 'sessionSize'); num('#s-goal', 'dailyGoal');
  $('#s-preset').addEventListener('change', async e => { const x = EXAM_PRESETS[+e.target.value]; if (!x) return $('#s-ename').focus(); s.examName = x.name; s.examDate = x.date; await saveSettings(); renderSettings(); if (!x.date) $('#s-exam').focus(); });
  $('#s-ename').addEventListener('change', async e => { s.examName = e.target.value.trim(); await saveSettings(); });
  $('#s-pdays').addEventListener('change', async e => { { const v = Math.round(+e.target.value) || 0; s.progressDays = v <= 0 ? 0 : Math.min(365, Math.max(7, v)); } e.target.value = s.progressDays; await saveSettings(); });
  $('#p-exam').addEventListener('click', async () => { s.progressDays = 0; await saveSettings(); renderSettings(); });
  $('#s-ret').addEventListener('change', async e => { s.retention = +e.target.value; makeFsrs(); await saveSettings(); });
  $('#s-exam').addEventListener('change', async e => { s.examDate = e.target.value; await saveSettings(); });
  $('#b-export').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await store.exportAll())], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `vocab-backup-${dayKey()}.json` });
    document.body.append(a); a.click(); a.remove(); s.lastBackupAt = Date.now(); await saveSettings(); renderSettings();
  });
  $('#b-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await store.importAll(JSON.parse(await f.text())); await boot(true); alert('匯入完成'); } catch (err) { alert('匯入失敗:' + err.message); }
  });
  $('#b-reset').addEventListener('click', async () => { if (confirm('確定要清除所有學習進度嗎?此動作無法復原。')) { await store.clear(); await boot(true); } });
}
const saveSettings = () => store.setKV('settings', S.settings);

/* ---------- session ---------- */
function doneSheet(bank, mode) {
  const { fresh } = countsFor(bank, mode), more = Math.min(20, fresh), seen = S.words[bank].some(w => S.cards.has(cardId(bank, w.id, typeOf(mode))));
  const el = document.createElement('div'); el.className = 'sheet-bg';
  el.innerHTML = `<div class="sheet card"><h2>今天的進度已完成 ✓</h2><p class="muted small">你想怎麼繼續?</p>
    <button class="btn block" data-sheet="more" ${more ? '' : 'disabled'}>再學 ${more} 個新字${more ? '' : '(沒有新字了)'}</button>
    <button class="btn ghost block" data-sheet="practice" ${seen ? '' : 'disabled'}>複習已學過的字(10 題,不影響排程)</button>
    <button class="btn ghost block" data-sheet="close">關閉</button></div>`;
  el.onclick = async e => {
    const a = e.target.dataset.sheet; if (!a && e.target !== el) return;
    el.remove();
    if (a === 'more') { const d = (S.daily[dayKey()] ||= { reviews: 0, correct: 0, new: {} }); d.bonus ||= {}; const k = `${bank}:${typeOf(mode)}`; d.bonus[k] = (d.bonus[k] || 0) + more; await store.setKV('daily', S.daily); startSession(bank, mode); }
    else if (a === 'practice') startSession(bank, mode, true);
  };
  document.body.appendChild(el);
}
function startSession(bank, mode, practice = false) {
  const queue = buildQueue(bank, mode, practice);
  if (!queue.length) { if (!practice) doneSheet(bank, mode); return; }
  S.session = { bank, mode, practice, queue, pos: 0, total: queue.length, results: [], revealed: false, t0: Date.now(), answered: false };
  render();
}
function endSession() { S.session = null; render(); }
function curWord() { const s = S.session; return wordById[`${s.bank}:${s.queue[s.pos]}`]; }

function renderSession() {
  const s = S.session;
  if (s.kind === 'ex') return renderEx();
  if (s.pos >= s.queue.length) return renderSummary();
  const w = curWord(), pct = Math.round(s.results.length / s.total * 100);
  const head = `<div class="topbar"><button class="icon-btn" data-act="quit" aria-label="離開">✕</button><div class="bar"><i style="width:${pct}%"></i></div><span class="muted small">${s.results.length}/${s.total}${s.practice ? ' · 練習' : ''}</span></div>`;
  if (s.mode === 'flash') return renderFlash(head, w);
  if (s.mode === 'mcq') return renderMcq(head, w);
  return renderSpell(head, w);
}
const exBlock = w => w.ex ? `<div class="ex">${esc(w.ex)}${w.exzh ? `<br><span>${esc(w.exzh)}</span>` : ''}</div>` : '';
const speakBtn = w => `<button class="icon-btn" data-speak="${esc(w.w)}" aria-label="發音">🔊</button>`;

function renderFlash(head, w) {
  const s = S.session;
  let body = `<div class="card q"><div class="word">${esc(w.w)}</div><div class="pos">${esc(w.pos || '')}</div><div style="margin-top:10px">${speakBtn(w)}</div>`;
  if (s.revealed) {
    body += `<div class="zh">${esc(w.zh)}</div>${exBlock(w)}</div>`;
    const iv = s.practice ? ['', '', '', ''] : previewIntervals(s.bank, w.id);
    body += `<div class="ratings">${[['忘了', 1], ['有點難', 2], ['記得', 3], ['太簡單', 4]].map(([t, r], i) => `<button class="rate r${r}" data-rate="${r}"><b>${t}</b><span>${iv[i]}</span></button>`).join('')}</div>`;
  } else body += `</div><button class="btn block" style="margin-top:14px" data-act="reveal">顯示答案</button>`;
  app.innerHTML = head + body;
}

function renderMcq(head, w) {
  const s = S.session;
  if (!s.q || s.q.id !== w.id) {
    const rec = S.cards.get(cardId(s.bank, w.id, 'recog')), reverse = !!rec && rec.stability > 3 && S.words[s.bank].length >= 4 && Math.random() < 0.5;
    const field = reverse ? 'w' : 'zh', ds = distractors(w, s.bank, field);
    s.q = { id: w.id, reverse, field, opts: shuffle([w, ...ds]), picked: null, t0: Date.now() };
  }
  const q = s.q;
  let body = `<div class="card q">${q.reverse ? `<div class="muted small">哪一個英文單字的意思是</div><div class="zh">${esc(w.zh)}</div><div class="pos">${esc(w.pos || '')}</div>` : `<div class="word">${esc(w.w)}</div><div class="pos">${esc(w.pos || '')}</div><div style="margin-top:10px">${speakBtn(w)}</div>`}</div>`;
  body += `<div class="opts">${q.opts.map((o, i) => {
    let cls = ''; if (q.picked !== null) cls = o.id === w.id ? 'ok' : i === q.picked ? 'no' : '';
    const hit = q.picked === i && o.id === w.id;
    return `<button class="opt ${cls}${hit ? ' picked' : ''}" data-pick="${i}" ${q.picked !== null ? 'disabled' : ''}><span>${esc(q.reverse ? o.w : o.zh)}</span>${hit ? '<b class="opt-tag">✓ 正確</b>' : ''}</button>`;
  }).join('')}</div>`;
  if (q.picked !== null) body += `<div class="card" style="margin-top:12px"><b>${esc(w.w)}</b> ${esc(w.pos || '')} — ${esc(w.zh)}${exBlock(w)}</div><button class="btn block" style="margin-top:12px" data-act="next">下一題</button>`;
  app.innerHTML = head + body;
}

function renderSpell(head, w) {
  const s = S.session, r = s.spellResult;
  let body = `<div class="card q"><div class="muted small">請拼出這個字</div><div class="zh">${esc(w.zh)}</div><div class="pos">${esc(w.pos || '')}${w.w.includes('/') ? '' : ` · ${w.w.length} 個字母`}</div><div style="margin-top:10px">${speakBtn(w)}</div>${s.hint ? `<div class="pos" style="margin-top:6px">提示:${esc(w.w[0])}${'・'.repeat(Math.max(0, answers(w)[0].length - 1))}</div>` : ''}</div>`;
  if (!r) {
    body += `<form id="spell-form" style="margin-top:14px" autocomplete="off"><input class="field" id="spell-in" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="輸入英文" aria-label="拼字答案"><div class="row" style="margin-top:12px"><button type="button" class="btn ghost" data-act="hint" ${s.hint ? 'disabled' : ''}>提示</button><button type="button" class="btn ghost" data-act="giveup">不會</button><button class="btn grow" type="submit">送出</button></div></form>`;
  } else {
    const shown = r.flags ? [...r.user].map((ch, i) => `<span class="${r.flags[i] ? 'good' : 'x'}">${esc(ch)}</span>`).join('') : '';
    body += `<div class="card" style="margin-top:14px;text-align:center">
      ${r.kind === 'ok' ? `<div class="verdict ok">✓ 正確!</div>` : r.kind === 'typo' ? `<div class="verdict half">差一點!有一個字母不對</div>` : `<div class="verdict no">${r.gaveUp ? '正確答案' : '✗ 再記一次'}</div>`}
      ${r.kind !== 'ok' && r.user ? `<div class="muted small">你的答案</div><div class="diff">${shown}</div>` : ''}
      <div class="muted small">正確拼法</div><div class="diff"><span class="good">${esc(w.w.split('/').join(' / '))}</span></div>${exBlock(w)}</div>
      <button class="btn block" style="margin-top:12px" data-act="next">下一題</button>`;
  }
  app.innerHTML = head + body;
  const inp = $('#spell-in'); if (inp) inp.focus({ preventScroll: true });
}

function renderSummary() {
  const s = S.session, ok = s.results.filter(r => r.rating >= 3).length, missed = s.results.filter(r => r.rating < 3);
  app.innerHTML = `<div class="stack"><section class="card q"><h1>${ok === s.total ? '全部答對!🎉' : '完成這一回'}</h1><p class="zh">${ok} / ${s.total}</p><p class="muted">答對率 ${Math.round(ok / s.total * 100)}% · 用時 ${Math.max(1, Math.round((Date.now() - s.t0) / 60000))} 分鐘</p></section>
    ${missed.length ? `<section class="card"><h2>需要再加強</h2><ul class="missed">${[...new Map(missed.map(r => [r.wid, r])).values()].map(r => { const w = wordById[`${s.bank}:${r.wid}`]; return `<li><b>${esc(w.w)}</b> ${esc(w.pos || '')} — ${esc(w.zh)}</li>`; }).join('')}</ul></section>` : ''}
    <button class="btn block" data-act="again">再來一回</button><button class="btn ghost block" data-act="quit">回首頁</button></div>`;
}

async function answerCurrent(rating, extra = {}) {
  const s = S.session, w = curWord(); await grade(s.bank, w.id, s.mode, rating, { wid: w.id, ...extra });
  s.results.push({ wid: w.id, rating });
  if (rating === 1 && !s.practice && s.queue.length - s.pos < 40) { const at = Math.min(s.queue.length, s.pos + 4); s.queue.splice(at, 0, w.id); s.total++; } // see it again soon
  s.pos++; s.revealed = false; s.q = null; s.spellResult = null; s.hint = false; render();
}

/* ---------- exercise questions (教材練習題本) ---------- */
const BLANK_RE = /[A-Za-z]*_{2,}[A-Za-z]*(?:\s*\([A-Za-z]+\))?/;
function sentenceHtml(q, revealed, wrongPick) {
  if (!revealed) return esc(q.q).replace(/([A-Za-z]*)(_{2,})([A-Za-z]*)/g, (_, a, m, b) => '<span class="nb">' + a + '<span class="blank" style="min-width:' + Math.max(2.4, m.length * 0.55).toFixed(1) + 'em"></span>' + b + '</span>');
  const m = BLANK_RE.exec(q.q); if (!m) return esc(q.full);
  const tail = q.q.length - m.index - m[0].length, ans = q.full.slice(m.index, q.full.length - tail);
  return esc(q.q.slice(0, m.index)) + '<mark class="ans">' + esc(ans) + '</mark>' + esc(q.q.slice(m.index + m[0].length));
}
const qSt = id => S.qstats.get(id);
function qTotals(filter = () => true) {
  let total = 0, tried = 0, ok = 0, wrong = 0, first = 0;
  for (const q of S.questions) { if (!filter(q)) continue; total++; const st = qSt(q.id); if (!st) continue; tried++; if (st.last) ok++; else wrong++; if (st.firstOk) first++; }
  return { total, tried, ok, wrong, first };
}
const wrongIds = (filter = () => true) => S.questions.filter(q => filter(q) && qSt(q.id) && !qSt(q.id).last).map(q => q.id);
const unitList = () => [...new Set(S.questions.map(q => q.unit))].sort((a, b) => a - b);

async function recordQ(q, ok, extra = {}) {
  const prev = qSt(q.id), st = { id: q.id, n: (prev?.n || 0) + 1, ok: (prev?.ok || 0) + (ok ? 1 : 0), last: ok, firstOk: prev ? prev.firstOk : ok, ts: Date.now() };
  S.qstats.set(q.id, st); await store.putQ(st);
  const d = (S.daily[dayKey()] ||= { reviews: 0, correct: 0, new: {} }); d.reviews++; if (ok) d.correct++;
  await store.setKV('daily', S.daily); await store.addLog({ ts: Date.now(), cardId: 'q:' + q.id, rating: ok ? 3 : 1, source: 'ex', ...extra });
}

function startEx(ids, opts = {}) {
  if (!ids.length) return;
  S.session = { kind: 'ex', queue: ids.slice(), pos: 0, total: ids.length, results: [], t0: Date.now(), retest: !!opts.retest, title: opts.title || '', cur: null };
  render();
}
function nextNewIds(n = 20) { return S.questions.filter(q => !qSt(q.id)).slice(0, n).map(q => q.id); }

function unitTile(u) {
  const t = qTotals(q => q.unit === u), cls = t.tried === 0 ? '' : t.wrong ? 'bad' : t.ok === t.total ? 'good' : 'part';
  return `<button class="tile ${cls}" data-xunit="${u}"><b>${u}</b><span>${t.ok}/${t.total}</span></button>`;
}
function renderPractice() {
  if (!S.questions.length) { app.innerHTML = '<h1>字彙王 Level 3-5  練習題本</h1><p class="muted" style="margin-top:12px">尚未匯入練習題本(<code>data/questions.json</code>)。</p>'; return; }
  if (S.pview === 'unit') return renderUnit();
  const t = qTotals(), w = t.wrong, units = unitList();
  app.innerHTML = `<h1>字彙王 Level 3-5  練習題本</h1><div class="stack" style="margin-top:12px">
  <section class="card"><div class="row between"><h2>總進度</h2><span class="muted small">共 ${t.total} 題 · ${units.length} 個單元</span></div>
    <div class="bigscore"><b>${t.ok}</b><span>/ ${t.total} 題目前答對</span></div>
    <div class="seg"><i class="g" style="width:${t.ok / t.total * 100}%"></i><i class="r" style="width:${t.wrong / t.total * 100}%"></i></div>
    <div class="stat-grid" style="margin-top:12px"><div class="stat"><b>${t.tried}</b><span>已作答</span></div><div class="stat"><b>${w}</b><span>錯題待複習</span></div><div class="stat"><b>${t.tried ? Math.round(t.first / t.tried * 100) : 0}%</b><span>一次答對率</span></div></div>
    <div class="row wrap" style="margin-top:14px"><button class="btn block" data-pact="retest" ${w ? '' : 'disabled'}>重測所有錯題(${w})</button></div>
  </section>
  <section class="card"><h2>選擇單元</h2><p class="small muted">點單元進入:可測驗整個單元、只重測錯題,並查看該單元的錯題。做到一半離開,進度會自動存起來。<span class="dot g"></span>全對 <span class="dot y"></span>進行中 <span class="dot r"></span>有錯題</p>
    <div class="tiles">${units.map(unitTile).join('')}</div></section></div>`;
}

function renderUnit() {
  const u = S.punit, qs = S.questions.filter(q => q.unit === u), t = qTotals(q => q.unit === u);
  const left = qs.filter(q => !qSt(q.id)), wrong = qs.filter(q => qSt(q.id) && !qSt(q.id).last);
  const item = q => `<div class="witem"><div class="muted small">第 ${q.no} 題 · ${QTYPES[q.type]} · 答錯 ${(qSt(q.id).n - qSt(q.id).ok)} 次</div><div>${sentenceHtml(q, true)}</div><div class="small"><b>${esc(q.ans)}</b> <span class="muted">${esc(q.pos)} ${esc(q.zh)}</span></div></div>`;
  const types = ['all', ...['fill', 'mcq', 'match'].filter(x => wrong.some(q => q.type === x))], f = types.includes(S.wrongType) ? S.wrongType : 'all';
  const shown = wrong.filter(q => f === 'all' || q.type === f), partial = left.length > 0 && left.length < qs.length;
  app.innerHTML = `<div class="topbar"><button class="icon-btn" data-pact="back" aria-label="返回">←</button><h1 style="font-size:1.25rem">Unit ${u}</h1></div>
  <div class="stack"><section class="card">
    <div class="stat-grid"><div class="stat"><b>${t.tried}/${t.total}</b><span>已作答</span></div><div class="stat"><b>${t.ok}</b><span>目前答對</span></div><div class="stat"><b>${wrong.length}</b><span>錯題</span></div></div>
    <div class="stack" style="margin-top:14px;gap:10px">
      ${partial ? `<button class="btn block" data-uact="resume">繼續作答(還剩 ${left.length} 題)</button><button class="btn ghost block" data-uact="all">從頭重做整個單元(${qs.length} 題)</button>` : `<button class="btn block" data-uact="all">測驗整個單元(${qs.length} 題)</button>`}
      <button class="btn ghost block" data-uact="wrong" ${wrong.length ? '' : 'disabled'}>只重測錯題(${wrong.length})</button>
    </div></section>
  <section class="card"><h2>答錯的題目</h2>${wrong.length ? `<div class="chips">${types.map(x => `<button class="chip ${f === x ? 'on' : ''}" data-wtype="${x}">${x === 'all' ? '全部' : QTYPES[x]}</button>`).join('')}</div>${shown.map(item).join('')}` : '<p class="muted small" style="margin-top:6px">這個單元目前沒有錯題。</p>'}</section></div>`;
}

/* --- exercise session --- */
function exQuestionState(q) {
  const s = S.session;
  if (!s.cur || s.cur.id !== q.id) s.cur = { id: q.id, picked: null, result: null, fill: null, hint: false, opts: q.opts ? (s.retest ? shuffle(q.opts) : q.opts.slice()) : null };
  return s.cur;
}
function renderEx() {
  const s = S.session;
  if (s.pos >= s.queue.length) return renderExSummary();
  const q = qById[s.queue[s.pos]], c = exQuestionState(q), pct = Math.round(s.results.length / s.total * 100), done = c.result !== null;
  let body = `<div class="topbar"><button class="icon-btn" data-xact="quit" aria-label="離開">✕</button><div class="bar"><i style="width:${pct}%"></i></div><span class="muted small">${s.results.length}/${s.total}${s.retest ? ' · 重測' : ''}</span></div>`;
  body += `<div class="card"><div class="muted small">Unit ${q.unit} · 第 ${q.no} 題 · ${QTYPES[q.type]}</div><p class="qtext">${sentenceHtml(q, done)}</p>${c.hint && !done ? `<div class="small muted">提示:${esc(q.pos)} ${esc(q.zh)}</div>` : ''}</div>`;
  if (q.type === 'fill') {
    if (!done) body += `<form id="ex-form" style="margin-top:14px" autocomplete="off"><input class="field" id="ex-in" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="輸入完整單字" aria-label="答案"><div class="row" style="margin-top:12px"><button type="button" class="btn ghost" data-xact="hint" ${c.hint ? 'disabled' : ''}>提示</button><button type="button" class="btn ghost" data-xact="giveup">不會</button><button class="btn grow" type="submit">送出</button></div></form>`;
    else {
      const r = c.fill, shown = r.flags ? [...r.user].map((ch, i) => `<span class="${r.flags[i] ? 'good' : 'x'}">${esc(ch)}</span>`).join('') : '';
      body += `<div class="card" style="margin-top:14px;text-align:center">${r.kind === 'ok' ? '<div class="verdict ok">✓ 正確!</div>' : r.kind === 'typo' ? '<div class="verdict half">差一個字母(拼字要完全正確才算對)</div>' : `<div class="verdict no">${r.gaveUp ? '正確答案' : '✗ 答錯了'}</div>`}${r.kind !== 'ok' && r.user ? `<div class="muted small">你的答案</div><div class="diff">${shown}</div>` : ''}<div class="muted small">正確答案</div><div class="diff"><span class="good">${esc(q.ans)}</span></div><div class="small">${esc(q.pos)} ${esc(q.zh)}</div></div>`;
    }
  } else {
    body += `<div class="opts ${q.type === 'match' ? 'bank' : ''}">${c.opts.map((o, i) => {
      const lab = s.retest ? '' : `(${'ABCDEF'[i]}) `; let cls = ''; if (done) cls = o === q.ans ? 'ok' : i === c.picked ? 'no' : '';
      const hit = done && i === c.picked && o === q.ans;
      return `<button class="opt ${cls}${hit ? ' picked' : ''}" data-xpick="${i}" ${done ? 'disabled' : ''}><span>${lab}${esc(o)}</span>${hit ? '<b class="opt-tag">✓ 正確</b>' : ''}</button>`;
    }).join('')}</div>`;
    if (done) body += `<div class="card" style="margin-top:12px">${c.result ? '<div class="verdict ok">✓ 正確!</div>' : '<div class="verdict no">✗ 答錯了</div>'}<b>${esc(q.ans)}</b> <span class="muted">${esc(q.pos)} ${esc(q.zh)}</span></div>`;
  }
  if (done) body += `<div class="row" style="margin-top:12px"><button class="icon-btn" data-speak="${esc(q.ans)}" aria-label="發音">🔊</button><button class="btn grow" data-xact="next">${s.pos + 1 >= s.queue.length ? '看結果' : '下一題'}</button></div>`;
  app.innerHTML = body;
  const inp = $('#ex-in'); if (inp) inp.focus({ preventScroll: true });
}
function renderExSummary() {
  const s = S.session, ok = s.results.filter(r => r.ok).length, miss = s.results.filter(r => !r.ok).map(r => qById[r.id]);
  const left = wrongIds().length;
  app.innerHTML = `<div class="stack"><section class="card q"><h1>${ok === s.total ? '全部答對!🎉' : '完成這一回'}</h1><p class="zh">${ok} / ${s.total}</p><p class="muted">答對率 ${Math.round(ok / s.total * 100)}% · 用時 ${Math.max(1, Math.round((Date.now() - s.t0) / 60000))} 分鐘</p>${s.retest ? `<p class="small">錯題本還剩 <b>${left}</b> 題</p>` : ''}</section>
    ${miss.length ? `<section class="card"><h2>這回答錯的題目</h2>${miss.map(q => `<div class="witem"><div class="muted small">Unit ${q.unit} · 第 ${q.no} 題</div><div>${sentenceHtml(q, true)}</div><div class="small"><b>${esc(q.ans)}</b> <span class="muted">${esc(q.pos)} ${esc(q.zh)}</span></div></div>`).join('')}</section>` : ''}
    ${miss.length ? `<button class="btn block" data-xact="redo-miss">馬上重測這 ${miss.length} 題</button>` : ''}
    ${left && !miss.length ? '<button class="btn block" data-xact="retest-all">繼續重測錯題本</button>' : ''}
    <button class="btn ghost block" data-xact="quit">回練習題本</button></div>`;
}
function checkFill(input, ans) {
  const norm = x => x.trim().toLowerCase().replace(/\s+/g, ' '), user = norm(input), a = ans.toLowerCase();
  if (user === a) return { kind: 'ok', user };
  const r = editOps(user, a);
  return { kind: r.dist === 1 && a.length >= 4 ? 'typo' : 'wrong', user, flags: r.flags };
}
async function exAnswer(ok, extra) {
  const s = S.session, q = qById[s.queue[s.pos]]; s.cur.result = ok; await recordQ(q, ok, extra); s.results.push({ id: q.id, ok }); render();
}
async function exClick(t, s) {
  if (t.dataset.speak) return speak(t.dataset.speak);
  const q = qById[s.queue[s.pos]];
  if (t.dataset.xpick !== undefined && s.cur && s.cur.result === null) { const i = +t.dataset.xpick; s.cur.picked = i; return exAnswer(s.cur.opts[i] === q.ans, { answer: s.cur.opts[i] }); }
  switch (t.dataset.xact) {
    case 'quit': if (!s.results.length || s.pos >= s.queue.length || confirm('要離開嗎?已作答的題目會保留。')) { S.session = null; S.pview = S.punit != null ? 'unit' : 'main'; render(); } break;
    case 'hint': s.cur.hint = true; { const v = $('#ex-in')?.value; renderEx(); if ($('#ex-in')) $('#ex-in').value = v || ''; } break;
    case 'giveup': s.cur.fill = { kind: 'wrong', user: '', gaveUp: true }; await exAnswer(false, { answer: '' }); break;
    case 'next': s.pos++; s.cur = null; render(); break;
    case 'redo-miss': { const ids = s.results.filter(r => !r.ok).map(r => r.id); S.session = null; startEx(ids, { retest: true }); break; }
    case 'retest-all': S.session = null; startEx(shuffle(wrongIds()), { retest: true }); break;
  }
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.bank) return setBank(t.dataset.bank);
  if (t.dataset.enter) return setBank(t.dataset.enter);
  if (t.dataset.tab) return setTab(t.dataset.tab);
  if (t.dataset.pgunit) { S.tab = 'practice'; S.punit = +t.dataset.pgunit; S.pview = 'unit'; S.wrongType = 'all'; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === 'practice')); return render(); }
  if (t.dataset.xunit) { S.punit = +t.dataset.xunit; S.pview = 'unit'; S.wrongType = 'all'; return render(); }
  if (t.dataset.uact) { const u = S.punit, all = S.questions.filter(q => q.unit === u).map(q => q.id), act = t.dataset.uact, ttl = 'Unit ' + u;
    if (act === 'wrong') return startEx(shuffle(wrongIds(q => q.unit === u)), { retest: true, title: ttl });
    if (act === 'resume') return startEx(all.filter(id => !qSt(id)), { title: ttl });
    return startEx(all, { title: ttl }); }
  if (t.dataset.wtype) { S.wrongType = t.dataset.wtype; return render(); }
  switch (t.dataset.pact) {
    case 'retest': S.punit = null; return startEx(shuffle(wrongIds()), { retest: true });
    case 'back': S.pview = 'main'; S.punit = null; return render();
  }
  if (t.dataset.start) { const [b, m] = t.dataset.start.split(':'); return startSession(b, m); }
  if (t.dataset.speak) return speak(t.dataset.speak);
  if (t.dataset.level) { const l = +t.dataset.level, a = S.settings.levels; S.settings.levels = a.includes(l) ? a.filter(x => x !== l) : [...a, l].sort(); await saveSettings(); return render(); }
  const s = S.session; if (!s) return;
  if (s.kind === 'ex') return exClick(t, s);
  if (t.dataset.rate) return answerCurrent(+t.dataset.rate);
  if (t.dataset.pick !== undefined && s.q && s.q.picked === null) {
    const i = +t.dataset.pick, w = curWord(), correct = s.q.opts[i].id === w.id, ms = Date.now() - s.q.t0;
    s.q.picked = i; s.q.result = correct; render(); s.q.ms = ms; return;
  }
  switch (t.dataset.act) {
    case 'quit': if (!s.results.length || s.pos >= s.queue.length || confirm('要離開嗎?已完成的題目會保留。')) endSession(); break;
    case 'reveal': s.revealed = true; render(); break;
    case 'next': if (s.mode === 'mcq') { const q = s.q; await answerCurrent(q.result ? (q.ms < 2500 ? 4 : 3) : 1, { ms: q.ms, correct: q.result }); } else if (s.mode === 'spell') { const r = s.spellResult; await answerCurrent(r.kind === 'ok' ? (s.hintUsed ? 2 : 3) : r.kind === 'typo' ? 2 : 1, { answer: r.user, correct: r.kind === 'ok' }); s.hintUsed = false; } break;
    case 'hint': s.hint = true; s.hintUsed = true; { const v = $('#spell-in')?.value; renderSpell(document.querySelector('.topbar').outerHTML, curWord()); if ($('#spell-in')) $('#spell-in').value = v || ''; } break;
    case 'giveup': s.spellResult = { kind: 'wrong', user: '', best: curWord().w, gaveUp: true }; render(); break;
    case 'again': startSession(s.bank, s.mode, s.practice); break;
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'ex-form') { e.preventDefault(); const v = $('#ex-in').value; if (!v.trim()) return; const s = S.session, q = qById[s.queue[s.pos]]; s.cur.fill = checkFill(v, q.ans); exAnswer(s.cur.fill.kind === 'ok', { answer: v.trim() }); return; }
  if (e.target.id !== 'spell-form') return; e.preventDefault();
  const s = S.session, v = $('#spell-in').value; if (!v.trim()) return;
  s.spellResult = checkSpelling(v, curWord()); render();
});
document.addEventListener('keydown', e => {
  const s = S.session; if (!s) return;
  if (s.kind === 'ex') { if (e.key === 'Enter' && s.cur?.result !== null && s.cur) { e.preventDefault(); $('[data-xact="next"]')?.click(); } return; }
  if (e.key === 'Enter' && s.mode === 'spell' && s.spellResult) { e.preventDefault(); $('[data-act="next"]')?.click(); }
  else if (s.mode === 'flash' && !s.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); s.revealed = true; render(); }
  else if (s.mode === 'flash' && s.revealed && '1234'.includes(e.key) && e.key) { answerCurrent(+e.key); }
  else if (s.mode === 'mcq' && s.q && s.q.picked === null && '1234'.includes(e.key) && s.q.opts[+e.key - 1]) { document.querySelector(`[data-pick="${+e.key - 1}"]`)?.click(); }
  else if (s.mode === 'mcq' && s.q?.picked !== null && e.key === 'Enter') { $('[data-act="next"]')?.click(); }
});

/* ---------- boot ---------- */
async function boot(reload = false) {
  if (!reload) await store.init();
  S.settings = { ...DEFAULTS, ...(await store.getKV('settings') || {}) };
  if (!S.settings.examV2) { S.settings.examV2 = true; if (!S.settings.examDate) S.settings.examDate = DEFAULTS.examDate; store.setKV('settings', S.settings); }
  if (!S.settings.progressV3) { S.settings.progressV3 = true; S.settings.progressDays = 0; store.setKV('settings', S.settings); }
  S.daily = (await store.getKV('daily')) || {};
  if (!S.settings.startDate) { const ks = Object.keys(S.daily).filter(k => /^\d{4}-\d\d-\d\d$/.test(k)).sort(); S.settings.startDate = ks[0] || dayKey(); store.setKV('settings', S.settings); }
  S.cards = await store.allCards(); S.session = null; makeFsrs();
  if (!reload) { await Promise.all([...Object.keys(BANKS).map(loadBank), loadQuestions()]); }
  S.qstats = await store.allQ();
  render();
}
boot().catch(e => {
  console.error(e);
  app.innerHTML = `<div class="card" style="margin-top:30px"><h2>載入失敗</h2><p class="small muted">${esc(String(e && e.message || e))}</p><button class="btn block" id="reload-fix">清除快取並重新載入</button></div>`;
  $('#reload-fix').onclick = async () => { try { for (const k of await caches.keys()) await caches.delete(k); const rs = await navigator.serviceWorker.getRegistrations(); for (const r of rs) await r.unregister(); } catch { } location.reload(); };
}).then(() => { if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { }); });
