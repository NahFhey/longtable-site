import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTimeline, createRoomLayout, practicePlaces, practiceKitchenServices, gatheringAmbience,
  gatheringLocations } from '../model.mjs';
import { realPlate } from '../food-corner.mjs';
import { receivePracticeSnapshot, practiceNow } from '../model.mjs';
import { SET_OUT_SECONDS, FOOD_CORNER, atFood } from '../food-layout.mjs';

const sample = JSON.parse(readFileSync(new URL('../data/timeline.sample.json', import.meta.url)));
const A = Date.parse('2026-09-26T12:00:00Z') / 1000;
const stamp = seconds => new Date(seconds * 1000).toISOString();
const move = (person, seconds, destination = 'food', table = null) => ({ person, at: stamp(seconds), destination, table });
const fixture = (moves = [move('u_lena', A)]) => ({ ...structuredClone(sample), generated_at: stamp(A),
  practice: { people: { u_lena: { position: moves.findLast(m => m.person === 'u_lena')?.destination ?? 'table',
    table: moves.findLast(m => m.person === 'u_lena')?.table ?? 't01' } }, speech: [], moves } });
const room = data => createRoomLayout(data.tables, data.room_layout);
const place = (data, seconds, person = 'u_lena') => practicePlaces(data, seconds * 1000).get(person);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const point = p => ({ x: p.x, y: p.y });

test('practice moves validate, sort, survive revalidation, and drop malformed entries', () => {
  const data = fixture([move('u_lena', A + 1), move('u_lena', A, 'table', 't01')]);
  const good = structuredClone(data.practice.moves).reverse();
  data.practice.moves.push(null, {}, move('ghost', A), move('u_lena', A, 'stage'),
    move('u_lena', A, 'table', 't99'), move('u_lena', A, 'food', 't01'),
    { ...move('u_lena', A), at: 'not-a-date' }, { ...move('u_lena', A), at: '2026-09-26T12:00:00-04:00' });
  const validated = validateTimeline(data);
  assert.deepEqual(validated.practice.moves, good);
  assert.deepEqual(validateTimeline(validated).practice.moves, good);
  data.practice.moves = {};
  assert.deepEqual(validateTimeline(data).practice.moves, []);
});

test('practice waits empty-handed, plates, eats, and returns after 400 seconds', t => {
  const data = fixture(), [service] = practiceKitchenServices(data);
  t.diagnostic(JSON.stringify(service));
  assert.equal(place(data, A).foodPhase, 'waiting');
  assert.equal(place(data, A + 1).foodPhase, 'waiting');
  assert.equal(place(data, A + 1).plate, false);
  assert.equal(realPlate(place(data, A + 1), 0, true), null);
  assert.deepEqual(realPlate(place(data, service.readyTime + 1), 0, true).items, []);
  assert.equal(place(data, service.readyTime + 1).foodPhase, 'serving-first');
  assert.equal(place(data, service.readyTime + 100).foodPhase, 'eating');
  assert.deepEqual(place(data, service.readyTime + 400), gatheringLocations(data).get('u_lena'));
  assert.equal(practiceKitchenServices(data), practiceKitchenServices(data));
});

test('a correct clock keeps offset zero for a first snapshot 180 seconds old', () => {
  const data = { ...fixture(), generated_at: stamp(A + .3) };
  const live = receivePracticeSnapshot(data, null, (A + .3) * 1000);
  const loadedAt = (A + 180.3) * 1000;
  const late = receivePracticeSnapshot(data, null, loadedAt);
  assert.equal(late.lo, -180000);
  assert.equal(late.hi, Infinity);
  assert.equal(late.offset, 0);
  const position = practicePlaces(late.timeline, practiceNow(late, loadedAt)).get('u_lena');
  assert.equal(position.foodPhase, 'eating');
  assert.deepEqual(position, practicePlaces(live.timeline, practiceNow(live, loadedAt)).get('u_lena'));
});

