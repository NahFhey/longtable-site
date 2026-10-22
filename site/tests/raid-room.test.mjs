import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateTimeline } from "../model.mjs";
import { raidBossState, raidStateAt, raidRoomLayout } from "../raid-model.mjs";
import { createRaidRoom } from "../raid-room.mjs";

import { stationsAt } from "../raid-3d-pose.mjs";

const raw = JSON.parse(await readFile(new URL("../data/timeline.raid.sample.json", import.meta.url), "utf8"));
const timeline = validateTimeline(raw);
let next = 0;
const bossModule = () => import(`../raid-boss.mjs?isolated=${next++}`);
function context() {
  const calls = [];
  return { calls, ctx: new Proxy({ measureText: text => ({ width: text.length * 5 }) }, {
    get(target, key) { return target[key] ?? ((...args) => calls.push([key, ...args])); },
    set(target, key, value) { target[key] = value; if (key === "globalAlpha") calls.push([key, value]); return true; },
  }) };
}
const rect = { x: 11.5, y: 2, w: 25, h: 14.0625 };
const boss = t => raidBossState(raidStateAt(timeline, t), timeline, t);

test("default boss draws a pixel outline with eight limbs and phase-specific paths", async () => {
  const { createBossRenderer } = await bossModule(), renderer = createBossRenderer({ reducedMotion: true, slotMinutes: 30 });
  const paths = [];
  for (const t of [40, 42, 43]) {
    const { ctx, calls } = context(); renderer.draw(ctx, boss(t), rect, 123);
    assert.ok(calls.filter(call => call[0] === "stroke").length >= 9);
    for (const call of calls.filter(call => ["moveTo", "lineTo"].includes(call[0]))) assert.ok(call.slice(1).every(Number.isInteger));
    paths.push(calls);
  }
  assert.notDeepEqual(paths[0], paths[1]); assert.notDeepEqual(paths[1], paths[2]);
  assert.equal(Object.keys(renderer.anchors()).length, 8);
});

test("throwing custom boss falls back permanently across new instances and disposes", async () => {
  const module = await bossModule(); let drawn = 0, created = 0, disposed = 0;
  module.registerBossRenderer(() => { created++; return { draw() { drawn++; throw new Error("WebGL lost"); }, dispose() { disposed++; } }; });
  const renderer = module.createBossRenderer({}), { ctx, calls } = context();
  renderer.draw(ctx, boss(40), rect, 1); renderer.draw(ctx, boss(40), rect, 2);
  module.createBossRenderer({}).draw(ctx, boss(40), rect, 3);
  assert.equal(drawn, 1); assert.equal(created, 1); assert.equal(disposed, 1);
  assert.ok(calls.some(call => call[0] === "stroke"));
});

test("unavailable or creation-failing custom boss uses the outline for the session", async () => {
  for (const failsAtCreation of [false, true]) {
    const module = await bossModule(); let created = 0, drawn = 0;
    module.registerBossRenderer(() => { created++; if (failsAtCreation) throw new Error("create"); return { available: () => false, draw() { drawn++; } }; });
    const { ctx, calls } = context(); module.createBossRenderer({}).draw(ctx, boss(40), rect, 0);
    module.createBossRenderer({}).draw(ctx, boss(40), rect, 0);
    assert.equal(created, 1); assert.equal(drawn, 0); assert.ok(calls.some(call => call[0] === "stroke"));
  }
});

test("unready custom boss is retried next frame, forwards options and anchors, dispose is once", async () => {
  const module = await bossModule(); let ready = false, drawn = 0, disposed = 0, options;
  const anchors = { L1: [.1, .2], R4: [.9, .8] };
  module.registerBossRenderer(value => { options = value; return { ready: () => ready, draw() { drawn++; }, anchors: () => anchors, dispose() { disposed++; } }; });
  const renderer = module.createBossRenderer({ reducedMotion: true, slotMinutes: 15 }), { ctx, calls } = context();
  renderer.draw(ctx, boss(40), rect, 10); assert.equal(drawn, 1, "warm-up draw"); assert.ok(calls.some(call => call[0] === "stroke"));
  ready = true; calls.length = 0; renderer.draw(ctx, boss(40), rect, 20);
  assert.equal(drawn, 2); assert.equal(calls.some(call => call[0] === "stroke"), false);
  assert.deepEqual(options, { reducedMotion: true, slotMinutes: 15 }); assert.deepEqual(renderer.anchors(), anchors);
  renderer.dispose(); renderer.dispose(); assert.equal(disposed, 1);
});

