import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicActivity, validateTimeline, slotToMs } from '../model.mjs';

const sample = JSON.parse(await readFile(new URL('../data/timeline.sample.json', import.meta.url), 'utf8'));
function fixture() {
  const data = structuredClone(sample);
  data.schema = 7;
  data.visitors = { open: true, people: [] };
  data.people.forEach(person => { person.movements = []; });
  const actor = data.people[0];
  data.activity = [{ id: 'a'.repeat(32), at: new Date(slotToMs(data, 3)).toISOString(),
    action: 'join', actor: actor.id, person: null, table: data.tables[0].id }];
  return { data, actor };
}

test('activity combines recorded changes, earlier movements and public events newest first', () => {
  const { data, actor } = fixture();
  actor.movements = [{ at: 2.5, table: data.tables[0].id, destination: 'food' }];
  const entries = publicActivity(validateTimeline(data));
  assert.ok(entries.some(entry => entry.text.includes('joined or updated their game seat')));
  assert.ok(entries.some(entry => entry.text.includes('went to get food')));
  assert.ok(entries.some(entry => entry.id.startsWith('event-')));
  assert.ok(entries.every((entry, index) => !index || entries[index - 1].at >= entry.at));
  assert.equal(entries.find(entry => entry.id.startsWith('movement-')).at, slotToMs(data, 2.5));
});

test('movement log does not duplicate history and hidden people remain anonymous retroactively', () => {
  const { data, actor } = fixture();
  const privateName = actor.name;
  actor.hidden = true; actor.name = null; actor.variant = null; actor.appearance = null;
  actor.movements = [{ at: 3, table: data.tables[0].id, destination: 'food' }];
  data.activity[0].action = 'move_food';
  const entries = publicActivity(validateTimeline(data));
  assert.equal(entries.filter(entry => entry.text.includes('went to get food')).length, 1);
  assert.ok(entries.find(entry => entry.id.startsWith('activity-')).text.startsWith('someone'));
  assert.ok(entries.every(entry => !entry.text.includes(privateName)));
});

test('removed table references remain readable and arbitrary or private payloads fail validation', () => {
  const { data } = fixture();
  data.activity[0].table = 't999';
  assert.match(publicActivity(validateTimeline(data)).find(entry => entry.id.startsWith('activity-')).text, /removed game/);
  for (const change of [{ actor: 'missing' }, { action: 'private_roll' }, { at: 'yesterday' }, { text: 'secret' }]) {
    const invalid = structuredClone(data);
    Object.assign(invalid.activity[0], change);
    assert.throws(() => validateTimeline(invalid));
  }
  data.activity.push(structuredClone(data.activity[0]));
  assert.throws(() => validateTimeline(data));
});

test('public dice outcomes are logged while private rolls are excluded', () => {
  const { data, actor } = fixture();
  const event = { id: 'public-roll', at: 3, kind: 'roll', person: actor.id, by: actor.id,
    text: null, duration: null, table: data.tables[0].id, visibility: 'public',
    roll: { expression: '1d20', sides: 20, faces: [9], modifier: 0, total: 9 } };
  data.events.push(event);
  assert.ok(publicActivity(validateTimeline(data)).some(entry => entry.text.includes('rolled 1d20: [9]')));
  event.visibility = 'private';
  assert.ok(!publicActivity(data).some(entry => entry.id === 'event-public-roll'));
  assert.throws(() => validateTimeline(data));
});
