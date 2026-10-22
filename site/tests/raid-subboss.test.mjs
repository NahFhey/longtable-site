import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateTimeline } from "../model.mjs";
import { raidStateAt, raidRoomLayout, RAID_WORLD, RAID_BOSS_RECT, RAID_RESERVE_RECT } from "../raid-model.mjs";
import { raidSubBosses, raidSubBossSprite, RAID_SUBBOSS_SIZE, RAID_SUBBOSS_PALETTE } from "../raid-subboss.mjs";

const raw = JSON.parse(await readFile(new URL("../data/timeline.raid.sample.json", import.meta.url), "utf8"));
const timeline = validateTimeline(raw);
const ids = raw.raid.checklist.filter(item => item.kind === "boss").map(item => item.id);
const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

test("sub-bosses appear only in Phases 2 and 3, in checklist order through the shared layout", () => {
  assert.deepEqual(raidSubBosses(null, timeline), []);
  assert.deepEqual(raidSubBosses(raidStateAt(timeline, 40.5), timeline), []);
  for (const slot of [42.5, 43.5]) {
    const state = raidStateAt(timeline, slot), bosses = raidSubBosses(state, timeline);
    assert.deepEqual(bosses.map(boss => boss.id), ids);
    assert.deepEqual(bosses.map(boss => boss.name), raw.raid.checklist.filter(item => item.kind === "boss").map(item => item.name));
    assert.deepEqual(raidRoomLayout(state, timeline, slot).subBosses, bosses);
  }
});

test("sub-boss defeat and table credit follow selected-time checks and undo without moving", () => {
  const input = structuredClone(raw);
  input.raid.log.push({ at: 43.6, kind: "check", admin: true, item: "prototype_prime", table: null, undo: true });
  input.raid.log.sort((a, b) => a.at - b.at);
  const edited = validateTimeline(input);
  const check = edited.raid.log.find(entry => entry.kind === "check" && entry.item === "prototype_prime");
  const positions = [];
  for (const slot of [43.6, 42.5, check.at, 43.5, check.at - 1e-8]) {
    const before = structuredClone(raidStateAt(edited, slot)), state = structuredClone(before);
    const bosses = raidSubBosses(state, edited);
    assert.deepEqual(state, before, "placement does not mutate the fold");
    for (const boss of bosses) {
      const entry = edited.raid.log.findLast(entry => entry.at <= slot && entry.kind === "check" && entry.item === boss.id);
      const defeated = !!entry && !entry.undo;
      assert.equal(boss.defeated, defeated);
      assert.equal(boss.table, defeated ? entry.table : null);
      if (defeated) assert.equal(boss.tableName, edited.tables.find(table => table.id === entry.table).name);
    }
    positions.push(bosses.map(({ id, x, y, label }) => ({ id, x, y, label })));
  }
  for (const position of positions) assert.deepEqual(position, positions[0]);
});

test("zero to eight sub-bosses and credit plates fit the band clear of each other, party and group plates", () => {
  for (let count = 0; count <= 8; count++) {
    const input = structuredClone(raw), original = new Set(ids);
    input.raid.checklist = input.raid.checklist.filter(item => item.kind !== "boss");
    input.raid.checklist.push(...Array.from({ length: count }, (_, i) => ({ id: `test_boss_${i}`, name: `Boss ${i}`, kind: "boss" })));
    input.raid.log = input.raid.log.filter(entry => entry.kind !== "check" || !original.has(entry.item));
    const edited = validateTimeline(input);
    for (const slot of [42.5, 43.5]) {
      const layout = raidRoomLayout(raidStateAt(edited, slot), edited, slot);
      assert.equal(layout.subBosses.length, count);
      const occupied = layout.subBosses.map(boss => ({ x: boss.x, y: boss.y, w: RAID_SUBBOSS_SIZE, h: RAID_SUBBOSS_SIZE }));
      for (const [i, boss] of layout.subBosses.entries()) {
        const rect = occupied[i];
        for (const bounds of [rect, boss.label]) {
          assert.ok(bounds.x - bounds.w / 2 >= RAID_WORLD.x && bounds.x + bounds.w / 2 <= RAID_WORLD.x + RAID_WORLD.w);
          assert.ok(bounds.y - bounds.h / 2 > RAID_BOSS_RECT.y + RAID_BOSS_RECT.h);
          assert.ok(bounds.y + bounds.h / 2 < RAID_RESERVE_RECT.y);
          assert.ok(Math.hypot(bounds.x - 32, bounds.y - 27) >= 4);
          for (const group of layout.groups) assert.equal(overlaps(bounds, group.label), false, `${count}: ${boss.id} / ${group.table}`);
          for (const person of layout.people.filter(person => person.table === layout.groups.find(group => group.x === 32 && group.y === 27)?.table)) {
            assert.equal(overlaps(bounds, { ...person, w: 1, h: 1 }), false, "active party sprite");
          }
        }
        // Even the nearest point of a sprite must clear the four-tile exclusion circle.
        assert.ok(Math.hypot(Math.max(0, Math.abs(boss.x - 32) - rect.w / 2), Math.max(0, Math.abs(boss.y - 27) - rect.h / 2)) >= 4);
        for (let j = i + 1; j < occupied.length; j++) {
          assert.equal(overlaps(rect, occupied[j]), false);
          assert.equal(overlaps(boss.label, layout.subBosses[j].label), false);
        }
      }
    }
  }
});

test("the four named sprite grids are distinct from each other and the generic spider", () => {
  const grids = [...ids, "unknown"].map(id => raidSubBossSprite(id)[0]);
  assert.equal(new Set(grids.map(grid => grid.join("\n"))).size, 5);
  assert.deepEqual(raidSubBossSprite("another_unknown"), raidSubBossSprite("unknown"));
  assert.deepEqual(raidSubBossSprite("constructor"), raidSubBossSprite("unknown"));
  assert.deepEqual(raidSubBossSprite("__proto__"), raidSubBossSprite("unknown"));
});

test("all idle and collapsed grids use rectangular pixels and the bounded raid palette", () => {
  const existing = new Set(["#dfba76", "#d9604c", "#9cdbcd", "#b1b5a8", "#f1eadb", "#55685b"]);
  assert.equal(Object.values(RAID_SUBBOSS_PALETTE).filter(color => !existing.has(color)).length, 2);
  for (const id of [...ids, "unknown"]) {
    const frames = raidSubBossSprite(id);
    assert.equal(frames.length, 3);
    assert.notDeepEqual(frames[0], frames[1], "idle legs change");
    assert.notDeepEqual(frames[0], frames[2], "defeat collapses the body");
    for (const grid of frames) {
      assert.equal(grid.length, 16);
      for (const row of grid) {
        assert.equal(row.length, 16);
        for (const pixel of row) assert.ok(pixel === "." || Object.hasOwn(RAID_SUBBOSS_PALETTE, pixel), `${id}: ${pixel}`);
      }
    }
  }
});
