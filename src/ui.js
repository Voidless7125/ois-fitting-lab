'use strict';
/* ====================================================================
   Fitting Lab UI. State lives in S; every render is a pure function of S.
   ==================================================================== */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmt(n, d) {
  if (n == null || isNaN(n)) return '-';
  d = d == null ? 2 : d;
  const s = Number(n).toFixed(d);
  return d > 0 ? s.replace(/\.?0+$/, '') : s;
}
const money = n => Math.round(n).toLocaleString('en-US');
const LS_KEY = 'oisfit.v1';
function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } }
function lsSet(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable */ } }

const goalFromPreset = id => {
  const p = GOAL_PRESETS.find(x => x.id === id) || GOAL_PRESETS[0];
  return { w: { ...p.w }, solar: p.solar, req: { sensorSW: 3, navSW: 0, budget: null }, include: { ...DEFAULT_INCLUDE } };
};
const S = {
  tab: 'build', ship: 'enceladus', patch: 2, sun: 1, goalId: 'stealth', goal: goalFromPreset('stealth'), live: true,
  fit: null, open: {}, why: {}, saved: [], cmp: [], save: null, saveErr: '', saveOpen: {},
  mods: { type: 'generator', basis: 'stock', sort: null, dir: -1, q: '' },
  parts: { mod: 'mkiv', ids: null, label: 'Stock', chart: 0 }
};
const ctx = () => ({ patch: S.patch, sun: S.sun });

function persist() {
  lsSet({ ship: S.ship, patch: S.patch, sun: S.sun, goalId: S.goalId, goal: S.goal, live: S.live, fit: fitToCode(S.fit), saved: S.saved, tab: S.tab });
}
function restore() {
  const o = lsGet();
  if (!o) return false;
  try {
    if (SHIP[o.ship]) S.ship = o.ship;
    S.patch = o.patch != null ? o.patch : 2; S.sun = o.sun != null ? o.sun : 1;
    S.goalId = o.goalId || 'stealth'; if (o.goal && o.goal.w) S.goal = { ...goalFromPreset(S.goalId), ...o.goal, req: { ...goalFromPreset(S.goalId).req, ...(o.goal.req || {}) } };
    S.live = o.live !== false; S.saved = Array.isArray(o.saved) ? o.saved : [];
    if (o.fit) S.fit = fitFromCode(o.fit);
    if (o.tab) S.tab = o.tab;
    return true;
  } catch (e) { return false; }
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 1800);
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast((what || 'Text') + ' copied'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast((what || 'Text') + ' copied'); } catch (e2) { toast('Select the text and copy it'); }
    ta.remove();
  }
}

/* ---------- small renderers ---------- */
const PIN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M9.6 1.4l5 5-2.1.8-2.3 2.3.3 3.4-1.3 1.3-2.8-2.8L2.6 14.6l-1-1 3.6-3.8-2.8-2.8L3.7 5.7l3.4.3 2.3-2.3z" fill="currentColor"/></svg>';
function rowOf(fit, i) { return summarize({ ship: fit.ship, slots: fit.slots.map((s, j) => (j === i ? s : { mod: null })) }, ctx()).rows[0]; }
function modOptions(group, only, sel) {
  const types = only ? [only] : TYPES.filter(t => GROUP_OF[t] === group);
  let h = '<option value="">(empty)</option>';
  for (const t of types) {
    h += '<optgroup label="' + esc(TYPE_LABEL[t]) + '">';
    for (const m of MODS_BY_TYPE[t] || []) h += '<option value="' + m.id + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name + ' - ' + money(m.price) + (m.special ? ' (NPC kit)' : '')) + '</option>';
    h += '</optgroup>';
  }
  return h;
}
const STRAT_OPTS = [['auto', 'Parts: best for goal'], ['new', 'Parts: stock'], ['eff', 'Parts: max efficiency'], ['quiet', 'Parts: quietest'],
  ['frugal', 'Parts: lowest power'], ['tough', 'Parts: toughest'], ['cheap', 'Parts: cheapest'], ['bal0.5', 'Parts: balanced'], ['custom', 'Parts: custom']];
function keyStats(r, n) {
  const defs = STAT_DEFS[r.mod.t];
  return defs.slice(0, n || 2).map(([k, l]) => {
    const x = r.st[k];
    return '<span>' + esc(l) + ' <b>' + fmt(x.v, x.d) + (x.u && x.u !== 'time' && x.u !== 'v' ? ' ' + x.u : '') + '</b></span>';
  }).join('');
}
function effClass(ev) { return ev.dead ? 'dead' : (ev.eff >= 200 ? 'hot' : ''); }