test('a clock 90 seconds slow is corrected by a fresh first snapshot', () => {
  const data = { ...fixture(), generated_at: stamp(A + .3) };
  const slow = receivePracticeSnapshot(data, null, (A + .3 - 90) * 1000);
  assert.equal(slow.offset, 90000);
  const [service] = practiceKitchenServices(data);
  for (const seconds of [A + 1, service.readyTime + 1, service.readyTime + 100, A + 180.3, service.readyTime + 400]) {
    assert.deepEqual(practicePlaces(slow.timeline, practiceNow(slow, (seconds - 90) * 1000)).get('u_lena'), place(data, seconds));
  }
});

test('a clock 90 seconds fast is bounded after an unchanged poll and a new snapshot', t => {
  const stale = { ...fixture([]), generated_at: stamp(A - 180) };
  const first = receivePracticeSnapshot(stale, null, (A + 90) * 1000);
  assert.equal(first.offset, 0);
  assert.equal(first.hi, Infinity);
  const pollAt = (A + 95) * 1000;
  const unchanged = receivePracticeSnapshot(stale, first, pollAt, (A + 90) * 1000);
  assert.equal(unchanged.hi, Infinity);
  assert.equal(unchanged.lo, first.lo);
  const click = A + 8;
  assert.ok(click - (pollAt / 1000 - 90) > 0 && click - (pollAt / 1000 - 90) <= 5);
  const data = { ...fixture([move('u_lena', click)]), generated_at: stamp(click) };
  const fast = receivePracticeSnapshot(data, unchanged, (click + 1 + 90) * 1000, pollAt);
  const error = fast.offset / 1000 + 90;
  assert.equal(fast.hi, click * 1000 - pollAt + 2000);
  assert.equal(fast.offset, fast.hi);
  assert.ok(error >= 0 && error <= 7);
  const [service] = practiceKitchenServices(data);
  for (const [seconds, phase] of [[click + 1, 'waiting'], [service.readyTime + 1, 'serving-first'],
    [service.readyTime + 100, 'eating'], [service.readyTime + 400, undefined]]) {
    const corrected = practiceNow(fast, (seconds + 90) * 1000);
    near(corrected / 1000 - seconds, error);
    const actual = practicePlaces(fast.timeline, corrected).get('u_lena');
    assert.deepEqual(actual, place(data, seconds + error));
    assert.equal(actual.foodPhase, phase);
    if (phase === 'waiting') assert.equal(actual.plate, false);
    if (!phase) assert.deepEqual(actual, gatheringLocations(data).get('u_lena'));
    t.diagnostic(`${phase ?? 'back after 400 s'}: clock error ${error} s`);
  }
  const later = receivePracticeSnapshot(data, fast, (click + 6 + 90) * 1000, (click + 1 + 90) * 1000);
  assert.equal(later.lo, fast.lo);
  assert.equal(later.hi, fast.hi);
  assert.equal(later.offset, fast.offset);
});

test('inconsistent offset bounds reset to the newest observation and doors clear the bounds', () => {
  const data = fixture();
  const first = receivePracticeSnapshot(data, null, (A - 90) * 1000);
  const next = { ...data, generated_at: stamp(A + 5) };
  const recovered = receivePracticeSnapshot(next, first, (A + 95) * 1000, (A + 94) * 1000);
  assert.equal(recovered.lo, -90000);
  assert.equal(recovered.hi, -90000);
  assert.equal(recovered.offset, -90000);
  const doors = receivePracticeSnapshot({ ...next, practice: null, generated_at: data.event.start }, recovered,
    Date.parse(data.event.start));
  assert.equal(doors.lo, -Infinity);
  assert.equal(doors.hi, Infinity);
  assert.equal(doors.moves.length, 0);
  assert.equal(doors.seen.size, 0);
});

