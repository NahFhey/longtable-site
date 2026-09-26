import test from "node:test";
import assert from "node:assert/strict";
import { activeEvents, createRoomLayout, playbackSpeed, stageAnnouncer } from "../model.mjs";
import { stageGeometry } from "../stage.mjs";
import { tickViewerClock } from "../clock.mjs";

const layout = createRoomLayout([]);
const spot = { x: layout.stageFront.x + 2, y: layout.stageFront.y };
const announce = { kind: "announce", at: 10, text: "Welcome" };
const timeline = (events = [announce], slot_minutes = 1) => ({ event: { slot_minutes, slots: 60 }, events });
const position = ({ x, y }) => ({ x, y });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Independently measure the hall corridor and stair route in tiles.
const door = { x: layout.door.x + 1.5, y: layout.door.y + .5 };
const { foot, landing } = stageGeometry(layout);
const length = Math.abs(door.x - layout.trunkX) + Math.abs(door.y - foot.y)
  + Math.abs(foot.x - layout.trunkX) + distance(foot, landing) + distance(landing, spot);
const walkSlots = length / (1.2 * 60);

test("announcer walks in at caretaker speed, speaks, and reverses the route out", () => {
  const data = timeline();
  assert.equal(stageAnnouncer(data, 0, layout), null);
  const start = stageAnnouncer(data, announce.at - walkSlots, layout);
  near(start.x, door.x); near(start.y, door.y);
  for (const seconds of [1, 2, 4]) {
    const incoming = stageAnnouncer(data, 10 - seconds / 60, layout);
    const outgoing = stageAnnouncer(data, 18 + seconds / 60, layout);
    assert.equal(incoming.speaking, false);
    assert.equal(outgoing.speaking, false);
    assert.equal(incoming.event, announce);
    assert.equal(outgoing.event, announce);
    near(distance(incoming, spot), seconds * 1.2);
    near(incoming.x, outgoing.x); near(incoming.y, outgoing.y);
  }
  for (const slot of [10, 14, 18 - .001]) {
    assert.deepEqual(stageAnnouncer(data, slot, layout), { ...spot, speaking: true, event: announce });
  }
  assert.equal(stageAnnouncer(data, 18, layout).speaking, false);
  assert.equal(stageAnnouncer(data, 18 + walkSlots + .001, layout), null);
});

test("walk-in crosses the interior of the stage stairs segment", () => {
  const remaining = distance(landing, spot) + distance(foot, landing) / 2;
  const staff = stageAnnouncer(timeline(), 10 - remaining / (1.2 * 60), layout);
  near(staff.x, (foot.x + landing.x) / 2);
  near(staff.y, foot.y);
  assert.equal(staff.speaking, false);
});

test("break speaking clips to five minutes or the eight-minute maximum, in fractional slots", () => {
  for (const slotMinutes of [1, 5, 30]) {
    for (const minutes of [5, 30]) {
      const event = { kind: "break", at: 2, duration: minutes / slotMinutes };
      const data = timeline([event], slotMinutes);
      const end = event.at + Math.min(minutes, 8) / slotMinutes;
      assert.equal(stageAnnouncer(data, end - .0001, layout).speaking, true);
      assert.equal(stageAnnouncer(data, end, layout).speaking, false);
      assert.equal(stageAnnouncer(data, end + walkSlots / slotMinutes + .001, layout), null);
    }
  }
});

test("overlapping windows merge and later speech takes precedence", () => {
  const brk = { kind: "break", at: 10, duration: 5 };
  const next = { ...announce, at: 13 };
  const data = timeline([next, brk]);
  for (let slot = 10; slot < 21; slot += .1) {
    const staff = stageAnnouncer(data, slot, layout);
    assert.deepEqual(position(staff), spot);
    assert.equal(staff.speaking, true);
    assert.equal(staff.event, slot < 13 ? brk : next);
  }
  assert.equal(stageAnnouncer(data, 21.01, layout).event, next);
});

