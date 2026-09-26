import test from "node:test";
import assert from "node:assert/strict";
import { createRoomLayout, foodGeometry } from "../model.mjs";
import { FOOD_CORNER, atFood, foodGraph, foodObstacles, overflowSpot } from "../food-layout.mjs";
import { cornerRoute, foodGraphPath, crossesFoodRect } from "../food-routing.mjs";
import { DISHES, resetDishes, applyMotion, bodyMotion, bindFoodDrawing, drawFoodArea, foodDepthItems } from "../food-corner.mjs";

const layout = createRoomLayout([]);
const key = p => `${p.x},${p.y}`;
const contains = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

test("food corner has 20 unique seats and each plate lies on its own table", () => {
  const seats = Array.from({ length: 20 }, (_, i) => foodGeometry(layout, i, 20).seat);
  assert.equal(new Set(seats.map(key)).size, 20);
  for (const seat of seats) {
    assert.equal(seat.standing, false);
    const tables = FOOD_CORNER.dining.map(r => ({ ...r, ...atFood(layout, r) }));
    const table = tables.find(r => contains(r, seat.plate));
    assert.ok(table, `plate ${key(seat.plate)} lies on a table`);
    assert.equal(Math.sign(seat.plate.x - seat.x), seat.facing);
    assert.ok(Math.abs(seat.plate.x - seat.x) <= 1, "plate stays on the near half");
    assert.ok(!contains(table, seat), "stool is beside the table");
  }
});

test("no corner route segment crosses a table, the hearth or another stool rectangle", t => {
  const nodes = [...foodGraph(layout, 40).values()];
  const obstacles = foodObstacles(layout);
  const checkPath = (from, to, points) => {
    const excluded = new Set(obstacles.filter(r => r.kind === "stool" && (contains(r, from) || contains(r, to))));
    let a = from;
    for (const b of points) {
      for (const r of obstacles) {
        if (!excluded.has(r)) assert.ok(!crossesFoodRect(a, b, r), `${key(a)} → ${key(b)} crosses ${r.kind} ${key(r)}`);
      }
      a = b;
    }
    assert.ok(Math.hypot(a.x - to.x, a.y - to.y) < 1e-7);
  };
  let pairs = 0;
  for (const from of nodes) for (const to of nodes) {
    checkPath(from, to, foodGraphPath(layout, from, to, 40));
    pairs += 1;
  }
  // A retarget halfway down every directed edge keeps the waypoint ahead, even
  // when the nearest node lies behind the person or belongs to another lane.
  const goal = atFood(layout, FOOD_CORNER.exit);
  for (const from of nodes) for (const next of from.edges) {
    const current = { x: from.x + (next.x - from.x) * .2, y: from.y + (next.y - from.y) * .2 };
    const path = cornerRoute(layout, current, goal, (_a, b) => [b], [next], 40);
    assert.deepEqual(path[0], { x: next.x, y: next.y });
    // The previously assigned stool stays this diner's own terminal until they
    // finish the approach and leave; no other stool may be traversed.
    checkPath(current, next, [path[0]]);
    checkPath(next, goal, path.slice(1));
  }
  const entryX = atFood(layout, FOOD_CORNER.enter).x;
  assert.ok(FOOD_CORNER.queue.first.every(p => atFood(layout, p).x - entryX >= .9 - 1e-9));
  assert.equal(cornerRoute(layout, { x: 10, y: layout.aisles[0] }, { x: 20, y: 10 }, (_a, b) => [b]), null,
    "ordinary top-aisle travel retains the hall route");
  t.diagnostic(`${nodes.length} waypoints; ${pairs} ordered waypoint paths; every directed edge retargeted mid-walk`);
});