test('auto-return uses the previous destination; repeat food clicks start a fresh visit', () => {
  for (const [destination, table] of [['lounge', null], ['table', 't04']]) {
    const data = fixture([move('u_lena', A - 1, destination, table), move('u_lena', A)]);
    const [service] = practiceKitchenServices(data);
    const before = place(data, A - 1);
    assert.deepEqual(place(data, service.readyTime + 400), before);
    data.practice.moves.push(move('u_lena', service.readyTime + 100));
    const repeat = structuredClone(data);
    assert.equal(place(repeat, service.readyTime + 100).foodPhase, 'serving-first');
    assert.equal(place(repeat, service.readyTime + 200).foodPhase, 'eating');
    assert.deepEqual(place(repeat, service.readyTime + 500), before);
  }
  const threadDefault = fixture();
  threadDefault.practice.people.u_lena.table = 't04';
  const [threadService] = practiceKitchenServices(threadDefault);
  assert.equal(place(threadDefault, threadService.readyTime + 400).table.id, 't04');
  const visitor = fixture([move('u_tess', A)]);
  visitor.practice.people = { u_tess: { position: 'food', table: null } };
  const [service] = practiceKitchenServices(visitor);
  assert.equal(place(visitor, service.readyTime + 400, 'u_tess').kind, 'lounge');
});

test('later moves supersede food immediately while the kitchen continues through cleanup', () => {
  const initial = fixture(), [first] = practiceKitchenServices(initial);
  const leave = Date.parse(stamp(first.readyTime + 50)) / 1000;
  const data = fixture([move('u_lena', A), move('u_lena', leave, 'table', 't01')]);
  const [service] = practiceKitchenServices(data);
  assert.equal(place(data, leave).kind, 'table');
  assert.equal(place(data, leave).seat, 1);
  near(service.lastDinerEnd, leave);
  near(service.cleanupRequested, leave + 300);
  assert.equal(gatheringAmbience(data, room(data), (leave + 200) * 1000).foodCount, 6);
  assert.ok(service.backEnd > service.cleanupEnd);
  const idle = { ...data, practice: { ...data.practice, people: {} } };
  assert.equal(practicePlaces(idle, leave * 1000).size, 0);
  assert.deepEqual(practiceKitchenServices(idle), practiceKitchenServices(data));
  const reset = fixture([move('u_lena', A, 'lounge')]);
  reset.practice.people.u_lena.position = 'table';
  assert.equal(place(reset, A + 2000).kind, 'table', 'a reaction after idle reset uses the bot default');
});

test('a second diner joins while food is out; cleanup demand starts at cleanup end without a walk-in', () => {
  const data = fixture(), [first] = practiceKitchenServices(data);
  const join = Date.parse(stamp(first.readyTime + 100)) / 1000;
  const joining = fixture([move('u_lena', A), move('u_tess', join)]);
  joining.practice.people.u_tess = { position: 'food', table: null };
  assert.equal(place(joining, join, 'u_tess').foodPhase, 'serving-first');
  const [extended] = practiceKitchenServices(joining);
  near(extended.lastDinerEnd, join + 400);
  const during = extended.cleanupStart + 1;
  const queued = structuredClone(joining);
  queued.practice.moves.push(move('u_tess', during));
  const [one, two] = practiceKitchenServices(queued);
  near(two.start, one.cleanupEnd);
  near(two.walkIn, 0);
  near(two.readyTime, two.start + SET_OUT_SECONDS);
  assert.equal(place(queued, during, 'u_tess').foodPhase, 'waiting');
  assert.equal(place(queued, during, 'u_tess').plate, false);
  assert.equal(place(queued, two.readyTime + 1, 'u_tess').foodPhase, 'serving-first');
});

test('legacy snapshots keep the first-seen food timestamp across polls and reset on a changed position', () => {
  const data = fixture(); delete data.practice.moves;
  const first = receivePracticeSnapshot(data, null, A * 1000);
  const [service] = practiceKitchenServices(first.timeline);
  let next = first;
  for (const seconds of [A + 1, service.readyTime + 1, service.readyTime + 100, service.readyTime + 401]) {
    next = receivePracticeSnapshot({ ...data, generated_at: stamp(seconds) }, next, seconds * 1000);
    assert.equal(next.timeline.practice.moves[0].at, data.generated_at);
    assert.deepEqual(practiceKitchenServices(next.timeline), [service]);
    assert.deepEqual(place(next.timeline, seconds), place(first.timeline, seconds));
  }
  assert.equal(place(first.timeline, A).plate, false);
  const leaving = structuredClone(data); leaving.generated_at = stamp(A + 1000);
  leaving.practice.people.u_lena.position = 'lounge';
  const left = receivePracticeSnapshot(leaving, next, (A + 1000) * 1000);
  const again = receivePracticeSnapshot({ ...data, generated_at: stamp(A + 1001) }, left, (A + 1001) * 1000);
  assert.equal(again.moves.at(-1).at, stamp(A + 1001));
  assert.equal(place(again.timeline, A + 1001).foodPhase, 'waiting');
  const doors = receivePracticeSnapshot({ ...data, practice: null, generated_at: data.event.start }, again, Date.parse(data.event.start));
  assert.equal(doors.moves.length, 0);
});

