import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocation, foodVisit, foodGeometry, loungeActivities, createRoomLayout, accessibleEventText } from '../model.mjs';

function fixture() {
  const person = { id: 'guest', presence: { planned: [0, 20], actual: { here: null, leaving: null } },
    movements: [{ at: 2, table: 't1', destination: 'food' }] };
  const table = { id: 't1', name: 'Game', dm: 'host', start: 0, end: 10, seats: 5,
    signups: [{ person: person.id, planned: [0, 10], actual: null }] };
  const data = { event: { slots: 20, slot_minutes: 30 }, people: [person], tables: [table], events: [], visitors: { people: [] } };
  return { person, data, at: seconds => 2 + seconds / 1800 };
}

test('food visits collect at both tables, eat exactly five minutes, clear the plate and return to their seat', () => {
  const { person, data, at } = fixture();
  for (const [seconds, phase] of [[0, 'serving-first'], [19.999, 'serving-first'], [20, 'serving-second'],
    [40, 'seating'], [69.999, 'seating'], [70, 'eating'], [369.999, 'eating'], [370, 'trash'], [399.999, 'trash']]) {
    assert.equal(resolveLocation(data, person, at(seconds)).foodPhase, phase, String(seconds));
  }
  assert.equal(resolveLocation(data, person, at(389)).plate, true);
  assert.equal(resolveLocation(data, person, at(390)).plate, false);
  const returned = resolveLocation(data, person, at(400));
  assert.equal(returned.kind, 'table');
  assert.equal(returned.seat, 1);
  assert.equal(resolveLocation(data, person, at(1000)).kind, 'table');
  assert.equal(data.tables[0].signups.length, 1);
});

test('food state is independent of playback history, reloads and slot length', () => {
  const { data, person, at } = fixture();
  const expected = resolveLocation(data, person, at(190));
  resolveLocation(data, person, at(700));
  assert.deepEqual(resolveLocation(structuredClone(data), structuredClone(person), at(190)), expected);
  assert.equal(expected.foodRemaining, .6);
  for (const minutes of [1, 5, 30, 60]) {
    data.event.slot_minutes = minutes;
    assert.equal(foodVisit(data, 70 / (minutes * 60), 0).foodPhase, 'eating');
    assert.equal(foodVisit(data, 370 / (minutes * 60), 0).foodPhase, 'trash');
    assert.equal(foodVisit(data, 400 / (minutes * 60), 0), null);
  }
});

test('food returns to the previous lounge choice; newer moves, absence and game end supersede it', () => {
  const { data, person, at } = fixture();
  person.movements.unshift({ at: 1, table: 't1', destination: 'lounge' });
  assert.equal(resolveLocation(data, person, at(400)).kind, 'lounge');
  person.movements.push({ at: at(100), table: 't1', destination: 'table' });
  assert.equal(resolveLocation(data, person, at(101)).kind, 'table');
  person.presence.actual.leaving = at(200);
  assert.equal(resolveLocation(data, person, at(200)).kind, 'absent');
  person.presence.actual.leaving = null;
  person.movements = [{ at: 9.99, table: 't1', destination: 'food' }];
  assert.equal(resolveLocation(data, person, 10).kind, 'lounge');
});

test('a break sends food and lounge visitors to activities and restores their current context afterward', () => {
  const { data, person, at } = fixture();
  data.events = [{ id: 'break', kind: 'break', at: at(50), duration: 1 }];
  assert.equal(resolveLocation(data, person, at(51)).kind, 'lounge');
  assert.equal(resolveLocation(data, person, at(1850)).kind, 'table');
  assert.match(accessibleEventText(data, { break: data.events[0] }), /Staff announcement: Break time/);
});

test('automatic meal and visitor meals do not restart on each frame or wandering beat', () => {
  const { data, person } = fixture();
  person.movements = [];
  data.events = [{ id: 'meal', kind: 'meal', at: 2, duration: 1 }];
  assert.equal(resolveLocation(data, person, 2.1).foodPhase, 'eating');
  assert.equal(resolveLocation(data, person, 2.5).kind, 'table');
  data.events = []; data.tables = []; data.visitors.people = [person.id];
  let start;
  for (let minute = 0; minute < 16; minute += 4) {
    if (resolveLocation(data, person, minute / 30).foodPhase === 'serving-first') { start = minute / 30; break; }
  }
  assert.notEqual(start, undefined);
  assert.equal(resolveLocation(data, person, start + 5 / 30).foodPhase, 'eating');
  assert.notEqual(resolveLocation(data, person, start + 7 / 30).kind, 'food');
});

test('lounge population creates reading, conversation, cards and multiple stable groups within the lounge', () => {
  const layout = createRoomLayout([]);
  for (const count of [0, 1, 2, 3, 6, 7, 13, 100]) {
    const people = Array.from({ length: count }, (_, i) => ({ id: `p${i}` }));
    const groups = loungeActivities(layout, people);
    assert.equal(groups.size, count);
    assert.deepEqual(groups, loungeActivities(layout, people.reverse()));
    const activities = new Set([...groups.values()].map(group => group.activity));
    assert.deepEqual(activities, new Set(count === 0 ? [] : count === 1 ? ['reading'] : count === 2 ? ['chatting']
      : count <= 6 ? ['cards'] : ['cards', 'chatting']));
    for (const { position } of groups.values()) {
      assert.ok(position.x > layout.lounge.x && position.x < layout.lounge.x + layout.lounge.w);
      assert.ok(position.y > layout.lounge.y && position.y < layout.lounge.y + layout.lounge.h);
    }
  }
  for (let index = 0; index < 24; index += 1) {
    const { seat } = foodGeometry(layout, index, 24);
    assert.ok(seat.x < layout.food.x + layout.food.w && seat.y < layout.food.y + layout.food.h);
  }
});
