'use strict';
/* ====================================================================
   Fitting Lab core: game data model, efficiency maths, scoring, auto-fit.
   Pure functions only (no DOM) so it can be tested under node.
   Everything below is derived from the game's data files and from the
   decompiled/disassembled exe (see the "How it works" tab).
   ==================================================================== */

const TYPES = ['generator', 'solar', 'battery', 'nav', 'helm', 'sensor', 'ladar', 'comms',
  'maindrive', 'rcs', 'jumpdrive', 'weapon', 'pds', 'cm', 'hack', 'arm'];
const TYPE_LABEL = {
  generator: 'Reactor', solar: 'Solar wing', battery: 'Battery', nav: 'Nav computer', helm: 'Helm',
  sensor: 'Sensors', ladar: 'Ladar', comms: 'Comms', maindrive: 'Main drive', rcs: 'RCS',
  jumpdrive: 'Jump drive', weapon: 'Launcher', pds: 'Point defence', cm: 'Countermeasures',
  hack: 'Hacking', arm: 'Grapple arm'
};
// Which ship slot group each module type fits (ShipModuleClass::getSlotTypeForModuleType).
const GROUP_OF = {
  generator: 'major', jumpdrive: 'major', maindrive: 'engine',
  battery: 'comp', nav: 'comp', sensor: 'comp', helm: 'comp', comms: 'comp', hack: 'comp',
  cm: 'ext', weapon: 'ext', rcs: 'ext', pds: 'ext', solar: 'ext', ladar: 'ext', arm: 'ext'
};
const GROUP_LABEL = { major: 'Major', engine: 'Engine', comp: 'Computer', ext: 'External' };
const GROUPS = ['major', 'engine', 'comp', 'ext'];
// Slider categories: which module types each one rates.
const CAT_OF = {
  generator: 'power', solar: 'power', battery: 'power',
  maindrive: 'speed', rcs: 'speed', helm: 'speed',
  jumpdrive: 'jump', nav: 'jump',
  sensor: 'sensing', ladar: 'sensing',
  weapon: 'combat', pds: 'combat', cm: 'combat',
  comms: 'comms', hack: 'comms',
  arm: 'salvage'
};
const CATS = ['power', 'speed', 'jump', 'sensing', 'combat', 'comms', 'salvage'];
const CAT_LABEL = {
  power: 'Power and storage', speed: 'Speed and handling', jump: 'Jump range', sensing: 'Sensing',
  combat: 'Combat', comms: 'Comms and hacking', salvage: 'Salvage'
};
const CAT_TYPES = {};
for (const t of TYPES) (CAT_TYPES[CAT_OF[t]] = CAT_TYPES[CAT_OF[t]] || []).push(t);

const PATCH_LEVELS = [
  { id: 0, name: 'Base game', short: 'Base', note: 'Stock exe. Battery drain ignores part power modifiers; weapon spin-up grows with efficiency.' },
  { id: 1, name: 'Bugfix patch', short: 'Patch', note: 'The standard patcher: part power modifiers now cost battery power.' },
  { id: 2, name: 'Patch + spin-up fix', short: 'Patch+', note: 'Adds --weapon-spinup-fix: weapon spin-up shrinks as efficiency rises.' }
];

/* ---------- data ---------- */
const COMP = {};          // id -> part
const PARTS_BY_CLASS = {};
for (const id of Object.keys(DATA.comps)) {
  const c = DATA.comps[id];
  const p = { id: +id, name: c[0], cls: c[1], mfr: c[2], eff: c[3], pw: c[4], em: c[5], sturd: c[6], mind: c[7], dbd: c[8], drop: c[9], cost: c[10] };
  COMP[id] = p;
  (PARTS_BY_CLASS[p.cls] = PARTS_BY_CLASS[p.cls] || []).push(p);
}
const MOD = {};
const MODS_BY_TYPE = {};
for (const m of DATA.mods) {
  if (m.range_raw != null && m.range == null) m.range = 1;
  MOD[m.id] = m;
  (MODS_BY_TYPE[m.t] = MODS_BY_TYPE[m.t] || []).push(m);
}
const SHIPS = DATA.ships;
const SHIP = {};
for (const s of SHIPS) SHIP[s.id] = s;
const CLASS_ORDER = ['core', 'magnode', 'emrelay', 'microcomp', 'burner', 'tasconverter', 'shp1', 'roaut', 'clusterm', 'hapnode', 'buffer'];
const CLASS_LABEL = {
  core: 'Core', magnode: 'Mag-node', emrelay: 'EM relay', microcomp: 'Microcomputer', burner: 'Burner',
  tasconverter: 'TAS converter', shp1: 'SHP-1', roaut: 'ROAUT', clusterm: 'Cluster-M', hapnode: 'Hap-node', buffer: 'Buffer'
};

