import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shieldCells, weaponCells } from "./raid-gear-cells.mjs";

const sample = JSON.parse(await readFile(new URL("../data/timeline.raid.sample.json", import.meta.url), "utf8"));
const person = id => ({ id, hidden: false, variant: 5 });

test("raid gear follows the same id across calls, reloads and table or appearance changes", async () => {
  const { raidGear } = await import("../raid-gear.mjs");
  const reloaded = await import("../raid-gear.mjs?reload-test");
  for (const member of sample.people) {
    const original = structuredClone(member), gear = raidGear(member);
    assert.ok(gear?.weapon);
    assert.deepEqual(raidGear(member), gear);
    assert.deepEqual(reloaded.raidGear({ ...member, table: "another-table", variant: 12345 }), gear);
    assert.deepEqual(member, original, "selection does not mutate the person");
    gear.weapon[0] = -1;
    if (gear.shield) gear.shield[0] = -1;
    assert.deepEqual(raidGear(member), reloaded.raidGear(member), "returned cells do not share mutable state");
  }
});

test("raid gear uses only the exact non-empty weapon and shield atlas cells", async () => {
  const { raidGear } = await import("../raid-gear.mjs");
  const weapons = new Set(weaponCells.map(String)), shields = new Set(shieldCells.map(String));
  assert.equal(weapons.size, 110); assert.equal(shields.size, 60);
  for (const member of [...sample.people, ...Array.from({ length: 4096 }, (_, i) => person(`atlas-${i}`))]) {
    const gear = raidGear(member);
    assert.ok(weapons.has(String(gear.weapon)), `weapon ${gear.weapon}`);
    assert.ok(gear.shield === null || shields.has(String(gear.shield)), `shield ${gear.shield}`);
  }
});

test("the 50-person raid sample has varied weapons and between 25 and 75 percent shields", async () => {
  const { raidGear } = await import("../raid-gear.mjs");
  const gear = sample.people.map(raidGear);
  assert.equal(gear.length, 50);
  assert.ok(new Set(gear.map(item => item.weapon[0])).size >= 4);
  const shielded = gear.filter(item => item.shield !== null).length;
  assert.ok(shielded >= 50 * .25 && shielded <= 50 * .75, `${shielded}/50 shielded`);
});

test("raid bows in columns 52 and 53 never carry a shield", async () => {
  const { raidGear } = await import("../raid-gear.mjs");
  const bows = new Set();
  for (let i = 0; i < 4096; i++) {
    const gear = raidGear(person(`bow-${i}`));
    if (gear.weapon[0] >= 52) {
      bows.add(gear.weapon[0]);
      assert.equal(gear.shield, null);
    }
  }
  assert.deepEqual([...bows].sort(), [52, 53]);
});

test("hidden people and every hidden silhouette receive no raid gear", async () => {
  const { raidGear } = await import("../raid-gear.mjs");
  for (const member of [null, undefined, { ...person("private"), hidden: true },
    { ...person("silhouette"), variant: null },
    { ...person("private-appearance"), hidden: true, appearance: { skin: 0, shirt: 0, hair: 0, hat: 0 } }]) {
    assert.equal(raidGear(member), null);
  }
});
