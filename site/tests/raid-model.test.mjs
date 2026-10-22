import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateTimeline, resolveLocation } from "../model.mjs";
import { raidStateAt, raidRoomLayout, raidBossState, defaultRaidScene, raidHallCountdown, raidTableLabel, createRaidStateMemo, RAID_WORLD, RAID_BOSS_RECT, RAID_RESERVE_RECT } from "../raid-model.mjs";

import { stationsAt } from "../raid-3d-pose.mjs";

const raw = JSON.parse(await readFile(new URL("../data/timeline.raid.sample.json", import.meta.url), "utf8"));
const variant = edit => { const input = structuredClone(raw); edit?.(input); return validateTimeline(input); };
const row = (state, table) => state.leaderboard.find(row => row.table === table);
const leg = (state, id) => state.legs.find(leg => leg.id === id);
const insert = (input, ...entries) => { input.raid.log.push(...entries); input.raid.log.sort((a, b) => a.at - b.at); };

// Independent expectations from the eligible history, including all equal-time entries.
function expectHistory(timeline, time) {
  const raid = timeline.raid, entries = raid.log.filter(entry => entry.at <= time);
  const state = raidStateAt(timeline, time), latest = (kind, predicate = () => true) => entries.findLast(entry => entry.kind === kind && predicate(entry));
  const opening = latest("open"), ending = latest("end");
  assert.equal(state.status, time < raid.window.start ? "upcoming" : ending || time >= raid.window.end ? "ended" : "live");
  assert.equal(state.phase, latest("phase")?.phase ?? (opening ? 1 : null));
  assert.equal(state.result, ending?.result ?? (time >= raid.window.end ? "unfinished" : null));
  const members = new Map(opening?.members.map(member => [member.table, member.leg]));
  for (const entry of entries) {
    if (entry.kind === "move") members.set(entry.table, entry.to);
    if (entry.kind === "member") { if (entry.change === "add") members.set(entry.table, entry.leg); else members.delete(entry.table); }
  }
  assert.deepEqual(state.members.map(({ table, leg }) => [table, leg]), [...members]);
  assert.deepEqual(state.reserves, [...members].filter(([, leg]) => leg === null).map(([table]) => table));
  for (const definition of raid.legs) {
    const actual = leg(state, definition.id);
    const reports = entries.filter(entry => entry.leg === definition.id);
    const hp = reports.findLast(entry => ["leg_hp", "leg_max", "leg_revived", "leg_destroyed"].includes(entry.kind));
    const max = reports.findLast(entry => entry.kind === "leg_max")?.max ?? opening?.legs.find(leg => leg.leg === definition.id).max ?? null;
    assert.equal(actual.max, max);
    assert.equal(actual.hp, hp ? hp.kind === "leg_destroyed" ? 0 : hp.hp : opening?.legs.find(leg => leg.leg === definition.id).max ?? null);
    const destroyed = reports.findLast(entry => ["leg_destroyed", "leg_revived"].includes(entry.kind));
    assert.equal(actual.destroyed, destroyed?.kind === "leg_destroyed");
    assert.equal(actual.destroyedAt, destroyed?.kind === "leg_destroyed" ? destroyed.at : null);
    assert.equal(actual.table, [...members].find(([, leg]) => leg === definition.id)?.[0] ?? null);
  }
  for (const item of state.checklist) {
    const check = latest("check", entry => entry.item === item.id);
    assert.equal(item.done, !!check && !check.undo);
    assert.equal(item.table, check && !check.undo ? check.table : null);
  }
  const max = latest("king_max"), hp = entries.findLast(entry => ["king_max", "king_hp"].includes(entry.kind));
  assert.deepEqual(state.king, max ? { max: max.max, hp: hp.hp } : null);
  assert.equal(state.active, latest("active")?.table ?? null);
}

test("raid sample validates and every log boundary folds in insertion order", () => {
  const timeline = variant();
  for (const entry of timeline.raid.log) {
    assert.ok(raidStateAt(timeline, entry.at));
    expectHistory(timeline, entry.at - 1e-8);
    expectHistory(timeline, entry.at);
  }
  expectHistory(timeline, 0); expectHistory(timeline, 48);
  assert.deepEqual(raidStateAt(timeline, 48), raidStateAt(timeline, 100));
  assert.equal(raidStateAt(timeline, 42.75).members.some(member => member.table === "t10"), false);
  assert.equal(raidStateAt(timeline, 42.78).members.some(member => member.table === "t10"), true);
  assert.equal(raidStateAt(timeline, 42.81).members.some(member => member.table === "t10"), false);
});