test('the caretaker sets out, cooks, and resumes the exact paused tour after two services', () => {
  const data = fixture([move('u_lena', A), move('u_lena', A + 2000)]), layout = room(data);
  const plain = { ...data, practice: null };
  const services = practiceKitchenServices(data, layout);
  let absence = 0;
  for (const service of services) {
    const at = seconds => gatheringAmbience(data, layout, seconds * 1000);
    assert.equal(at(service.setOutStart - .001).foodCount, 0);
    assert.equal(at(service.readyTime).foodCount, 6);
    assert.equal(at(service.cleanupStart - .001).foodCount, 6);
    // Finishing the current segment is still tour time; only the excursion is subtracted.
    const departure = gatheringAmbience(plain, layout, (service.tourDeparture - absence) * 1000).staff;
    const back = at(service.backEnd).staff;
    near(back.x, departure.x); near(back.y, departure.y);
    absence += service.backEnd - service.tourDeparture;
    const expected = gatheringAmbience(plain, layout, (service.backEnd + 1 - absence) * 1000).staff;
    near(at(service.backEnd + 1).staff.x, expected.x);
    near(at(service.backEnd + 1).staff.y, expected.y);
  }
});

test('caretaker continuity every quarter second across three practice services, including D4', () => {
  const first = fixture(), [service] = practiceKitchenServices(first);
  const data = fixture([move('u_lena', A), move('u_lena', service.cleanupStart + 1), move('u_lena', A + 2400)]);
  const layout = room(data), services = practiceKitchenServices(data, layout);
  assert.equal(services.length, 3);
  let previous = gatheringAmbience(data, layout, (A - 1) * 1000).staff;
  for (let t = A - .75; t <= services.at(-1).backEnd + 20; t += .25) {
    const current = gatheringAmbience(data, layout, t * 1000).staff;
    const step = Math.hypot(current.x - previous.x, current.y - previous.y);
    assert.ok(step <= 3.4 * .25 + 1e-6, `step ${step} at ${t - A}`);
    previous = current;
  }
});

test('practice continues through the eve and reduced motion keeps the same readiness', () => {
  const data = fixture(), layout = room(data), [service] = practiceKitchenServices(data, layout);
  for (const seconds of [A, service.setOutStart + 1, service.readyTime, service.cleanupStart, service.backEnd]) {
    const reduced = gatheringAmbience(data, layout, seconds * 1000, true);
    assert.deepEqual(point(reduced.staff), seconds < service.backEnd ? atFood(layout, FOOD_CORNER.pickup) : reduced.lightSwitch);
    assert.equal(reduced.foodCount, seconds >= service.readyTime && seconds < service.cleanupStart ? 6 : 0);
  }
  const eve = Date.parse(data.event.start) / 1000 - 60;
  const changed = fixture([move('u_lena', eve)]);
  assert.equal(place(changed, eve + 1).foodPhase, 'waiting');
  assert.ok(gatheringAmbience(changed, layout, (eve + 1) * 1000).staff);
});

test('500 practice moves over six weeks schedule in under 50 ms without changing the snapshot', t => {
  const data = fixture(Array.from({ length: 500 }, (_, i) => move('u_lena', A + i * 6 * 7 * 86400 / 500,
    i % 3 === 0 ? 'food' : i % 3 === 1 ? 'table' : 'lounge', i % 3 === 1 ? 't01' : null)));
  const before = structuredClone(data), layout = room(data), start = performance.now();
  practiceKitchenServices(data, layout);
  const elapsed = performance.now() - start;
  t.diagnostic(`500 moves: ${elapsed.toFixed(3)} ms`);
  assert.ok(elapsed < 50, `${elapsed.toFixed(3)} ms`);
  assert.deepEqual(data, before);
});
