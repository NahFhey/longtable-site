import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRoomLayout, tableLifecycle, tableScenery } from "../model.mjs";

const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
test("crew and staged furniture reconstruct at any selected time without changing records", () => {
  const data = structuredClone(sample);
  data.tables = [{ ...data.tables[0], start: 2, end: 4, pad: 11 }];
  const before = structuredClone(data);
  const table = data.tables[0], layout = createRoomLayout(data.tables, data.room_layout);
  const { prepareAt, readyAt, inactiveAt } = tableLifecycle(data, table, 0);
  const at = (slot, reduced = false) => tableScenery(data, table, slot, layout, 0, reduced);
  for (const [start, end] of [[prepareAt, readyAt], [table.end, inactiveAt]]) {
    for (const fraction of [0, .1, .3, .5, .8, .95]) {
      const slot = start + (end - start) * fraction;
      const direct = at(slot);
      at(end); at(0); // Seeking elsewhere must not affect the result.
      assert.deepEqual(at(slot), direct);
      assert.ok(!("staff" in direct));
      for (const member of direct.crew) {
        assert.ok(Number.isFinite(member.x) && Number.isFinite(member.y));
        assert.ok([0, 1, 2].includes(member.member));
      }
      const reduced = at(slot, true);
      assert.deepEqual(reduced.crew, []);
      assert.ok([0, 1].includes(reduced.rug));
      assert.ok([0, 1].includes(reduced.map));
      assert.equal(reduced.furniture, direct.furniture);
      assert.deepEqual(reduced.chairs, direct.chairs);
    }
  }
  assert.equal(at(prepareAt).furniture, false);
  assert.equal(at(prepareAt + .4 * (readyAt - prepareAt)).furniture, true);
  for (const [slot, rug] of [[0, 0], [readyAt, 1], [table.start, 1], [inactiveAt, 0]]) {
    assert.deepEqual(at(slot).crew, []);
    assert.equal(at(slot).rug, rug);
  }
  assert.equal(at(readyAt).map, 1);
  assert.deepEqual(at(inactiveAt).crew, []);
  assert.equal(at(inactiveAt).furniture, false);
  assert.deepEqual(data, before);
});

test("compressed windows and boundary tables have finite scenery with no crew outside phases", () => {
  const data = structuredClone(sample);
  data.event.slot_minutes = 1;
  data.tables = [{ ...data.tables[0], start: 0, end: data.event.slots }];
  const layout = createRoomLayout(data.tables, data.room_layout);
  for (const slot of [0, 1, data.event.slots]) {
    const scene = tableScenery(data, data.tables[0], slot, layout, 0);
    assert.deepEqual(scene.crew, []);
    assert.ok([0, 1].includes(scene.rug));
    assert.ok(Number.isFinite(scene.map));
  }
});

function sceneryFixture() {
  const data = structuredClone(sample);
  data.event.slot_minutes = 30;
  data.tables = [{ ...data.tables[0], start: 2, end: 4, pad: 11 }];
  const table = data.tables[0], layout = createRoomLayout(data.tables, data.room_layout);
  const { prepareAt, readyAt, inactiveAt } = tableLifecycle(data, table, 0);
  const at = (slot, reduced = false) => tableScenery(data, table, slot, layout, 0, reduced);
  return { data, table, layout, inactiveAt, at,
    preparing: (p, reduced) => at(prepareAt + p * (readyAt - prepareAt), reduced),
    cleaning: (q, reduced) => at(table.end + q * (inactiveAt - table.end), reduced) };
}

test("preparation unrolls the rug before placing any furniture", () => {
  const { preparing } = sceneryFixture();
  const scenes = Array.from({ length: 101 }, (_, i) => preparing(i / 100));
  for (const scene of scenes) if (scene.furniture) assert.equal(scene.rug, 1);
  assert.equal(scenes[0].rug, 0);
  assert.ok(scenes.findIndex(scene => scene.rug > 0) < scenes.findIndex(scene => scene.furniture));
  assert.equal(preparing(.32).furniture, false);
  assert.equal(preparing(.36).furniture, true);
  assert.ok(Math.abs(preparing(.25).rug - .5) < 1e-12);
});