test("window close without end freezes an unfinished result and honors logged window edits", () => {
  const timeline = variant(input => {
    input.raid.log = input.raid.log.filter(entry => entry.at < 47.55);
    insert(input, { at: 46.9, kind: "admin", admin: true, action: "window", window: { start: 40, end: 47 } });
  });
  assert.equal(raidStateAt(timeline, 46.99).status, "live");
  const final = raidStateAt(timeline, 47);
  assert.equal(final.status, "ended"); assert.equal(final.result, "unfinished");
  assert.equal(final.king.hp, 450); assert.equal(final.timer, null);
  assert.deepEqual(final, raidStateAt(timeline, 48));
  assert.equal(defaultRaidScene(final, 47), "hall");
  const natural = variant(input => { input.raid.log = input.raid.log.filter(entry => entry.at < 47.55); });
  assert.equal(raidStateAt(natural, 48).result, "unfinished");
});

test("countdown uses selected fractional time, pause, stop and zero clamp", () => {
  const timeline = variant();
  const a = raidStateAt(timeline, 40.01).timer.seconds;
  assert.ok(Math.abs(a - raidStateAt(timeline, 40.01 + 1 / 1800).timer.seconds - 1) < 1e-8);
  assert.equal(raidStateAt(timeline, 40.21).timer.pushesLeftSeconds, 120);
  assert.equal(raidStateAt(timeline, 43.45).timer.seconds, 180);
  assert.equal(raidStateAt(timeline, 43.45).timer.paused, true);
  assert.equal(raidStateAt(timeline, 42).timer, null);
  const stoppedLog = variant(input => { input.raid.log = input.raid.log.filter(entry => entry.at <= 40); input.raid.members = structuredClone(input.raid.log[0].members); });
  assert.equal(raidStateAt(stoppedLog, 41).timer.seconds, 0);
  const late = variant(input => { input.raid.log.findLast(entry => entry.kind === "timer" && entry.timer).next = 48.1; });
  assert.ok(raidStateAt(late, 47.54).timer.seconds > 0);
});

test("leaderboard counts positive drops, healing, destruction, rooms and reserves", () => {
  const timeline = variant();
  assert.equal(row(raidStateAt(timeline, 40.27), "t2").legDamage, 60);
  assert.equal(row(raidStateAt(timeline, 40.37), "t2").legDamage, 60);
  const final = raidStateAt(timeline, 48);
  assert.deepEqual(final.leaderboard.slice(0, 3).map(row => [row.table, row.legs, row.legDamage]), [["t1", 1, 300], ["t2", 1, 290], ["t3", 1, 270]]);
  assert.equal(row(final, "t3").coinsSpent, 1);
  assert.equal(row(final, "t9").kingDamage, 1400);
  assert.equal(row(final, "t5").kingDamage, 512);
  assert.equal(row(final, "t8").rooms, 0); assert.equal(row(final, "t7").rooms, 1);
  const zero = final.leaderboard.filter(row => row.legs === 0 && row.legDamage + row.kingDamage === 0);
  assert.deepEqual(zero.map(row => row.name), zero.map(row => row.name).sort((a, b) => a.localeCompare(b)));
  assert.ok(row(raidStateAt(timeline, 40), "t9"));
  assert.deepEqual(final.leaderboard, raidStateAt(timeline, 47.55).leaderboard);
});

test("revive removes the latest destruction credit and resets its time without removing damage", () => {
  const timeline = variant(input => insert(input,
    { at: 41.2, kind: "leg_revived", admin: true, leg: "L1", hp: 100 },
    { at: 41.21, kind: "leg_hp", admin: false, leg: "L1", table: "t4", hp: 0 },
    { at: 41.21, kind: "leg_destroyed", admin: false, leg: "L1", table: "t4" },
    { at: 41.22, kind: "leg_revived", admin: true, leg: "L1", hp: 70 }));
  const revived = raidStateAt(timeline, 41.2);
  assert.equal(row(revived, "t1").legs, 0); assert.equal(row(revived, "t1").legDamage, 300);
  assert.equal(leg(revived, "L1").hp, 100); assert.equal(leg(revived, "L1").destroyedAt, null);
  assert.equal(row(raidStateAt(timeline, 41.21), "t4").legs, 1);
  assert.equal(row(raidStateAt(timeline, 41.22), "t4").legs, 0);
  assert.equal(row(raidStateAt(timeline, 41.22), "t4").legDamage, 100);
  assert.equal(raidBossState(revived, timeline, 41.2).legs[0].destroyedAt, null);
});

