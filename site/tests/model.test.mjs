import test from "node:test";
import assert from "node:assert/strict";
import { characterAppearance } from "../characters.mjs";
import {
  ANNOUNCE_MINUTES,
  SPOTLIGHT_MINUTES,
  TimelineError,
  activeEvents,
  accessibleEventText,
  chairSeatIndices,
  createSeatingPlan,
  createRoomLayout,
  createLiveState,
  crossedSpeechEvents,
  displayName,
  effectivePresence,
  effectiveSignupRange,
  inHalfOpen,
  indexAdminEvents,
  isPresent,
  modeAt,
  msToSlot,
  ordinaryLocation,
  personTooltip,
  playbackSpeed,
  reconcileLiveSnapshot,
  resolveLocation,
  seatOffset,
  seatPositionForPlan,
  slotToMs,
  speechView,
  tableGridPosition,
  tableView,
  tableLifecycle,
  validateTimeline,
  visibleVariant,
} from "../model.mjs";

const clone = (value) => structuredClone(value);

function person(id, overrides = {}) {
  return {
    id,
    name: id === "hidden-key" ? null : `Name ${id}`,
    dm: false,
    hidden: id === "hidden-key",
    variant: id === "hidden-key" ? null : 31,
    appearance: null,
    presence: { planned: [0, 8], actual: { here: null, leaving: null } },
    ...overrides,
  };
}

function timeline(schema = 2) {
  const people = [
    person("admin", { dm: true, variant: 1 }),
    person("dm", { dm: true, variant: 17 }),
    person("player"),
    person("hidden-key"),
  ];
  return {
    schema,
    ...(schema === 4 ? { room_layout: { version: 1, pad_capacity: 20, overflow_capacity: 120 } } : {}),
    phase: "live",
    generated_at: "2026-11-07T15:01:00Z",
    event: { name: "Test hall", start: "2026-11-07T10:00:00-05:00", tz: "America/New_York", slot_minutes: 30, slots: 8 },
    people,
    tables: [{
      pad: 0, id: "table-key", name: "Table One", system: "A system", pitch: "A pitch", seats: 3, walk_ins: true,
      start: 1, end: 5, dm: "dm", created_at: "2026-10-01T10:00:00-04:00",
      signups: [
        { person: "player", planned: [1, 5], actual: null },
        { person: "hidden-key", planned: [2, 4], actual: [null, null] },
      ],
    }],
    events: [],
  };
}

function event(id, kind, at, overrides = {}) {
  const duration = kind === "break" || kind === "meal" ? 1 : null;
  const text = kind === "announce" ? "Listen" : kind === "shout" ? "Huzzah" : kind === "donation" ? "For the cause" : null;
  const target = kind === "spotlight" || kind === "shout" || kind === "donation" ? "player" : null;
  return { id, kind, at, duration, text, person: target, by: "admin", ...overrides };
}

test("schema 1–4 are accepted, unknown fields are ignored, and 0/5 are rejected", () => {
  for (const schema of [1, 2, 3, 4]) {
    const input = timeline(schema);
    input.unknown_top = "ignored";
    input.event.future_field = 42;
    input.people[0].future_field = true;
    const result = validateTimeline(input);
    assert.equal(result.schema, schema);
    assert.equal("unknown_top" in result, false);
    assert.equal("future_field" in result.event, false);
    assert.equal("future_field" in result.people[0], false);
  }
  for (const schema of [0, 5]) assert.throws(() => validateTimeline({ ...timeline(), schema }), TimelineError);
});

test("custom appearances survive live reconciliation and defaults preserve old characters", () => {
  const input = timeline(3);
  const choices = { skin: 3, shirt: 14, hair: 15, hat: 2 };
  const initial = validateTimeline(input);
  assert.deepEqual(characterAppearance(initial.people[2]), { skin: 3, shirt: 7, hair: 0, hat: 0 });
  input.people[2].appearance = choices;
  input.generated_at = "2026-11-07T15:02:00Z";
  const updated = validateTimeline(input);
  assert.deepEqual(characterAppearance(updated.people[2]), choices);
  const live = reconcileLiveSnapshot(createLiveState(initial), updated);
  assert.deepEqual(characterAppearance(live.snapshot.people[2]), choices);
  assert.equal(characterAppearance({ hidden: true, variant: 1, appearance: choices }), null);
});

