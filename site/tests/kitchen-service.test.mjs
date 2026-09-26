import test from 'node:test';
import { checkContinuity } from './kitchen-helpers.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoomLayout, caretakerTour, kitchenServices, kitchenCleanup, hallAmbience, resolveLocation, foodVisit, isPresent } from '../model.mjs';
import { FOOD_CORNER, SET_OUT_SECONDS, atFood, foodClearAt, foodSetOut, kitchenPath, foodObstacles } from '../food-layout.mjs';
import { crossesFoodRect } from '../food-routing.mjs';

const load = name => JSON.parse(readFileSync(new URL(`../data/timeline.${name}.json`, import.meta.url)));
const sample = load('sample');
const layout = createRoomLayout(sample.tables, sample.room_layout);
const rooms = new WeakMap();
const roomFor = data => { if (!rooms.has(data)) rooms.set(data, createRoomLayout(data.tables ?? [], data.room_layout)); return rooms.get(data); };
const state = (data, seconds, reduced = false, room = roomFor(data)) => hallAmbience(data, seconds / (data.event.slot_minutes * 60), room, reduced);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const point = p => ({ x: p.x, y: p.y });
const synthetic = () => ({ event: { slots: 40, slot_minutes: 1 }, tables: [],
  people: [{ id: 'guest', presence: { planned: [0, 40], actual: { here: null, leaving: null } }, movements: [] }],
  events: [{ id: 'meal', kind: 'meal', at: 1, duration: 10 }], visitors: { people: [] } });

for (const name of ['sample', 'demo-50']) test(`whole-event caretaker continuity: ${name}`, t => {
  const data = load(name);
  checkContinuity(data, createRoomLayout(data.tables, data.room_layout), t);
});

test('Dinner service starts on demand, serves six dishes and clears after the last diner and quiet window', t => {
  const dinner = sample.events.find(e => e.id === 'e03');
  assert.equal(dinner.at, 16);
  const [service] = kitchenServices(sample, layout);
  assert.equal(service.start, 28800);
  near(service.readyTime, service.start + service.walkIn + SET_OUT_SECONDS);
  assert.equal(state(sample, service.setOutStart - .001).foodCount, 0);
  assert.equal(state(sample, service.readyTime).foodCount, 6);
  assert.equal(state(sample, service.cleanupStart - .001).foodCount, 6);
  // u_tess arrives at 16.3, mid-Dinner, and is the last diner to leave.
  near(service.lastDinerEnd, 16.3 * 1800 + 400);
  near(service.cleanupRequested, service.lastDinerEnd + 300);
  assert.ok(service.cleanupStart >= service.cleanupRequested);
  near(service.cleanupEnd, service.cleanupStart + SET_OUT_SECONDS);
  assert.equal(state(sample, service.cleanupEnd).foodCount, 0);
  assert.equal(kitchenServices(sample, layout), kitchenServices(sample, layout));
  t.diagnostic(JSON.stringify(service));
});

test('cleanup removes slot 5 first, carries each dish back and removes one dish at a time', () => {
  let previous = 6, removals = [];
  for (let seconds = 0; seconds <= SET_OUT_SECONDS; seconds += .01) {
    const clear = foodClearAt(layout, seconds);
    assert.ok(clear.count === previous || clear.count === previous - 1);
    if (clear.count < previous) { removals.push(clear.dish); assert.equal(clear.dish, clear.count); }
    previous = clear.count;
  }
  assert.deepEqual(removals, [5, 4, 3, 2, 1, 0]);
  assert.equal(foodClearAt(layout, SET_OUT_SECONDS).count, 0);
  near(SET_OUT_SECONDS, 31.094117647058823);
});

test('a diner 200 seconds into quiet time is served immediately and restarts quiet time', () => {
  const data = synthetic();
  const original = kitchenServices(data)[0];
  const later = original.lastDinerEnd + 200;
  const changed = structuredClone(data);
  changed.events.push({ id: 'late', kind: 'meal', at: later / 60, duration: 10 });
  const [service] = kitchenServices(changed);
  assert.equal(kitchenServices(changed).length, 1);
  near(service.lastDinerEnd, later + 400);
  near(service.cleanupRequested, later + 700);
  assert.equal(resolveLocation(changed, changed.people[0], (later + 1) / 60).foodPhase, 'serving-first');
});