test("King damage requires active party, excludes admin and Valve, coins use push minutes", () => {
  const timeline = variant(input => insert(input,
    { at: 43.1, kind: "king_hp", admin: false, table: "t4", hp: 2200 },
    { at: 43.15, kind: "king_hp", admin: false, table: "t5", hp: 2250 },
    { at: 43.2, kind: "king_hp", admin: true, table: "t5", hp: 2100 },
    { at: 43.25, kind: "push", admin: false, table: "t9", minutes: 2 }));
  const state = raidStateAt(timeline, 43.47);
  assert.equal(row(state, "t4").kingDamage, 0);
  assert.equal(row(state, "t5").kingDamage, 100);
  assert.equal(row(state, "t9").coinsSpent, 2);
  assert.deepEqual(state.king, { max: 1912, hp: 1662 });
});

test("max overrides establish the next damage baseline without awarding damage", () => {
  const timeline = variant(input => insert(input,
    { at: 40.4, kind: "leg_max", admin: true, leg: "L1", max: 400, hp: 350 }));
  assert.equal(row(raidStateAt(timeline, 40.4), "t1").legDamage, 0);
  assert.equal(row(raidStateAt(timeline, 40.5), "t1").legDamage, 260);
});

test("state and layout are pure under forward, backward and shuffled seeks and returned mutation", () => {
  const timeline = variant();
  const times = [...new Set([0, 39, 40, ...timeline.raid.log.map(entry => entry.at), 48])];
  const expected = times.map(t => ({ state: raidStateAt(timeline, t), layout: raidRoomLayout(raidStateAt(timeline, t), timeline, t) }));
  for (const order of [[...times].reverse(), [...times].sort((a, b) => Math.sin(a * 51) - Math.sin(b * 51))]) {
    for (const t of order) { const index = times.indexOf(t); assert.deepEqual(raidStateAt(timeline, t), expected[index].state); assert.deepEqual(raidRoomLayout(raidStateAt(timeline, t), timeline, t), expected[index].layout); }
  }
  const changed = raidStateAt(timeline, 41); changed.legs[0].hp = 999; changed.leaderboard[0].legs = 999;
  assert.deepEqual(raidStateAt(timeline, 41), raidStateAt(variant(), 41));
});

test("late and early tables use their own windows and only seated people join, hidden names stay private", () => {
  const timeline = variant(input => {
    const late = input.tables.find(table => table.id === "t1"), early = input.tables.find(table => table.id === "t2");
    late.start = 42; early.end = 44;
    for (const signup of late.signups) signup.planned[0] = 42;
    for (const signup of early.signups) signup.planned[1] = 44;
    Object.assign(input.people.find(person => person.id === late.signups[0].person), { hidden: true, name: null, variant: null, appearance: null });
  });
  const layout = t => raidRoomLayout(raidStateAt(timeline, t), timeline, t);
  assert.equal(layout(41).people.some(person => person.table === "t1"), false);
  assert.equal(raidStateAt(timeline, 41).members.find(member => member.table === "t1").running, false);
  assert.ok(layout(42.1).people.some(person => person.table === "t1"));
  assert.equal(layout(44).people.some(person => person.table === "t2"), false);
  const hidden = layout(42.1).people.find(person => person.hidden);
  assert.equal(hidden.name, null);
  const nonmember = timeline.people.find(person => person.id === "u_dm10");
  assert.equal(resolveLocation(timeline, nonmember, 41).kind, "table");
  assert.equal(layout(41).people.some(person => person.id === nonmember.id), false);
  const meal = variant(input => { input.events.push({ id: "raid-break", kind: "break", at: 40, duration: 1, text: null, person: null, by: "u_dm1" }); });
  assert.equal(raidRoomLayout(raidStateAt(meal, 40.5), meal, 40.5).people.length, 0);
});

