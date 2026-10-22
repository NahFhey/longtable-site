import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateTimeline } from "../model.mjs";
import { raidStateAt, raidWorldFit } from "../raid-model.mjs";
import { createRaidRoom } from "../raid-room.mjs";

const raw = JSON.parse(await readFile(new URL("../data/timeline.raid.sample.json", import.meta.url), "utf8"));
const timeline = validateTimeline(raw), second = 1 / (timeline.event.slot_minutes * 60);
const core = () => import("../raid-fx.mjs");
const entry = predicate => timeline.raid.log.find(predicate);
const collapse = entry(e => e.kind === "phase" && e.cause === "collapse");
const death = entry(e => e.kind === "king_hp" && e.hp === 0);
const fixture = entries => {
  const data = structuredClone(raw);
  data.raid.log = [data.raid.log.find(e => e.kind === "open"), ...entries];
  return data;
};
function recording() {
  const calls = [], state = {}, stack = [];
  const ctx = new Proxy({
    save() { stack.push({ ...state }); },
    restore() { Object.assign(state, stack.pop()); },
  }, {
    get(target, key) { return target[key] ?? state[key] ?? ((...args) => calls.push({ op: key, args, ...state })); },
    set(_target, key, value) { state[key] = value; return true; },
  });
  return { ctx, calls };
}
const viewport = { width: 960, height: 750 };
function render(t, { data = timeline, reducedMotion = false, nowMs = 0 } = {}) {
  const record = recording(), people = [];
  const room = createRaidRoom({ ctx: () => record.ctx, reducedMotion, slotMinutes: 30,
    drawPerson(person) { people.push({ ...person }); record.calls.push({ op: "person", args: [person.id] }); } });
  const layout = room.draw(raidStateAt(data, t), data, t, nowMs, viewport);
  room.dispose(); return { ...record, people, layout };
}
const op = (frame, name) => frame.calls.filter(call => call.op === name);
// Sprite fallback pixels precede the people; combat particles belong to the effects pass after them.
const effectRects = frame => frame.calls.slice(frame.calls.findLastIndex(call => call.op === "person") + 1)
  .filter(call => call.op === "fillRect");

test("raid effects report the sample's 90 damage at L1 without duplicating its destruction", async () => {
  const { raidEffects } = await core();
  const hits = raidEffects(timeline, 40.6 + second).filter(e => e.kind === "hit" && e.leg === "L1");
  assert.equal(hits.length, 1); assert.equal(hits[0].amount, 90);
  assert.ok(Math.abs(hits[0].progress - 1 / 2.4) < 1e-8);
  const destroyed = fixture([{ at: 40.1, kind: "leg_destroyed", leg: "R1" }]);
  assert.equal(raidEffects(destroyed, 40.1)[0].amount, 300);
});

test("heals, admin corrections, max changes and revivals are silent but update hit baselines", async () => {
  const { raidEffects } = await core();
  const heal = entry(e => e.kind === "leg_hp" && e.hp === 230);
  assert.deepEqual(raidEffects(timeline, heal.at + second), []);
  const data = fixture([
    { at: 40.1, kind: "leg_hp", leg: "L1", hp: 100, admin: true },
    { at: 40.2, kind: "leg_hp", leg: "L1", hp: 150 },
    { at: 40.3, kind: "leg_max", leg: "L1", hp: 500, max: 500 },
    { at: 40.4, kind: "leg_revived", leg: "L1", hp: 80, admin: true },
    { at: 40.5, kind: "leg_hp", leg: "L1", hp: 60 },
    { at: 40.6, kind: "king_max", hp: 500, max: 500 },
    { at: 40.7, kind: "king_hp", hp: 400, admin: true },
    { at: 40.8, kind: "king_hp", hp: 450 },
    { at: 40.9, kind: "king_max", hp: 300, max: 350 },
    { at: 41, kind: "king_hp", hp: 260 },
  ]);
  for (const e of data.raid.log.slice(1).filter(e => ![40.5, 41].includes(e.at))) assert.deepEqual(raidEffects(data, e.at), []);
  assert.equal(raidEffects(data, 40.5)[0].amount, 20);
  assert.equal(raidEffects(data, 41)[0].amount, 40);
});

