global.DATA = require('../data/data.json');
const C = require('../src/core.js');
const ctx = { patch: 2, sun: 1 };
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
// 1. stock 'new' efficiency vs earlier python numbers (all-slots-filled except buffer)
const exp = { slsp: 120, esolarmk2: 128, mkv: 193, nvt1: 178, ch440: 170, kijd10: 164, pcm9g: 186, sc90: 160, oths: 152, gxdelta: 151 };
for (const [id, e] of Object.entries(exp)) { const m = C.MOD[id]; const ev = C.evalBuild(m, C.presetIds(m, 'new')); ok(ev.eff === e, `${id} new ${ev.eff} != ${e}`); }
// 2. max-efficiency build
const mx = { ch440: 188, nvt1: 198, pcm9g: 208, pcm9: 200, kiorchid: 211 };
for (const [id, e] of Object.entries(mx)) { const m = C.MOD[id]; const ev = C.evalBuild(m, C.buildFrom(m, 'eff', {})); ok(ev.eff === e, `${id} max ${ev.eff} != ${e}`); }
// 3. chain logic: empty a chain-0 slot -> dead; empty one chain -> loses eff
const m = C.MOD.drak; const ids = C.buildFrom(m, 'eff', {}).slice(); const f = DATA.if[m.if];
const i0 = f.s.findIndex(s => s[1] === 0 && !s[2]); const a = ids.slice(); a[i0] = -1; ok(C.evalBuild(m, a).dead, 'chain0 empty must be dead');
const i1 = f.s.findIndex(s => s[1] !== 0); const b = ids.slice(); b[i1] = -1; const eb = C.evalBuild(m, b); ok(eb.eff < C.evalBuild(m, ids).eff && !eb.dead, 'one chain off lowers eff: ' + eb.eff);
console.log('drak chain0 slot', i0, 'chain', f.s[i1], '-> eff', eb.eff, 'lost', eb.lostEff);
// 4. presets: eff accounting incl chain kill
for (const id of ['mkv', 'lp02', 'ch440', 'sc90']) { const mm = C.MOD[id]; console.log(id, C.PRESET_NAMES.map(n => { const p = C.presetIds(mm, n); return n + ':' + (p ? C.evalBuild(mm, p).eff : '-') }).join(' ')); }
// 5. weapons patch
const sp = C.MOD.spl9s; const ev = C.evalBuild(sp, C.buildFrom(sp, 'eff', {}));
console.log('spl9s eff', ev.eff, 'spin base', C.modStats(sp, ev, { patch: 0, sun: 1 }).spin.v.toFixed(2), 'patched', C.modStats(sp, ev, { patch: 2, sun: 1 }).spin.v.toFixed(2));
// 6. warnings
const pc = C.MOD.pcm9; console.log('pcm9 boost warn', C.warnings(pc, C.evalBuild(pc, C.presetIds(pc, 'boost'))).length);
// 6b. battery recharge: only r100/x100/eb30 define generationrate; it scales with efficiency like a reactor's output
for (const [id, rate] of [['x100', 0.2], ['eb30', 0.2], ['r100', 0.1], ['t100', 0]]) { const bm = C.MOD[id]; const be = C.evalBuild(bm, C.presetIds(bm, 'new')); const r = C.modStats(bm, be, ctx).rech.v; ok(Math.abs(r - rate * be.eff / 100) < 1e-9, `${id} recharge ${r} != ${rate * be.eff / 100}`); }
// 7. rank + autofit
const G = Object.fromEntries(C.GOAL_PRESETS.map(p => [p.id, p]));
for (const gid of ['stealth', 'combat', 'spec', 'hauler']) {
  const g = { w: G[gid].w, solar: G[gid].solar, req: { sensorSW: 3, navSW: 0 } };
  const fit = C.autoFit(C.emptyFit('enceladus'), g, ctx);
  const sm = C.summarize(fit, ctx);
  console.log('\n==', gid, 'price', sm.price, 'gen', sm.S.gen.toFixed(1), 'solar', sm.S.solar.toFixed(1), 'cap', sm.S.cap.toFixed(0), 'idle', sm.S.idle.toFixed(2), 'high', sm.S.high.toFixed(1), 'emis', sm.S.emIdle.toFixed(0), sm.S.emHigh.toFixed(0));
  console.log(sm.rows.map(r => r.mod.id + '@' + r.ev.eff).join(' '));
}
console.log(bad ? ('FAILURES ' + bad) : 'core tests pass');