test("phase layouts use projected arenas, reserve below, active party nearest the King", () => {
  const timeline = variant();
  const siege = raidRoomLayout(raidStateAt(timeline, 40), timeline, 40);
  for (const group of siege.groups) {
    if (group.leg) assert.deepEqual([group.x, group.y], siege.stations.legs[group.leg].arena);
    else assert.ok(group.y >= siege.reserve.y);
  }
  const hollow = raidRoomLayout(raidStateAt(timeline, 42), timeline, 42);
  assert.ok(hollow.groups.every(group => group.y >= hollow.reserve.y));
  const heart = raidRoomLayout(raidStateAt(timeline, 43.1), timeline, 43.1);
  const distance = group => Math.hypot(group.x - (heart.boss.x + heart.boss.w / 2), group.y - (heart.boss.y + heart.boss.h));
  assert.equal([...heart.groups].sort((a, b) => distance(a) - distance(b))[0].table, "t5");
  assert.equal(heart.boss.w / heart.boss.h, 16 / 9);
});

test("hall labels follow assignments, opening roster and the one-hour countdown", () => {
  const timeline = variant();
  assert.equal(raidHallCountdown(timeline, 37.99), null);
  assert.equal(raidHallCountdown(timeline, 38), "Spider-Mech raid in 60:00");
  assert.equal(raidHallCountdown(timeline, 39), "Spider-Mech raid in 30:00");
  assert.equal(raidHallCountdown(timeline, 40), null);
  assert.equal(raidTableLabel(timeline, raidStateAt(timeline, 39), "t6"), "Spider-Mech raid · Leg R2");
  assert.equal(raidTableLabel(timeline, raidStateAt(timeline, 39), "t9"), "Spider-Mech raid · Reserve");
  assert.equal(raidTableLabel(timeline, raidStateAt(timeline, 42.75), "t10"), "");
  assert.equal(raidTableLabel(timeline, raidStateAt(timeline, 40.8), "t9"), "Spider-Mech raid · Leg L4");
});