test("lair, core and discharge effects retain every logged target and their distinct types", async () => {
  const { raidEffects } = await core();
  for (const predicate of [e => e.action === "stompquake", e => e.kind === "strike" && e.timer === "core", e => e.kind === "discharge"]) {
    const source = entry(predicate), effect = raidEffects(timeline, source.at + second).find(e => e.kind === source.kind);
    assert.deepEqual(effect.targets, source.targets); assert.equal(effect.timer, source.timer);
  }
});

test("collapse is halfway after half an event second; King death is immediate and deduplicated", async () => {
  const { raidEffects } = await core();
  const effect = raidEffects(timeline, collapse.at + second / 2).find(e => e.kind === "collapse");
  assert.ok(Math.abs(effect.progress - .5) < 1e-8); assert.equal(effect.duration, 1);
  assert.equal(raidEffects(timeline, death.at).filter(e => e.kind === "death").length, 1);
  const endOnly = fixture([{ at: 41, kind: "king_max", hp: 100, max: 100 }, { at: 42, kind: "end", result: "won" }]);
  assert.equal(raidEffects(endOnly, 42).filter(e => e.kind === "death").length, 1);
});

test("every effect expires within ten event seconds and never appears before its entry", async () => {
  const { raidEffects } = await core();
  for (const e of timeline.raid.log) {
    assert.ok(raidEffects(timeline, e.at + 10 * second).every(fx => fx.at !== e.at));
    assert.ok(raidEffects(timeline, e.at - second / 10).every(fx => fx.at < e.at));
  }
  assert.deepEqual(raidEffects({}, 40), []);
});

test("dense logs keep only the latest twelve effects and repeated frames do not revisit the log", async () => {
  const { raidEffects, RAID_EFFECT_CAP } = await core();
  const data = fixture(Array.from({ length: 5000 }, (_, i) => ({ at: 41, kind: "strike", timer: "lair", targets: [`t${i}`] })));
  const effects = raidEffects(data, 41 + second);
  assert.equal(RAID_EFFECT_CAP, 12); assert.equal(effects.length, 12);
  assert.deepEqual(effects[0].targets, ["t4988"]); assert.deepEqual(effects.at(-1).targets, ["t4999"]);
  data.raid.log = new Proxy(data.raid.log, { get() { throw Error("per-frame log read"); } });
  for (let i = 0; i < 100; i++) assert.ok(raidEffects(data, 41 + i * second / 100).length <= RAID_EFFECT_CAP);
});

test("effect frames are identical after reverse seeks, reloads and mutations to returned targets", async () => {
  const { raidEffects } = await core(), source = entry(e => e.action === "stompquake"), t = source.at + second;
  const before = JSON.stringify(raw), frame = raidEffects(timeline, t);
  raidEffects(timeline, 48); raidEffects(timeline, 39);
  assert.deepEqual(raidEffects(timeline, t), frame);
  const reloaded = await import("../raid-fx.mjs?fx-reload");
  assert.deepEqual(reloaded.raidEffects(timeline, t), frame);
  frame[0].targets.pop(); assert.deepEqual(raidEffects(timeline, t), reloaded.raidEffects(timeline, t));
  assert.equal(JSON.stringify(raw), before);
});

test("lunges are deterministic, independently phased and sparse across 100 sampled times", async () => {
  const { raidLunge } = await core();
  const party = timeline.people.map(p => p.id), signatures = new Set(); let active = 0;
  for (const id of party) {
    const samples = Array.from({ length: 100 }, (_, i) => raidLunge(id, i * 73));
    assert.deepEqual(samples, Array.from({ length: 100 }, (_, i) => raidLunge(id, i * 73)));
    assert.ok(samples.every(value => value >= 0 && value <= 1)); signatures.add(JSON.stringify(samples));
  }
  assert.ok(signatures.size > party.length * .9);
  for (let i = 0; i < 100; i++) {
    const count = party.filter(id => raidLunge(id, i * 73) > 0).length;
    assert.ok(count <= Math.ceil(party.length / 3), `${count}/${party.length} at ${i * 73}`); active += count;
  }
  assert.ok(active > 0);
});

