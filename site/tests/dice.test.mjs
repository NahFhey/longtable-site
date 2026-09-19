import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { diceAt, diceText, validateTimeline } from "../model.mjs";

const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
function fixture() {
  const data = structuredClone(sample);
  data.schema = 5;
  const table = data.tables[0];
  data.events = [{ id: "roll-a", kind: "roll", at: table.start + .125, duration: null,
    text: null, person: table.dm, by: table.dm, table: table.id, visibility: "public",
    roll: { expression: "2d6+3", sides: 6, faces: [3, 4], modifier: 3, total: 10 } }];
  return data;
}

test("schema 5 enforces dice math, visibility and references without echoing private input", () => {
  assert.equal(validateTimeline(fixture()).events[0].roll.total, 10);
  for (const patch of [{ visibility: "private" }, { table: "missing" }, { person: "missing" }, { text: "PRIVATE SECRET" }, { by: "missing" }]) {
    const data = fixture(); Object.assign(data.events[0], patch);
    assert.throws(() => validateTimeline(data), (error) => !error.message.includes("PRIVATE SECRET"));
  }
  for (const patch of [{ faces: [] }, { faces: [0, 7] }, { faces: [true] }, { total: 11 }, { total: true }, { modifier: 1001 }, { sides: 1 }, { expression: "2d6+4" }, { secret: "PRIVATE SECRET" }]) {
    const data = fixture(); Object.assign(data.events[0].roll, patch);
    assert.throws(() => validateTimeline(data), (error) => !error.message.includes("PRIVATE SECRET"));
  }
  const old = fixture(); old.schema = 4;
  assert.throws(() => validateTimeline(old));
});

test("dice frames derive solely from selected time, settle on recorded faces, and honor reduced motion", () => {
  const data = validateTimeline(fixture()), event = data.events[0];
  const slot = event.at + 1.5 / (data.event.slot_minutes * 60);
  const midway = diceAt(data, event.table, slot);
  assert.ok(Math.abs(midway.progress - .5) < 1e-9);
  diceAt(data, event.table, slot + 1);
  assert.deepEqual(diceAt(data, event.table, slot), midway);
  assert.deepEqual(diceAt(validateTimeline(fixture()), event.table, slot), midway);
  assert.equal(diceAt(data, event.table, event.at - .001), null);
  const settled = diceAt(data, event.table, event.at + 1);
  assert.deepEqual(settled.dice.map((die) => die.face), [3, 4]);
  assert.ok(settled.dice.every((die) => die.angle === 0));
  assert.deepEqual(diceAt(data, event.table, slot, true).dice, settled.dice);
  assert.match(diceText(data, event), /2d6\+3: \[3, 4\] \+3 = 10/);
});

test("hidden rollers stay hidden and refresh/removal never reuses a discarded outcome", () => {
  const input = fixture(), event = input.events[0];
  const person = input.people.find((p) => p.id === event.person);
  person.hidden = true; person.name = null; person.variant = null; person.appearance = null;
  let data = validateTimeline(input);
  assert.match(diceText(data, diceAt(data, event.table, event.at).event), /^someone rolled/);
  assert.doesNotMatch(diceText(data, event), /critical/i);
  input.events.push({ ...structuredClone(event), id: "roll-b", roll: { expression: "1d20", sides: 20, faces: [20], modifier: 0, total: 20 } });
  data = validateTimeline(input);
  assert.equal(diceAt(data, event.table, event.at).event.id, "roll-b");
  assert.doesNotMatch(diceText(data, input.events[1]), /critical/i);
  input.events = [];
  assert.equal(diceAt(validateTimeline(input), event.table, event.at), null);
});
