/* Vocaboo extra practice: 寫作升級 (基本字 → 升級字, 3 stages) and 易混淆字.
   Additive: data/extra.json, own question ids (up-… / cf-…) stored in the existing qstats store. Loaded after app.js. */
'use strict';
async function loadExtra() {
  try {
    const r = await fetch('data/extra.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); S.extra = j;
    for (const q of [...j.upgrade.questions, ...j.confuse.questions]) qById[q.id] = q;
  } catch (e) { S.extra = null; }
}
const xq = (kind, unit, stage) => (S.extra ? (kind === 'up' ? S.extra.upgrade.questions : S.extra.confuse.questions) : []).filter(q => q.unit === unit && (!stage || q.stage === stage));
function xProg(qs) { let ok = 0, tried = 0; for (const q of qs) { const st = qSt(q.id); if (st) { tried++; if (st.last) ok++; } } return { total: qs.length, ok, tried, wrong: tried - ok }; }
const xCls = p => p.tried === 0 ? '' : p.wrong ? 'bad' : p.ok === p.total ? 'good' : 'part';
const xAll = kind => (S.extra ? (kind === 'up' ? S.extra.upgrade.questions : S.extra.confuse.questions) : []);
function extraEntryCards() {
  if (S.bank !== 'gsat' || !S.extra) return '';
  const u = xProg(xAll('up')), c = xProg(xAll('cf'));
  return `<section class="card"><h2>寫作升級</h2><p class="small muted" style="margin:4px 0 10px">基本字 → 升級字:把 big、nice 這類常用字,換成作文更出色的形容詞(視覺、聽覺、觸覺、嗅覺、味覺、外貌、個性)。每組:① 學習卡 ② 選擇題 ③ 拼字。</p>
    <button class="btn block" data-ext="up">進入寫作升級<span class="muted small"> · ${u.ok}/${u.total} 題答對</span></button></section>
  <section class="card"><h2>易混淆字</h2><p class="small muted" style="margin:4px 0 10px">拼字或意思相近的字放在一起比較,用句子選出最適合的字。共 ${S.extra.confuse.groups.length} 組。</p>
    <button class="btn block" data-ext="cf">進入易混淆字<span class="muted small"> · ${c.ok}/${c.total} 題答對</span></button></section>`;
}
const xBack = (to, label = '返回') => `<div class="topbar"><button class="icon-btn" data-ext="${to}" aria-label="${label}">←</button>`;
const xTag = w => w.gsat ? `<span class="muted small">L${w.lv}</span>` : '<span class="muted small">超出學測字表</span>';
function renderExtraView() {
  const e = S.extra, v = S.pview; if (!e) { S.pview = 'main'; return renderPractice(); }
  if (v === 'xup') { // list of sets
    app.innerHTML = `${xBack('main')}<h1 style="font-size:1.25rem">寫作升級</h1></div><div class="stack"><section class="card"><p class="small muted">選一個感官/主題。先看學習卡,再做選擇題,最後練拼字。<span class="dot g"></span>全對 <span class="dot y"></span>進行中 <span class="dot r"></span>有錯題</p></section>
    ${e.upgrade.sets.map(s => { const n = s.bases.reduce((a, b) => a + b.words.length, 0), p = xProg(xq('up', s.id)); return `<button class="card xrow ${xCls(p)}" data-ext="upset:${s.id}"><div class="row between"><b>${esc(s.name.split('|')[0])}</b><span class="muted small">${esc(s.en)} · ${n} 字 · ${p.ok}/${p.total} 題</span></div></button>`; }).join('')}</div>`;
  } else if (v === 'xupset') {
    const s = e.upgrade.sets.find(x => x.id === S.xid), m = xProg(xq('up', s.id, 2)), f = xProg(xq('up', s.id, 3)), n = s.bases.reduce((a, b) => a + b.words.length, 0);
    const wrong = xq('up', s.id).filter(q => qSt(q.id) && !qSt(q.id).last).length;
    app.innerHTML = `${xBack('up')}<h1 style="font-size:1.25rem">${esc(s.name.split('|')[0])} · ${esc(s.en)}</h1></div><div class="stack"><section class="card"><p class="small muted">${n} 個升級字,${s.bases.length} 個基本字。建議照順序做。</p>
    <div class="stack" style="margin-top:12px;gap:10px">
      <button class="btn ghost block" data-ext="uplearn:${s.id}">① 學習卡:基本字 → 升級字</button>
      <button class="btn block" data-ext="upgo:${s.id}:2">② 選擇題(${m.total} 題 · 答對 ${m.ok})</button>
      <button class="btn block" data-ext="upgo:${s.id}:3">③ 拼字(${f.total} 題 · 答對 ${f.ok})</button>
      <button class="btn ghost block" data-ext="upwrong:${s.id}" ${wrong ? '' : 'disabled'}>只重測錯題(${wrong})</button></div></section></div>`;
  } else if (v === 'xuplearn') {
    const s = e.upgrade.sets.find(x => x.id === S.xid);
    app.innerHTML = `${xBack('upset:' + s.id)}<h1 style="font-size:1.25rem">學習卡 · ${esc(s.name.split('|')[0])}</h1></div><div class="stack">${s.bases.map(b => `<section class="card"><h2>${esc(b.base)} <span class="muted small">${esc(b.zh)}</span> →</h2>${b.words.map(w => `<div class="witem"><div class="row between"><b>${esc(w.w)}</b><span class="muted small">${esc(w.zh)} · ${xTag(w).replace(/<[^>]+>/g, '')}</span></div><div class="small">${esc(w.sent).replace(esc(w.w), `<mark class="ans">${esc(w.w)}</mark>`)}</div></div>`).join('')}</section>`).join('')}
    <button class="btn block" data-ext="upgo:${s.id}:2">前往 ② 選擇題</button></div>`;
  } else if (v === 'xcf') {
    const gs = e.confuse.groups;
    app.innerHTML = `${xBack('main')}<h1 style="font-size:1.25rem">易混淆字</h1></div><div class="stack">${['拼字相近', '語意相近'].map(tp => `<section class="card"><h2>${tp}</h2>${gs.filter(g => g.type === tp).map(g => { const p = xProg(xq('cf', g.id)); return `<button class="xrow ${xCls(p)}" data-ext="cfset:${g.id}"><span>${esc(g.name)}</span><span class="muted small">${p.ok}/${p.total}</span></button>`; }).join('')}</section>`).join('')}</div>`;
  } else if (v === 'xcfset') {
    const g = e.confuse.groups.find(x => x.id === S.xid), qs = xq('cf', g.id), p = xProg(qs);
    app.innerHTML = `${xBack('cf')}<h1 style="font-size:1.1rem">${esc(g.name)}</h1></div><div class="stack"><section class="card"><div class="muted small">${esc(g.type)}</div><p style="margin:6px 0 10px"><b>${esc(g.note)}</b></p>
      ${g.members.map(m => `<div class="witem"><b>${esc(m.w)}</b> <span class="muted">${esc(m.pos)} ${esc(m.zh)}</span> ${m.gsat ? `<span class="muted small">L${m.lv}</span>` : ''}</div>`).join('')}</section>
      <section class="card"><div class="stack" style="gap:10px"><button class="btn block" data-ext="cfgo:${g.id}">開始練習(${qs.length} 題 · 答對 ${p.ok})</button>
      <button class="btn ghost block" data-ext="cfwrong:${g.id}" ${p.wrong ? '' : 'disabled'}>只重測錯題(${p.wrong})</button></div></section></div>`;
  }
  window.scrollTo(0, 0);
}
function extraClick(a) {
  const [act, id, st] = a.split(':');
  const go = (view, xid) => { S.pview = view; S.xid = xid || null; render(); };
  switch (act) {
    case 'main': S.pview = 'main'; S.punit = null; return render();
    case 'up': return go('xup'); case 'cf': return go('xcf');
    case 'upset': return go('xupset', id); case 'uplearn': return go('xuplearn', id); case 'cfset': return go('xcfset', id);
    case 'upgo': { const ids = xq('up', id, +st).map(q => q.id); return startEx(+st === 2 ? shuffle(ids) : ids, { title: '寫作升級', back: { view: 'xupset', xid: id } }); }
    case 'upwrong': return startEx(shuffle(xq('up', id).filter(q => qSt(q.id) && !qSt(q.id).last).map(q => q.id)), { retest: true, title: '寫作升級', back: { view: 'xupset', xid: id } });
    case 'cfgo': return startEx(shuffle(xq('cf', id).map(q => q.id)), { title: '易混淆字', back: { view: 'xcfset', xid: id } });
    case 'cfwrong': return startEx(shuffle(xq('cf', id).filter(q => qSt(q.id) && !qSt(q.id).last).map(q => q.id)), { retest: true, title: '易混淆字', back: { view: 'xcfset', xid: id } });
  }
}
function extraHead(q) {
  if (q.extra === 'up') { const s = S.extra?.upgrade.sets.find(x => x.id === q.unit); return `寫作升級 · ${esc(s ? s.name.split('|')[0] : '')} · ${q.stage === 3 ? '拼字' : '選擇題'}`; }
  const g = S.extra?.confuse.groups.find(x => x.id === q.unit); return `易混淆字 · ${esc(g ? g.name : '')}`;
}