test("reduced motion always gives zero lunge and zero shake", async () => {
  const { raidLunge, raidEffects, raidShake } = await core();
  for (let i = 0; i < 100; i++) for (const p of timeline.people) assert.equal(raidLunge(p.id, i * 73, true), 0);
  assert.deepEqual(raidShake(raidEffects(timeline, death.at + .1 * second), true), [0, 0]);
  assert.notDeepEqual(raidShake(raidEffects(timeline, death.at + .1 * second), false), [0, 0]);
});

test("room hit pulse and floating damage draw at L1's foot and disappear ten seconds later", () => {
  const hit = render(40.6 + second), late = render(40.6 + 10 * second);
  const foot = hit.layout.stations.legs.L1.foot.map(value => Math.round(value * 32));
  assert.ok(op(hit, "fillRect").some(c => c.args.join() === [foot[0] - 4, foot[1] - 4, 8, 8].join()));
  const number = op(hit, "fillText").find(c => c.args[0] === "-90");
  assert.equal(number.args[1], foot[0]); assert.ok(number.args[2] < foot[1]);
  assert.equal(op(late, "fillText").some(c => c.args[0] === "-90"), false);
});

test("reduced-motion hit and strike highlights stay static throughout their duration", () => {
  const first = render(40.6 + .2 * second, { reducedMotion: true }), later = render(40.6 + second, { reducedMotion: true });
  const damage = frame => op(frame, "fillText").find(c => c.args[0] === "-90");
  assert.ok(damage(first)); assert.deepEqual(damage(first), damage(later));
  const strike = entry(e => e.action === "stompquake");
  const a = render(strike.at + .2 * second, { reducedMotion: true }), b = render(strike.at + second, { reducedMotion: true });
  const flashes = frame => op(frame, "strokeRect").filter(c => c.strokeStyle === "#9cdbcd");
  assert.ok(flashes(a).length > 0); assert.deepEqual(flashes(a), flashes(b));
});

test("room beams distinguish lair, core and discharge, flash parties, and ignore absent targets", () => {
  for (const [predicate, color] of [[e => e.action === "stompquake", "#9cdbcd"],
    [e => e.kind === "strike" && e.timer === "core", "#d9604c"], [e => e.kind === "discharge", "#dfba76"]]) {
    const source = entry(predicate), frame = render(source.at + second);
    const targets = frame.layout.groups.filter(g => source.targets.includes(g.table));
    assert.ok(targets.length > 0);
    assert.ok(op(frame, "strokeRect").filter(c => c.strokeStyle === color).length >= targets.length);
    assert.ok(op(frame, "lineTo").some(c => c.strokeStyle === color));
  }
  const missing = fixture([{ at: 40.3, kind: "strike", timer: "lair", targets: ["not-in-room"] }]);
  const frame = render(40.3 + second, { data: missing });
  assert.equal(op(frame, "strokeRect").filter(c => c.strokeStyle === "#9cdbcd").length, 0);
});

test("collapse interpolates the outline body, emits floor dust and shakes only without reduced motion", () => {
  const before = render(collapse.at - .1 * second), halfway = render(collapse.at + .5 * second), after = render(collapse.at + 2 * second);
  const top = frame => op(frame, "moveTo")[0].args[1];
  assert.ok(top(before) < top(halfway) && top(halfway) < top(after));
  const dust = frame => effectRects(frame).filter(c => c.fillStyle === "#b1b5a8" && c.args[2] === 6);
  assert.equal(dust(halfway).length, 12); assert.equal(dust(after).length, 0);
  const shaking = render(collapse.at + .1 * second), reduced = render(collapse.at + .1 * second, { reducedMotion: true });
  const fit = raidWorldFit(viewport, reduced.layout.world), expected = [fit.scale / 32, 0, 0, fit.scale / 32, fit.x, fit.y];
  assert.deepEqual(op(reduced, "setTransform")[1].args, expected);
  assert.notDeepEqual(op(shaking, "setTransform")[1].args, expected);
});