test('a service without diners waits 300 seconds from readiness before returning to pickup to clear', () => {
  const clear = kitchenCleanup(layout, 60, 100);
  assert.equal(clear.requested, 400);
  assert.ok(clear.end >= 400 && clear.end < 410);
  assert.deepEqual(point(clear.segments.at(-1).to), atFood(layout, FOOD_CORNER.pickup));
});

test('a visit during cleanup waits for a new service with no walk-in or hall round between services', () => {
  const data = synthetic(), first = kitchenServices(data)[0];
  const changed = structuredClone(data), demand = first.cleanupStart + 1;
  changed.events.push({ id: 'late', kind: 'meal', at: demand / 60, duration: 10 });
  const services = kitchenServices(changed);
  assert.equal(services.length, 2);
  near(services[1].start, services[0].cleanupEnd);
  assert.equal(services[1].walkIn, 0);
  assert.equal(resolveLocation(changed, changed.people[0], (demand + 1) / 60).foodPhase, 'waiting');
  assert.equal(resolveLocation(changed, changed.people[0], (services[1].readyTime + 1) / 60).foodPhase, 'serving-first');
  assert.deepEqual(point(state(changed, services[1].start).staff), atFood(layout, FOOD_CORNER.pickup));
});

test('a mid-meal arrival with nobody at the meal start starts a service and waits for it', () => {
  const data = synthetic(); data.people[0].presence.planned = [3, 40];
  const [service] = kitchenServices(data);
  assert.equal(service.start, 180);
  assert.equal(service.reason, 'meal');
  assert.equal(resolveLocation(data, data.people[0], 181 / 60).foodPhase, 'waiting');
  assert.equal(resolveLocation(data, data.people[0], (service.readyTime + 1) / 60).foodPhase, 'serving-first');
  assert.equal(state(data, service.readyTime + 100).foodCount, 6);
});

test('a mid-meal arrival while food is out queues from arrival and extends quiet time', () => {
  const data = synthetic(), first = kitchenServices(data)[0], arrival = first.readyTime + 60;
  const changed = structuredClone(data);
  changed.people.push({ id: 'late', presence: { planned: [arrival / 60, 40], actual: { here: null, leaving: null } }, movements: [] });
  const services = kitchenServices(changed), late = changed.people[1];
  assert.equal(services.length, 1);
  near(services[0].lastDinerEnd, arrival + 400);
  assert.equal(resolveLocation(changed, late, (arrival + 1) / 60).foodPhase, 'serving-first');
  assert.equal(resolveLocation(changed, late, (arrival + 100) / 60).foodPhase, 'eating');
});

// A spotlight lasts SPOTLIGHT_MINUTES (14 slots here), so the meal runs slots 5-25 to outlast the stage at 0-14.
const spotlit = () => { const data = synthetic(); Object.assign(data.events[0], { at: 5, duration: 20 });
  data.events.push({ id: 'stage', kind: 'spotlight', at: 0, person: 'guest' }); return data; };

test('a diner on stage at the meal start with nobody else present starts a service when the spotlight ends', () => {
  const data = spotlit(), [service] = kitchenServices(data);
  assert.equal(service.start, 840);
  assert.equal(service.reason, 'meal');
  assert.equal(resolveLocation(data, data.people[0], 841 / 60).foodPhase, 'waiting');
  assert.equal(resolveLocation(data, data.people[0], (service.readyTime + 1) / 60).foodPhase, 'serving-first');
});

test('a diner on stage at the meal start while food is out queues when the spotlight ends and extends quiet time', () => {
  const data = spotlit();
  data.people.push({ id: 'other', presence: { planned: [0, 40], actual: { here: null, leaving: null } }, movements: [] });
  const services = kitchenServices(data), [guest, other] = data.people;
  assert.equal(services.length, 1);
  assert.ok(services[0].readyTime < 840);
  assert.equal(resolveLocation(data, other, (services[0].readyTime + 1) / 60).foodPhase, 'serving-first');
  assert.equal(resolveLocation(data, guest, 841 / 60).foodPhase, 'serving-first');
  near(services[0].lastDinerEnd, 840 + 400);
});