/* ---------- efficiency / power / emission maths ---------- */
const PRESET_NAMES = ['new', 'stealth', 'defence', 'lowpoweruse', 'boost'];
const PRESET_LABEL = { new: 'Stock', stealth: 'Stealth preset', defence: 'Defence preset', lowpoweruse: 'Low-power preset', boost: 'Efficiency preset' };

function padIds(mod, ids) {
  const n = DATA.if[mod.if].s.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(ids[i] == null ? -1 : ids[i]);
  return out;
}

/* Replicates ComponentInterfaceInstance::getEfficiencyPercent / getPowerModifier /
   getEmissionsModifier for undamaged parts.
   - a missing part in a chain-0 slot kills the module (0%)
   - a missing part in any other chain turns that whole chain off
   - the module is dead if every positive chain, or every negative chain, is off
   - efficiency = trunc(100 + sum of working parts' modifiers)
   - power and emission modifiers are percentages added to the module's draw / signature */
function evalBuild(mod, idsIn, health) {
  const f = DATA.if[mod.if];
  const ids = padIds(mod, idsIn);
  const slots = f.s;
  // a part is "working" when it exists and its health is at or above its minimum-damage threshold
  const working = i => ids[i] >= 0 && (!health || health[i] == null || health[i] >= COMP[ids[i]].mind);
  const pos = new Array(f.P + 1).fill(true), neg = new Array(f.N + 1).fill(true);
  let dead = false, why = '';
  for (let i = 0; i < slots.length; i++) {
    const [cls, chain, buf] = slots[i];
    if (buf) continue;
    if (!working(i)) {
      if (chain === 0) { dead = true; why = ids[i] < 0 ? 'a ' + CLASS_LABEL[cls] + ' slot on the main line is empty' : 'a ' + CLASS_LABEL[cls] + ' on the main line is destroyed'; }
      else if (chain > 0) pos[chain] = false; else neg[-chain] = false;
    }
  }
  if (!dead && f.P > 0 && !pos.slice(1).some(Boolean)) { dead = true; why = 'every positive chain is switched off'; }
  if (!dead && f.N > 0 && !neg.slice(1).some(Boolean)) { dead = true; why = 'every negative chain is switched off'; }
  let sum = 0, pw = 0, em = 0, sturd = 0, cost = 0, parts = 0, lost = 0, full = 0;
  for (let i = 0; i < slots.length; i++) {
    if (ids[i] < 0) continue;
    const c = COMP[ids[i]];
    parts++; sturd += c.sturd; cost += c.cost;
    const chain = slots[i][1];
    const alive = chain === 0 || (chain > 0 ? pos[chain] : neg[-chain]);
    full += c.eff;
    if (working(i)) {
      pw += c.pw; em += c.em;
      const h = health && health[i] != null ? health[i] : 100;
      const factor = h >= c.dbd ? 1 : 1 - c.drop / 100;
      if (alive) sum += c.eff * factor; else lost += c.eff;
    }
  }
  const chainDead = slots.some(([, ch, buf], i) => !buf && ch !== 0 && !working(i));
  if (dead && why.indexOf('main line') >= 0) { pw = 0; em = 0; }
  return { ids, eff: dead ? 0 : Math.trunc(100 + sum), pristine: Math.trunc(100 + full), pw, em, sturd, cost, parts, dead, why, lostEff: lost, chainDead };
}

/* ---------- build generators ---------- */
function partKey(strat) {
  if (strat === 'eff') return c => [-c.eff, c.pw + c.em, c.cost];
  if (strat === 'quiet') return c => [c.em, -c.eff, c.pw];
  if (strat === 'frugal') return c => [c.pw, -c.eff, c.em];
  if (strat === 'tough') return c => [-c.sturd, -c.eff, c.pw + c.em];
  if (strat === 'cheap') return c => [c.cost, -c.eff, c.pw + c.em];
  const lam = parseFloat(strat.slice(3));       // 'bal0.5': efficiency minus lambda x (power + emission)
  return c => [-(c.eff - lam * (c.pw + c.em)), c.cost, 0];
}
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] - b[i]; } return 0; }
const _bestCache = {};
function bestPart(cls, strat) {
  const k = cls + '|' + strat;
  if (_bestCache[k] !== undefined) return _bestCache[k];
  const key = partKey(strat);
  const list = (PARTS_BY_CLASS[cls] || []).slice().sort((a, b) => cmpArr(key(a), key(b)));
  return (_bestCache[k] = list.length ? list[0].id : -1);
}
const STRATS = ['eff', 'quiet', 'frugal', 'tough', 'cheap', 'bal0.25', 'bal0.5', 'bal1', 'bal2'];
const STRAT_LABEL = {
  eff: 'Max efficiency', quiet: 'Quietest', frugal: 'Lowest power', tough: 'Toughest', cheap: 'Cheapest',
  'bal0.25': 'Balanced (efficiency first)', 'bal0.5': 'Balanced', bal1: 'Balanced (thrifty)', bal2: 'Balanced (very thrifty)'
};
/* Which chains a "skeleton" build keeps: the main line plus the first chain on each side. */
function buildFrom(mod, strat, o) {
  o = o || {};
  const f = DATA.if[mod.if];
  const ids = [];
  for (const [cls, chain, buf] of f.s) {
    if (buf) { ids.push(o.buffer ? bestPart('buffer', o.bufStrat || strat) : -1); continue; }
    if (o.skeleton && chain !== 0 && Math.abs(chain) !== 1) { ids.push(-1); continue; }
    ids.push(bestPart(cls, strat));
  }
  return ids;
}
function presetIds(mod, name) {
  const c = mod.cfg[name];
  return c ? padIds(mod, c) : null;
}

