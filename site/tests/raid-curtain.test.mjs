import test from "node:test";
import assert from "node:assert/strict";

const core = () => import("../raid-curtain.mjs");
const crossing = { previousScene: "hall", nextScene: "raid", previousTime: 39.99,
  nextTime: 40.01, windowStart: 40, reducedMotion: false, cause: "tick" };
const stage = { foot: { x: 20, y: 12 }, landing: { x: 22, y: 12 },
  opening: { x: 24, y: 3, w: 2, h: 8 } };
const members = [
  { id: "dm", table: "a", seat: { x: 3, y: 5 } },
  { id: "player", table: "a", seat: { x: 4, y: 5 } },
  { id: "hidden", table: "b", seat: { x: 6, y: 15 }, approach: [{ x: 6, y: 12 }] },
];

test("curtain trigger plays only small forward ticks across the raid window start", async () => {
  const { shouldPlayRaidCurtain } = await core();
  assert.equal(shouldPlayRaidCurtain(crossing), true);
  for (const change of [
    { cause: "seek" }, { cause: "toggle" }, { previousTime: 39, nextTime: 40 },
    { previousTime: 38, nextTime: 40.01 }, { reducedMotion: true },
    { previousTime: null }, { previousTime: 40.1 }, { previousScene: "raid" },
    { nextScene: "hall" }, { nextTime: 39.999 }, { previousTime: 40.02, nextTime: 39.99 },
  ]) assert.equal(shouldPlayRaidCurtain({ ...crossing, ...change }), false, JSON.stringify(change));
});

test("curtain frames keep the ordered six-second beats and only the supplied member parties", async () => {
  const { curtainFrame } = await core();
  const frames = [0, 500, 2500, 4500, 5500, 6500].map(ms => curtainFrame(ms, members, stage));
  assert.deepEqual(frames[0].people.map(p => [p.id, p.x, p.y]), members.map(p => [p.id, p.seat.x, p.seat.y]));
  assert.equal(frames[0].curtain.open, 0);
  assert.equal(frames[1].curtain.open, .5);
  assert.equal(curtainFrame(1000, members, stage).curtain.open, 1);
  assert.equal(frames[2].beat, "walk");
  assert.ok(frames[2].people.some(p => p.moving));
  assert.deepEqual(curtainFrame(4000, members, stage).people, []);
  assert.equal(frames[3].dark, .5);
  assert.equal(curtainFrame(5000, members, stage).dark, 1);
  assert.equal(frames[4].raidAlpha, .5);
  assert.equal(frames[4].done, false);
  assert.equal(frames[5].raidAlpha, 1);
  assert.equal(frames[5].done, true);
  for (const frame of frames) {
    assert.ok(frame.people.every(p => members.some(m => m.id === p.id)));
    assert.equal(frame.people.some(p => p.id === "nonmember"), false);
    assert.equal(frame.curtain.open >= 0 && frame.curtain.open <= 1, true);
  }
});

test("curtain walks stagger by table, use the stage route and stay pure on reverse queries", async () => {
  const { curtainFrame } = await core();
  const inputs = structuredClone({ members, stage });
  const early = curtainFrame(1600, members, stage);
  assert.ok(early.people.find(p => p.id === "dm").moving);
  assert.equal(early.people.find(p => p.id === "hidden").moving, false);
  const frame = curtainFrame(2600, members, stage);
  curtainFrame(6500, members, stage);
  curtainFrame(0, members, stage);
  assert.deepEqual(curtainFrame(2600, members, stage), frame);
  assert.deepEqual({ members, stage }, inputs);
  const route = [{ id: "route", table: "one", seat: { x: 0, y: 0 }, approach: [{ x: 0, y: 12 }] }];
  const onAisle = curtainFrame(1100, route, stage).people[0];
  assert.equal(onAisle.x, 0);
  assert.ok(onAisle.y > 0 && onAisle.y < 12);
  assert.deepEqual(curtainFrame(4500, [], stage).people, []);
});