test("schema 3 rejects missing, malformed, or identifying hidden appearances", () => {
  const choices = { skin: 3, shirt: 14, hair: 15, hat: 2 };
  const invalid = [undefined, {}, [], { ...choices, skin: true }, { ...choices, shirt: 15 },
    { ...choices, hair: -1 }, { ...choices, hat: 4 }, { ...choices, extra: 0 }];
  for (const appearance of invalid) {
    const input = timeline(3);
    input.people[2].appearance = appearance;
    assert.throws(() => validateTimeline(input), TimelineError);
  }
  const hidden = timeline(3);
  hidden.people[3].appearance = choices;
  assert.throws(() => validateTimeline(hidden), TimelineError);
});

test("timestamp fields enforce awareness, generated-at UTC, and start's numeric offset", () => {
  const validCases = [
    ["Z generated_at and Z created_at", (input) => {
      input.generated_at = "2026-11-07T15:01:00.123Z";
      input.tables[0].created_at = "2026-10-01T14:00:00Z";
    }],
    ["numeric zero generated_at and nonzero created_at", (input) => {
      input.generated_at = "2026-11-07T15:01:00+00:00";
      input.tables[0].created_at = "2026-10-01T10:00:00-04:00";
    }],
    ["negative zero generated_at and numeric-zero start", (input) => {
      input.generated_at = "2026-11-07T15:01:00-00:00";
      input.event.start = "2026-11-07T15:00:00+00:00";
    }],
    ["valid leap day", (input) => {
      input.generated_at = "2024-02-29T15:01:00Z";
      input.tables[0].created_at = "2024-02-29T10:00:00-05:00";
    }],
  ];
  for (const [label, mutate] of validCases) {
    const input = timeline();
    mutate(input);
    assert.doesNotThrow(() => validateTimeline(input), label);
  }

  const invalidCases = [
    ["generated_at with a positive nonzero offset", (input) => { input.generated_at = "2026-11-07T15:01:00+00:01"; }],
    ["generated_at with a negative nonzero offset", (input) => { input.generated_at = "2026-11-07T10:01:00-05:00"; }],
    ["generated_at without a zone", (input) => { input.generated_at = "2026-11-07T15:01:00"; }],
    ["generated_at with an invalid date", (input) => { input.generated_at = "not-a-dateZ"; }],
    ["generated_at with an impossible day", (input) => { input.generated_at = "2026-02-31T15:01:00Z"; }],
    ["generated_at with a non-leap February 29", (input) => { input.generated_at = "2026-02-29T15:01:00Z"; }],
    ["event.start with Z", (input) => { input.event.start = "2026-11-07T15:00:00Z"; }],
    ["event.start without an offset", (input) => { input.event.start = "2026-11-07T10:00:00"; }],
    ["event.start with an impossible day", (input) => { input.event.start = "2026-02-31T10:00:00-05:00"; }],
    ["table.created_at without an offset", (input) => { input.tables[0].created_at = "2026-10-01T10:00:00"; }],
    ["table.created_at with an impossible day", (input) => { input.tables[0].created_at = "2026-04-31T10:00:00Z"; }],
  ];
  for (const [label, mutate] of invalidCases) {
    const input = timeline();
    mutate(input);
    assert.throws(() => validateTimeline(input), TimelineError, label);
  }
});

test("known malformed values and schema-1 speech fail closed", () => {
  const wrong = timeline(); wrong.people[0].dm = "yes";
  assert.throws(() => validateTimeline(wrong), TimelineError);
  const old = timeline(1); old.events.push(event("new-kind", "shout", 1));
  assert.throws(() => validateTimeline(old), TimelineError);
  const hiddenLeak = timeline(); hiddenLeak.people[3].name = "Private Name";
  assert.throws(() => validateTimeline(hiddenLeak), TimelineError);
});