test("overflow spots are unique for 21–60 diners", () => {
  for (let count = 21; count <= 60; count += 1) {
    const seats = Array.from({ length: count }, (_, i) => foodGeometry(layout, i, count).seat);
    assert.equal(new Set(seats.map(key)).size, count);
    for (const seat of seats.slice(20)) {
      assert.equal(seat.standing, true);
      assert.equal(seat.plate, null);
      assert.ok(seat.y < layout.aisles[0], "overflow never touches the hall aisle");
      assert.ok(foodObstacles(layout).every(r => !contains(r, seat)), "standing place is clear of furniture");
    }
  }
  assert.equal(new Set(Array.from({ length: 500 }, (_, i) => key(overflowSpot(i)))).size, 500, "later passes never reuse a spot");
  assert.ok(Math.abs(overflowSpot(5).x - overflowSpot(0).x - .45) < 1e-9);
});

test("reduced motion applies no waddle or idle transforms", () => {
  const identity = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, look: false };
  const transforms = [];
  const ctx = { translate: (...args) => transforms.push(args), rotate: (...args) => transforms.push(args), scale: (...args) => transforms.push(args) };
  for (const moving of [false, true]) for (const now of [0, 105, 210, 5000, 10000]) {
    const motion = bodyMotion(.37, moving, now, false, true);
    assert.deepEqual(motion, identity);
    applyMotion(ctx, motion, 1, 2);
  }
  assert.deepEqual(transforms, []);
  const calls = [];
  const drawing = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]), set: () => true });
  bindFoodDrawing({ ctx: () => drawing, rpg: () => ({}), reduced: () => true });
  const frame = now => {
    calls.length = 0;
    drawFoodArea(layout, now, .8);
    foodDepthItems(layout, now, 6).forEach(item => item.draw());
    return JSON.stringify(calls);
  };
  assert.equal(frame(0), frame(16000), "steam, lights, bin and dish pops remain static");
});

test("walk-cycle phase is independent of replay speed", () => {
  const frames = [0, 105, 210, 315, 420];
  const atSpeed = speed => frames.map(realTime => {
    const eventSeconds = realTime / 1000 * speed;
    return { position: 2.4 * eventSeconds, motion: bodyMotion(0, true, realTime, false, false) };
  });
  const baseline = atSpeed(1);
  assert.ok(baseline[1].motion.rot > .09 && baseline[3].motion.rot < -.09, "a 210 ms half-period rocks both ways");
  for (const speed of [30, 120, 600, 1800]) {
    const fast = atSpeed(speed);
    assert.notEqual(fast[1].position, baseline[1].position);
    assert.deepEqual(fast.map(f => f.motion), baseline.map(f => f.motion));
  }
});

function dishScales(reduced = false) {
  const scales = [], stack = [];
  let scale = 1;
  const ctx = new Proxy({
    save() { stack.push(scale); }, restore() { scale = stack.pop(); },
    scale(x) { scale *= x; },
    drawImage(_image, sx, sy) {
      if (DISHES.some(([x, y]) => sx === x * 17 && sy === y * 17)) scales.push(scale);
    },
  }, { get: (target, name) => target[name] ?? (() => {}), set: () => true });
  bindFoodDrawing({ ctx: () => ctx, rpg: () => ({}), reduced: () => reduced });
  return (now, count, playing = true) => {
    scales.length = 0;
    foodDepthItems(layout, now, count, playing)[0].draw();
    return [...scales];
  };
}

test('fresh food load and a seek draw all existing dishes at full size', () => {
  const frame = dishScales();
  assert.deepEqual(frame(0, 6), Array(6).fill(1.45));
  frame(20, 0);
  resetDishes();
  assert.deepEqual(frame(30, 6), Array(6).fill(1.45));
});

test('a falling dish count shrinks the last dish over 0.2 seconds', () => {
  const frame = dishScales();
  frame(0, 6);
  assert.deepEqual(frame(100, 5), Array(6).fill(1.45));
  const midway = frame(200, 5);
  assert.equal(midway.length, 6);
  assert.equal(midway[5], .725);
  assert.equal(frame(300, 5).length, 5);
  const still = dishScales(true);
  still(0, 6);
  assert.equal(still(100, 5).length, 5);
});

test('dish pops require a rising count during playback', () => {
  const frame = dishScales();
  frame(0, 0);
  assert.deepEqual(frame(100, 1), []);
  assert.ok(frame(200, 1)[0] > 0);
  resetDishes(); frame(300, 0, false);
  assert.deepEqual(frame(400, 1, false), [1.45]);
});