test("King death flashes, bursts and drops the outline crown; reduced motion holds the crown", () => {
  const early = render(death.at + .1 * second), middle = render(death.at + .8 * second), late = render(death.at + 10 * second);
  const crown = frame => op(frame, "moveTo").filter(c => c.strokeStyle === "#55685b" && c.lineWidth === 6)[1];
  assert.ok(crown(early).args[1] < crown(middle).args[1]); assert.ok(crown(middle).args[1] < crown(late).args[1]);
  assert.equal(effectRects(early).filter(c => c.fillStyle === "#f1eadb" && c.args[2] === 6).length, 12);
  assert.equal(effectRects(late).filter(c => c.fillStyle === "#f1eadb" && c.args[2] === 6).length, 0);
  const a = render(death.at + .1 * second, { reducedMotion: true }), b = render(death.at + second, { reducedMotion: true });
  assert.deepEqual(crown(a), crown(b));
  assert.deepEqual(op(a, "setTransform"), op(b, "setTransform"));
});

test("room lunges approach live feet with slashes, obey party caps and leave layout and reduced motion fixed", () => {
  let moved = 0, hiddenMoved = false;
  const data = structuredClone(timeline); data.people.forEach(p => { p.hidden = true; });
  for (let i = 0; i < 100; i++) {
    const frame = render(40.5, { data, nowMs: i * 73 }), counts = new Map();
    for (const person of frame.people) {
      const original = frame.layout.people.find(p => p.id === person.id);
      if (person.x === original.x && person.y === original.y) continue;
      moved++; hiddenMoved ||= person.hidden; counts.set(person.table, (counts.get(person.table) ?? 0) + 1);
      const foot = frame.layout.stations.legs[person.leg].foot;
      assert.ok(Math.hypot(person.x - foot[0], person.y - foot[1]) < Math.hypot(original.x - foot[0], original.y - foot[1]));
    }
    for (const [table, count] of counts) assert.ok(count <= Math.max(1, Math.floor(frame.people.filter(p => p.table === table).length / 3)));
    if (counts.size) assert.ok(op(frame, "stroke").some(c => c.strokeStyle === "#f1eadb"));
  }
  assert.ok(moved > 0); assert.ok(hiddenMoved);
  for (const [t, reducedMotion] of [[40.5, true], [42.5, false], [43.5, false]]) {
    const frame = render(t, { reducedMotion, nowMs: 350 });
    for (const p of frame.people) {
      const original = frame.layout.people.find(person => person.id === p.id);
      assert.equal(p.x, original.x); assert.equal(p.y, original.y);
    }
  }
});

test("room combat frames are identical after a seek with the same selected time and nowMs", () => {
  const a = render(death.at + .2 * second); render(39); render(43.2);
  assert.deepEqual(render(death.at + .2 * second).calls, a.calls);
  assert.ok(op(a, "fillRect").some(c => c.fillStyle === "#f1eadb" && c.args[2] === 6));
});

test("effects overlay a registered boss using its feet, and collapse and death keep its inputs unchanged", async () => {
  const source = await readFile(new URL("../raid-room.mjs", import.meta.url), "utf8");
  const bossPath = source.match(/from "(\.\/raid-boss\.mjs[^\"]*)"/)[1];
  const module = await import(new URL(bossPath, new URL("../raid-room.mjs", import.meta.url)));
  const { stationsAt } = await import("../raid-3d-pose.mjs");
  const inputs = [];
  module.registerBossRenderer(options => ({ draw(ctx, boss) { inputs.push(structuredClone(boss)); ctx.fillRect(123, 456, 7, 8); },
    stations(boss, rect) { const stations = stationsAt(boss, rect, options); stations.legs.L1.foot = [25, 20]; return stations; } }));
  try {
    const hit = render(40.6 + second), marker = hit.calls.findIndex(c => c.op === "fillRect" && c.args.join() === "123,456,7,8");
    const pulse = hit.calls.findIndex(c => c.op === "fillRect" && c.args.join() === "796,636,8,8");
    assert.ok(marker >= 0 && pulse > marker);
    const dust = render(collapse.at + .1 * second), burst = render(death.at + .1 * second);
    assert.equal(effectRects(dust).filter(c => c.fillStyle === "#b1b5a8" && c.args[2] === 6).length, 12);
    assert.equal(effectRects(burst).filter(c => c.fillStyle === "#f1eadb" && c.args[2] === 6).length, 12);
    assert.equal(inputs[1].phase, 2); assert.equal(inputs[2].king.dead, true);
    assert.equal("collapse" in inputs[1], false); assert.equal("crownFall" in inputs[2], false);
  } finally { module.registerBossRenderer(null); }
});