test("cleanup removes furniture before rolling the rug back up", () => {
  const { cleaning, data, table, inactiveAt, at } = sceneryFixture();
  const scenes = Array.from({ length: 101 }, (_, i) => cleaning(i / 100));
  for (const scene of scenes) if (scene.furniture) assert.equal(scene.rug, 1);
  assert.ok(scenes.findLastIndex(scene => scene.furniture) < scenes.findIndex(scene => scene.rug < 1));
  assert.equal(cleaning(.64).furniture, true);
  assert.equal(cleaning(.66).furniture, false);
  assert.ok(Math.abs(cleaning(.75).rug - .5) < 1e-12);
  assert.equal(cleaning(1 - 1e-9).rug, 0);
  assert.equal(tableLifecycle(data, table, inactiveAt).phase, "inactive");
  assert.equal(at(inactiveAt).rug, 0);
});

test("three crew members share the work with distinct loads and presence windows", () => {
  const { preparing, cleaning } = sceneryFixture();
  for (const phase of [preparing, cleaning]) {
    const loads = [new Set(), new Set(), new Set()];
    let largestCrew = 0;
    for (let i = 0; i < 100; i += 1) {
      const scene = phase(i / 100);
      largestCrew = Math.max(largestCrew, scene.crew.length);
      assert.equal(new Set(scene.crew.map(person => person.member)).size, scene.crew.length);
      for (const person of scene.crew) if (person.load) loads[person.member].add(person.load);
      assert.deepEqual(phase(i / 100), scene);
      assert.ok(scene.crew.every(person => Number.isFinite(person.x) && Number.isFinite(person.y)));
      const reduced = phase(i / 100, true);
      assert.deepEqual(reduced.crew, []);
      assert.equal(reduced.rug, scene.rug > 0 ? 1 : 0);
      assert.equal(reduced.map, scene.map > 0 ? 1 : 0);
    }
    assert.equal(largestCrew, 3);
    assert.deepEqual([...loads[0]].sort(), ["chairs", "map", "rug"]);
    assert.deepEqual([...loads[1]].sort(), ["chairs", "rug"]);
    assert.deepEqual([...loads[2]], ["table"]);
  }
  const loadsAt = scene => scene.crew.map(({ member, load }) => [member, load]);
  for (const [p, expected] of [
    [.05, [[0, "rug"], [1, "rug"]]],
    [.15, [[0, "rug"], [1, "rug"], [2, "table"]]],
    [.25, [[0, null], [1, null], [2, "table"]]],
    [.4, [[0, "chairs"], [1, "chairs"], [2, null]]],
    [.61, [[0, "chairs"], [1, "chairs"]]],
    [.8, [[0, "map"], [1, null]]],
    [.95, [[0, null], [1, null]]],
  ]) assert.deepEqual(loadsAt(preparing(p)), expected);
  for (const [q, expected] of [
    [.05, [[0, null], [1, null], [2, null]]],
    [.2, [[0, "map"], [1, null], [2, null]]],
    [.4, [[0, "chairs"], [1, "chairs"], [2, null]]],
    [.7, [[0, null], [1, null], [2, "table"]]],
    [.85, [[0, "rug"], [1, "rug"], [2, "table"]]],
    [.95, [[0, "rug"], [1, "rug"]]],
  ]) assert.deepEqual(loadsAt(cleaning(q)), expected);
});

test("crew lag leaves space between members on the last route leg", () => {
  const { preparing, layout } = sceneryFixture();
  const [a, b] = preparing(.5).crew;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= .7);
  const cell = layout.cells[0];
  assert.equal(a.x, cell.x + .3);
  assert.equal(b.x, a.x);
  assert.ok(Math.abs(a.y - (cell.y + 3.5)) < 1e-12);
  assert.ok(Math.abs(a.y - b.y - .8) < 1e-12);
});
