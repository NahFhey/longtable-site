import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TimelineError, validateTimeline } from "../model.mjs";

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
const sample = () => read("../data/timeline.raid.sample.json");
const cases = read("./fixtures/raid-malformed.json");
function malformed(fixture) {
  const doc = sample();
  for (const patch of fixture.patches) {
    let target = doc;
    for (const key of patch.path.slice(0, -1)) target = target[key];
    const key = patch.path.at(-1);
    if (patch.op === "delete") { if (Array.isArray(target)) target.splice(key, 1); else delete target[key]; }
    else if (patch.op === "append") target[key].push(structuredClone(patch.value));
    else target[key] = structuredClone(patch.value);
  }
  return doc;
}

test("schema 8 preserves and independently clones the entire raid log", () => {
  const input = sample();
  const output = validateTimeline(input);
  assert.deepEqual(output.raid, input.raid);
  output.raid.log[0].legs[0].max = 1;
  assert.notEqual(output.raid.log[0].legs[0].max, input.raid.log[0].legs[0].max);
});
test("schema 8 allows absent/null raid and a scheduled empty log", () => {
  const input = sample();
  input.raid.log = [];
  assert.deepEqual(validateTimeline(input).raid.log, []);
  input.raid = null;
  assert.equal(validateTimeline(input).raid, null);
  delete input.raid;
  assert.equal(validateTimeline(input).raid, undefined);
});
test("a next strike may fall after the event's last slot", () => {
  const input = sample();
  const entry = input.raid.log.find(e => e.kind === "timer" && e.next !== null);
  entry.next = input.event.slots + 0.1;
  assert.equal(validateTimeline(input).raid.log.find(e => e.kind === "timer" && e.next !== null).next, input.event.slots + 0.1);
});
test("legacy samples keep validating without raid", () => {
  const input = read("../data/timeline.sample.json");
  const before = validateTimeline(input);
  assert.equal(before.raid ?? null, null);
  // Older schemas keep the same data contract, without a raid key.
  for (const schema of [1,2,3,4,5,6,7]) {
    const legacy = structuredClone(input);
    legacy.schema = schema;
    if (schema === 1) legacy.events = legacy.events.filter(e => ["break","meal","announce","spotlight"].includes(e.kind));
    if (schema >= 6) legacy.visitors = {open:true,people:[]};
    if (schema >= 7) legacy.people.forEach(p => {p.movements = [];});
    assert.equal(validateTimeline(legacy).raid, undefined);
  }
});
test("organizer markers after end and timed window edits survive", () => {
  const input = sample();
  const entry = input.raid.log.find(e => e.kind === "admin");
  entry.action = "window"; entry.window = {start:40,end:47};
  input.raid.log.push({at:48,kind:"admin",admin:true,action:"coin_grant"});
  assert.deepEqual(validateTimeline(input).raid, input.raid);
});
test("the sample timer reconstructs running, paused and resumed minutes", () => {
  const input = validateTimeline(sample());
  const timerAt = minute => {
    const t = 40 + minute / 30;
    const timer = input.raid.log.filter(e => e.kind === "timer" && e.at <= t).at(-1);
    return timer.timer === null ? null : timer.paused ? timer.remaining : Math.max(0, (timer.next-t)*30);
  };
  for (const [minute, remaining] of [[3,1],[6,3],[103,3],[107,3],[109,2]]) assert.ok(Math.abs(timerAt(minute)-remaining)<1e-9);
  assert.equal(timerAt(55), null);
  assert.equal(timerAt(227), null);
});
for (const fixture of cases) test(`reject raid: ${fixture.name}`, () => {
  assert.throws(() => validateTimeline(malformed(fixture)), error => error instanceof TimelineError && /raid/.test(error.message));
});
