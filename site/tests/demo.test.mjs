import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTimeline, isPresent, tableLifecycle, resolveLocation } from '../model.mjs';

const demo = validateTimeline(JSON.parse(await readFile(new URL('../data/timeline.demo-50.json', import.meta.url), 'utf8')));

test('full-day demo has 50 distinct arrivals and departures, then an empty hall', () => {
  assert.equal(demo.people.length, 50);
  assert.equal(new Set(demo.people.map(person => person.id)).size, 50);
  assert.equal(demo.event.slots * demo.event.slot_minutes, 24 * 60);
  assert.equal(demo.tables.length, 12);
  for (const person of demo.people) {
    const { here, leaving } = person.presence.actual;
    assert.ok(here > 0 && here < leaving && leaving < demo.event.slots);
    assert.equal(isPresent(person, here - .001, demo.event.slots), false);
    assert.equal(isPresent(person, here, demo.event.slots), true);
    assert.equal(isPresent(person, leaving, demo.event.slots), false);
  }
  for (const start of [0, 12]) {
    assert.ok(demo.people.some(person => person.presence.actual.here >= start && person.presence.actual.here < start + 12));
  }
  for (const start of [24, 36]) {
    assert.ok(demo.people.some(person => person.presence.actual.leaving >= start && person.presence.actual.leaving < start + 12));
  }
  // Everyone is in the hall together for one fifth of the marathon.
  const lastArrival = Math.max(...demo.people.map(person => person.presence.actual.here));
  const firstDeparture = Math.min(...demo.people.map(person => person.presence.actual.leaving));
  assert.ok(firstDeparture - lastArrival >= demo.event.slots * .2, `${lastArrival}..${firstDeparture}`);
  assert.ok(demo.people.every(person => isPresent(person, lastArrival, demo.event.slots)));
  // Every game is playing at once for one fifth of the marathon, then the tables fade in a random order.
  const lastStart = Math.max(...demo.tables.map(table => table.start));
  const firstEnd = Math.min(...demo.tables.map(table => table.end));
  assert.ok(firstEnd - lastStart >= demo.event.slots * .2, `${lastStart}..${firstEnd}`);
  assert.ok(demo.tables.every(table => tableLifecycle(demo, table, lastStart).phase === 'active'));
  assert.ok(new Set(demo.tables.map(table => table.end)).size >= 8, 'tables fade one by one');
  assert.equal(new Set(demo.tables.map(table => table.dm)).size, demo.tables.length, 'one DM per concurrent game');
  const seated = demo.tables.flatMap(table => table.signups.map(signup => signup.person));
  assert.equal(new Set(seated).size, seated.length, 'nobody sits at two concurrent games');
  assert.ok(demo.people.every(person => !isPresent(person, 48, 48)));
  assert.ok(demo.tables.every(table => tableLifecycle(demo, table, 48).phase === 'inactive'));
  for (const table of demo.tables) for (const signup of table.signups) {
    const person = demo.people.find(person => person.id === signup.person);
    assert.ok(signup.actual[0] < signup.actual[1]);
    assert.ok(signup.actual[0] >= person.presence.actual.here);
    assert.ok(signup.actual[1] <= person.presence.actual.leaving);
  }
});

test('demo includes visitors, meals, breaks, public rolls and present stage speakers', () => {
  assert.ok(demo.visitors.people.length >= 6);
  for (const kind of ['meal', 'break', 'donation', 'shout', 'roll', 'announce']) {
    assert.ok(demo.events.some(event => event.kind === kind), kind);
  }
  for (const event of demo.events.filter(event => event.person)) {
    const person = demo.people.find(person => person.id === event.person);
    assert.ok(isPresent(person, event.at, demo.event.slots), `${event.id}: speaker/roller must be present`);
  }
  assert.equal(demo.activity.filter(entry => entry.action === 'here').length, 50);
  assert.equal(demo.activity.filter(entry => entry.action === 'leaving').length, 50);
});

test('everyone present at Dinner goes to eat, including DMs back from a snack trip', () => {
  const dinner = demo.events.find(event => event.kind === 'meal');
  const present = demo.people.filter(person => isPresent(person, dinner.at + .1, demo.event.slots));
  const returned = present.filter(person => person.movements.some(move => move.destination === 'table' && move.at < dinner.at));
  assert.ok(returned.length >= 8);
  for (const person of present) assert.equal(resolveLocation(demo, person, dinner.at + .1).event?.id, dinner.id, person.id);
});
