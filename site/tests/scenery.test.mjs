import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRoomLayout, tableLifecycle, tableScenery } from "../model.mjs";

const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
test("porters and staged furniture reconstruct at any selected time without changing records", () => {
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
      assert.ok(Number.isFinite(direct.staff.x) && Number.isFinite(direct.staff.y));
      const reduced = at(slot, true);
      assert.equal(reduced.staff, null);
      assert.equal(reduced.furniture, direct.furniture);
      assert.deepEqual(reduced.chairs, direct.chairs);
    }
  }
  assert.equal(at(prepareAt).furniture, false);
  assert.equal(at(prepareAt + .4 * (readyAt - prepareAt)).furniture, true);
  assert.equal(at(readyAt).staff, null);
  assert.equal(at(readyAt).map, 1);
  assert.equal(at(inactiveAt).staff, null);
  assert.equal(at(inactiveAt).furniture, false);
  assert.deepEqual(data, before);
});

test("compressed windows and boundary tables have finite scenery with no staff outside phases", () => {
  const data = structuredClone(sample);
  data.event.slot_minutes = 1;
  data.tables = [{ ...data.tables[0], start: 0, end: data.event.slots }];
  const layout = createRoomLayout(data.tables, data.room_layout);
  for (const slot of [0, 1, data.event.slots]) {
    const scene = tableScenery(data, data.tables[0], slot, layout, 0);
    assert.equal(scene.staff, null);
    assert.ok(Number.isFinite(scene.map));
  }
});