test('a break over the meal start with one diner starts a service when the break ends', () => {
  const data = synthetic(); data.events.push({ id: 'break', kind: 'break', at: 0, duration: 3 });
  const [service] = kitchenServices(data);
  assert.equal(service.start, 180);
  assert.equal(service.reason, 'meal');
  assert.equal(resolveLocation(data, data.people[0], 181 / 60).foodPhase, 'waiting');
  assert.equal(resolveLocation(data, data.people[0], (service.readyTime + 1) / 60).foodPhase, 'serving-first');
});

test('a spotlight over the meal start that ends inside a break starts the visit when the break ends', () => {
  const data = spotlit(); data.events.push({ id: 'break', kind: 'break', at: 12, duration: 6 });
  const [service] = kitchenServices(data);
  assert.equal(service.start, 1080);
  assert.equal(resolveLocation(data, data.people[0], 1081 / 60).foodPhase, 'waiting');
  assert.equal(resolveLocation(data, data.people[0], (service.readyTime + 1) / 60).foodPhase, 'serving-first');
});

test('a demo visitor outside a meal starts a visit service', () => {
  const data = load('demo-50'), first = kitchenServices(data)[0];
  assert.equal(first.reason, 'visit');
  assert.ok(!data.events.some(e => e.kind === 'meal' && e.at * 1800 === first.start));
});

test('an emptied hall clears early, walks through the switch, fades, and exits through the door', t => {
  const data = synthetic(); data.people[0].presence.planned[1] = 3;
  const room = createRoomLayout([]), [service] = kitchenServices(data, room);
  assert.equal(service.cleanupRequested, 180);
  assert.equal(service.emptied, true);
  const end = state(data, service.backEnd, false, room);
  assert.deepEqual(point(end.staff), end.lightSwitch);
  assert.equal(end.lights, 1);
  near(state(data, service.backEnd + 2, false, room).lights, .5);
  assert.equal(state(data, service.backEnd + 6.001, false, room).staff, null);
  checkContinuity(data, room, t);
});

test('an arrival during empty-hall cleanup finishes cleanup and begins pending service at pickup', t => {
  const data = synthetic(); data.people[0].presence.planned[1] = 3;
  const first = kitchenServices(data)[0], arrival = first.cleanupStart + 2;
  const changed = structuredClone(data);
  changed.people.push({ id: 'new', presence: { planned: [arrival / 60, 20], actual: { here: null, leaving: null } } });
  changed.events.push({ id: 'return', kind: 'meal', at: arrival / 60, duration: 5 });
  const services = kitchenServices(changed);
  assert.equal(services[1].start, services[0].cleanupEnd);
  assert.equal(services[1].walkIn, 0);
  checkContinuity(changed, createRoomLayout([]), t);
});

test('every Dinner diner waits, then serves and eats relative to readiness, with exact half-open boundaries', () => {
  const [service] = kitchenServices(sample, layout);
  for (const person of sample.people.filter(p => isPresent(p, 16, sample.event.slots))) {
    for (const [seconds, phase] of [[service.start + 1, 'waiting'], [service.readyTime + 1, 'serving-first'], [service.readyTime + 100, 'eating']]) {
      assert.equal(resolveLocation(sample, person, seconds / 1800).foodPhase, phase, person.id);
    }
  }
  for (const [elapsed, phase] of [[0, 'serving-first'], [19.999, 'serving-first'], [20, 'serving-second'],
    [40, 'seating'], [70, 'eating'], [370, 'trash']]) {
    assert.equal(foodVisit(sample, (service.readyTime + elapsed) / 1800, 16).foodPhase, phase);
  }
  assert.equal(foodVisit(sample, (service.readyTime + 400) / 1800, 16), null);
});

test('kitchen shortest paths stay outside all furniture and hearth footprints', () => {
  const obstacles = foodObstacles(layout).filter(r => ['kitchen', 'hearth'].includes(r.kind));
  for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) {
    const path = kitchenPath(layout, a, b);
    for (let i = 1; i < path.length; i++) for (const rect of obstacles) {
      assert.ok(!crossesFoodRect(path[i - 1], path[i], rect), `${a} → ${b} crosses ${rect.kind}`);
    }
  }
});

