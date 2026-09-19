import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTimeline, resolveLocation, validateRoll } from '../model.mjs';

const sample = JSON.parse(await readFile(new URL('../data/timeline.sample.json', import.meta.url), 'utf8'));
function fixture() {
  const data = structuredClone(sample);
  data.schema = 7;
  data.events = [];
  data.people.forEach(person => { person.movements = []; });
  const table = data.tables[0];
  const person = data.people.find(person => person.id === table.dm);
  person.presence = { planned: [0, data.event.slots], actual: { here: null, leaving: null } };
  data.visitors = { open: true, people: [person.id] };
  return { data, table, person };
}

test('player movement replays at chosen time, keeps the seat, and ends with the game', () => {
  const { data, table, person } = fixture();
  const at = table.start;
  person.movements = [
    { at: at + .1, table: table.id, destination: 'food' },
    { at: at + .2, table: table.id, destination: 'lounge' },
    { at: at + .3, table: table.id, destination: 'table' },
  ];
  const timeline = validateTimeline(data), player = timeline.people.find(p => p.id === person.id);
  const place = time => resolveLocation(timeline, player, time);
  assert.equal(place(at).kind, 'table');
  assert.equal(place(at + .1).kind, 'food');
  assert.equal(place(at + .2).kind, 'lounge');
  assert.equal(place(at + .3).kind, 'table');
  assert.equal(place(at + .3).seat, 0);
  assert.equal(place(at + .15).kind, 'food');
  assert.equal(resolveLocation(timeline, player, at + .3, { meal: { id: 'meal' } }).kind, 'table');
  assert.notEqual(place(table.end).table?.id, table.id);
  player.presence.actual.leaving = at + .4;
  assert.equal(place(at + .4).kind, 'absent');
});

test('visitor meals finish automatically and choices yield to a game', () => {
  const { data, table, person } = fixture();
  person.movements = [{ at: 0, table: null, destination: 'food' }];
  const timeline = validateTimeline(data), visitor = timeline.people.find(p => p.id === person.id);
  if (table.start > 0) {
    assert.equal(resolveLocation(timeline, visitor, 1 / data.event.slot_minutes).kind, 'food');
    assert.notEqual(resolveLocation(timeline, visitor, table.start / 2).kind, 'food');
  }
  assert.equal(resolveLocation(timeline, visitor, table.start).kind, 'table');
  visitor.movements = [{ at: table.end, table: null, destination: 'lounge' }];
  assert.equal(resolveLocation(timeline, visitor, table.end).kind, 'lounge');
});

test('schema 7 validates movement history and legacy schemas remain readable', () => {
  const { data, person, table } = fixture();
  for (const movements of [null, [{ at: 1, table: 'missing', destination: 'food' }],
    [{ at: 1, table: null, destination: 'table' }], [{ at: -1, table: null, destination: 'food' }],
    [{ at: 1, table: null, destination: 'stage' }],
    [{ at: 2, table: table.id, destination: 'food' }, { at: 1, table: table.id, destination: 'table' }]]) {
    person.movements = movements;
    assert.throws(() => validateTimeline(data));
  }
  delete person.movements;
  assert.throws(() => validateTimeline(data));
  data.schema = 6;
  assert.deepEqual(validateTimeline(data).people.find(p => p.id === person.id).movements, []);
});

test('custom dice sizes and quantities validate without relaxing outcome math', () => {
  const roll = { expression: '100d1000-1000', sides: 1000, faces: Array(100).fill(1000), modifier: -1000, total: 99000 };
  assert.equal(validateRoll(roll).total, 99000);
  assert.equal(validateRoll({ expression: '2d3', sides: 3, faces: [2, 3], modifier: 0, total: 5 }).total, 5);
  for (const patch of [{ sides: 1001 }, { faces: Array(101).fill(1000) }, { total: 99001 }]) {
    assert.throws(() => validateRoll({ ...roll, ...patch }));
  }
});