test("event text limits apply only to announce, shout, and donation", () => {
  const longText = "Long meal or spotlight detail. ".repeat(20);
  const input = timeline();
  input.events = [
    event("meal", "meal", 1, { text: longText }),
    event("spotlight", "spotlight", 2, { text: longText }),
    event("announce", "announce", 3, { text: "a".repeat(280) }),
    event("shout", "shout", 4, { text: "s".repeat(80) }),
    event("donation", "donation", 5, { text: "d".repeat(80) }),
  ];
  const result = validateTimeline(input);
  assert.equal(result.events[0].text, longText);
  assert.equal(result.events[1].text, longText);

  for (const [kind, length] of [["announce", 281], ["shout", 81], ["donation", 81]]) {
    const invalid = timeline();
    invalid.events = [event(`too-long-${kind}`, kind, 1, { text: "x".repeat(length) })];
    assert.throws(() => validateTimeline(invalid), TimelineError);
  }

  const wrongPerson = timeline();
  wrongPerson.events = [event("meal-person", "meal", 1, { person: "player" })];
  assert.throws(() => validateTimeline(wrongPerson), TimelineError);
  const wrongDuration = timeline();
  wrongDuration.events = [event("spotlight-duration", "spotlight", 1, { duration: 1 })];
  assert.throws(() => validateTimeline(wrongDuration), TimelineError);
});

test("empty people, tables, and events remain a valid sensible state", () => {
  const input = timeline();
  input.people = [];
  input.tables = [];
  input.events = [];
  const result = validateTimeline(input);
  assert.deepEqual(result.people, []);
  assert.deepEqual(result.tables, []);
  assert.deepEqual(activeEvents(result, 2), { break: null, meal: null, announce: null, spotlight: null });
});

test("time conversion supports fractional slots and compressed windows", () => {
  const data = validateTimeline(timeline());
  const start = Date.parse(data.event.start);
  assert.equal(slotToMs(data, 1.5), start + 45 * 60_000);
  assert.equal(msToSlot(data, start + 7.5 * 60_000), .25);
  const compressed = timeline(); compressed.event.slot_minutes = 2; compressed.event.slots = 8;
  const validated = validateTimeline(compressed);
  assert.equal(slotToMs(validated, 8) - slotToMs(validated, 0), 16 * 60_000);
});

test("half-open ranges exclude their end", () => {
  assert.equal(inHalfOpen([1.25, 2.5], 1.25), true);
  assert.equal(inHalfOpen([1.25, 2.5], 2.499), true);
  assert.equal(inHalfOpen([1.25, 2.5], 2.5), false);
});

test("effective presence covers every planned/actual fallback combination", () => {
  const base = person("p");
  assert.deepEqual(effectivePresence(base, 8), [0, 8]);
  assert.deepEqual(effectivePresence(person("p", { presence: { planned: [1, 7], actual: { here: 2.25, leaving: null } } }), 8), [2.25, 7]);
  assert.deepEqual(effectivePresence(person("p", { presence: { planned: [1, 7], actual: { here: null, leaving: 6.5 } } }), 8), [1, 6.5]);
  assert.deepEqual(effectivePresence(person("p", { presence: { planned: [1, 7], actual: { here: 2, leaving: 6 } } }), 8), [2, 6]);
  assert.equal(effectivePresence(person("p", { presence: { planned: null, actual: { here: null, leaving: 6 } } }), 8), null);
  assert.deepEqual(effectivePresence(person("p", { presence: { planned: null, actual: { here: 2.5, leaving: null } } }), 8), [2.5, 8]);
  assert.equal(isPresent(person("p"), 8, 8), false);
});

