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
function extraSubHead(cur) { // 3 sub-tabs + the three progress bars
  const t = qTotals(), rows = [['exam', '學測歷屆試題', t.ok, t.total], ['up', '寫作升級', ...(p => [p.ok, p.total])(xProg(xAll('up')))], ['cf', '易混淆字', ...(p => [p.ok, p.total])(xProg(xAll('cf')))]];
  return `<div class="chips" role="tablist" style="margin-top:12px">${rows.map(r => `<button class="chip ${cur === r[0] ? 'on' : ''}" role="tab" aria-selected="${cur === r[0]}" data-ext="sub:${r[0]}">${r[1]}</button>`).join('')}</div>
  <section class="card" style="margin-bottom:12px">${rows.map(r => `<div style="margin:${r[0] === 'exam' ? '0' : '12px 0 0'}"><div class="row between"><b class="small">${r[1]}</b><span class="muted small">${r[2]}/${r[3]} 題答對</span></div><div class="seg" style="margin-top:6px"><i class="g" style="width:${r[3] ? r[2] / r[3] * 100 : 0}%"></i></div></div>`).join('')}</section>`;
}
function extraSubBody(sub) {
  const e = S.extra;
  if (sub === 'up') return `<div class="stack"><section class="card"><p class="small muted">基本字 → 升級字:把 big、nice 這類常用字,換成作文更出色的字。選一組:先看學習卡,再做選擇題,最後練拼字。<span class="dot g"></span>全對 <span class="dot y"></span>進行中 <span class="dot r"></span>有錯題</p></section>
    ${e.upgrade.sets.map(s => { const n = s.bases.reduce((a, b) => a + b.words.length, 0), p = xProg(xq('up', s.id)); return `<button class="card xrow ${xCls(p)}" data-ext="upset:${s.id}"><div class="row between"><b>${esc(s.name.split('|')[0])}</b><span class="muted small">${esc(s.en)} · ${n} 字 · ${p.ok}/${p.total} 題</span></div></button>`; }).join('')}</div>`;
  const gs = e.confuse.groups;
  return `<div class="stack"><section class="card"><p class="small muted">拼字或意思相近的字放在一起比較,用句子選出最適合的字。共 ${gs.length} 組。</p></section>${['拼字相近', '語意相近'].map(tp => `<section class="card"><h2>${tp}</h2>${gs.filter(g => g.type === tp).map(g => { const p = xProg(xq('cf', g.id)); return `<button class="xrow ${xCls(p)}" data-ext="cfset:${g.id}"><span>${esc(g.name)}</span><span class="muted small">${p.ok}/${p.total}</span></button>`; }).join('')}</section>`).join('')}</div>`;
}
const xLines = (label, t) => t ? `<div class="xnote"><div class="xlab">${label}</div>${t.split(/[;;]/).map(x => x.trim().replace(/[。.]$/, '')).filter(Boolean).map(x => `<div><b>${esc(x)}</b></div>`).join('')}</div>` : '';
const xBack = (to, label = '返回') => `<div class="topbar"><button class="icon-btn" data-ext="${to}" aria-label="${label}">←</button>`;
const xTag = w => w.gsat ? ` <span class="xlv">(L${w.lv})</span>` : '';
const xSort = ws => ws.map((w, i) => [w, i]).sort((a, b) => ((a[0].gsat ? a[0].lv : 99) - (b[0].gsat ? b[0].lv : 99)) || (a[1] - b[1])).map(x => x[0]);
function renderExtraView() {
  const e = S.extra, v = S.pview; if (!e) { S.pview = 'main'; return renderPractice(); }
  if (v === 'xupset') {
    const s = e.upgrade.sets.find(x => x.id === S.xid), m = xProg(xq('up', s.id, 2)), f = xProg(xq('up', s.id, 3)), n = s.bases.reduce((a, b) => a + b.words.length, 0);
    const wrong = xq('up', s.id).filter(q => qSt(q.id) && !qSt(q.id).last).length;
    app.innerHTML = `${xBack('up')}<h1 style="font-size:1.25rem">${esc(s.name.split('|')[0])} · ${esc(s.en)}</h1></div><div class="stack"><section class="card"><p class="small muted">${n} 個升級字,${s.bases.length} 個基本字。學習卡會列出全部(含 L1–L2 的字);L1–L2 的字只在學習卡認識,選擇題和拼字只考 L3 以上與超出字表的字。</p>
    <div class="stack" style="margin-top:12px;gap:10px">
      <button class="btn ghost block" data-ext="uplearn:${s.id}">① 學習卡:基本字 → 升級字</button>
      <button class="btn block" data-ext="upgo:${s.id}:2">② 選擇題(${m.total} 題 · 答對 ${m.ok})</button>
      <button class="btn block" data-ext="upgo:${s.id}:3">③ 拼字(${f.total} 題 · 答對 ${f.ok})</button>
      <button class="btn ghost block" data-ext="upwrong:${s.id}" ${wrong ? '' : 'disabled'}>只重測錯題(${wrong})</button></div></section></div>`;
  } else if (v === 'xuplearn') {
    const s = e.upgrade.sets.find(x => x.id === S.xid);
    app.innerHTML = `${xBack('upset:' + s.id)}<h1 style="font-size:1.25rem">學習卡 · ${esc(s.name.split('|')[0])}</h1></div><div class="stack">${s.bases.map(b => `<section class="card"><h2>${esc(b.base)} <span class="muted small">${esc(b.zh)}</span> →</h2>${xSort(b.words).map(w => `<div class="witem"><div class="row between"><b>${esc(w.w)}</b><span class="muted small">${esc(w.zh)}${xTag(w)}</span></div><div class="small">${esc(w.sent).replace(esc(w.w), `<mark class="ans">${esc(w.w)}</mark>`)}</div></div>`).join('')}</section>`).join('')}
    <button class="btn block" data-ext="upgo:${s.id}:2">前往 ② 選擇題</button></div>`;
  } else if (v === 'xcfset') {
    const g = e.confuse.groups.find(x => x.id === S.xid), qs = xq('cf', g.id), p = xProg(qs);
    app.innerHTML = `${xBack('cf')}<h1 style="font-size:1.1rem">${esc(g.name)}</h1></div><div class="stack"><section class="card"><div class="muted small">${esc(g.type)}</div>${xLines('用法', g.hide ? '' : g.note)}${xLines('口訣', g.tip)}
      ${g.members.map(m => `<div class="witem"><b class="xw">${esc(m.w)}</b> <b>${esc(m.pos)} ${esc(m.zh)}</b> ${m.gsat ? `<span class="muted small">L${m.lv}</span>` : ''}</div>`).join('')}</section>
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
    case 'up': case 'cf': S.psub = act; S.pview = 'main'; return render();
    case 'sub': S.psub = id; S.pview = 'main'; return render();
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