/* Every candidate parts build of a module: strategy x buffer x skeleton, plus the module's own presets. */
const _candCache = new Map();
function candidates(mod) {
  if (_candCache.has(mod.id)) return _candCache.get(mod.id);
  const seen = new Set(), out = [];
  const add = (ids, label, strat) => {
    const key = ids.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const ev = evalBuild(mod, ids);
    if (ev.dead) return;
    if (warnings(mod, ev).some(w => /never become ready|never become/.test(w))) return;   // do not recommend a build that locks the module up
    out.push({ ids: ev.ids, ev, label, strat });
  };
  for (const n of PRESET_NAMES) { const p = presetIds(mod, n); if (p) add(p, PRESET_LABEL[n], 'preset:' + n); }
  for (const s of STRATS) for (const buffer of [false, true]) for (const skeleton of [false, true]) {
    const tag = STRAT_LABEL[s] + (skeleton ? ' (minimal)' : '') + (buffer ? ' + buffer' : '');
    add(buildFrom(mod, s, { buffer, skeleton }), tag, s + (skeleton ? '+min' : '') + (buffer ? '+buf' : ''));
  }
  _candCache.set(mod.id, out);
  return out;
}

/* ---------- module stats (patch-aware) ---------- */
function stat(v, u, hi, d) { return { v, u, hi, d: d == null ? 2 : d }; }
const STAT_DEFS = {
  generator: [['out', 'Output', (m, E) => stat(m.generationrate * E, 'kW', true)]],
  solar: [['out', 'Output in full sun', (m, E, I, c) => stat(m.generationrate * E * m.range * c.sun, 'kW', true)],
    ['range', 'Sunlight gain', (m) => stat(m.range, 'x', true)]],
  battery: [['cap', 'Capacity', (m, E) => stat(m.maxpowercontent * E, '', true, 1)],
    ['rech', 'Recharge', (m, E) => stat((m.generationrate || 0) * E, 'kW', true, 3)]],
  nav: [['boot', 'Boot time', (m, E, I) => stat(m.boottime * I, 'time', false)], ['sw', 'Software', (m) => stat(m.softwareversion, 'v', true, 0)]],
  helm: [['boot', 'Boot time', (m, E, I) => stat(m.boottime * I * 0.5, 'time', false)]],
  sensor: [['q', 'Signal strength', (m, E) => stat(m.sensorquality * E, '', true)], ['sw', 'Software', (m) => stat(m.softwareversion, 'v', true, 0)]],
  ladar: [['range', 'Range', (m, E) => stat(m.ladarrange * E, '', true, 0)], ['rad', 'Radius', (m) => stat(m.ladarradius, '', true, 0)]],
  comms: [['sync', 'Sync time', (m, E, I) => stat(m.synctime * I * 0.5, 'time', false)]],
  maindrive: [['thrust', 'Thrust', (m, E) => stat(m.thrust * E, '', true)]],
  rcs: [['rot', 'Rotation rate', (m, E) => stat(m.rotationrate * E, 'deg/s', true, 1)]],
  jumpdrive: [['range', 'Jump range', (m, E) => stat(m.jumpdistance * E, '', true, 0)],
    ['spin', 'Spin-up', (m, E, I) => stat(m.spinuptime * I, 'time', false, 1)],
    ['calc', 'Calc time', (m) => stat(m.calctime, 'time', false, 0)]],
  weapon: [['tubes', 'Tubes', (m) => stat(m.tubes, '', true, 0)],
    ['spin', 'Tube spin-up', (m, E, I, c) => stat(m.spinuptime * (c.patch >= 2 ? I : E) * 0.5, 'time', false, 1)]],
  pds: [['range', 'Range', (m, E) => stat(m.range * E, '', true, 1)],
    ['reload', 'Reload', (m, E, I) => stat(m.reloadtime * I, 'time', false)],
    ['hit', 'Hit chance', (m) => stat(m.hit ? 1 - 1 / m.hit : 0, '', true, 2)],
    ['hps', 'Hits per time', (m, E, I) => stat(I > 0 ? (m.hit ? 1 - 1 / m.hit : 0) / (m.reloadtime * I) : 0, '', true)]],
  cm: [['tubes', 'Countermeasures', (m) => stat(m.tubes, '', true, 0)], ['reload', 'Reload', (m, E, I) => stat(m.reloadtime * I * 0.5, 'time', false)]],
  hack: [['range', 'Hack range', (m) => stat(m.hackrange, '', true, 0)], ['time', 'Hack time', (m, E, I) => stat(m.hacktime * I, 'time', false)]],
  arm: [['time', 'Grapple time', (m, E, I) => stat(m.grappletime * I, 'time', false)]]
};
function modStats(mod, ev, ctx) {
  const E = ev.eff / 100, I = 2 - E;
  const out = {};
  for (const [k, , fn] of STAT_DEFS[mod.t]) out[k] = fn(mod, E, I, ctx);
  return out;
}
function drawOf(mod, ev, ctx) {
  const mult = 1 + ev.pw / 100;
  const shownIdle = (mod.normalpowerusage || 0) * mult, shownHigh = (mod.highpowerusage || 0) * mult;
  const real = ctx.patch >= 1 ? mult : 1;        // base game: batteries never see the part modifier
  return { shownIdle, shownHigh, idle: (mod.normalpowerusage || 0) * real, high: (mod.highpowerusage || 0) * real };
}
function emisOf(mod, ev) {
  const mult = 1 + ev.em / 100;
  return { idle: (mod.emissionstrength || 0) * mult, high: (mod.emissionhighstrength || 0) * mult };
}
/* Known cases where a module stops working properly at high efficiency. */
function warnings(mod, ev) {
  const w = [];
  const E = ev.eff / 100, I = 2 - E;
  if (mod.t === 'cm' && mod.tubes > 1) {
    const T = 0.5 * mod.reloadtime * I;
    if (T > -1 && T <= 0) w.push('Efficiency at 200% or more puts the reload timer between -1 and 0, so the countermeasures never become ready again after the first drop.');
  }
  if (mod.t === 'pds' && I <= 0) w.push('Efficiency at 200% or more makes the PDS reload timer zero or negative; it would never become ready again.');
  if (I <= 0 && ['nav', 'helm', 'comms', 'jumpdrive', 'hack', 'arm'].indexOf(mod.t) >= 0) w.push('Efficiency at 200% or more drives this timer to zero or below; behaviour there is untested.');
  return w;
}