test("signup actual endpoints independently fall back to planned", () => {
  const base = { person: "p", planned: [1, 6], actual: null };
  assert.deepEqual(effectiveSignupRange(base), [1, 6]);
  assert.deepEqual(effectiveSignupRange({ ...base, actual: [2.5, null] }), [2.5, 6]);
  assert.deepEqual(effectiveSignupRange({ ...base, actual: [null, 5.5] }), [1, 5.5]);
  assert.deepEqual(effectiveSignupRange({ ...base, actual: [2.5, 5.5] }), [2.5, 5.5]);
  assert.deepEqual(effectiveSignupRange({ ...base, actual: [null, null] }), [1, 6]);
});

test("ordinary location resolves absence, lounge, signup, and DM seat zero", () => {
  const data = validateTimeline(timeline());
  const dm = data.people.find((item) => item.id === "dm");
  const player = data.people.find((item) => item.id === "player");
  assert.equal(ordinaryLocation(data, player, .5).kind, "lounge");
  assert.deepEqual(ordinaryLocation(data, player, 1).seat, 1);
  assert.deepEqual(ordinaryLocation(data, dm, 1).seat, 0);
  assert.equal(ordinaryLocation(data, player, 8).kind, "absent");
});

test("hidden privacy and appearance mapping never use an ID", () => {
  const data = validateTimeline(timeline());
  const hidden = data.people.find((item) => item.hidden);
  const shown = data.people.find((item) => item.id === "player");
  assert.equal(displayName(hidden), "someone");
  assert.equal(visibleVariant(hidden), null);
  assert.equal(visibleVariant(shown, 15), 1);
  const tip = personTooltip(hidden, { label: "the lounge" });
  assert.equal(tip, "someone at the lounge");
  assert.doesNotMatch(tip, /hidden-key|Private Name/);
});

test("ten-column indexing and local seats stay inside adjacent table cells", () => {
  assert.deepEqual(tableGridPosition(0), { column: 0, row: 0 });
  assert.deepEqual(tableGridPosition(9), { column: 9, row: 0 });
  assert.deepEqual(tableGridPosition(10), { column: 0, row: 1 });
  const offsets = Array.from({ length: 10 }, (_, index) => seatOffset(index));
  assert.deepEqual(offsets[0], { x: 1, y: -1, overflow: false });
  assert.equal(new Set(offsets.map((item) => `${item.x.toFixed(6)},${item.y.toFixed(6)}`)).size, offsets.length);
  for (let a = 0; a < offsets.length; a += 1) for (let b = a + 1; b < offsets.length; b += 1) {
    assert.ok(Math.hypot(offsets[a].x - offsets[b].x, offsets[a].y - offsets[b].y) >= .999);
  }
  assert.throws(() => seatOffset(10), RangeError);
});

test("global occupied overflow seats never overlap each other or adjacent tables", () => {
  const tables = Array.from({ length: 20 }, (_, tableIndex) => ({
    seats: 40,
    signups: Array.from({ length: 35 }, (_, signupIndex) => ({ person: `${tableIndex}:${signupIndex}` })),
  }));
  const plan = createSeatingPlan(tables);
  assert.equal(plan.columns, 10);
  assert.equal(plan.cells[10].x, plan.cells[0].x);
  assert.ok(plan.cells[10].y > plan.cells[0].y);
  assert.equal(plan.overflowSeats.length, 20 * (35 - 9));
  assert.deepEqual(createSeatingPlan(tables).overflowSeats, plan.overflowSeats);

  const occupied = [];
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    for (let seat = 0; seat <= tables[tableIndex].signups.length; seat += 1) {
      occupied.push(seatPositionForPlan(plan, tableIndex, seat));
    }
  }
  for (let a = 0; a < occupied.length; a += 1) for (let b = a + 1; b < occupied.length; b += 1) {
    const distance = Math.hypot(occupied[a].x - occupied[b].x, occupied[a].y - occupied[b].y);
    assert.ok(distance >= .999, `seats ${a} and ${b} overlap at ${distance}`);
  }
});