test("scene holds a logged result for exactly one slot and schema-7 has no raid", async () => {
  const timeline = variant();
  for (const [t, expected] of [[39, "hall"], [40, "raid"], [47.55, "raid"], [48.549, "raid"], [48.55, "hall"]]) assert.equal(defaultRaidScene(raidStateAt(timeline, t), t), expected);
  const old = validateTimeline(JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8")));
  assert.equal(raidStateAt(old, 40), null); assert.equal(defaultRaidScene(null, 40), "hall");
});


test("phase-1 people spread evenly in stable person order on projected rings, with plates outside", () => {
  const timeline = variant(), t = 40.5, state = raidStateAt(timeline, t);
  const layout = raidRoomLayout(state, timeline, t, { theta: 0 });
  const stations = stationsAt(raidBossState(state, timeline, t), layout.boss, { theta: 0 });
  assert.deepEqual(layout.stations, stations);
  for (const group of layout.groups.filter(group => group.leg)) {
    const { arena: [x, y], ring: [rx, ry] } = stations.legs[group.leg];
    assert.deepEqual([group.x, group.y], [x, y]);
    const party = layout.people.filter(person => person.table === group.table);
    assert.ok(party.length > 0);
    assert.deepEqual(party.map(person => person.id), party.map(person => person.id).sort());
    party.forEach((person, i) => {
      const angle = -Math.PI / 2 + i * 2 * Math.PI / party.length;
      assert.ok(((person.x - x) / rx) ** 2 + ((person.y - y) / ry) ** 2 <= 1 + 1e-9);
      assert.ok(Math.abs(person.x - x - rx * Math.cos(angle)) < 1e-9);
      assert.ok(Math.abs(person.y - y - ry * Math.sin(angle)) < 1e-9);
    });
    assert.ok(group.label.x + group.label.w / 2 < x - rx || group.label.x - group.label.w / 2 > x + rx);
  }
  const moved = raidRoomLayout(raidStateAt(timeline, 40.8), timeline, 40.8, { theta: 0 });
  assert.equal(moved.arenas.find(arena => arena.id === "L1").destroyed, true);
  assert.equal(moved.groups.find(group => group.table === "t9").leg, "L4");
  assert.deepEqual([moved.groups.find(group => group.table === "t9").x, moved.groups.find(group => group.table === "t9").y], moved.stations.legs.L4.arena);
});

test("carousel follows selected event time, freezes front for reduced motion or theta zero, and is pure", () => {
  const timeline = variant();
  const layout = (t, options) => raidRoomLayout(raidStateAt(timeline, t), timeline, t, options);
  const a = 40 + 30 / 1800, b = 40 + 60 / 1800;
  assert.notDeepEqual(layout(a).stations.legs, layout(b).stations.legs);
  assert.deepEqual(layout(a, { reducedMotion: true }).stations, layout(a, { theta: 0 }).stations);
  assert.deepEqual(layout(a, { reducedMotion: true, theta: 75 }).stations, layout(a, { theta: 0 }).stations);
  assert.deepEqual(layout(b, { reducedMotion: true }).stations, layout(a, { theta: 0 }).stations);
  assert.deepEqual(layout(b, { theta: 0 }).stations, layout(a, { theta: 0 }).stations);
  const expected = layout(a); layout(b); assert.deepEqual(layout(a), expected);
});

test("72 carousel angles keep every ring and full plate inside the world and clear of reserves", () => {
  const timeline = variant(), t = 40.5, state = raidStateAt(timeline, t);
  const inside = ({ x, y, w, h }, theta) => {
    assert.ok(x >= RAID_WORLD.x && y >= RAID_WORLD.y && x + w <= RAID_WORLD.w && y + h <= RAID_WORLD.h, `world at ${theta}`);
    assert.ok(x + w <= RAID_RESERVE_RECT.x || x >= RAID_RESERVE_RECT.x + RAID_RESERVE_RECT.w || y + h <= RAID_RESERVE_RECT.y || y >= RAID_RESERVE_RECT.y + RAID_RESERVE_RECT.h, `reserves at ${theta}`);
  };
  for (let theta = 0; theta < 360; theta += 5) {
    const layout = raidRoomLayout(state, timeline, t, { theta });
    assert.equal(layout.arenas.length, 8);
    assert.equal(layout.boss.w / layout.boss.h, 16 / 9);
    for (const { arena: [x, y], ring: [rx, ry] } of layout.arenas) inside({ x: x - rx, y: y - ry, w: 2 * rx, h: 2 * ry }, theta);
    // Include plates even for currently unoccupied/destroyed legs.
    for (const { label } of layout.arenas) inside({ x: label.x - label.w / 2, y: label.y - label.h / 2, w: label.w, h: label.h }, theta);
    for (const { label, leg } of layout.groups.filter(group => group.leg)) inside({ x: label.x - label.w / 2, y: label.y - label.h / 2, w: label.w, h: label.h }, `${theta} ${leg}`);
    assert.deepEqual(layout.boss, RAID_BOSS_RECT);
  }
});

test("special leg action banners use names while standard legs use only ids", () => {
  const timeline = variant();
  assert.equal(raidStateAt(timeline, 40.5).lastAction.text, "Table 1: Dawn finale reported the Venom Injector (L1) at 90 HP");
  assert.equal(raidStateAt(timeline, 40.6).lastAction.text, "Table 1: Dawn finale destroyed the Venom Injector (L1)");
  assert.equal(raidStateAt(timeline, 40.64).lastAction.text, "Table 1: Dawn finale moved to the Armored Strut (L4)");
  assert.equal(raidStateAt(timeline, 40.27).lastAction.text, "Table 2: Dawn finale reported L2 at 210 HP");
  assert.equal(raidStateAt(timeline, 41.07).lastAction.text, "Table 2: Dawn finale destroyed L2");
});

test("state memo shares a fold by timeline identity and selected slot, including backward seeks", () => {
  const timeline = variant(); let calls = 0;
  const memo = createRaidStateMemo((...args) => { calls++; return raidStateAt(...args); });
  assert.equal(memo(timeline, 40.5), memo(timeline, 40.5)); assert.equal(calls, 1);
  memo(timeline, 40.6); assert.equal(calls, 2);
  memo(timeline, 40.5); assert.equal(calls, 3);
  memo(variant(), 40.5); assert.equal(calls, 4); assert.equal(memo.folds, 4);
});