test('cooking is deterministic after a fresh cache and visits at least four stations in five minutes', () => {
  const data = structuredClone(sample), [service] = kitchenServices(data, layout), stations = new Set();
  const reloaded = structuredClone(data);
  for (let second = 0; second < 300; second++) {
    const time = service.readyTime + second, current = state(data, time).staff;
    assert.deepEqual(current, state(reloaded, time).staff);
    FOOD_CORNER.kitchenStations.forEach((station, i) => {
      const p = atFood(layout, station);
      if (Math.hypot(current.x - p.x, current.y - p.y) < 1e-6) stations.add(i);
    });
  }
  assert.ok(stations.size >= 4, `${stations.size} stations visited`);
});

test('reduced motion uses identical service times, pins staff, and changes all dishes only at phase boundaries', () => {
  const [service] = kitchenServices(sample, layout);
  for (const time of [service.start + 1, service.setOutStart + 1, service.readyTime + 100, service.cleanupStart + 1, service.cleanupEnd + .1]) {
    const reduced = state(sample, time, true);
    assert.deepEqual(point(reduced.staff), atFood(layout, FOOD_CORNER.pickup));
    assert.equal(reduced.foodCount, time >= service.readyTime && time < service.cleanupStart ? 6 : 0);
  }
  const time = service.setOutStart + 8;
  assert.deepEqual(point(state(sample, time).staff), foodSetOut(layout, 8 / SET_OUT_SECONDS * 6).staff);
});

test('first demo-50 service schedule call takes under 150 ms', t => {
  const data = load('demo-50'), room = createRoomLayout(data.tables, data.room_layout);
  const start = performance.now(); kitchenServices(data, room); const elapsed = performance.now() - start;
  t.diagnostic(`first call: ${elapsed.toFixed(3)} ms`);
  assert.ok(elapsed < 150, `${elapsed} ms`);
});

test('services leave dwells immediately, finish walking segments, and resume the exact paused tour', () => {
  for (const start of [9, 60, 100, 200]) {
    const baseline = synthetic(); baseline.events = [];
    const data = structuredClone(baseline); data.events = [{ id: 'meal', kind: 'meal', at: start / 60, duration: 20 }];
    const room = createRoomLayout([]), tour = caretakerTour(data, room);
    let clock = start - 8, elapsed = clock % tour.seconds;
    const segment = tour.segments.find(s => { if (elapsed < s.seconds) return true; elapsed -= s.seconds; return false; });
    const moving = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 0;
    const remaining = moving ? segment.seconds - elapsed : 0;
    const service = kitchenServices(data, room)[0];
    assert.deepEqual(point(state(data, start, false, room).staff), point(state(baseline, start, false, room).staff));
    const leftAt = start + remaining;
    for (const delta of [0, .1, 1, 10]) {
      const after = state(data, service.backEnd + delta, false, room).staff;
      const expected = state(baseline, leftAt + delta, false, room).staff;
      near(after.x, expected.x); near(after.y, expected.y);
    }
  }
});

test('raw candidates respect breaks, explicit choice precedence, game assignments and fractional timestamps', () => {
  const data = synthetic(); data.events = [];
  data.visitors.people = ['guest'];
  data.people[0].movements = [{ at: 0, table: null, destination: 'lounge' }, { at: .1234567, table: null, destination: 'food' },
    { at: 2, table: null, destination: 'food' }, { at: 2, table: null, destination: 'lounge' },
    { at: 3, table: 'wrong-game', destination: 'food' }, { at: 4, table: null, destination: 'food' }];
  data.events = [{ id: 'break', kind: 'break', at: 4, duration: 1 }];
  const services = kitchenServices(data);
  near(services[0].start, .1234567 * 60);
  assert.equal(services[0].reason, 'visit');
  assert.ok(!services.some(s => [120, 180, 240].includes(s.start)));
  assert.equal(resolveLocation(data, data.people[0], 2).kind, 'lounge');
});