/* ---------- radar ---------- */
function radar(axes, goalVals) {
  const R = 118, cx = 170, cy = 150, n = axes.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  let g = '';
  for (const lv of [0.25, 0.5, 0.75, 1]) g += '<polygon points="' + axes.map((_, i) => pt(i, lv).join(',')).join(' ') + '" fill="none" class="axis" stroke-width="1"/>';
  axes.forEach((a, i) => { const [x, y] = pt(i, 1); g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" class="axis"/>'; });
  if (goalVals) g += '<polygon points="' + goalVals.map((v, i) => pt(i, Math.max(.02, v)).join(',')).join(' ') + '" class="goalline"/>';
  g += '<polygon points="' + axes.map((a, i) => pt(i, Math.max(.02, a.v)).join(',')).join(' ') + '" class="fitline"/>';
  axes.forEach((a, i) => {
    const [x, y] = pt(i, a.v); g += '<circle cx="' + x + '" cy="' + y + '" r="3" fill="var(--accent)"/>';
    const [lx, ly] = pt(i, 1.2); const anchor = lx < cx - 10 ? 'end' : lx > cx + 10 ? 'start' : 'middle';
    g += '<text x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '" font-size="10.5" dominant-baseline="middle">' + esc(a.l) + '</text>';
  });
  return '<svg viewBox="-34 0 408 300" role="img" aria-label="Fit profile radar chart">' + g + '</svg>';
}
const OPTIONAL_TYPES = { solar: 1, hack: 1 };
function fitAxes(sum) {
  const c = ctx();
  const per = {};
  for (const r of sum.rows) {
    const n = normMetrics(r.mod, { ev: r.ev, ids: r.ev.ids }, c);
    (per[r.mod.t] = per[r.mod.t] || []).push(n);
  }
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const axes = [];
  for (const cat of CATS) {
    const types = CAT_TYPES[cat].filter(t => !OPTIONAL_TYPES[t] || per[t]);
    const vals = types.map(t => mean((per[t] || []).map(n => n.perf)));
    axes.push({ k: cat, l: ({ power: 'Power', speed: 'Speed', jump: 'Jump', sensing: 'Sensing', combat: 'Combat', comms: 'Comms', salvage: 'Salvage' })[cat], v: mean(vals) });
  }
  const all = Object.values(per).flat();
  axes.push({ k: 'stealth', l: 'Stealth', v: all.length ? 1 - mean(all.map(n => n.emis)) : 0 });
  axes.push({ k: 'econ', l: 'Economy', v: all.length ? 1 - mean(all.map(n => n.pow)) : 0 });
  axes.push({ k: 'thrift', l: 'Thrift', v: all.length ? 1 - mean(all.map(n => n.price)) : 0 });
  axes.push({ k: 'tough', l: 'Tough', v: all.length ? mean(all.map(n => n.sturd)) : 0 });
  return axes;
}
function goalMatch(axes, goal) {
  let a = 0, b = 0;
  for (const x of axes) { const w = goal.w[x.k] || 0; a += w * x.v; b += w; }
  return b ? a / b : 0;
}

/* ---------- power bar ---------- */
function powerBar(sum) {
  const gen = sum.S.gen, sol = sum.S.solar, idle = sum.S.idle, high = sum.S.high;
  const max = Math.max(gen + sol, high, idle, 1) * 1.04;
  const W = 460, x = v => 10 + (W - 20) * v / max;
  let h = '<svg viewBox="0 0 ' + W + ' 104" role="img" aria-label="Power generation against draw">';
  h += '<text x="10" y="13" font-size="11">GENERATION  ' + fmt(gen + sol, 1) + ' kW' + (sol ? ' (reactor ' + fmt(gen, 1) + ' + solar ' + fmt(sol, 1) + ')' : '') + '</text>';
  h += '<rect x="10" y="19" width="' + Math.max(0, x(gen) - 10) + '" height="20" fill="var(--accent)"/>';
  if (sol) h += '<rect x="' + x(gen) + '" y="19" width="' + (x(gen + sol) - x(gen)) + '" height="20" fill="var(--amber)"/>';
  h += '<text x="10" y="62" font-size="11">DRAW  ' + fmt(idle, 1) + ' kW idle, ' + fmt(high, 1) + ' kW all systems active</text>';
  h += '<rect x="10" y="68" width="' + Math.max(0, x(idle) - 10) + '" height="20" fill="var(--good)" opacity=".85"/>';
  h += '<rect x="' + x(idle) + '" y="68" width="' + Math.max(0, x(high) - x(idle)) + '" height="20" fill="var(--bad)" opacity=".6"/>';
  h += '<line x1="' + x(gen + sol) + '" y1="16" x2="' + x(gen + sol) + '" y2="92" stroke="var(--ink)" stroke-dasharray="3 3" opacity=".5"/>';
  h += '</svg>';
  return h;
}

/* ====================== BUILD TAB ====================== */
function renderBuild() {
  const g = S.goal;
  const goalChips = GOAL_PRESETS.map(p => '<button class="chip" data-act="goal" data-id="' + p.id + '" aria-pressed="' + (S.goalId === p.id) + '">' + esc(p.name) + '</button>').join('');
  const sl = (k, l) => '<div class="slider"><label for="w-' + k + '">' + esc(l) + '</label><output id="o-' + k + '">' + g.w[k] + '</output><input type="range" id="w-' + k + '" data-w="' + k + '" min="0" max="10" step="1" value="' + g.w[k] + '"></div>';
  const inc = ['jumpdrive', 'hack', 'arm', 'ladar', 'weapon', 'pds', 'cm', 'rcs'].map(t => '<label><input type="checkbox" data-inc="' + t + '"' + (g.include[t] !== false ? ' checked' : '') + '>' + esc(TYPE_LABEL[t]) + '</label>').join('');
  const preset = GOAL_PRESETS.find(p => p.id === S.goalId);
  const left = '<div class="col">' +
    '<div class="card"><h2>What do you want?</h2><div class="goalchips">' + goalChips + '</div>' +
    '<p class="blurb" id="blurb">' + esc(preset ? preset.blurb : 'Custom mix.') + '</p>' +
    '<div class="sub">Roles</div>' + CATS.map(c => sl(c, CAT_LABEL[c])).join('') +
    '<div class="sub">Trade-offs</div>' + GLOBAL_AXES.map(([k, l]) => sl(k, l)).join('') +
    '</div>' +
    '<div class="card"><h2>Rules</h2>' +
    '<div class="fld"><label for="r-ssw">Sensors: software at least</label><select id="r-ssw">' + [0, 1, 2, 3].map(v => '<option' + (g.req.sensorSW === v ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
    '<div class="fld"><label for="r-nsw">Nav computer: software at least</label><select id="r-nsw">' + [0, 1, 2].map(v => '<option' + (g.req.navSW === v ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
    '<div class="fld"><label for="r-sol">Solar wings</label><input type="number" id="r-sol" min="0" max="6" value="' + (g.solar || 0) + '"></div>' +
    '<div class="fld"><label for="r-bud">Module budget (credits)</label><input type="number" id="r-bud" min="0" step="500" placeholder="none" value="' + (g.req.budget || '') + '"></div>' +
    '<div class="sub">Fit these systems</div><div class="checks">' + inc + '</div>' +
    '<div class="fld" style="margin-top:8px"><label><input type="checkbox" id="r-spec"' + (g.special ? ' checked' : '') + '> Allow NPC kit modules (Remora RCS and sensor, probe sensor)</label></div>' +
    '<div class="sub">Fitting</div>' +
    '<div class="row"><button class="btn primary" data-act="fit">Auto-fit hull</button><button class="btn" data-act="partsonly">Re-pick parts only</button><button class="btn" data-act="stockfit">Load stock loadout</button><button class="btn ghost" data-act="unlock">Unlock all</button></div>' +
    '<div class="fld" style="margin-top:10px"><label><input type="checkbox" id="live"' + (S.live ? ' checked' : '') + '> Re-fit as I move the sliders (pinned slots stay put)</label></div>' +
    '</div></div>';
  return '<div class="work">' + left + '<div class="col" id="fitpane">' + renderFitPane() + '</div></div>';
}

function renderFitPane() {
  const fit = S.fit, ship = SHIP[fit.ship], c = ctx();
  const sum = summarize(fit, c);
  const axes = fitAxes(sum);
  const match = goalMatch(axes, S.goal);
  const gv = [...CATS, 'stealth', 'econ', 'thrift', 'tough'].map(k => (S.goal.w[k] || 0) / 10);
  const total = sum.hullValue + sum.price;
  const end = sum.netPeak < 0 ? sum.S.cap / (-sum.netPeak) : Infinity;
  const q = k => (sum.byType[k] || [])[0];
  const jd = q('jumpdrive'), sn = q('sensor'), md = q('maindrive');
  const kpi = (l, v, s, cls) => '<div class="kpi ' + (cls || '') + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  const kp = [
    kpi('Goal match', Math.round(match * 100) + '%', 'how close the fit is to your sliders', match > .6 ? 'good' : match < .35 ? 'warn' : ''),
    kpi('Price', money(total), 'hull ' + money(sum.hullValue) + ' + modules ' + money(sum.price)),
    kpi('Power balance', (sum.net >= 0 ? '+' : '') + fmt(sum.net, 1) + ' kW', 'idle; ' + (sum.netPeak >= 0 ? 'sustains full load' : 'full load drains ' + fmt(-sum.netPeak, 1) + ' kW'), sum.net < 0 ? 'bad' : ''),
    kpi('Battery endurance', end === Infinity ? 'unlimited' : fmt(end, 1), 'stored ' + money(sum.S.cap) + ' / net drain at full load (units are the game\'s)', end < 1 ? 'warn' : ''),
    kpi('Signature', fmt(sum.S.emIdle, 0) + ' / ' + fmt(sum.S.emHigh, 0), 'emissions idle / all active'),
    kpi('Jump range', jd ? fmt(jd.st.range.v, 0) : '-', jd ? 'spin-up ' + fmt(jd.st.spin.v, 1) : 'no jump drive'),
    kpi('Thrust', md ? fmt(md.st.thrust.v, 2) : '-', 'hull top speed ' + (ship.speed != null ? fmt(ship.speed, 1) : '?')),
    kpi('Sensor strength', sn ? fmt(sn.st.q.v, 2) : '-', sn ? 'software ' + sn.mod.softwareversion : 'no sensors')
  ].join('');
  const alerts = [];
  if (sum.net < 0) alerts.push('<div class="bad">Idle draw is higher than generation. The batteries drain even when nothing is happening.</div>');
  if (!sum.byType.generator) alerts.push('<div class="warn">No reactor fitted.</div>');
  if (!sum.byType.battery) alerts.push('<div class="warn">No battery fitted.</div>');
  if (!sum.byType.maindrive) alerts.push('<div class="warn">No main drive fitted.</div>');
  if (S.patch === 0) alerts.push('<div class="warn">Base game: the batteries ignore the power-modifier cost of better parts, but the module screens still show it. The patcher fixes that, and the numbers here switch with the patch selector.</div>');
  sum.rows.forEach(r => r.warn.forEach(w => alerts.push('<div class="bad"><b>' + esc(r.mod.name) + ':</b> ' + esc(w) + '</div>')));
  const plan = slotPlan(ship);
  let slotsHtml = '';
  for (const grp of GROUPS) {
    const idxs = plan.map((p, i) => [p, i]).filter(([p]) => p.group === grp);
    if (!idxs.length) continue;
    slotsHtml += '<div class="group"><h3>' + GROUP_LABEL[grp] + ' slots (' + idxs.length + ')</h3>';
    for (const [p, i] of idxs) slotsHtml += renderSlot(i, p, sum);
    slotsHtml += '</div>';
  }
  const typed = plan.length && plan[0].only;
  if (typed) slotsHtml = '<div class="group"><h3>Module slots</h3>' + plan.map((p, i) => renderSlot(i, p, sum)).join('') + '</div>';
  return '<div class="card"><div class="row" style="justify-content:space-between"><h2>' + esc(ship.name) + ' fit</h2><span class="dim">' + esc((ship.cat || '') + (ship.mfr ? ' - ' + ship.mfr : '')) + '</span></div>' +
    '<div class="kpis" style="margin-top:10px">' + kp + '</div></div>' +
    '<div class="card"><div class="vis"><div>' + radar(axes, gv) + '<div class="legend"><span><i style="background:var(--accent)"></i>this fit</span><span><i style="background:var(--amber)"></i>your sliders</span></div></div>' +
    '<div><h2>Power</h2><div class="powerbar">' + powerBar(sum) + '</div>' +
    '<div class="row" style="margin:6px 0"><label class="dim" for="sun">Sunlight at your sector</label><input type="range" id="sun" min="0" max="1.5" step="0.05" value="' + S.sun + '"><output class="mono" id="sunv">' + fmt(S.sun, 2) + 'x</output></div>' +
    '<p class="dim" style="font-size:12.5px">Solar wings scale with sunlight (the range figure multiplies it). Reactor output is flat.</p>' + alerts.join('') + '</div></div></div>' +
    '<div class="card"><h2>Slots</h2>' + slotsHtml + '</div>' +
    '<div class="card"><h2>Keep this build</h2>' + exportBlock(sum) + '</div>';
}

function renderSlot(i, p, sum) {
  const s = S.fit.slots[i];
  const title = p.only ? TYPE_LABEL[p.only] : GROUP_LABEL[p.group] + ' ' + (p.idx + 1);
  const row = sum.rows.find(r => r.slot === i);
  const sel = '<select data-act="mod" data-i="' + i + '" aria-label="' + esc(title) + ' module">' + modOptions(p.group, p.only, s.mod) + '</select>';
  const pin = '<button class="pin" data-act="lock" data-i="' + i + '" aria-pressed="' + !!s.locked + '" title="Pinned slots are not changed by auto-fit" aria-label="Pin slot">' + PIN + '</button>';
  if (!row) return '<div class="slot empty"><div class="slot-h">' + pin + sel + '<span class="dim">' + esc(title) + '</span><span></span></div></div>';
  const strat = '<select data-act="strat" data-i="' + i + '" class="strat" aria-label="Parts for ' + esc(title) + '">' + STRAT_OPTS.map(([v, l]) => '<option value="' + v + '"' + (v === (s.strat || 'auto') ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
  const d = row.dr, e = row.em;
  const body = '<div class="slot-b">' + keyStats(row, 3) +
    '<span>Power <b>' + fmt(d.shownIdle, 2) + ' / ' + fmt(d.shownHigh, 1) + '</b></span><span>Emissions <b>' + fmt(e.idle, 1) + ' / ' + fmt(e.high, 0) + '</b></span>' +
    '<span>Price <b>' + money(row.mod.price) + '</b></span>' + (s.label && s.strat === 'auto' ? '<span>' + esc(s.label) + '</span>' : '') + '</div>';
  const open = S.open[i];
  return '<div class="slot"><div class="slot-h">' + pin + sel + strat + '<span class="effb ' + effClass(row.ev) + '" title="Module efficiency">' + row.ev.eff + '%</span></div>' + body +
    '<div class="slot-b" style="padding-top:0"><button class="btn small ghost" data-act="open" data-i="' + i + '">' + (open ? 'Hide details' : 'Parts and alternatives') + '</button></div>' +
    (open ? renderSlotDetails(i, row) : '') + '</div>';
}

function renderSlotDetails(i, row) {
  const s = S.fit.slots[i], m = row.mod, f = DATA.if[m.if];
  const ids = row.ev.ids;
  let grid = '';
  f.s.forEach(([cls, chain, buf], k) => {
    const parts = (PARTS_BY_CLASS[cls] || []).slice().sort((a, b) => b.eff - a.eff);
    grid += '<label>' + esc(CLASS_LABEL[cls]) + (buf ? ' (buffer)' : '') + (chain ? ' - chain ' + chain : ' - main line') +
      '<select data-act="part" data-i="' + i + '" data-k="' + k + '"><option value="-1">(empty)</option>' +
      parts.map(c => '<option value="' + c.id + '"' + (c.id === ids[k] ? ' selected' : '') + '>' + esc(c.name + ' - eff +' + c.eff + ', pw +' + c.pw + '%, em +' + c.em + '%') + '</option>').join('') + '</select></label>';
  });
  let why = '';
  const rk = rankType(m.t, S.goal, ctx());
  if (rk.length) {
    why = '<div><h4>Why this module (best five for your goal)</h4><table class="alts"><tr><th>Module</th><th>Score</th><th>Does its job</th><th>Price</th><th></th></tr>' +
      rk.slice(0, 5).map((r, j) => '<tr><td>' + esc(r.mod.name) + '</td><td class="mono">' + fmt(r.score, 2) + '</td><td class="mono">' + Math.round(r.n.perf * 100) + '%</td><td class="mono">' + money(r.mod.price) + '</td><td>' +
        (r.mod.id === m.id ? '<span class="tag win">fitted</span>' : '') + (j < r.tied && r.tied > 1 ? '<span class="tag tie">tie</span>' : '') + '</td></tr>').join('') + '</table>' +
      (rk[0].tied > 1 ? '<p class="dim" style="font-size:12px;margin-top:6px">' + rk[0].tied + ' modules scored within 1% of each other; the one that does its job best comes first, then the cheaper.</p>' : '') + '</div>';
  }
  return '<div class="slot-x"><div><h4>Parts, slot by slot</h4><div class="partgrid">' + grid + '</div></div>' + why +
    '<div class="row"><button class="btn small" data-act="toparts" data-i="' + i + '">Open in Parts lab</button>' + row.warn.map(w => '<span class="tag tie">' + esc(w.slice(0, 60)) + '...</span>').join('') + '</div></div>';
}

function exportBlock(sum) {
  const cfg = configLine(S.fit), shop = shoppingList(S.fit), code = fitToCode(S.fit);
  return '<div class="row" style="margin-bottom:8px"><input type="text" id="savename" placeholder="Name this build" style="flex:1;min-width:160px"><button class="btn primary" data-act="save">Save build</button></div>' +
    '<div class="grid2"><div><h4 class="dim">Ship file line</h4><pre class="out">configuration=$stock:false:My build,' + esc(cfg) + '</pre><button class="btn small" data-act="copycfg">Copy line</button></div>' +
    '<div><h4 class="dim">Shopping list (modules and parts)</h4><pre class="out">' + esc(shop || '(nothing fitted)') + '</pre><button class="btn small" data-act="copyshop">Copy list</button></div></div>' +
    '<div style="margin-top:10px"><h4 class="dim">Build code (paste into Saved to restore)</h4><textarea readonly id="codebox" aria-label="Build code">' + esc(code) + '</textarea><button class="btn small" data-act="copycode">Copy code</button></div>';
}

/* ====================== MODULES TAB ====================== */
function basisBuild(m, basis) {
  if (basis === 'stock') return presetIds(m, 'new');
  if (basis === 'eff') return candidates(m).reduce((a, c) => (c.ev.eff > a.ev.eff ? c : a)).ids;
  if (basis === 'quiet') return candidates(m).reduce((a, c) => (c.ev.em < a.ev.em ? c : a)).ids;
  return bestBuild(m, S.goal, ctx()).cand.ids;
}
function renderModules() {
  const M = S.mods, t = M.type, c = ctx();
  const chips = TYPES.map(x => '<button class="chip" data-act="mtype" data-t="' + x + '" aria-pressed="' + (x === t) + '">' + esc(TYPE_LABEL[x]) + '</button>').join('');
  const defs = STAT_DEFS[t];
  let rows = (MODS_BY_TYPE[t] || []).map(m => {
    const ids = basisBuild(m, M.basis) || [];
    const ev = evalBuild(m, ids), st = modStats(m, ev, c), dr = drawOf(m, ev, c), em = emisOf(m, ev);
    const sc = scoreOf(m, { ev, ids }, S.goal, c);
    return { m, ev, st, dr, em, score: sc.score, ids };
  });
  if (M.q) rows = rows.filter(r => (r.m.name + ' ' + r.m.mfr + ' ' + r.m.id).toLowerCase().indexOf(M.q.toLowerCase()) >= 0);
  const cols = [
    { k: 'name', l: 'Module', get: r => r.m.name, txt: true },
    { k: 'price', l: 'Price', get: r => r.m.price, d: 0, hi: false },
    { k: 'eff', l: 'Eff %', get: r => r.ev.eff, d: 0, hi: true },
    ...defs.map(([k, l, , ]) => ({ k: 's:' + k, l, get: r => r.st[k].v, d: r => r.st[k].d, hi: r => r.st[k].hi })),
    { k: 'pi', l: 'Power idle', get: r => r.dr.shownIdle, d: 2, hi: false },
    { k: 'ph', l: 'Power active', get: r => r.dr.shownHigh, d: 1, hi: false },
    { k: 'ei', l: 'Emis. idle', get: r => r.em.idle, d: 1, hi: false },
    { k: 'eh', l: 'Emis. active', get: r => r.em.high, d: 0, hi: false },
    { k: 'goal', l: 'Goal score', get: r => r.score, d: 2, hi: true }
  ].filter(cc => !(['pi', 'ph'].indexOf(cc.k) >= 0 && ['generator', 'solar', 'battery'].indexOf(t) >= 0));
  if (M.sort) { const col = cols.find(x => x.k === M.sort); if (col) rows.sort((a, b) => (col.txt ? String(col.get(a)).localeCompare(col.get(b)) * -M.dir : (col.get(a) - col.get(b)) * M.dir)); }
  const best = {};
  cols.forEach(col => {
    if (col.txt) return;
    const vals = rows.map(col.get); if (!vals.length) return;
    const hi = typeof col.hi === 'function' ? col.hi(rows[0]) : col.hi;
    best[col.k] = hi ? Math.max(...vals) : Math.min(...vals);
  });
  const head = cols.map(col => '<th class="' + (col.txt ? 'l' : '') + '" data-act="msort" data-k="' + col.k + '">' + esc(col.l) + (M.sort === col.k ? (M.dir < 0 ? ' v' : ' ^') : '') + '</th>').join('');
  const body = rows.map(r => '<tr data-act="mrow" data-id="' + r.m.id + '">' + cols.map(col => {
    if (col.txt) return '<td class="l"><b>' + esc(r.m.name) + '</b> <span class="dim">' + esc(r.m.mfr) + '</span>' + (r.ev.eff >= 200 ? '<span class="tag tie">200%+</span>' : '') + (r.m.special ? '<span class="tag">NPC kit</span>' : '') + '</td>';
    const v = col.get(r), d = typeof col.d === 'function' ? col.d(r) : col.d;
    const isBest = best[col.k] != null && Math.abs(v - best[col.k]) < 1e-9 && rows.length > 1;
    return '<td class="mono ' + (isBest ? 'best' : '') + '">' + (col.k === 'price' ? money(v) : fmt(v, d)) + '</td>';
  }).join('') + '</tr>').join('');
  const basisSeg = [['stock', 'Stock parts'], ['eff', 'Max efficiency'], ['quiet', 'Quietest parts'], ['goal', 'Best for my goal']].map(([v, l]) => '<button data-act="mbasis" data-v="' + v + '" aria-pressed="' + (M.basis === v) + '">' + l + '</button>').join('');
  const note = {
    weapon: S.patch >= 2 ? 'Spin-up uses the fixed formula: it shrinks as efficiency rises.' : 'Spin-up in the base game GROWS with efficiency (the bug the spin-up fix removes).',
    solar: 'Output is for full sunlight; set sunlight on the Build tab. The range figure multiplies sunlight.',
    sensor: 'Signal strength is sensor quality x efficiency. Software version is shown in its own column.',
    pds: 'Hits per time = (1 - 1/N) / reload for a 1dN hit die, assuming one shot per reload.'
  }[t] || '';
  return '<div class="card" style="margin-top:18px"><div class="row" style="justify-content:space-between"><div class="row">' + chips + '</div></div>' +
    '<div class="row" style="margin:12px 0"><div class="seg">' + basisSeg + '</div><input type="text" id="mq" placeholder="Search" value="' + esc(M.q) + '" style="width:160px"><span class="dim">Best value in each column is green. Click a column to sort, a row to open it in the Parts lab.</span></div>' +
    (note ? '<p class="dim" style="font-size:12.5px">' + esc(note) + '</p>' : '') +
    '<div class="tablewrap"><table class="t"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

/* ====================== PARTS TAB ====================== */
function curPartsModule() { return MOD[S.parts.mod] || MODS_BY_TYPE.generator[0]; }
function ensureParts() {
  const m = curPartsModule();
  if (!S.parts.ids || S.parts.ids.length !== DATA.if[m.if].s.length) S.parts.ids = (presetIds(m, 'new') || buildFrom(m, 'eff')).slice();
}
function lineChart(m, ev0, key) {
  const W = 560, H = 230, L = 50, B = 30, T = 14, R = 14;
  const defs = STAT_DEFS[m.t];
  const [k, label] = defs[Math.min(key, defs.length - 1)];
  const c = ctx();
  const xs = [], series = [];
  for (let e = 100; e <= 230; e += 2) xs.push(e);
  const val = (e, patch) => { const E = e / 100; const f = STAT_DEFS[m.t][Math.min(key, defs.length - 1)][2]; return f(m, E, 2 - E, { ...c, patch }).v; };
  const variants = m.t === 'weapon' && k === 'spin' ? [[2, 'fixed (patch + spin-up fix)', 'var(--accent)'], [0, 'base game', 'var(--amber)']] : [[c.patch, label, 'var(--accent)']];
  let lo = Infinity, hi = -Infinity;
  const data = variants.map(([p]) => xs.map(e => { const v = val(e, p); lo = Math.min(lo, v); hi = Math.max(hi, v); return v; }));
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  const X = e => L + (W - L - R) * (e - 100) / 130, Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="axis" stroke-dasharray="2 4"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="10">' + fmt(v, Math.abs(hi) < 10 ? 2 : 0) + '</text>'; }
  for (const e of [100, 150, 200]) g += '<text x="' + X(e) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10">' + e + '%</text>';
  g += '<line x1="' + X(200) + '" x2="' + X(200) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--bad)" stroke-dasharray="4 4" opacity=".7"/><text x="' + (X(200) + 4) + '" y="' + (T + 10) + '" font-size="10" style="fill:var(--bad)">200%</text>';
  data.forEach((d, j) => { g += '<polyline fill="none" stroke="' + variants[j][2] + '" stroke-width="2" points="' + d.map((v, i) => X(xs[i]) + ',' + Y(v)).join(' ') + '"/>'; });
  const mark = (e, name, col) => { if (e <= 0) return ''; const v = val(Math.min(230, e), variants[0][0]); return '<circle cx="' + X(Math.min(230, e)) + '" cy="' + Y(v) + '" r="5" fill="' + col + '"/><text x="' + X(Math.min(230, e)) + '" y="' + (Y(v) - 9) + '" text-anchor="middle" font-size="10" style="fill:' + col + '">' + name + '</text>'; };
  const stock = evalBuild(m, presetIds(m, 'new') || []).eff, mx = candidates(m).reduce((a, x) => Math.max(a, x.ev.eff), 0);
  g += mark(stock, 'stock', 'var(--dim)') + mark(mx, 'max', 'var(--good)') + mark(ev0.eff, 'now', 'var(--accent)');
  const tabs = defs.map(([kk, l], j) => '<button class="chip" data-act="pchart" data-j="' + j + '" aria-pressed="' + (j === Math.min(key, defs.length - 1)) + '">' + esc(l) + '</button>').join('');
  return '<div class="row" style="margin-bottom:6px">' + tabs + '</div><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="' + esc(label) + ' against efficiency">' + g + '</svg>' +
    '<div class="legend">' + variants.map(v => '<span><i style="background:' + v[2] + '"></i>' + esc(v[1]) + '</span>').join('') + '<span>x axis: module efficiency</span></div>';
}
function renderParts() {
  ensureParts();
  const m = curPartsModule(), P = S.parts, c = ctx(), f = DATA.if[m.if];
  const ev = evalBuild(m, P.ids), st = modStats(m, ev, c), dr = drawOf(m, ev, c), em = emisOf(m, ev);
  const modSel = '<select id="pmod">' + TYPES.map(t => '<optgroup label="' + esc(TYPE_LABEL[t]) + '">' + (MODS_BY_TYPE[t] || []).map(x => '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</optgroup>').join('') + '</select>';
  const quick = PRESET_NAMES.filter(n => m.cfg[n]).map(n => '<button class="btn small" data-act="ppreset" data-v="' + n + '">' + PRESET_LABEL[n] + '</button>').join('') +
    ['eff', 'quiet', 'frugal', 'tough', 'cheap', 'bal0.5'].map(sv => '<button class="btn small" data-act="pstrat" data-v="' + sv + '">' + STRAT_LABEL[sv] + '</button>').join('') +
    '<button class="btn small" data-act="pstrat" data-v="eff+min">Efficiency, minimal chains</button><button class="btn small" data-act="pstrat" data-v="quiet+min+buf">Quiet + buffer</button>';
  let slotsH = '<table class="alts"><tr><th>Slot</th><th>Chain</th><th>Part</th><th>Eff</th><th>Pwr</th><th>Em</th></tr>';
  f.s.forEach(([cls, chain, buf], k) => {
    const parts = (PARTS_BY_CLASS[cls] || []).slice().sort((a, b) => b.eff - a.eff);
    const cur = COMP[P.ids[k]];
    slotsH += '<tr><td>' + esc(CLASS_LABEL[cls]) + (buf ? ' <span class="tag">buffer</span>' : '') + '</td><td class="mono">' + (chain || 'main') + '</td><td><select data-act="ppart" data-k="' + k + '"><option value="-1">(empty)</option>' +
      parts.map(x => '<option value="' + x.id + '"' + (x.id === P.ids[k] ? ' selected' : '') + '>' + esc(x.name + ' (' + x.mfr + ')') + '</option>').join('') + '</select></td>' +
      '<td class="mono">' + (cur ? '+' + cur.eff : '') + '</td><td class="mono">' + (cur ? '+' + cur.pw + '%' : '') + '</td><td class="mono">' + (cur ? '+' + cur.em + '%' : '') + '</td></tr>';
  });
  slotsH += '</table>';
  const base = evalBuild(m, presetIds(m, 'new') || []), mxc = candidates(m).reduce((a, x) => (x.ev.eff > a.ev.eff ? x : a));
  const sBase = modStats(m, base, c), sMax = modStats(m, mxc.ev, c);
  const cmpRows = STAT_DEFS[m.t].map(([k, l]) => '<tr><td>' + esc(l) + '</td><td class="mono">' + fmt(sBase[k].v, sBase[k].d) + '</td><td class="mono"><b>' + fmt(st[k].v, st[k].d) + '</b></td><td class="mono">' + fmt(sMax[k].v, sMax[k].d) + '</td></tr>').join('') +
    '<tr><td>Efficiency</td><td class="mono">' + base.eff + '%</td><td class="mono"><b>' + ev.eff + '%</b></td><td class="mono">' + mxc.ev.eff + '%</td></tr>' +
    '<tr><td>Power draw idle / active</td><td class="mono">' + fmt(drawOf(m, base, c).shownIdle, 2) + ' / ' + fmt(drawOf(m, base, c).shownHigh, 1) + '</td><td class="mono"><b>' + fmt(dr.shownIdle, 2) + ' / ' + fmt(dr.shownHigh, 1) + '</b></td><td class="mono">' + fmt(drawOf(m, mxc.ev, c).shownIdle, 2) + ' / ' + fmt(drawOf(m, mxc.ev, c).shownHigh, 1) + '</td></tr>' +
    '<tr><td>Emissions idle / active</td><td class="mono">' + fmt(emisOf(m, base).idle, 1) + ' / ' + fmt(emisOf(m, base).high, 0) + '</td><td class="mono"><b>' + fmt(em.idle, 1) + ' / ' + fmt(em.high, 0) + '</b></td><td class="mono">' + fmt(emisOf(m, mxc.ev).idle, 1) + ' / ' + fmt(emisOf(m, mxc.ev).high, 0) + '</td></tr>' +
    '<tr><td>Parts cost</td><td class="mono">' + money(base.cost) + '</td><td class="mono"><b>' + money(ev.cost) + '</b></td><td class="mono">' + money(mxc.ev.cost) + '</td></tr>';
  const warn = warnings(m, ev).map(w => '<div class="bad">' + esc(w) + '</div>').join('') + (ev.dead ? '<div class="bad">This build is dead: ' + esc(ev.why) + '.</div>' : '') +
    (ev.chainDead && !ev.dead ? '<div class="warn">At least one chain has an empty slot, so every part on that chain is switched off (they still draw power and make noise).</div>' : '');
  const fitSlots = S.fit.slots.map((s, i) => [s, i]).filter(([s]) => s.mod === m.id);
  // table of every part by class
  let catalog = '';
  for (const cls of CLASS_ORDER) {
    const list = (PARTS_BY_CLASS[cls] || []).slice().sort((a, b) => b.eff - a.eff);
    const mxE = Math.max(...list.map(x => x.eff), 1);
    catalog += '<tr><td class="l" colspan="7" style="background:var(--panel2)"><b>' + CLASS_LABEL[cls] + '</b></td></tr>' + list.map(x => '<tr><td class="l">' + esc(x.name) + ' <span class="dim">' + esc(x.mfr) + '</span></td><td class="mono">+' + x.eff + '<span class="bar" style="width:' + Math.round(40 * x.eff / mxE) + 'px"></span></td><td class="mono">+' + x.pw + '%</td><td class="mono">+' + x.em + '%</td><td class="mono">' + x.sturd + '</td><td class="mono">' + x.cost + '</td><td class="mono">' + x.mind + '/' + x.dbd + '</td></tr>').join('');
  }
  return '<div style="margin-top:18px" class="col"><div class="card"><div class="row" style="justify-content:space-between"><div class="row"><h2>Parts lab</h2>' + modSel + '</div><span class="dim">' + esc(m.mfr) + ' - ' + esc(TYPE_LABEL[m.t]) + ' - interface ' + esc(m.if) + ' - price ' + money(m.price) + '</span></div>' +
    '<p class="dim" style="margin:8px 0 0">' + esc(m.desc) + '</p></div>' +
    '<div class="grid2"><div class="card"><h2>Slots</h2><div class="row" style="margin-bottom:8px">' + quick + '</div>' + slotsH + warn + '<div class="row" style="margin-top:10px">' + (fitSlots.length ? fitSlots.map(([s, i]) => '<button class="btn small" data-act="applytofit" data-i="' + i + '">Use in fit slot ' + (i + 1) + '</button>').join('') : '<span class="dim">This module is not in your fit.</span>') + '</div></div>' +
    '<div class="card"><h2>What it does</h2><table class="alts"><tr><th></th><th>Stock</th><th>This build</th><th>Best efficiency</th></tr>' + cmpRows + '</table>' +
    '<h2 style="margin-top:16px">Efficiency curve</h2>' + lineChart(m, ev, P.chart) + '</div></div>' +
    '<div class="card"><h2>All parts</h2><div class="tablewrap"><table class="t"><thead><tr><th class="l">Part</th><th>Efficiency</th><th>Power</th><th>Emissions</th><th>Sturdiness</th><th>Cost</th><th>Min dmg / drop</th></tr></thead><tbody>' + catalog + '</tbody></table></div></div></div>';
}


/* ====================== MY SHIP (save file) ====================== */
function parseSave(buf) {
  const dv = new DataView(buf); let p = 0;
  const need = n => { if (p + n > buf.byteLength) throw new Error('The file ends early; it may be damaged.'); };
  const u32 = () => { need(4); const v = dv.getUint32(p, true); p += 4; return v; };
  const i32 = () => { need(4); const v = dv.getInt32(p, true); p += 4; return v; };
  const f32 = () => { need(4); const v = dv.getFloat32(p, true); p += 4; return v; };
  const f64 = () => { need(8); const v = dv.getFloat64(p, true); p += 8; return v; };
  const u8 = () => { need(1); return dv.getUint8(p++); };
  const str = () => { const n = u32(); if (n > 4096) throw new Error('Unexpected data in the file (text length ' + n + ').'); need(n); let t = ''; for (let i = 0; i < n; i++) t += String.fromCharCode(dv.getUint8(p + i)); p += n; return t; };
  if (u32() !== 0x5f6ae9) throw new Error('This is not an Objects in Space save (objectsNN.sav).');
  const version = u32();
  if (version !== 12) throw new Error('This save is version ' + version + '. Only version 12 saves (game 1.0.x) can be read.');
  const o = { version, game: str(), title: str(), meta: {} };
  for (;;) { const tag = i32(), t = u8(); const v = t === 0 ? u32() : str(); if (tag === -9999) break; o.meta[tag] = v; }
  o.difficulty = u32(); u32(); p += 3;
  const nf = u32(); o.flags = []; for (let i = 0; i < nf; i++) o.flags.push(str());
  o.classval = u32();
  const sh = { strings: [] };
  for (let i = 0; i < 5; i++) sh.strings.push(str());
  sh.behav = u32(); sh.x = f64(); sh.y = f64(); sh.sector = u32(); u8(); u32(); sh.player = u8();
  const nh = u32(); sh.hull = []; for (let i = 0; i < nh; i++) sh.hull.push([u32(), f32()]);
  const nc = u32(); for (let i = 0; i < nc; i++) { str(); u32(); u32(); u32(); u32(); }
  const nm = u32(); sh.mods = [];
  for (let k = 0; k < nm; k++) {
    const m = { id: str(), comps: [] };
    for (let i = 0; i < 20; i++) { const id = u32(), h = f32(); m.comps.push([id === 0xffffffff ? -1 : id, h]); }
    p += 160;                                  // 20 add-on pairs
    m.on = u8(); m.count = i32(); i32(); u8(); u8(); m.setting = i32(); p += 4;
    sh.mods.push(m);
  }
  o.ship = sh;
  return o;
}
const HULL_NAMES = ['Bow', 'Stern', 'Port', 'Starboard', 'Primary'];
function saveToFit(sv) {
  const sh = sv.ship, id = SHIP[sv.meta[1004]] ? sv.meta[1004] : (SHIP[sh.strings[0]] ? sh.strings[0] : null);
  if (!id) throw new Error('Hull class "' + (sv.meta[1004] || sh.strings[0]) + '" is not in the lab\'s ship list.');
  const fit = emptyFit(id), plan = slotPlan(SHIP[id]), unknown = [], extra = [];
  for (const m of sh.mods) {
    const mod = MOD[m.id];
    if (!mod) { unknown.push(m.id); continue; }
    const k = plan.findIndex((p, j) => !fit.slots[j].mod && (p.only ? p.only === mod.t : p.group === GROUP_OF[mod.t]));
    if (k < 0) { extra.push(m.id); continue; }
    const n = DATA.if[mod.if].s.length;
    const ids = [], health = [];
    for (let i = 0; i < n; i++) { const [cid, h] = m.comps[i]; const ok = cid >= 0 && COMP[cid]; ids.push(ok ? cid : -1); health.push(ok ? Math.max(0, h) : null); }
    fit.slots[k] = { mod: mod.id, ids, health, strat: 'custom', locked: true, save: { on: m.on, setting: m.setting, count: m.count } };
  }
  return { fit, unknown, extra };
}
function loadSaveFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const sv = parseSave(rd.result), r = saveToFit(sv);
      S.save = { name: file.name, sv, fit: r.fit, unknown: r.unknown, extra: r.extra }; S.saveErr = '';
    } catch (e) { S.save = null; S.saveErr = e.message; }
    renderTab();
  };
  rd.onerror = () => { S.saveErr = 'The file could not be read.'; renderTab(); };
  rd.readAsArrayBuffer(file);
}
function healthBar(h, c) {
  const pct = Math.max(0, Math.min(100, h));
  const col = h < c.mind ? 'var(--bad)' : h < c.dbd ? 'var(--amber)' : 'var(--good)';
  return '<span class="hbar" title="Worse than ' + c.dbd + ' costs efficiency; below ' + c.mind + ' the part stops working"><i style="width:' + pct + '%;background:' + col + '"></i></span>';
}
function renderShip() {
  const sv = S.save;
  const drop = '<label class="drop" id="drop" for="savefile"><b>Choose your save file</b> or drop it here<br><span class="dim">objects00.sav in your Objects in Space save folder. The file is read in your browser and never uploaded.</span></label><input type="file" id="savefile" accept=".sav,application/octet-stream" hidden>';
  if (!sv) return '<div class="card" style="margin-top:18px"><h2>My ship</h2>' + drop + (S.saveErr ? '<div class="bad" style="margin-top:10px">' + esc(S.saveErr) + '</div>' : '') +
    '<p class="dim" style="margin-top:12px">Reads the ship from a save: which modules you have, every part in every slot and its health, what the damage is costing you, and which modules and parts your save has flagged as yours.</p></div>';
  const c = ctx(), m = sv.sv.meta, sh = sv.sv.ship, fit = sv.fit, ship = SHIP[fit.ship];
  const sum = summarize(fit, c);
  const flagsOf = pre => sv.sv.flags.filter(f => f.indexOf(pre) === 0).map(f => f.slice(pre.length));
  const ownedMods = flagsOf('has_module_'), ownedParts = flagsOf('has_component_');
  const partByName = {}; for (const id of Object.keys(COMP)) partByName[COMP[id].name.toLowerCase()] = COMP[id];
  const hulls = sh.hull.map(([i, v]) => HULL_NAMES[i] + ' ' + fmt(v, 0)).join(', ');
  const hullDamaged = sh.hull.some(([, v]) => v > 0);
  const info = [['Pilot', m[1001]], ['Ship', (m[1003] || sh.strings[1]) + ' (' + sh.strings[2] + ')'], ['Hull', ship.name], ['Credits', m[1002] != null ? money(m[1002]) : '-'],
    ['Docked at', m[1009] || 'in space'], ['Saved', m[1006] || '-'], ['In-game date', m[1007] || '-'], ['Game version', m[1010] || '-'], ['Hull damage', hullDamaged ? hulls : 'none recorded']];
  const kv = info.map(([k, v]) => '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('');
  // damage accounting
  let rows = '', worst = [];
  sum.rows.forEach(r => {
    const s = fit.slots[r.slot], f = DATA.if[r.mod.if];
    const open = S.saveOpen[r.slot];
    const loss = r.ev.pristine - r.ev.eff;
    let parts = '';
    f.s.forEach(([cls, chain, buf], k) => {
      const id = r.ev.ids[k]; const cc = id >= 0 ? COMP[id] : null; const h = s.health ? s.health[k] : null;
      if (cc && h != null) {
        const fixed = s.health.slice(); fixed[k] = 100;
        const gain = evalBuild(r.mod, r.ev.ids, fixed).eff - r.ev.eff;
        if (h < 99.95) worst.push({ mod: r.mod, cls, cc, h, gain, slot: r.slot, costs: h < cc.dbd });
      }
      parts += '<tr><td>' + esc(CLASS_LABEL[cls]) + (buf ? ' <span class="tag">buffer</span>' : '') + '</td><td class="mono">' + (chain || 'main') + '</td><td>' + (cc ? esc(cc.name) + ' <span class="dim">' + esc(cc.mfr) + '</span>' : '<span class="dim">(empty)</span>') + '</td><td>' + (cc ? healthBar(h, cc) + ' <span class="mono">' + fmt(h, 1) + '%</span>' + (h < cc.mind ? ' <span class="tag tie">not working</span>' : '') : '') + '</td></tr>';
    });
    const sw = s.save || {};
    rows += '<tr class="mrow2"><td class="l"><b>' + esc(r.mod.name) + '</b> <span class="dim">' + esc(TYPE_LABEL[r.mod.t]) + '</span>' + (r.mod.special ? '<span class="tag">NPC kit</span>' : '') + '</td>' +
      '<td class="mono">' + r.ev.eff + '%' + (loss > 0 ? ' <span class="dim">of ' + r.ev.pristine + '%</span>' : '') + '</td>' +
      '<td class="mono ' + (loss > 0 ? 'lossc' : '') + '">' + (loss > 0 ? '-' + loss : '0') + '</td>' +
      '<td class="l ks">' + keyStats(r, 2) + '</td>' +
      '<td class="mono">' + (sw.on ? 'on' : 'off') + ' ' + (sw.setting != null && sw.setting !== 100 ? sw.setting + '%' : '') + (r.mod.t === 'cm' ? ' ' + sw.count + ' left' : '') + '</td>' +
      '<td class="l"><button class="btn small ghost" data-act="svopen" data-i="' + r.slot + '">' + (open ? 'Hide parts' : 'Parts') + '</button> <button class="btn small ghost" data-act="svparts" data-i="' + r.slot + '">Parts lab</button></td></tr>' +
      (open ? '<tr><td colspan="6" class="l" style="background:var(--panel2)"><table class="alts"><tr><th>Slot</th><th>Chain</th><th>Part</th><th>Health</th></tr>' + parts + '</table>' + r.warn.map(w => '<div class="bad">' + esc(w) + '</div>').join('') + (r.ev.dead ? '<div class="bad">This module is dead: ' + esc(r.ev.why) + '.</div>' : '') + '</td></tr>' : '');
  });
  worst.sort((a, b) => (b.gain - a.gain) || (a.h - b.h));
  const nCost = worst.filter(w => w.costs).length;
  const wtable = worst.length ? '<table class="alts"><tr><th>Part</th><th>In</th><th>Health</th><th>Efficiency back if repaired</th></tr>' + worst.slice(0, 12).map(w => '<tr><td>' + esc(w.cc.name) + ' <span class="dim">' + esc(CLASS_LABEL[w.cls]) + '</span></td><td>' + esc(w.mod.name) + '</td><td class="mono">' + fmt(w.h, 1) + '% ' + healthBar(w.h, w.cc) + '</td><td class="mono ' + (w.gain > 0 ? 'good' : 'dim') + '">' + (w.gain > 0 ? '+' + w.gain + '%' : (w.costs ? 'none (chain is off)' : 'no cost yet')) + '</td></tr>').join('') + '</table>' : '<p class="good">Every part is at full health.</p>';
  const nDam = worst.length, nDead = sum.rows.reduce((a, r) => a + r.ev.ids.filter((id, k) => id >= 0 && fit.slots[r.slot].health && fit.slots[r.slot].health[k] < COMP[id].mind).length, 0);
  const chipsOf = (list, look) => list.map(n => { const hit = look(n); return '<span class="tag' + (hit ? '' : ' tie') + '">' + esc(hit ? hit.name : n) + '</span>'; }).join(' ');
  const fitted = new Set(sum.rows.map(r => r.mod.id));
  const modChips = chipsOf(ownedMods, n => MOD[n]);
  const missing = ownedMods.filter(n => MOD[n] && !fitted.has(n)).map(n => MOD[n].name);
  const unknown = sv.unknown.concat(sv.extra);
  return '<div style="margin-top:18px" class="col"><div class="card"><div class="row" style="justify-content:space-between"><h2>My ship</h2><div class="row"><span class="dim">' + esc(sv.name) + '</span><label class="btn small" for="savefile">Load another save</label><input type="file" id="savefile" accept=".sav,application/octet-stream" hidden></div></div>' +
    '<div class="kvs">' + kv + '</div></div>' +
    '<div class="card"><div class="row" style="justify-content:space-between"><h2>Fitted modules (' + sum.rows.length + ')</h2><div class="row"><button class="btn primary" data-act="svbuild">Open in Build tab</button></div></div>' +
    '<div class="kpis" style="margin:10px 0"><div class="kpi ' + (nCost ? 'warn' : '') + '"><div class="l">Worn parts</div><div class="v">' + nDam + '</div><div class="s">' + nCost + ' costing efficiency, ' + nDead + ' not working</div></div>' +
    '<div class="kpi"><div class="l">Power balance</div><div class="v">' + (sum.net >= 0 ? '+' : '') + fmt(sum.net, 1) + ' kW</div><div class="s">idle; generation ' + fmt(sum.S.gen + sum.S.solar, 1) + ', battery ' + money(sum.S.cap) + '</div></div>' +
    '<div class="kpi"><div class="l">Signature</div><div class="v">' + fmt(sum.S.emIdle, 0) + ' / ' + fmt(sum.S.emHigh, 0) + '</div><div class="s">emissions idle / all active</div></div>' +
    '<div class="kpi"><div class="l">Module value</div><div class="v">' + money(sum.price) + '</div><div class="s">hull ' + money(sum.hullValue) + '</div></div></div>' +
    (unknown.length ? '<div class="warn">Not in the lab\'s catalog or no free slot: ' + esc(unknown.join(', ')) + '.</div>' : '') +
    '<div class="tablewrap"><table class="t"><thead><tr><th class="l">Module</th><th>Efficiency now</th><th>Lost to damage</th><th class="l">Key stats now</th><th>Switch</th><th class="l"></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
    '<div class="grid2"><div class="card"><h2>Repair priorities</h2><p class="dim" style="font-size:12.5px">Every part below full health, ranked by how much efficiency its module would get back if you repaired it. A part only costs efficiency once it is worn below its own limit.</p>' + wtable + '</div>' +
    '<div class="card"><h2>What your save says you have</h2><p class="dim" style="font-size:12.5px">From the save\'s ownership flags. They record what you have bought or unlocked, not how many.</p><h4 class="dim" style="margin-top:8px">Modules</h4><div class="chips">' + (modChips || '<span class="dim">none flagged</span>') + '</div>' +
    (missing.length ? '<p class="dim" style="margin-top:8px;font-size:12.5px">Owned but not fitted: ' + esc(missing.join(', ')) + '</p>' : '') +
    '<h4 class="dim" style="margin-top:12px">Parts</h4><div class="chips">' + (chipsOf(ownedParts, n => partByName[n]) || '<span class="dim">none flagged</span>') + '</div></div></div></div>';
}

/* ====================== SAVED TAB ====================== */
function renderSaved() {
  const rows = S.saved.map((b, i) => {
    let fit; try { fit = fitFromCode(b.code); } catch (e) { return ''; }
    const sum = summarize(fit, { patch: b.patch != null ? b.patch : S.patch, sun: S.sun });
    return { i, b, fit, sum };
  }).filter(Boolean);
  const list = rows.map(r => '<div class="saveditem"><input type="checkbox" data-act="cmp" data-i="' + r.i + '" aria-label="Compare ' + esc(r.b.name) + '"' + (S.cmp.indexOf(r.i) >= 0 ? ' checked' : '') + '><div><b>' + esc(r.b.name) + '</b> <span class="dim">' + esc(SHIP[r.fit.ship].name) + ' - ' + money(r.sum.price + r.sum.hullValue) + ' - ' + esc(PATCH_LEVELS[r.b.patch != null ? r.b.patch : 2].short) + '</span></div><div class="row"><button class="btn small" data-act="loadsaved" data-i="' + r.i + '">Load</button><button class="btn small ghost" data-act="delsaved" data-i="' + r.i + '">Delete</button></div></div>').join('');
  const sel = rows.filter(r => S.cmp.indexOf(r.i) >= 0).slice(0, 4);
  let cmp = '';
  if (sel.length >= 2) {
    const metrics = [
      ['Hull', r => SHIP[r.fit.ship].name], ['Price', r => money(r.sum.price + r.sum.hullValue)], ['Generation kW', r => fmt(r.sum.S.gen + r.sum.S.solar, 1)],
      ['Idle draw kW', r => fmt(r.sum.S.idle, 2)], ['All-active draw kW', r => fmt(r.sum.S.high, 1)], ['Battery capacity', r => fmt(r.sum.S.cap, 0)],
      ['Emissions idle / active', r => fmt(r.sum.S.emIdle, 0) + ' / ' + fmt(r.sum.S.emHigh, 0)],
      ['Jump range', r => (r.sum.byType.jumpdrive ? fmt(r.sum.byType.jumpdrive[0].st.range.v, 0) : '-')],
      ['Thrust', r => (r.sum.byType.maindrive ? fmt(r.sum.byType.maindrive[0].st.thrust.v, 2) : '-')],
      ['Sensor strength', r => (r.sum.byType.sensor ? fmt(r.sum.byType.sensor[0].st.q.v, 2) : '-')],
      ['Comms sync', r => (r.sum.byType.comms ? fmt(r.sum.byType.comms[0].st.sync.v, 2) : '-')]
    ];
    cmp = '<div class="tablewrap" style="margin-top:12px"><table class="t"><thead><tr><th class="l">Metric</th>' + sel.map(r => '<th>' + esc(r.b.name) + '</th>').join('') + '</tr></thead><tbody>' +
      metrics.map(([l, fn]) => '<tr><td class="l">' + l + '</td>' + sel.map(r => '<td class="mono">' + esc(fn(r)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  } else if (rows.length) cmp = '<p class="dim">Tick two to four builds to compare them side by side.</p>';
  return '<div class="card" style="margin-top:18px"><h2>Saved builds</h2>' + (rows.length ? '<div class="saved">' + list + '</div>' : '<p class="dim">Nothing saved yet. Name a build at the bottom of the Build tab.</p>') + cmp + '</div>' +
    '<div class="card" style="margin-top:16px"><h2>Import a build code</h2><textarea id="importbox" placeholder="Paste a build code here"></textarea><div class="row" style="margin-top:8px"><button class="btn primary" data-act="import">Load code</button></div></div>';
}

/* ====================== HOW IT WORKS ====================== */
function renderHow() {
  const rows = [
    ['Reactor', 'power output', 'generationrate x e'], ['Solar wing', 'power output', 'generationrate x e x range x sunlight'], ['Battery', 'capacity', 'maxpowercontent x e'],
    ['Nav computer', 'boot time', 'boottime x (2 - e)'], ['Helm', 'boot time', 'boottime x (2 - e) x 0.5'], ['Sensors', 'signal strength', 'sensorquality x e'],
    ['Ladar', 'range (radius is fixed)', 'ladarrange x e'], ['Comms', 'sync time', 'synctime x (2 - e) x 0.5'], ['Main drive', 'thrust', 'thrust x e'],
    ['RCS', 'rotation rate', 'rotationrate x e'], ['Jump drive', 'range and spin-up', 'jumpdistance x e; spinuptime x (2 - e)'],
    ['Launcher', 'tube spin-up', 'base game: spinuptime x e x 0.5. With the spin-up fix: spinuptime x (2 - e) x 0.5'],
    ['Point defence', 'range and reload', 'range x e; reloadtime x (2 - e)'], ['Countermeasures', 'reload between drops', 'reloadtime x (2 - e) x 0.5'],
    ['Hacking', 'hack time (range is fixed)', 'hacktime x (2 - e)'], ['Grapple arm', 'transfer time', 'grappletime x (2 - e)']
  ];
  return '<div class="card prose" style="margin-top:18px">' +
    '<h3>Where the numbers come from</h3><p>Module, part, interface and hull data are read from the game files (the fixed module files, <code>components.txt</code>, <code>compinterfaces.txt</code> and the ship class files). The formulas come from the decompiled exe and the exe itself, so they match what the game computes. Nothing here has been checked against a running game.</p>' +
    '<h3>Efficiency</h3><p><code>efficiency = 100 + the sum of every working part\'s efficiency modifier</code>, rounded down to a whole percent. Write <code>e</code> for efficiency / 100.</p>' +
    '<ul><li>Parts sit in slots. Each slot belongs to a <b>chain</b>. Leave a slot on the main line empty and the whole module is dead (0%).</li><li>Leave any other slot empty and that whole chain stops counting, although its parts still draw power and make noise.</li><li>If every chain on one side stops, the module is dead.</li><li>Every part adds a power-draw percentage and an emissions percentage to the module. Better parts cost power and make you easier to see.</li><li>A buffer adds no efficiency; it absorbs EMP hits and costs a lot of power and emissions.</li></ul>' +
    '<h3>What efficiency changes</h3><div class="tablewrap"><table class="t"><thead><tr><th class="l">Module</th><th class="l">Changes</th><th class="l">Formula</th></tr></thead><tbody>' + rows.map(r => '<tr><td class="l">' + r[0] + '</td><td class="l">' + r[1] + '</td><td class="l formula">' + esc(r[2]) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<h3>Patch levels</h3><ul>' + PATCH_LEVELS.map(p => '<li><b>' + p.name + ':</b> ' + esc(p.note) + '</li>').join('') + '</ul>' +
    '<p>The patch selector in the header switches the power-drain rule and the launcher spin-up formula. Nothing else in these numbers differs between the levels.</p>' +
    '<h3>Things to know</h3><ul>' +
    '<li><b>200% efficiency stalls countermeasures.</b> A countermeasure drop is ready when its timer reaches -1, but the timer only counts down while it is above zero. At 200 to about 220% the reload lands between -1 and 0 and never finishes. The auto-fitter never picks such a build; the Parts lab will let you and warns you.</li>' +
    '<li><b>Every timer except launcher spin-up uses (2 - e)</b> so better parts always make them shorter. The base game uses <code>e</code> for launcher spin-up, so better parts make it longer. The spin-up fix makes it consistent.</li>' +
    '<li><b>Base-game battery drain ignores part power modifiers.</b> The module screens show the modified figure, but the batteries only lose the base figure. The patch makes them agree.</li>' +
    '<li><b>Ships:</b> a hull has major, engine, computer and external slots. Reactors and jump drives go in major slots, the main drive in the engine slot, batteries, nav, sensors, helm, comms and hacking in computer slots, and everything else in external slots. Batteries are capped by the hull.</li></ul>' +
    '<h3>NPC kit modules</h3><p>The Remora RCS (AP-RCS1), the Remora sensor (RM-SNS) and the probe sensor come from the NPC module file. They are in the pickers and the Modules tab, tagged NPC kit, and the auto-fitter ignores them unless you tick the box in Rules. RM-SNS is about six times stronger than any shop sensor, which is why it is off by default.</p>' +
    '<h3>My ship</h3><p>The My ship tab reads a version 12 save (<code>objects00.sav</code>) in your browser; nothing is uploaded. It lists every fitted module, every part in every slot with its health, and what wear is costing each module. A part only costs efficiency once its health drops below its own limit; below its minimum it stops working and its chain switches off. The ownership chips come from the save\'s <code>has_module_</code> and <code>has_component_</code> flags.</p>' +
    '<h3>How the fitter chooses</h3><p>Each role slider scales how much a module\'s job matters; Stealth rewards low emissions, Economy low power draw, Low price a small bill and Toughness sturdy parts and a buffer. For every module the fitter tries about forty parts builds (the stock presets plus uniform builds by efficiency, noise, power, sturdiness and cost, with or without a buffer and with minimal chains), scores them against the sliders, and picks the best module. Scores are measured against the best and worst the game offers for that module type.</p>' +
    '<p><b>Ties:</b> modules scoring within 1% of each other are tied. The one that does its job better wins, then the cheaper one.</p></div>';
}

/* ====================== SHELL ====================== */
function renderShell() {
  const patch = PATCH_LEVELS.map(p => '<button data-act="patch" data-v="' + p.id + '" aria-pressed="' + (S.patch === p.id) + '">' + p.name + '</button>').join('');
  const ships = SHIPS.map(s => '<option value="' + s.id + '"' + (s.id === S.ship ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  const tabs = [['build', 'Build'], ['modules', 'Modules'], ['parts', 'Parts lab'], ['ship', 'My ship'], ['saved', 'Saved'], ['how', 'How it works']].map(([k, l]) => '<button role="tab" data-act="tab" data-v="' + k + '" aria-selected="' + (S.tab === k) + '">' + l + '</button>').join('');
  $('#head').innerHTML = '<div class="brandrow"><div class="brand"><h1>Fitting Lab</h1><span>Objects in Space</span></div>' +
    '<div class="ctl"><label>Hull <select id="ship">' + ships + '</select></label><label>Game <span class="seg" role="group" aria-label="Patch level">' + patch + '</span></label></div></div>' +
    '<div class="tabs" role="tablist">' + tabs + '</div>';
  $('#head').insertAdjacentHTML('beforeend', '');
}
function renderTab() {
  const el = $('#main');
  el.innerHTML = { build: renderBuild, modules: renderModules, parts: renderParts, ship: renderShip, saved: renderSaved, how: renderHow }[S.tab]();
}
function renderAll() { renderShell(); renderTab(); $('#patchnote').textContent = PATCH_LEVELS[S.patch].note; persist(); }
function refreshFit() { const el = $('#fitpane'); if (el) el.innerHTML = renderFitPane(); persist(); }
let _t;
function refitSoon() { clearTimeout(_t); _t = setTimeout(() => { S.fit = autoFit(S.fit, S.goal, ctx()); refreshFit(); }, 120); }

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, i = +b.dataset.i;
  const slots = S.fit.slots;
  switch (a) {
    case 'tab': S.tab = b.dataset.v; renderAll(); break;
    case 'patch': S.patch = +b.dataset.v; _candCache.clear(); renderAll(); break;
    case 'goal': {
      S.goalId = b.dataset.id; const g = goalFromPreset(S.goalId);
      S.goal = { ...g, req: { ...g.req, sensorSW: S.goal.req.sensorSW, navSW: S.goal.req.navSW, budget: S.goal.req.budget }, include: S.goal.include };
      S.fit = autoFit(S.fit, S.goal, ctx()); renderAll(); break;
    }
    case 'fit': S.fit = autoFit(S.fit, S.goal, ctx()); refreshFit(); toast('Fitted'); break;
    case 'partsonly': S.fit = autoFit(S.fit, S.goal, ctx(), { partsOnly: true, force: true }); refreshFit(); toast('Parts re-picked'); break;
    case 'unlock': slots.forEach(s => { s.locked = false; }); refreshFit(); break;
    case 'stockfit': {
      const ship = SHIP[S.ship]; const plan = slotPlan(ship);
      const fresh = emptyFit(S.ship);
      (ship.stock || []).forEach(id => { const t = MOD[id].t; const k = plan.findIndex((p, j) => !fresh.slots[j].mod && (p.only ? p.only === t : p.group === GROUP_OF[t])); if (k >= 0) { fresh.slots[k] = { mod: id, ids: null, strat: 'new', locked: true }; } });
      fresh.slots.forEach(s => { if (s.mod) s.ids = presetIds(MOD[s.mod], 'new'); });
      S.fit = fresh; refreshFit(); toast(ship.stock ? 'Stock loadout loaded' : 'No stock loadout for this hull'); break;
    }
    case 'lock': slots[i].locked = !slots[i].locked; refreshFit(); break;
    case 'open': S.open[i] = !S.open[i]; refreshFit(); break;
    case 'toparts': S.parts.mod = slots[i].mod; S.parts.ids = (slots[i].ids || presetIds(MOD[slots[i].mod], 'new')).slice(); S.tab = 'parts'; renderAll(); break;
    case 'save': {
      const name = ($('#savename').value || '').trim() || (SHIP[S.ship].name + ' build ' + (S.saved.length + 1));
      S.saved.push({ name, code: fitToCode(S.fit), patch: S.patch }); persist(); toast('Saved "' + name + '"'); break;
    }
    case 'copycfg': copy('configuration=$stock:false:My build,' + configLine(S.fit), 'Ship file line'); break;
    case 'copyshop': copy(shoppingList(S.fit), 'Shopping list'); break;
    case 'copycode': copy(fitToCode(S.fit), 'Build code'); break;
    case 'svopen': S.saveOpen[i] = !S.saveOpen[i]; renderTab(); break;
    case 'svparts': { const sl = S.save.fit.slots[i]; S.parts.mod = sl.mod; S.parts.ids = sl.ids.slice(); S.parts.chart = 0; S.tab = 'parts'; renderAll(); break; }
    case 'svbuild': { S.fit = { ship: S.save.fit.ship, slots: S.save.fit.slots.map(x => ({ ...x })) }; S.ship = S.fit.ship; S.open = {}; S.tab = 'build'; renderAll(); toast('Loaded your ship into Build; every slot is pinned'); break; }
    case 'cmp': { const k = S.cmp.indexOf(i); if (k >= 0) S.cmp.splice(k, 1); else S.cmp.push(i); renderTab(); break; }
    case 'mtype': S.mods.type = b.dataset.t; S.mods.sort = null; renderTab(); break;
    case 'mbasis': S.mods.basis = b.dataset.v; renderTab(); break;
    case 'msort': S.mods.dir = S.mods.sort === b.dataset.k ? -S.mods.dir : -1; S.mods.sort = b.dataset.k; renderTab(); break;
    case 'mrow': S.parts.mod = b.dataset.id; S.parts.ids = null; S.parts.chart = 0; S.tab = 'parts'; renderAll(); break;
    case 'ppreset': S.parts.ids = presetIds(curPartsModule(), b.dataset.v).slice(); renderTab(); break;
    case 'pstrat': {
      const v = b.dataset.v, parts = v.split('+'); S.parts.ids = buildFrom(curPartsModule(), parts[0], { skeleton: parts.indexOf('min') > 0, buffer: parts.indexOf('buf') > 0 }); renderTab(); break;
    }
    case 'pchart': S.parts.chart = +b.dataset.j; renderTab(); break;
    case 'applytofit': slots[i].ids = S.parts.ids.slice(); slots[i].strat = 'custom'; slots[i].locked = true; S.tab = 'build'; renderAll(); toast('Parts applied'); break;
    case 'loadsaved': { const sv = S.saved[i]; S.fit = fitFromCode(sv.code); S.ship = S.fit.ship; if (sv.patch != null) S.patch = sv.patch; S.tab = 'build'; renderAll(); break; }
    case 'delsaved': S.saved.splice(i, 1); S.cmp = []; renderAll(); break;
    case 'import': {
      try { S.fit = fitFromCode($('#importbox').value.trim()); S.ship = S.fit.ship; S.tab = 'build'; renderAll(); toast('Build loaded'); }
      catch (err) { toast('That code could not be read'); }
      break;
    }
  }
});
document.addEventListener('change', e => {
  const t = e.target, a = t.dataset.act;
  if (t.id === 'ship') { S.ship = t.value; S.fit = autoFit(emptyFit(S.ship), S.goal, ctx()); S.open = {}; renderAll(); return; }
  if (t.id === 'r-ssw') { S.goal.req.sensorSW = +t.value; if (S.live) refitSoon(); return; }
  if (t.id === 'r-nsw') { S.goal.req.navSW = +t.value; if (S.live) refitSoon(); return; }
  if (t.id === 'r-sol') { S.goal.solar = Math.max(0, Math.min(6, +t.value || 0)); if (S.live) refitSoon(); return; }
  if (t.id === 'r-bud') { S.goal.req.budget = +t.value || null; if (S.live) refitSoon(); return; }
  if (t.id === 'live') { S.live = t.checked; persist(); return; }
  if (t.id === 'r-spec') { S.goal.special = t.checked; if (S.live) refitSoon(); return; }
  if (t.id === 'savefile') { if (t.files[0]) loadSaveFile(t.files[0]); return; }
  if (t.dataset.inc) { S.goal.include[t.dataset.inc] = t.checked; if (S.live) refitSoon(); return; }
  if (t.id === 'pmod') { S.parts.mod = t.value; S.parts.ids = null; S.parts.chart = 0; renderTab(); return; }
  if (a === 'mod') {
    const i = +t.dataset.i; const s = S.fit.slots[i];
    if (!t.value) { s.mod = null; s.ids = null; s.locked = false; }
    else { s.mod = t.value; s.locked = true; s.strat = 'auto'; s.health = null; s.ids = bestBuild(MOD[s.mod], S.goal, ctx()).cand.ids.slice(); }
    refreshFit();
  } else if (a === 'strat') {
    const i = +t.dataset.i, s = S.fit.slots[i], m = MOD[s.mod], v = t.value;
    s.strat = v; s.locked = true; s.health = null;
    if (v === 'auto') { const b = bestBuild(m, S.goal, ctx()); s.ids = b.cand.ids.slice(); s.label = b.cand.label; }
    else if (v === 'new') s.ids = presetIds(m, 'new');
    else if (v !== 'custom') s.ids = buildFrom(m, v, {});
    refreshFit();
  } else if (a === 'part') {
    const i = +t.dataset.i, k = +t.dataset.k, s = S.fit.slots[i], m = MOD[s.mod];
    const ids = (s.ids || presetIds(m, 'new')).slice(); ids[k] = +t.value; s.ids = ids; s.health = null; s.strat = 'custom'; s.locked = true; refreshFit();
  } else if (a === 'ppart') { S.parts.ids[+t.dataset.k] = +t.value; renderTab(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.w) {
    S.goal.w[t.dataset.w] = +t.value; $('#o-' + t.dataset.w).textContent = t.value; S.goalId = 'custom';
    $('#blurb').textContent = 'Custom mix.';
    document.querySelectorAll('[data-act=goal]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    if (S.live) refitSoon(); else { refreshFit(); }
  } else if (t.id === 'sun') { S.sun = +t.value; $('#sunv').textContent = fmt(S.sun, 2) + 'x'; refitSoonSun(); }
  else if (t.id === 'mq') { S.mods.q = t.value; const pos = t.selectionStart; renderTab(); const n = $('#mq'); n.focus(); n.setSelectionRange(pos, pos); }
});
let _s; function refitSoonSun() { clearTimeout(_s); _s = setTimeout(() => { const keep = document.activeElement && document.activeElement.id === 'sun'; refreshFit(); if (keep) { const n = $('#sun'); if (n) n.focus(); } }, 60); }

document.addEventListener('dragover', e => { if (e.target.closest && e.target.closest('#drop')) { e.preventDefault(); e.target.closest('#drop').classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { if (e.target.closest && e.target.closest('#drop')) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadSaveFile(f); } });

/* ---------- boot ---------- */
(function boot() {
  const had = restore();
  if (!S.fit || S.fit.ship !== S.ship) S.fit = autoFit(emptyFit(S.ship), S.goal, ctx());
  renderAll();
})();