test("a renderer that becomes ready only after drawing replaces the outline on the next frame", async () => {
  const module = await bossModule(); let frames = 0, painted = 0;
  module.registerBossRenderer(() => ({ ready: () => frames > 0, draw() { if (frames > 0) painted++; frames++; } }));
  try {
    const renderer = module.createBossRenderer({ reducedMotion: true, slotMinutes: 15 }), { ctx, calls } = context();
    assert.equal(renderer.draw(ctx, boss(40), rect, 10), false); assert.ok(calls.some(call => call[0] === "stroke"));
    calls.length = 0; assert.equal(renderer.draw(ctx, boss(40), rect, 20), true);
    assert.equal(painted, 1); assert.equal(calls.some(call => call[0] === "stroke"), false);
    // The custom renderer receives tile units, so the seam scales the 32-px-per-tile context.
    assert.deepEqual(calls.find(call => call[0] === "scale")?.slice(1), [32, 32]);
  } finally { module.registerBossRenderer(null); }
});

test("boss input retains selected fractional time, destruction time, revival and King death", () => {
  assert.equal(boss(40.61).t, 40.61); assert.equal(boss(40.61).legs[0].destroyedAt, 40.6);
  const input = structuredClone(raw);
  input.raid.log.push({ at: 41.2, kind: "leg_revived", admin: true, leg: "L1", hp: 100 }); input.raid.log.sort((a, b) => a.at - b.at);
  const revived = validateTimeline(input), state = raidStateAt(revived, 41.21);
  assert.equal(raidBossState(state, revived, 41.21).legs[0].destroyedAt, null);
  assert.equal(boss(48).king.dead, true); assert.equal(boss(43).king.dead, false);
});

test("raid drawing uses its own fit frame, shipped tiles, party sprites and table plates", () => {
  const { ctx, calls } = context(), people = [], image = {};
  const room = createRaidRoom({ ctx: () => ctx, indoor: () => image, sheet: () => null, slotMinutes: 30, drawPerson(person) { people.push(person); } });
  const layout = room.draw(raidStateAt(timeline, 40), timeline, 40, 0, { width: 1920, height: 1080 });
  assert.equal(people.length, layout.people.length); assert.ok(people.length > 0);
  assert.ok(calls.some(call => call[0] === "drawImage" && call[1] === image));
  assert.ok(calls.some(call => call[0] === "fillText" && call[1] === timeline.tables.find(table => table.id === "t1").name));
  assert.ok(calls.some(call => call[0] === "setTransform" && call[1] > 0));
  room.dispose();
});