test("gaps within one walk time stay on stage; longer gaps permit separate visits", () => {
  const next = { ...announce, at: 18 + walkSlots / 2 };
  const data = timeline([announce, next]);
  const gap = stageAnnouncer(data, 18 + walkSlots / 4, layout);
  assert.deepEqual(gap, { ...spot, speaking: false, event: next });
  const separate = timeline([announce, { ...next, at: 18 + walkSlots * 3 }]);
  assert.equal(stageAnnouncer(separate, 18 + walkSlots * 1.5, layout), null);
});

test("announcer is pure and finite for arbitrary seeks and ignores meals and spotlights", () => {
  const data = timeline();
  const original = structuredClone(data);
  for (let slot = 24; slot >= 0; slot -= .013) {
    const staff = stageAnnouncer(data, slot, layout);
    assert.deepEqual(staff, stageAnnouncer(data, slot, layout));
    if (staff) assert.ok(Number.isFinite(staff.x) && Number.isFinite(staff.y));
  }
  assert.deepEqual(data, original);
  assert.equal(stageAnnouncer(timeline([{ kind: "spotlight", at: 10 }]), 10, layout), null);
});

test("reduced motion shows staff at the mic only inside speaking windows", () => {
  const data = timeline([announce, { ...announce, at: 18 + walkSlots / 2 }]);
  for (const slot of [0, 9.99, 18 + walkSlots / 4, 30]) assert.equal(stageAnnouncer(data, slot, layout, true), null);
  assert.deepEqual(stageAnnouncer(data, 10, layout, true), { ...spot, speaking: true, event: announce });
});

test("slot-zero speech starts at the mic and never walks at negative time", () => {
  const event = { ...announce, at: 0 };
  const data = timeline([event]);
  assert.equal(stageAnnouncer(data, -.001, layout), null);
  assert.deepEqual(stageAnnouncer(data, 0, layout), { ...spot, speaking: true, event });
  const early = timeline([{ ...announce, at: walkSlots / 2 }]);
  assert.ok(stageAnnouncer(early, 0, layout));
  assert.equal(stageAnnouncer(early, walkSlots / 2, layout).speaking, true);
});

test("playback and the viewer clock cap both walks at 30x while preserving speaking caps", () => {
  const data = timeline();
  for (const slot of [9.99, 18.01]) {
    const staff = stageAnnouncer(data, slot, layout);
    assert.equal(playbackSpeed(1800, activeEvents(data, slot), staff), 30);
    assert.equal(playbackSpeed(10, activeEvents(data, slot), staff), 10);
    const clock = tickViewerClock({ source: "sample", mode: "replay", slot }, data, 0, .01, 1800, staff);
    near(clock.slot, slot + .01 * 30 / 60);
  }
  assert.equal(playbackSpeed(1800, { break: {} }, { speaking: true }), 120);
  assert.equal(playbackSpeed(1800, { announce: {} }, { speaking: true }), 30);
  assert.equal(playbackSpeed(1800, {}), 1800);
});

test("announcer walks around the lounge to the stairs, never through its furniture", () => {
  const data = timeline();
  const { lounge } = layout;
  assert.ok(lounge, "fixture layout has a lounge");
  for (let step = 0; step <= 200; step += 1) {
    const walker = stageAnnouncer(data, announce.at - walkSlots * step / 200, layout);
    const inside = walker.x > lounge.x && walker.x < lounge.x + lounge.w
      && walker.y > lounge.y && walker.y < lounge.y + lounge.h;
    assert.ok(!inside, `announcer at ${walker.x},${walker.y} is inside the lounge`);
  }
});

test("meals are announced like breaks, clipped to the meal", () => {
  const short = { kind: "meal", at: 10, duration: 5, text: "Dinner is ready!" };
  const long = { kind: "meal", at: 10, duration: 30, text: null };
  assert.deepEqual(stageAnnouncer(timeline([short]), 10, layout), { ...spot, speaking: true, event: short });
  assert.equal(stageAnnouncer(timeline([short]), 15, layout).speaking, false);
  assert.equal(stageAnnouncer(timeline([long]), 17.9, layout).speaking, true);
  assert.equal(stageAnnouncer(timeline([long]), 18, layout).speaking, false);
});