test("chair drawing is bounded by useful local seats plus actual overflow signups", () => {
  const hugeEmptyCapacity = { seats: 1_000_000_000, signups: [{ person: "one" }] };
  assert.deepEqual(chairSeatIndices(hugeEmptyCapacity), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const full = { seats: 50, signups: Array.from({ length: 50 }, (_, index) => ({ person: String(index) })) };
  const seats = chairSeatIndices(full);
  assert.equal(seats.length, 51);
  assert.equal(seats.at(-1), 50);
});

test("active event windows are half-open and use fixed simulated minutes", () => {
  const input = timeline();
  input.events = [event("b", "break", 1), event("m", "meal", 2), event("a", "announce", 3), event("s", "spotlight", 4)];
  const data = validateTimeline(input);
  assert.ok(activeEvents(data, 1).break);
  assert.equal(activeEvents(data, 2).break, null);
  assert.ok(activeEvents(data, 2).meal);
  assert.ok(activeEvents(data, 3 + ANNOUNCE_MINUTES / 30 - .0001).announce);
  assert.equal(activeEvents(data, 3 + ANNOUNCE_MINUTES / 30).announce, null);
  assert.ok(activeEvents(data, 4 + SPOTLIGHT_MINUTES / 30 - .0001).spotlight);
  assert.equal(activeEvents(data, 4 + SPOTLIGHT_MINUTES / 30).spotlight, null);
});

test("active-event scans cache and inspect only admin events after indexing", () => {
  const data = validateTimeline(timeline());
  let kindReads = 0;
  const events = [
    event("b", "break", 1), event("m", "meal", 2), event("a", "announce", 3), event("s", "spotlight", 4),
    ...Array.from({ length: 20_000 }, (_, index) => event(`history-${index}`, "shout", index % 8)),
  ];
  data.events = events.map((item) => new Proxy(item, {
    get(target, property, receiver) {
      if (property === "kind") kindReads += 1;
      return Reflect.get(target, property, receiver);
    },
  }));
  const admin = indexAdminEvents(data);
  assert.equal(admin.length, 4);
  kindReads = 0;
  for (let frame = 0; frame < 300; frame += 1) activeEvents(data, 2);
  assert.equal(kindReads, 4 * 300);
});

test("movement overlap priority is spotlighted person, break, meal, ordinary", () => {
  const data = validateTimeline(timeline());
  const player = data.people.find((item) => item.id === "player");
  const active = { spotlight: event("s", "spotlight", 1), break: event("b", "break", 1), meal: event("m", "meal", 1), announce: null };
  assert.equal(resolveLocation(data, player, 2, active).kind, "spotlight");
  active.spotlight.person = "hidden-key";
  assert.equal(resolveLocation(data, player, 2, active).label, "the lounge (break)");
  active.break = null;
  assert.equal(resolveLocation(data, player, 2, active).kind, "food");
  active.meal = null;
  assert.equal(resolveLocation(data, player, 2, active).kind, "table");
  assert.equal(playbackSpeed(1800, { announce: {}, spotlight: null, break: null, meal: null }), 30);
  assert.equal(playbackSpeed(1800, { announce: null, spotlight: null, break: {}, meal: {} }), 120);
});

test("live mode includes start and the end-plus-one-hour boundary", () => {
  const data = validateTimeline(timeline());
  const start = Date.parse(data.event.start);
  const end = slotToMs(data, data.event.slots);
  assert.equal(modeAt(data, start - 1), "replay");
  assert.equal(modeAt(data, start), "live");
  assert.equal(modeAt(data, end + 60 * 60_000), "live");
  assert.equal(modeAt(data, end + 60 * 60_000 + 1), "replay");
});

test("replay queues every crossed speech event in time/input order", () => {
  const input = timeline();
  input.events = [event("slot-zero", "shout", 0), event("later", "shout", 2), event("same-a", "donation", 1), event("same-b", "shout", 1)];
  const data = validateTimeline(input);
  assert.deepEqual(data.events.map((item) => item.id), ["slot-zero", "same-a", "same-b", "later"]);
  assert.deepEqual(crossedSpeechEvents(data, 0, .1).map((item) => item.id), ["slot-zero"]);
  assert.deepEqual(crossedSpeechEvents(data, .5, 2).map((item) => item.id), ["same-a", "same-b", "later"]);
  assert.deepEqual(crossedSpeechEvents(data, 2, 1), []);
});

test("accessible event text includes literal content and protects hidden identities", () => {
  const data = validateTimeline(timeline());
  const active = {
    break: null,
    meal: null,
    announce: event("a11y-announce", "announce", 1, { text: "<script>announcement</script>" }),
    spotlight: event("a11y-spotlight", "spotlight", 1, { person: "hidden-key", text: "private reason" }),
  };
  const speech = event("a11y-shout", "shout", 1, { person: "hidden-key", text: "<img onerror=bad>" });
  const text = accessibleEventText(data, active, speech);
  assert.match(text, /Announcement: <script>announcement<\/script>/);
  assert.match(text, /Spotlight: someone\. private reason/);
  assert.match(text, /Reaction from someone: <img onerror=bad>/);
  assert.doesNotMatch(text, /hidden-key|Private Name/);
});

test("live reconciliation marks history seen, de-duplicates, drops oldest excess shouts, and never drops donations", () => {
  const firstInput = timeline();
  firstInput.events = [event("historical", "shout", 1)];
  const first = validateTimeline(firstInput);
  let live = createLiveState(first);
  assert.equal(live.speechQueue.length, 0);
  assert.equal(live.seenEventIds.has("historical"), true);

  const newerInput = timeline();
  newerInput.generated_at = "2026-11-07T15:02:00Z";
  newerInput.events = [event("historical", "shout", 1)];
  for (let index = 0; index < 13; index += 1) newerInput.events.push(event(`shout-${index}`, "shout", 2 + index / 20));
  newerInput.events.splice(5, 0, event("gift", "donation", 2.15));
  live = reconcileLiveSnapshot(live, validateTimeline(newerInput));
  assert.equal(live.changed, true);
  assert.equal(live.speechQueue.filter((item) => item.kind === "shout").length, 10);
  assert.equal(live.speechQueue.some((item) => item.id === "shout-0"), false);
  assert.equal(live.speechQueue.some((item) => item.id === "gift"), true);

  const same = reconcileLiveSnapshot(live, validateTimeline(newerInput));
  assert.equal(same.changed, false);
  assert.equal(same.speechQueue.length, live.speechQueue.length);
});

test("hostile text remains literal while hidden names and IDs stay out of public views", () => {
  const input = timeline();
  input.tables[0].name = "<img onerror=alert(1)>";
  input.tables[0].pitch = "<script>alert(2)</script>";
  input.events = [event("secret-event", "shout", 2, { person: "hidden-key", by: "hidden-key", text: "<img onerror=alert(3)>" })];
  const data = validateTimeline(input);
  const table = tableView(data, data.tables[0]);
  assert.equal(table.name, "<img onerror=alert(1)>");
  assert.equal(table.pitch, "<script>alert(2)</script>");
  assert.equal(table.roster[1].name, "someone");
  const bubble = speechView(data, data.events[0], 8);
  assert.equal(bubble.text, "<img onerror=alert(3)>");
  assert.equal(bubble.speaker, "someone");
  assert.equal(bubble.label, "From someone");
  const publicText = JSON.stringify({ table, bubble: { text: bubble.text, speaker: bubble.speaker, label: bubble.label } });
  assert.doesNotMatch(publicText, /hidden-key|Private Name/);
});

test("new snapshots replace deleted objects by stable-key reconciliation", () => {
  const first = validateTimeline(timeline());
  const state = createLiveState(first);
  const nextInput = clone(timeline());
  nextInput.generated_at = "2026-11-07T15:05:00Z";
  nextInput.tables = [];
  nextInput.people = nextInput.people.filter((item) => item.id !== "player" && item.id !== "hidden-key");
  nextInput.events = [];
  const next = reconcileLiveSnapshot(state, validateTimeline(nextInput));
  assert.equal(next.snapshot.tables.length, 0);
  assert.equal(next.snapshot.people.some((item) => item.id === "player"), false);
});

test("schema 4 rejects invalid layouts, pad collisions and excess overflow reservations", () => {
  const changes = [
    (data) => { delete data.room_layout; },
    (data) => { data.room_layout.version = 2; },
    (data) => { data.room_layout.pad_capacity = 0; },
    (data) => { data.room_layout.overflow_capacity = -1; },
    (data) => { delete data.tables[0].pad; },
    (data) => { data.tables[0].pad = null; },
    (data) => { data.tables[0].pad = true; },
    (data) => { data.tables[0].pad = 0.5; },
    (data) => { data.tables[0].pad = 20; },
    (data) => { data.tables.push({ ...data.tables[0], id: "different" }); },
    (data) => { data.tables[0].seats = 130; },
    (data) => { delete data.people[0].appearance; },
  ];
  for (const change of changes) {
    const data = timeline(4);
    change(data);
    assert.throws(() => validateTimeline(data), TimelineError);
  }
});

test("saved pads survive deletion, reorder, replacement and fresh-client refresh", () => {
  const input = timeline(4);
  input.room_layout.pad_capacity = 30;
  input.tables = Array.from({ length: 22 }, (_, pad) => ({ ...input.tables[0], id: `opaque-${99 - pad}`, pad, signups: [] }));
  const original = validateTimeline(input);
  const first = createRoomLayout(original.tables, original.room_layout);
  input.tables = input.tables.filter((table) => table.pad !== 0 && table.pad !== 10).reverse();
  input.tables.push({ ...input.tables[0], id: "new-table", pad: 0 });
  input.generated_at = "2026-11-07T15:02:00Z";
  const refresh = reconcileLiveSnapshot(createLiveState(original), validateTimeline(input)).snapshot;
  const reload = validateTimeline(JSON.parse(JSON.stringify(input)));
  const next = createRoomLayout(refresh.tables, refresh.room_layout);
  assert.deepEqual(next, createRoomLayout(reload.tables, reload.room_layout));
  for (const [index, table] of refresh.tables.entries()) {
    assert.deepEqual(next.cells[index], first.cells[table.pad]);
  }
  const empty = createRoomLayout([], input.room_layout);
  for (const key of ["width", "height", "stage", "food", "lounge", "door", "doorPosition", "stageFront", "tableGridBottom", "overflowRows", "aisles"]) {
    assert.deepEqual(next[key], first[key], key);
    assert.deepEqual(empty[key], first[key], key);
  }
});

test("fixed overflow area fits a large roster without moving landmarks or overlapping seats", () => {
  const room = { version: 1, pad_capacity: 20, overflow_capacity: 32 };
  const tables = [
    { id: "a", pad: 19, seats: 26, signups: Array(26).fill({}) },
    { id: "b", pad: 4, seats: 24, signups: Array(24).fill({}) },
  ];
  const layout = createRoomLayout(tables, room);
  const empty = createRoomLayout([], room);
  assert.equal(layout.overflowSeats.length, 32);
  assert.deepEqual(layout.lounge, empty.lounge);
  assert.deepEqual(layout.stage, empty.stage);
  const positions = tables.flatMap((table, index) => Array.from({ length: table.signups.length + 1 }, (_, seat) => seatPositionForPlan(layout, index, seat)));
  assert.equal(new Set(positions.map((pos) => `${pos.x}:${pos.y}`)).size, positions.length);
  for (const pos of layout.overflowSeats) {
    assert.ok(pos.y > layout.tableGridBottom && pos.y < layout.lounge.y);
    assert.ok(pos.x > 0 && pos.x < layout.stage.x);
  }
  const reorder = createRoomLayout([...tables].reverse(), room);
  for (const [index, table] of tables.entries()) {
    for (let seat = 0; seat <= table.signups.length; seat += 1) {
      const a = seatPositionForPlan(layout, index, seat);
      const b = seatPositionForPlan(reorder, 1 - index, seat);
      assert.deepEqual([a.x, a.y], [b.x, b.y]);
    }
  }
});

test("legacy schemas retain the original array-based grid and dynamic overflow area", () => {
  for (const schema of [1, 2, 3]) {
    const input = timeline(schema);
    input.tables[0].pad = 19; // An unknown field cannot rewrite old archives.
    input.room_layout = { version: 1, pad_capacity: 100, overflow_capacity: 500 };
    const data = validateTimeline(input);
    const layout = createRoomLayout(data.tables, data.room_layout);
    assert.deepEqual(layout.cells[0], { x: 4, y: 8 });
    assert.equal(layout.tableRows, 2);
    assert.equal(layout.overflowRows, 0);
  }
});

test("table lifecycle has half-open schedule phases and deterministic props", () => {
  const data = timeline(4);
  const table = { ...data.tables[0], start: 2, end: 4 };
  const bounds = tableLifecycle(data, table, 0);
  assert.equal(bounds.prepareAt, 2 - 1 / 6 - .5);
  assert.equal(bounds.readyAt, 2 - 1 / 6);
  assert.equal(bounds.inactiveAt, 4 + 1 / 3);
  for (const [slot, phase, furniture, props] of [
    [0, "scheduled", false, false],
    [bounds.prepareAt - 1e-8, "scheduled", false, false],
    [bounds.prepareAt, "preparing", true, false],
    [bounds.readyAt, "ready", true, true],
    [2, "active", true, true],
    [4 - 1e-8, "active", true, true],
    [4, "cleaning", true, false],
    [bounds.inactiveAt, "inactive", false, false],
    [8, "inactive", false, false],
  ]) {
    const actual = tableLifecycle(data, table, slot);
    assert.deepEqual([actual.phase, actual.furniture, actual.props], [phase, furniture, props]);
  }
});

test("lifecycle scales for dry runs and clips setup and cleanup to event boundaries", () => {
  const data = timeline(4);
  const table = { ...data.tables[0], start: 2, end: 4 };
  const normal = tableLifecycle(data, table, 1.5);
  for (const slot_minutes of [1, 5, 15, 30]) {
    const compressed = { ...data, event: { ...data.event, slot_minutes } };
    assert.deepEqual(tableLifecycle(compressed, table, 1.5), normal);
  }
  const hourly = tableLifecycle({ ...data, event: { ...data.event, slot_minutes: 60 } }, table, 0);
  assert.equal(hourly.readyAt, table.start - 5 / 60);
  const fullWindow = { ...table, start: 0, end: data.event.slots };
  assert.equal(tableLifecycle(data, fullWindow, 0).phase, "active");
  assert.equal(tableLifecycle(data, fullWindow, data.event.slots).phase, "inactive");
});

test("fresh reconstruction, forward replay and backward seeks agree on meaningful table state", () => {
  const data = validateTimeline(timeline(4));
  const person = data.people.find((p) => p.id === "player");
  const renderState = (package_, slot) => ({
    props: package_.tables.map((table) => tableLifecycle(package_, table, slot)),
    places: package_.people.map((person) => resolveLocation(package_, person, slot)),
  });
  const points = [0, .4, .9, 1, 2.5, 4.9, 5, 5.2, 5.4, 8];
  const sequential = new Map(points.map((slot) => [slot, renderState(data, slot)]));
  for (const slot of points.toReversed()) {
    const fresh = validateTimeline(JSON.parse(JSON.stringify(data)));
    assert.deepEqual(renderState(fresh, slot), sequential.get(slot));
  }
  // An actual departure after the table window cannot leave a person at packed furniture.
  data.tables[0].signups[0].actual = [1, 7];
  assert.equal(ordinaryLocation(data, person, 5.5).kind, "lounge");
});