test("raid modules render untrusted text without HTML injection or dependencies", async () => {
  for (const file of ["raid-model.mjs", "raid-room.mjs", "raid-boss.mjs"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write|import\s*\(|https?:|three\.js/);
  }
});


async function roomBossModule() {
  const source = await readFile(new URL("../raid-room.mjs", import.meta.url), "utf8");
  return import(new URL(source.match(/from "(\.\/raid-boss\.mjs[^\"]*)"/)[1], new URL("../raid-room.mjs", import.meta.url)));
}

test("rear rings and people draw before the boss and front rings and people after it, broken rings dim", async () => {
  const module = await roomBossModule(), { ctx, calls } = context();
  module.registerBossRenderer(() => ({ draw() { calls.push(["boss"]); } }));
  try {
    const room = createRaidRoom({ ctx: () => ctx, slotMinutes: 30, theta: 0, drawPerson(person) { calls.push(["person", person.id]); } });
    const layout = room.draw(raidStateAt(timeline, 40.61), timeline, 40.61, 1, { width: 800, height: 625 });
    const bossIndex = calls.findIndex(call => call[0] === "boss");
    assert.ok(bossIndex >= 0); assert.ok(layout.arenas.some(arena => arena.behind)); assert.ok(layout.arenas.some(arena => !arena.behind));
    for (const arena of layout.arenas) {
      const index = calls.findIndex(call => call[0] === "ellipse" && call[1] === arena.arena[0] * 32 && call[2] === arena.arena[1] * 32);
      assert.ok(index >= 0); assert.equal(index < bossIndex, arena.behind, arena.id);
      if (arena.destroyed) assert.ok(calls.slice(0, index).some(call => call[0] === "globalAlpha" && call[1] === .25));
      assert.ok(calls.some(call => call[0] === "fillText" && call[1].startsWith(arena.id) && call[2] === arena.foot[0] * 32 && call[3] === arena.foot[1] * 32));
    }
    for (const person of layout.people) assert.equal(calls.findIndex(call => call[0] === "person" && call[1] === person.id) < bossIndex, person.behind, person.id);
    for (const behind of [true, false]) {
      const depths = calls.filter(call => call[0] === "person").map(call => layout.people.find(person => person.id === call[1])).filter(person => person.behind === behind).map(person => person.depth);
      assert.deepEqual(depths, [...depths].sort((a, b) => b - a));
    }
    room.dispose();
  } finally { module.registerBossRenderer(null); }
});

test("the floor paints once into a cached canvas and repaints only for a new sheet", () => {
  const { ctx, calls } = context(), made = [], first = {}, second = {};
  let image = first;
  const createCanvas = (width, height) => { const floor = context(); made.push({ width, height, ...floor }); return { width, height, getContext: () => floor.ctx }; };
  const room = createRaidRoom({ ctx: () => ctx, indoor: () => image, slotMinutes: 30, theta: 0, createCanvas, drawPerson() {} });
  for (const t of [40.5, 40.6]) room.draw(raidStateAt(timeline, t), timeline, t, 1, { width: 390, height: 304 });
  assert.equal(made.length, 1);
  const { w, h } = raidRoomLayout(raidStateAt(timeline, 40.5), timeline, 40.5, { slotMinutes: 30 }).world;
  assert.deepEqual([made[0].width, made[0].height], [w * 16, h * 16]);
  assert.equal(made[0].calls.filter(call => call[0] === "drawImage" && call[1] === first).length, w * h);
  assert.equal(calls.filter(call => call[0] === "drawImage" && call[1] === first).length, 0);
  assert.equal(calls.filter(call => call[0] === "drawImage" && call[2] === 0 && call[3] === 0 && call[4] === w * 32).length, 2);
  image = second; room.draw(raidStateAt(timeline, 40.7), timeline, 40.7, 1, { width: 390, height: 304 });
  assert.equal(made.length, 2); assert.ok(made[1].calls.some(call => call[0] === "drawImage" && call[1] === second));
  room.dispose();
});

test("leg labels draw only in Phase 1", () => {
  const legIds = new Set(timeline.raid.legs.map(leg => leg.id));
  for (const [t, expected] of [[40.5, true], [42.5, false], [43.5, false]]) {
    const { ctx, calls } = context();
    const room = createRaidRoom({ ctx: () => ctx, slotMinutes: 30, theta: 0, drawPerson() {} });
    room.draw(raidStateAt(timeline, t), timeline, t, 1, { width: 800, height: 625 });
    const labels = calls.filter(call => call[0] === "fillText" && legIds.has(call[1].replace(" ★", "")));
    assert.equal(labels.length > 0, expected, `t=${t}`);
    room.dispose();
  }
});

test("registered renderer stations enter the pure layout only once ready", async () => {
  const module = await roomBossModule(), { ctx } = context(); let count = 0, options, ready = false;
  module.registerBossRenderer(value => { options = value; return {
    ready: () => ready, draw() {}, stations(input, rect) { count++; return stationsAt(input, rect, value); },
  }; });
  try {
    const room = createRaidRoom({ ctx: () => ctx, theta: 75, slotMinutes: 30, drawPerson() {} });
    const state = raidStateAt(timeline, 40.5);
    const actual = room.draw(state, timeline, 40.5, 100, { width: 800, height: 625 });
    assert.equal(count, 0); assert.equal(options.theta, 75);
    assert.deepEqual(actual, raidRoomLayout(state, timeline, 40.5, { theta: 75 }));
    ready = true;
    const custom = room.draw(state, timeline, 40.5, 200, { width: 800, height: 625 });
    assert.equal(count, 1);
    assert.deepEqual(custom.stations, stationsAt(boss(40.5), custom.boss, options));
    room.dispose();
  } finally { module.registerBossRenderer(null); }
});

test("outline stations hold the front view at two spin times unless theta is explicit", () => {
  const { ctx } = context();
  for (const theta of [undefined, 75]) {
    const room = createRaidRoom({ ctx: () => ctx, slotMinutes: 30, theta, drawPerson() {} });
    for (const t of [40.5, 40.517]) {
      const layout = room.draw(raidStateAt(timeline, t), timeline, t, 0, { width: 900, height: 700 });
      assert.deepEqual(layout.stations, stationsAt(boss(t), layout.boss, { theta: theta ?? 0 }));
    }
    room.dispose();
  }
});

test("unready outline uses front stations and switches to a ready renderer's own stations", async () => {
  const module = await roomBossModule(), { ctx } = context(); let ready = false, expected, count = 0;
  module.registerBossRenderer(options => ({ ready: () => ready, draw() {}, stations(input, rect) {
    count++; expected = stationsAt(input, rect, options); return expected;
  } }));
  try {
    const room = createRaidRoom({ ctx: () => ctx, slotMinutes: 30, drawPerson() {} });
    for (const t of [40.5, 40.517]) {
      const layout = room.draw(raidStateAt(timeline, t), timeline, t, 0, { width: 900, height: 700 });
      assert.deepEqual(layout.stations, stationsAt(boss(t), layout.boss, { theta: 0 }));
    }
    assert.equal(count, 0);
    ready = true;
    const layouts = [40.5, 40.517].map(t => {
      const layout = room.draw(raidStateAt(timeline, t), timeline, t, 0, { width: 900, height: 700 });
      assert.deepEqual(layout.stations, expected); return layout;
    });
    assert.equal(count, 2); assert.notDeepEqual(layouts[0].stations, layouts[1].stations);
    room.dispose();
  } finally { module.registerBossRenderer(null); }
});

test("unavailable renderer rejects its stations before the room chooses the outline", async () => {
  // A failed renderer is session-wide. Give this failure case its own module
  // instance so the following draw-failure case can still exercise a renderer.
  const bossURL = new URL(`../raid-boss.mjs?unavailable-room=${next++}`, import.meta.url);
  const module = await import(bossURL);
  const roomURL = new URL("../raid-room.mjs", import.meta.url);
  const source = (await readFile(roomURL, "utf8")).replace(/from "(\.\/[^\"]+)"/g,
    (_match, path) => `from ${JSON.stringify(path.startsWith("./raid-boss.mjs") ? bossURL.href : new URL(path, roomURL).href)}`);
  const isolated = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  let queried = 0, drawn = 0;
  module.registerBossRenderer(() => ({ available: () => false, draw() { drawn++; }, stations() { queried++; return {}; } }));
  const { ctx } = context(), room = isolated.createRaidRoom({ ctx: () => ctx, slotMinutes: 30, drawPerson() {} });
  for (const t of [40.5, 40.517]) {
    const layout = room.draw(raidStateAt(timeline, t), timeline, t, 0, { width: 900, height: 700 });
    assert.deepEqual(layout.stations, stationsAt(boss(t), layout.boss, { theta: 0 }));
  }
  assert.equal(queried, 0); assert.equal(drawn, 0); room.dispose();
});

test("a failed custom draw clears its rotating parties and redraws with front stations", async () => {
  const module = await roomBossModule(), { ctx, calls } = context(); let attempts = 0;
  module.registerBossRenderer(options => ({ draw() { attempts++; throw Error("lost"); }, stations(input, rect) { return stationsAt(input, rect, options); } }));
  try {
    const room = createRaidRoom({ ctx: () => ctx, slotMinutes: 30, drawPerson() {} });
    const t = 40.517, layout = room.draw(raidStateAt(timeline, t), timeline, t, 0, { width: 900, height: 700 });
    assert.deepEqual(layout.stations, stationsAt(boss(t), layout.boss, { theta: 0 }));
    assert.equal(attempts, 1);
    assert.equal(calls.filter(call => call[0] === "fillRect" && call[1] === 0 && call[2] === 0 && call[3] === 900 && call[4] === 700).length, 2);
    room.dispose();
  } finally { module.registerBossRenderer(null); }
});

function subBossRoom(reducedMotion = false, createCanvasOverride, roomFactory = createRaidRoom) {
  const { ctx, calls } = context(), made = [], image = {};
  const createCanvas = (width, height) => {
    const recorded = context(), canvas = { width, height, getContext: () => recorded.ctx };
    made.push({ canvas, ...recorded }); return canvas;
  };
  const room = roomFactory({ ctx: () => ctx, indoor: () => image, slotMinutes: 30, reducedMotion,
    createCanvas: createCanvasOverride ?? createCanvas, drawPerson(person) { calls.push(["person", person.id]); } });
  return { room, calls, made, ctx };
}
const subBossBlits = calls => calls.filter(call => call[0] === "drawImage" && call[1]?.width === 96 && call[1]?.height === 96);

test("sub-boss frames rasterise once, then only cached blits repeat across animation, defeat and undo", () => {
  const { room, calls, made } = subBossRoom(), viewport = { width: 390, height: 304 };
  const draw = (slot, now) => room.draw(raidStateAt(timeline, slot), timeline, slot, now, viewport);
  draw(42.5, 0);
  assert.equal(made.length, 13, "one floor and three frames for each of four designs");
  const pixels = made.map(item => item.calls.length);
  for (let now = 140; now <= 4200; now += 140) draw(42.5, now);
  draw(43.5, 5000); draw(42.5, 6000);
  assert.equal(made.length, 13);
  assert.deepEqual(made.map(item => item.calls.length), pixels, "cached contexts never repaint");
  assert.equal(subBossBlits(calls).length, 33 * 4);
  for (const item of made.slice(1)) {
    assert.equal(item.ctx.imageSmoothingEnabled, false);
    const fills = item.calls.filter(call => call[0] === "fillRect");
    assert.ok(fills.length > 0);
    for (const fill of fills) assert.ok(fill.slice(1).every(Number.isInteger));
  }
  for (const call of subBossBlits(calls)) assert.ok(call.slice(2).every(Number.isInteger));
  room.dispose();
});

test("alive sub-bosses change blitted idle frames on nowMs with distinct phases, reduced motion holds frame zero", () => {
  for (const reducedMotion of [false, true]) {
    const { room, calls, made } = subBossRoom(reducedMotion), state = raidStateAt(timeline, 42.5);
    const draw = now => {
      calls.length = 0; room.draw(state, timeline, 42.5, now, { width: 900, height: 700 });
      return subBossBlits(calls).map(call => call[1]);
    };
    const first = draw(0), second = draw(420);
    assert.equal(first.length, 4);
    first.forEach((image, i) => {
      if (reducedMotion) assert.equal(image, second[i]);
      else assert.notEqual(image, second[i]);
      if (reducedMotion) assert.equal(image, made[1 + i * 3].canvas, "frame zero");
    });
    if (!reducedMotion) {
      const patterns = Array.from({ length: 4 }, () => []);
      for (let now = 0; now < 840; now += 20) draw(now).forEach((image, i) => patterns[i].push(made.findIndex(item => item.canvas === image) % 3));
      assert.equal(new Set(patterns.map(pattern => pattern.join(""))).size, 4, "each boss has its own idle phase");
    }
    room.dispose();
  }
});

test("defeated sub-bosses hold a dim collapsed pose and a screen-space clearing-table plate, undo restores idle", () => {
  const input = structuredClone(raw);
  input.raid.log.push({ at: 43.6, kind: "check", admin: true, item: "prototype_prime", table: null, undo: true });
  input.raid.log.sort((a, b) => a.at - b.at);
  const edited = validateTimeline(input), { room, calls, made } = subBossRoom();
  const viewport = { width: 640, height: 500 };
  const draw = (slot, now) => {
    calls.length = 0;
    const layout = room.draw(raidStateAt(edited, slot), edited, slot, now, viewport);
    return { layout, image: subBossBlits(calls)[0]?.[1] };
  };
  const first = draw(43.5, 0), second = draw(43.5, 420);
  assert.equal(first.image, second.image);
  assert.equal(first.image, made[3].canvas, "collapsed frame");
  const boss = second.layout.subBosses[0];
  assert.equal(boss.defeated, true); assert.equal(boss.table, "t2");
  assert.ok(calls.some(call => call[0] === "globalAlpha" && call[1] === .35));
  const plate = calls.find(call => call[0] === "fillText" && call[1] === boss.tableName && call[2] === boss.label.x * 10 && call[3] === boss.label.y * 10);
  assert.ok(plate, "table credit is under the defeated sprite, separate from the party's plate");
  const restored = draw(43.6, 0), restoredSecond = draw(43.6, 420);
  assert.equal(restored.layout.subBosses[0].defeated, false);
  assert.notEqual(restored.image, restoredSecond.image);
  assert.equal(calls.some(call => call[0] === "fillText" && call[2] === boss.label.x * 10 && call[3] === boss.label.y * 10), false);
  room.dispose();
});

test("sub-bosses draw after the main boss and before front people, with combat effects above them", async () => {
  const input = structuredClone(raw);
  input.raid.log.push({ at: 42.5, kind: "strike", admin: false, timer: "lair", action: "stompquake", targets: ["t1"] });
  input.raid.log.sort((a, b) => a.at - b.at);
  const edited = validateTimeline(input);
  // Earlier tests deliberately disable their boss module for the session. Isolate this renderer.
  const bossURL = new URL(`../raid-boss.mjs?layered-subboss=${next++}`, import.meta.url), module = await import(bossURL);
  const roomURL = new URL("../raid-room.mjs", import.meta.url);
  const source = (await readFile(roomURL, "utf8")).replace(/from "(\.\/[^\"]+)"/g,
    (_match, path) => `from ${JSON.stringify(path.startsWith("./raid-boss.mjs") ? bossURL.href : new URL(path, roomURL).href)}`);
  const isolated = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  let calls;
  module.registerBossRenderer(() => ({ draw() { calls.push(["boss"]); } }));
  const recorded = subBossRoom(false, undefined, isolated.createRaidRoom), layered = recorded.room;
  calls = recorded.calls;
  try {
    const slot = 42.5 + 1 / 1800;
    layered.draw(raidStateAt(edited, slot), edited, slot, 0, { width: 900, height: 700 });
    const bossIndex = calls.findIndex(call => call[0] === "boss"), people = calls.map((call, index) => [call, index]).filter(([call]) => call[0] === "person").map(([, index]) => index);
    assert.ok(bossIndex >= 0); assert.ok(people.length > 0);
    assert.equal(subBossBlits(calls).length, 4);
    for (const blit of subBossBlits(calls)) {
      const index = calls.indexOf(blit);
      assert.ok(index > bossIndex && index < Math.min(...people));
    }
    assert.ok(calls.some((call, index) => call[0] === "stroke" && index > Math.max(...people)), "strike draws over the party and sprites");
  } finally { layered.dispose(); module.registerBossRenderer(null); }
});

test("missing offscreen contexts draw the sprite grids directly without retrying canvas allocation", () => {
  let count = 0;
  const { room, calls } = subBossRoom(false, () => { count++; return { getContext: () => null }; });
  for (const now of [0, 420, 840]) room.draw(raidStateAt(timeline, 42.5), timeline, 42.5, now, { width: 900, height: 700 });
  // The existing floor retries its unavailable cache; each of the 12 sprite frames tries only once.
  assert.equal(count, 15);
  assert.equal(subBossBlits(calls).length, 0);
  assert.ok(calls.some(call => call[0] === "fillRect" && call[3] === 6 && call[4] === 6));
  room.dispose();
});