/* ---------- scoring ---------- */
/* Primary-task terms per module type: [value, weight]; all "higher is better". */
function perfTerms(mod, ev, ctx) {
  const s = modStats(mod, ev, ctx), t = mod.t;
  switch (t) {
    case 'generator': return [[s.out.v, 1]];
    case 'solar': return [[s.out.v, 1]];
    case 'battery': return [[s.cap.v, 0.8], [s.rech.v, 0.2]];
    case 'nav': return [[-s.boot.v, 1]];
    case 'helm': return [[-s.boot.v, 1]];
    case 'sensor': return [[s.q.v, 1]];
    case 'ladar': return [[s.range.v, 0.5], [s.rad.v, 0.5]];
    case 'comms': return [[-s.sync.v, 1]];
    case 'maindrive': return [[s.thrust.v, 1]];
    case 'rcs': return [[s.rot.v, 1]];
    case 'jumpdrive': return [[s.range.v, 0.55], [-s.spin.v, 0.3], [-s.calc.v, 0.15]];
    case 'weapon': return [[s.tubes.v, 0.5], [-s.spin.v, 0.5]];
    case 'pds': return [[s.hps.v, 0.5], [s.range.v, 0.3], [s.hit.v, 0.2]];
    case 'cm': return [[s.tubes.v, 0.6], [-s.reload.v, 0.4]];
    case 'hack': return [[s.range.v, 0.6], [-s.time.v, 0.4]];
    case 'arm': return [[-s.time.v, 1]];
  }
  return [[0, 1]];
}
function rawMetrics(mod, cand, ctx) {
  const ev = cand.ev;
  const em = emisOf(mod, ev), dr = drawOf(mod, ev, ctx);
  return {
    perf: perfTerms(mod, ev, ctx),
    emis: 0.6 * em.idle + 0.4 * em.high,
    pow: 0.5 * dr.shownIdle + 0.5 * dr.shownHigh,
    price: mod.price + cand.ev.cost,
    sturd: ev.sturd + (ev.ids.some((id, i) => id >= 0 && DATA.if[mod.if].s[i][2]) ? 6 : 0)   // a fitted buffer shields from EMP
  };
}
const _normCache = {};
function normFor(ctx) {
  const key = ctx.patch >= 2 ? 'p2' : 'p' + ctx.patch;
  if (_normCache[key]) return _normCache[key];
  const N = {};
  for (const t of TYPES) {
    const rows = [];
    for (const m of MODS_BY_TYPE[t] || []) { if (m.special) continue; for (const c of candidates(m)) rows.push(rawMetrics(m, c, ctx)); }
    const n = rows[0].perf.length;
    const perfMin = new Array(n).fill(Infinity), perfMax = new Array(n).fill(-Infinity);
    const r = { emis: [Infinity, -Infinity], pow: [Infinity, -Infinity], price: [Infinity, -Infinity], sturd: [Infinity, -Infinity] };
    for (const x of rows) {
      x.perf.forEach(([v], i) => { perfMin[i] = Math.min(perfMin[i], v); perfMax[i] = Math.max(perfMax[i], v); });
      for (const k of ['emis', 'pow', 'price', 'sturd']) { r[k][0] = Math.min(r[k][0], x[k]); r[k][1] = Math.max(r[k][1], x[k]); }
    }
    N[t] = { perfMin, perfMax, r };
  }
  return (_normCache[key] = N);
}
const nz = (v, lo, hi) => (hi - lo < 1e-9 ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
function normMetrics(mod, cand, ctx) {
  const N = normFor(ctx)[mod.t], x = rawMetrics(mod, cand, ctx);
  let perf = 0;
  x.perf.forEach(([v, w], i) => { perf += w * nz(v, N.perfMin[i], N.perfMax[i]); });
  return {
    perf,
    emis: nz(x.emis, ...N.r.emis), pow: nz(x.pow, ...N.r.pow),
    price: nz(x.price, ...N.r.price), sturd: nz(x.sturd, ...N.r.sturd)
  };
}
function weightSum(goal, type) {
  const w = goal.w;
  return (w[CAT_OF[type]] || 0) + w.stealth + w.econ + w.thrift + w.tough;
}
function scoreOf(mod, cand, goal, ctx) {
  const n = normMetrics(mod, cand, ctx), w = goal.w;
  const s = (w[CAT_OF[mod.t]] || 0) * n.perf + w.stealth * (1 - n.emis) + w.econ * (1 - n.pow) +
    w.thrift * (1 - n.price) + w.tough * n.sturd;
  return { score: s, n };
}
function okByRules(mod, goal) {
  const r = goal.req || {};
  if (mod.special && !goal.special) return false;
  if (mod.t === 'sensor' && (mod.softwareversion || 0) < (r.sensorSW || 0)) return false;
  if (mod.t === 'nav' && (mod.softwareversion || 0) < (r.navSW || 0)) return false;
  return true;
}
/* Best parts build for a module under a goal. Ties go to the build that does the module's job better, then the cheaper. */
function bestBuild(mod, goal, ctx, only) {
  const ws = Math.max(1e-6, weightSum(goal, mod.t));
  let best = null;
  const list = only ? only(candidates(mod)) : candidates(mod);
  const rows = list.map(c => ({ c, ...scoreOf(mod, c, goal, ctx) }));
  const top = Math.max(...rows.map(r => r.score));
  const tied = rows.filter(r => r.score >= top - 0.01 * ws);
  tied.sort((a, b) => (b.n.perf - a.n.perf) || (a.n.price - b.n.price) || (b.score - a.score));
  best = tied[0];
  return { cand: best.c, score: best.score, n: best.n, ties: tied.length };
}
/* Rank all modules of a type for a goal. */
function rankType(type, goal, ctx, opts) {
  opts = opts || {};
  const rows = [];
  for (const m of MODS_BY_TYPE[type] || []) {
    if (!okByRules(m, goal)) continue;
    if (opts.partsOnly && m.id !== opts.partsOnly) continue;
    const b = bestBuild(m, goal, ctx, opts.only);
    rows.push({ mod: m, ...b });
  }
  rows.sort((a, b) => b.score - a.score);
  if (!rows.length) return rows;
  const ws = Math.max(1e-6, weightSum(goal, type));
  const top = rows[0].score;
  // the "tie" group: within 1% of the top score; the better performer at its task wins, then the cheaper
  const tied = rows.filter(r => r.score >= top - 0.01 * ws);
  tied.sort((a, b) => (b.n.perf - a.n.perf) || (a.mod.price - b.mod.price));
  const rest = rows.filter(r => tied.indexOf(r) < 0);
  rows.length = 0;
  rows.push(...tied, ...rest);
  rows.forEach((r, i) => { r.rank = i; r.tied = i < tied.length ? tied.length : 1; });
  return rows;
}

/* ---------- ships and fits ---------- */
function slotPlan(ship) {
  // returns [{group, label}] in display order
  const plan = [];
  const s = ship.slots;
  if (s.major != null || s.ext != null || s.comp != null) {
    for (const g of GROUPS) for (let i = 0; i < (s[g] || 0); i++) plan.push({ group: g, idx: i });
  } else {
    // older ships list one slot per module type
    for (const t of TYPES) for (let i = 0; i < (s[t] || 0); i++) plan.push({ group: GROUP_OF[t], only: t, idx: i });
  }
  return plan;
}
function allowedTypes(slot) {
  return slot.only ? [slot.only] : TYPES.filter(t => GROUP_OF[t] === slot.group);
}
function batteryCap(ship) { return ship.slots.battery != null ? ship.slots.battery : ship.bat; }

const DEFAULT_INCLUDE = { jumpdrive: true, hack: true, arm: true, ladar: true, weapon: true, pds: true, cm: true, rcs: true };
/* Picks module types for the free slots, in priority order. */
function planTypes(ship, include, solarCount, lockedTypes, occupied) {
  const plan = slotPlan(ship);
  const want = [];                         // [slotIndex, type]
  const free = {};
  plan.forEach((sl, i) => { if (!occupied.has(i)) (free[sl.only || sl.group] = free[sl.only || sl.group] || []).push(i); });
  const take = (key, type) => { const arr = free[key]; if (arr && arr.length) { want.push([arr.shift(), type]); return true; } return false; };
  const typed = !!plan[0] && !!plan[0].only;
  const slotKey = t => (typed ? t : GROUP_OF[t]);
  const have = t => lockedTypes[t] || 0;
  const need = (t) => have(t) === 0;
  if (need('generator')) take(slotKey('generator'), 'generator');
  if (include.jumpdrive && need('jumpdrive')) take(slotKey('jumpdrive'), 'jumpdrive');
  if (!typed && (ship.slots.major || 0) >= 3) take('major', 'generator');
  if (need('maindrive')) take(slotKey('maindrive'), 'maindrive');
  for (const t of ['nav', 'sensor', 'helm', 'comms']) if (need(t)) take(slotKey(t), t);
  if (include.hack && need('hack')) take(slotKey('hack'), 'hack');
  for (const t of ['rcs', 'weapon', 'pds', 'cm', 'ladar', 'arm']) if (include[t] !== false && need(t)) take(slotKey(t), t);
  let batt = batteryCap(ship) - have('battery');
  while (batt > 0 && take(slotKey('battery'), 'battery')) batt--;
  let sol = solarCount - have('solar');
  while (sol > 0 && take(slotKey('solar'), 'solar')) sol--;
  return want;
}

/* A fit is { ship, slots: [{mod, ids, strat, locked}], ctx }. */
function emptyFit(shipId) {
  const ship = SHIP[shipId];
  return { ship: shipId, slots: slotPlan(ship).map(p => ({ mod: null, ids: null, strat: 'auto', locked: false })) };
}
function pickModules(types, goal, ctx, budget, partsOnly) {
  // one best module per distinct type
  const chosen = {};
  const ranks = {};
  for (const t of new Set(types)) {
    ranks[t] = rankType(t, goal, ctx);
    if (ranks[t].length) chosen[t] = 0;
  }
  if (budget) {
    const price = () => Object.keys(chosen).reduce((a, t) => a + ranks[t][chosen[t]].mod.price * types.filter(x => x === t).length, 0);
    let guard = 400;
    while (price() > budget && guard-- > 0) {
      let bestSwap = null;
      for (const t of Object.keys(chosen)) {
        const cur = ranks[t][chosen[t]];
        for (let j = 0; j < ranks[t].length; j++) {
          const cand = ranks[t][j];
          const dp = (cur.mod.price - cand.mod.price) * types.filter(x => x === t).length;
          if (dp <= 0) continue;
          const loss = Math.max(0, cur.score - cand.score) / dp;
          if (!bestSwap || loss < bestSwap.loss) bestSwap = { t, j, loss };
        }
      }
      if (!bestSwap) break;
      chosen[bestSwap.t] = bestSwap.j;
    }
  }
  return { chosen, ranks };
}
function autoFit(fit, goal, ctx, opts) {
  opts = opts || {};
  const ship = SHIP[fit.ship], plan = slotPlan(ship);
  const slots = fit.slots.map(s => ({ ...s }));
  if (!opts.partsOnly) slots.forEach(s => { if (!(s.locked && s.mod)) { s.mod = null; s.ids = null; s.strat = 'auto'; s.locked = false; } });
  const lockedTypes = {}, occupied = new Set();
  slots.forEach((s, i) => { if (s.mod) { occupied.add(i); const t = MOD[s.mod].t; lockedTypes[t] = (lockedTypes[t] || 0) + 1; } });
  if (!opts.partsOnly) {
    const want = planTypes(ship, { ...DEFAULT_INCLUDE, ...(goal.include || {}) }, goal.solar || 0, lockedTypes, occupied);
    const types = want.map(w => w[1]);
    const { chosen, ranks } = pickModules(types, goal, ctx, goal.req && goal.req.budget);
    for (const [si, t] of want) {
      if (chosen[t] == null) continue;
      slots[si].mod = ranks[t][chosen[t]].mod.id;
    }
  }
  // parts for every slot that is not locked (or all, in parts-only mode)
  slots.forEach(s => {
    if (!s.mod) return;
    if (s.locked && !opts.partsOnly) return;
    if (s.strat !== 'auto' && opts.partsOnly && !opts.force) return;
    const m = MOD[s.mod];
    const b = bestBuild(m, goal, ctx);
    s.ids = b.cand.ids.slice(); s.strat = 'auto'; s.label = b.cand.label;
  });
  return { ...fit, slots };
}

/* ---------- ship summary ---------- */
function summarize(fit, ctx) {
  const rows = [];
  let price = 0, parts = 0;
  const S = { gen: 0, solar: 0, cap: 0, idleShown: 0, highShown: 0, idle: 0, high: 0, emIdle: 0, emHigh: 0, sturd: 0 };
  fit.slots.forEach((s, i) => {
    if (!s.mod) return;
    const m = MOD[s.mod];
    const ids = s.ids || presetIds(m, 'new') || [];
    const ev = evalBuild(m, ids, s.health);
    const st = modStats(m, ev, ctx), dr = drawOf(m, ev, ctx), em = emisOf(m, ev);
    rows.push({ slot: i, mod: m, ev, st, dr, em, warn: warnings(m, ev) });
    price += m.price; parts += ev.cost;
    S.idleShown += dr.shownIdle; S.highShown += dr.shownHigh; S.idle += dr.idle; S.high += dr.high;
    S.emIdle += em.idle; S.emHigh += em.high; S.sturd += ev.sturd;
    if (m.t === 'generator') S.gen += st.out.v;
    if (m.t === 'solar') S.solar += st.out.v;
    if (m.t === 'battery') { S.cap += st.cap.v; S.gen += st.rech.v; }   // a battery's own generationrate feeds the grid like a reactor's
  });
  const byType = {};
  for (const r of rows) (byType[r.mod.t] = byType[r.mod.t] || []).push(r);
  const net = S.gen + S.solar - S.idle, netPeak = S.gen + S.solar - S.high;
  return { rows, byType, price, parts, S, net, netPeak, hullValue: SHIP[fit.ship].value || 0 };
}

/* ---------- build codes, ship configuration line, shopping list ---------- */
function fitToCode(fit) {
  return JSON.stringify({ s: fit.ship, m: fit.slots.map(s => (s.mod ? [s.mod, s.ids || null, s.locked ? 1 : 0] : null)) });
}
function fitFromCode(text) {
  const o = JSON.parse(text);
  if (!SHIP[o.s]) throw new Error('Unknown hull "' + o.s + '"');
  const plan = slotPlan(SHIP[o.s]);
  const slots = plan.map((p, i) => {
    const x = o.m[i];
    if (!x || !MOD[x[0]]) return { mod: null, ids: null, strat: 'auto', locked: false };
    return { mod: x[0], ids: x[1], strat: x[1] ? 'custom' : 'auto', locked: !!x[2] };
  });
  return { ship: o.s, slots };
}
function configLine(fit) {
  // The ship file's "configuration=" line lists module ids; the game places each one in a free slot of its type.
  const order = ['generator', 'battery', 'nav', 'sensor', 'helm', 'rcs', 'maindrive', 'comms', 'weapon', 'jumpdrive', 'pds', 'cm', 'arm', 'hack', 'ladar', 'solar'];
  const ids = fit.slots.filter(s => s.mod).map(s => s.mod);
  ids.sort((a, b) => order.indexOf(MOD[a].t) - order.indexOf(MOD[b].t));
  return ids.join(',');
}
function shoppingList(fit) {
  const lines = [];
  const count = {};
  fit.slots.forEach(s => {
    if (!s.mod) return;
    const m = MOD[s.mod];
    const ids = s.ids || presetIds(m, 'new') || [];
    const f = DATA.if[m.if];
    const per = {};
    padIds(m, ids).forEach((id, i) => { if (id >= 0) { const k = f.s[i][0] + '|' + id; per[k] = (per[k] || 0) + 1; } });
    const key = m.id + '|' + JSON.stringify(per);
    count[key] = count[key] || { m, per, n: 0 };
    count[key].n++;
  });
  for (const k of Object.keys(count)) {
    const { m, per, n } = count[k];
    lines.push((n > 1 ? n + ' x ' : '') + m.name + ' (' + TYPE_LABEL[m.t] + ')');
    for (const pk of Object.keys(per).sort((a, b) => CLASS_ORDER.indexOf(a.split('|')[0]) - CLASS_ORDER.indexOf(b.split('|')[0]))) {
      const [cls, id] = pk.split('|');
      lines.push('    ' + per[pk] + ' x ' + CLASS_LABEL[cls] + ': ' + COMP[id].name + ' (' + COMP[id].mfr + ')');
    }
  }
  return lines.join('\n');
}

/* ---------- presets ---------- */
const GOAL_PRESETS = [
  { id: 'stealth', name: 'Stealth runner', blurb: 'Quiet reactor, solar help, small signature.',
    w: { power: 4, speed: 5, jump: 6, sensing: 6, combat: 1, comms: 4, salvage: 0, stealth: 10, econ: 6, thrift: 2, tough: 0 }, solar: 2 },
  { id: 'combat', name: 'Combat corvette', blurb: 'Launchers, point defence, countermeasures, hard-hitting power.',
    w: { power: 7, speed: 8, jump: 3, sensing: 7, combat: 10, comms: 2, salvage: 0, stealth: 1, econ: 1, thrift: 0, tough: 6 }, solar: 0 },
  { id: 'explorer', name: 'Long-haul explorer', blurb: 'Jump range, sensors, a thrifty power budget.',
    w: { power: 7, speed: 4, jump: 10, sensing: 9, combat: 1, comms: 3, salvage: 2, stealth: 3, econ: 6, thrift: 2, tough: 1 }, solar: 2 },
  { id: 'hauler', name: 'Cheap hauler', blurb: 'Low price, modest power, nothing fancy.',
    w: { power: 4, speed: 3, jump: 2, sensing: 2, combat: 0, comms: 1, salvage: 3, stealth: 1, econ: 5, thrift: 10, tough: 1 }, solar: 0 },
  { id: 'hacker', name: 'Infiltrator', blurb: 'Long-range hacking, quiet, fast comms.',
    w: { power: 4, speed: 5, jump: 3, sensing: 5, combat: 0, comms: 10, salvage: 0, stealth: 8, econ: 5, thrift: 2, tough: 0 }, solar: 1 },
  { id: 'salvage', name: 'Salvager', blurb: 'Fast grapple, good sensors and ladar.',
    w: { power: 4, speed: 5, jump: 2, sensing: 8, combat: 1, comms: 1, salvage: 10, stealth: 2, econ: 4, thrift: 4, tough: 1 }, solar: 1 },
  { id: 'spec', name: 'Best of everything', blurb: 'Pure performance; ignores price, power and noise.',
    w: { power: 10, speed: 10, jump: 10, sensing: 10, combat: 10, comms: 10, salvage: 10, stealth: 0, econ: 0, thrift: 0, tough: 0 }, solar: 0 },
  { id: 'budget', name: 'Bargain bin', blurb: 'The cheapest set that still does its jobs.',
    w: { power: 3, speed: 3, jump: 3, sensing: 3, combat: 3, comms: 3, salvage: 3, stealth: 0, econ: 2, thrift: 10, tough: 0 }, solar: 0 }
];
const GLOBAL_AXES = [['stealth', 'Stealth (low emissions)'], ['econ', 'Power economy'], ['thrift', 'Low price'], ['tough', 'Toughness']];

if (typeof module !== 'undefined') {
  module.exports = { TYPES, PARTS_BY_CLASS, CLASS_LABEL, MOD, MODS_BY_TYPE, COMP, SHIP, SHIPS, evalBuild, candidates, modStats, drawOf, emisOf, rankType, bestBuild, autoFit, emptyFit, summarize,
    GOAL_PRESETS, slotPlan, buildFrom, presetIds, warnings, fitToCode, fitFromCode, configLine, shoppingList, normFor, DATA, PRESET_NAMES };
}
