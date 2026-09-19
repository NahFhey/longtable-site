import { CHOICE_COUNTS } from "./characters.mjs";

const ADMIN_KINDS = new Set(["break", "meal", "announce", "spotlight"]);
const SPEECH_KINDS = new Set(["shout", "donation"]);
const ALL_KINDS = new Set([...ADMIN_KINDS, ...SPEECH_KINDS, "roll"]);
const POINT_KINDS = new Set(["announce", "spotlight", "shout", "donation", "roll"]);

export const PALETTE_SIZE = 15;
export const ANNOUNCE_MINUTES = 8;
export const SPOTLIGHT_MINUTES = 14;
export const MOVEMENT_PRIORITY = Object.freeze(["spotlight-person", "break", "meal", "ordinary"]);
export const TABLE_COLUMNS = 10;
export const LOCAL_SEAT_COUNT = 10;
export const OVERFLOW_COLUMNS = 30;

const ACTIVITY_LABELS = Object.freeze({
  set_presence: "updated their event attendance", here: "checked in", leaving: "checked out",
  create_table: "created a game", edit_table: "edited a game", delete_table: "deleted a game",
  end_table: "ended a game", join: "joined or updated their game seat", leave_table: "left a game",
  set_appearance: "changed their character", hide: "hid their identity", unseat: "removed a player from a game",
  join_visitors: "joined the Visitors Table", leave_visitors: "left the Visitors Table",
  open_visitors: "opened visitor signups", close_visitors: "closed visitor signups",
  remove_visitor: "removed a visitor", remove: "removed a public message", finalize: "finalized the event",
  move_food: "went to get food", move_lounge: "went to the lounge", move_table: "returned to the table",
  event_window: "updated the event name or dates",
});

const ADMIN_EVENT_CACHE = new WeakMap();

export class TimelineError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimelineError";
  }
}

function fail(message) {
  throw new TimelineError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function required(source, key, label) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) fail(`${label}.${key} is required.`);
  return source[key];
}

function string(value, label, { nullable = false, min = 0, max = Infinity } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length < min || value.length > max) fail(`${label} is malformed.`);
  return value;
}

function bool(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}

function number(value, label, { integer = false, min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    fail(`${label} is malformed.`);
  }
  return value;
}

function dateString(value, label, zoneForm = null) {
  const result = string(value, label, { min: 1 });
  if (!Number.isFinite(Date.parse(result))) fail(`${label} is not a valid date.`);
  const calendar = result.match(/^(\d{4})-(\d{2})-(\d{2})[T ]/);
  if (!calendar) fail(`${label} is not a valid date.`);
  const year = Number(calendar[1]);
  const month = Number(calendar[2]);
  const day = Number(calendar[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail(`${label} is not a valid date.`);
  const zone = result.match(/(Z|([+-])(\d\d):(\d\d))$/);
  if (zoneForm === "aware" && !zone) fail(`${label} must be an ISO 8601 instant with an offset.`);
  if (zoneForm === "numeric-offset" && (!zone || zone[1] === "Z")) fail(`${label} must include a numeric UTC offset.`);
  if (zoneForm === "zero-offset") {
    if (!zone) fail(`${label} must be an ISO 8601 instant with an offset.`);
    const offsetMinutes = zone[1] === "Z" ? 0 : Number(zone[3]) * 60 + Number(zone[4]);
    if (offsetMinutes !== 0) fail(`${label} must have a zero UTC offset.`);
  }
  return result;
}

function knownKeys(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function range(value, label, slots, { nullable = false, fractional = false, endpointNullable = false, allowReversed = false } = {}) {
  if (nullable && value === null) return null;
  const values = array(value, label);
  if (values.length !== 2) fail(`${label} must have two endpoints.`);
  const from = number(values[0], `${label}[0]`, { integer: !fractional, min: 0, max: slots, nullable: endpointNullable });
  const to = number(values[1], `${label}[1]`, { integer: !fractional, min: 0, max: slots, nullable: endpointNullable });
  if (!allowReversed && from !== null && to !== null && from >= to) fail(`${label} is empty or reversed.`);
  return [from, to];
}

/** Validate and clone only contract fields. Unknown fields are deliberately dropped. */
export function validateTimeline(input) {
  const root = object(input, "timeline");
  const schema = number(required(root, "schema", "timeline"), "timeline.schema", { integer: true });
  if (![1, 2, 3, 4, 5, 6, 7].includes(schema)) fail("This timeline uses an unsupported schema version.");
  const phase = string(required(root, "phase", "timeline"), "timeline.phase");
  if (phase !== "live" && phase !== "final") fail("timeline.phase is malformed.");
  const generated_at = dateString(required(root, "generated_at", "timeline"), "timeline.generated_at", "zero-offset");

  const rawEvent = object(required(root, "event", "timeline"), "timeline.event");
  const event = {
    name: string(required(rawEvent, "name", "timeline.event"), "timeline.event.name", { min: 1 }),
    start: dateString(required(rawEvent, "start", "timeline.event"), "timeline.event.start", "numeric-offset"),
    tz: string(required(rawEvent, "tz", "timeline.event"), "timeline.event.tz", { min: 1 }),
    slot_minutes: number(required(rawEvent, "slot_minutes", "timeline.event"), "timeline.event.slot_minutes", { integer: true, min: 1 }),
    slots: number(required(rawEvent, "slots", "timeline.event"), "timeline.event.slots", { integer: true, min: 1 }),
  };
  try { new Intl.DateTimeFormat("en", { timeZone: event.tz }).format(new Date(0)); }
  catch { fail("timeline.event.tz is not a valid time zone."); }

  const people = array(required(root, "people", "timeline"), "timeline.people").map((raw, index) => {
    const label = `timeline.people[${index}]`;
    const person = object(raw, label);
    const hidden = bool(required(person, "hidden", label), `${label}.hidden`);
    const name = string(required(person, "name", label), `${label}.name`, { nullable: true, min: 1 });
    const variant = number(required(person, "variant", label), `${label}.variant`, { integer: true, min: 0, max: 0xffffffff, nullable: true });
    if (hidden ? (name !== null || variant !== null) : (name === null || variant === null)) fail(`${label} has inconsistent privacy fields.`);
    let appearance = null;
    if (schema >= 3) {
      const rawAppearance = required(person, "appearance", label);
      if (rawAppearance !== null) {
        if (hidden) fail(`${label} has inconsistent privacy fields.`);
        const choices = object(rawAppearance, `${label}.appearance`);
        if (Object.keys(choices).length !== Object.keys(CHOICE_COUNTS).length) fail(`${label}.appearance is malformed.`);
        appearance = Object.fromEntries(Object.entries(CHOICE_COUNTS).map(([key, count]) => [key,
          number(required(choices, key, `${label}.appearance`), `${label}.appearance.${key}`, { integer: true, min: 0, max: count - 1 }),
        ]));
      }
    }
    const rawPresence = object(required(person, "presence", label), `${label}.presence`);
    const rawActual = object(required(rawPresence, "actual", `${label}.presence`), `${label}.presence.actual`);
    return {
      id: string(required(person, "id", label), `${label}.id`, { min: 1 }),
      name,
      dm: bool(required(person, "dm", label), `${label}.dm`),
      hidden,
      variant,
      appearance,
      movements: array(schema >= 7 ? required(person, "movements", label) : [], `${label}.movements`).map((rawMove) => {
        const move = object(rawMove, `${label}.movements`);
        const destination = string(move.destination, `${label}.movement.destination`);
        if (!["table", "food", "lounge"].includes(destination)) fail("Unknown movement destination.");
        const table = string(move.table, `${label}.movement.table`, { nullable: true, min: 1 });
        if (destination === "table" && table === null) fail("A table destination requires a table.");
        return { at: number(move.at, `${label}.movement.at`, { min: 0, max: event.slots }), table, destination };
      }),
      presence: {
        planned: range(required(rawPresence, "planned", `${label}.presence`), `${label}.presence.planned`, event.slots, { nullable: true }),
        actual: {
          here: number(required(rawActual, "here", `${label}.presence.actual`), `${label}.presence.actual.here`, { min: 0, max: event.slots, nullable: true }),
          leaving: number(required(rawActual, "leaving", `${label}.presence.actual`), `${label}.presence.actual.leaving`, { min: 0, max: event.slots, nullable: true }),
        },
      },
    };
  });
  const personById = new Map();
  for (const person of people) {
    if (personById.has(person.id)) fail("timeline.people contains duplicate identifiers.");
    personById.set(person.id, person);
  }

  let visitors = { open: true, people: [] };
  if (schema >= 6) {
    const group = object(required(root, "visitors", "timeline"), "timeline.visitors");
    visitors = {
      open: bool(required(group, "open", "visitors"), "visitors.open"),
      people: array(required(group, "people", "visitors"), "visitors.people").map((id) => string(id, "visitors.people", { min: 1 })),
    };
    if (new Set(visitors.people).size !== visitors.people.length || visitors.people.some((id) => !personById.has(id))) fail("Invalid visitor roster.");
  }

  const room_layout = schema >= 4 ? validateRoomLayout(required(root, "room_layout", "timeline")) : null;
  const tableIds = new Set();
  const tables = array(required(root, "tables", "timeline"), "timeline.tables").map((raw, index) => {
    const label = `timeline.tables[${index}]`;
    const table = object(raw, label);
    const id = string(required(table, "id", label), `${label}.id`, { min: 1 });
    if (tableIds.has(id)) fail("timeline.tables contains duplicate identifiers.");
    tableIds.add(id);
    const dm = string(required(table, "dm", label), `${label}.dm`, { min: 1 });
    if (!personById.has(dm)) fail(`${label}.dm does not resolve to a person.`);
    const start = number(required(table, "start", label), `${label}.start`, { integer: true, min: 0, max: event.slots });
    const end = number(required(table, "end", label), `${label}.end`, { integer: true, min: 0, max: event.slots });
    if (end <= start) fail(`${label} has an empty or reversed window.`);
    const signupPeople = new Set();
    const signups = array(required(table, "signups", label), `${label}.signups`).map((rawSignup, signupIndex) => {
      const signupLabel = `${label}.signups[${signupIndex}]`;
      const signup = object(rawSignup, signupLabel);
      const person = string(required(signup, "person", signupLabel), `${signupLabel}.person`, { min: 1 });
      if (!personById.has(person)) fail(`${signupLabel}.person does not resolve to a person.`);
      if (signupPeople.has(person)) fail(`${label}.signups contains a duplicate person.`);
      signupPeople.add(person);
      const planned = range(required(signup, "planned", signupLabel), `${signupLabel}.planned`, event.slots);
      if (planned[0] < start || planned[1] > end || planned[1] <= planned[0]) fail(`${signupLabel}.planned lies outside its table window.`);
      const actual = range(required(signup, "actual", signupLabel), `${signupLabel}.actual`, event.slots, { nullable: true, fractional: true, endpointNullable: true, allowReversed: true });
      return { person, planned, actual };
    });
    const seats = number(required(table, "seats", label), `${label}.seats`, { integer: true, min: 1 });
    if (signups.length > seats) fail(`${label} has more signups than seats.`);
    return {
      id,
      name: string(required(table, "name", label), `${label}.name`, { min: 1, max: 60 }),
      system: string(required(table, "system", label), `${label}.system`, { min: 1 }),
      pitch: string(required(table, "pitch", label), `${label}.pitch`, { max: 200 }),
      seats,
      walk_ins: bool(required(table, "walk_ins", label), `${label}.walk_ins`),
      start,
      end,
      dm,
      ...(room_layout ? { pad: number(required(table, "pad", label), `${label}.pad`, { integer: true, min: 0, max: room_layout.pad_capacity - 1 }) } : {}),
      created_at: dateString(required(table, "created_at", label), `${label}.created_at`, "aware"),
      signups,
    };
  });

  if (room_layout) validatePadAssignments(tables, room_layout);
  for (const person of people) {
    let previous = -1;
    for (const move of person.movements) {
      if (move.at < previous || (move.table !== null && !tables.some((table) => table.id === move.table))) fail("Invalid movement history.");
      previous = move.at;
    }
  }

  const eventIds = new Set();
  const events = array(required(root, "events", "timeline"), "timeline.events").map((raw, index) => {
    const label = `timeline.events[${index}]`;
    const item = object(raw, label);
    const id = string(required(item, "id", label), `${label}.id`, { min: 1 });
    if (eventIds.has(id)) fail("timeline.events contains duplicate identifiers.");
    eventIds.add(id);
    const kind = string(required(item, "kind", label), `${label}.kind`);
    if (!ALL_KINDS.has(kind) || (schema === 1 && !ADMIN_KINDS.has(kind)) || (kind === "roll" && schema < 5)) fail(`${label}.kind is unsupported for this schema.`);
    const at = number(required(item, "at", label), `${label}.at`, { min: 0, max: event.slots });
    const duration = number(required(item, "duration", label), `${label}.duration`, { min: 0, max: event.slots, nullable: true });
    const textMax = kind === "announce" ? 280 : SPEECH_KINDS.has(kind) ? 80 : Infinity;
    const text = string(required(item, "text", label), `${label}.text`, { nullable: true, max: textMax });
    const person = string(required(item, "person", label), `${label}.person`, { nullable: true, min: 1 });
    const by = string(required(item, "by", label), `${label}.by`, { min: 1 });
    if (!personById.has(by)) fail(`${label}.by does not resolve to a person.`);
    if (person !== null && !personById.has(person)) fail(`${label}.person does not resolve to a person.`);
    if ((kind === "break" || kind === "meal") !== (duration !== null)) fail(`${label}.duration is inconsistent with its kind.`);
    if ((kind === "break" || kind === "meal") && duration <= 0) fail(`${label}.duration must be positive.`);
    if (kind === "break" && text !== null) fail(`${label}.text is inconsistent with its kind.`);
    if ((kind === "announce" || kind === "shout" || kind === "donation") && (text === null || text.length === 0)) fail(`${label}.text is required for its kind.`);
    if ((kind === "spotlight" || kind === "shout" || kind === "donation" || kind === "roll") !== (person !== null)) fail(`${label}.person is inconsistent with its kind.`);
    if ((kind === "break" || kind === "announce") && text !== null && kind !== "announce") fail(`${label}.text is inconsistent with its kind.`);
    let dice = {};
    if (kind === "roll") {
      if (item.visibility !== "public" || text !== null || by !== person) fail(`${label} has invalid roll visibility or attribution.`);
      const table = string(required(item, "table", label), `${label}.table`, { min: 1 });
      if (!tables.some((candidate) => candidate.id === table)) fail(`${label}.table does not resolve.`);
      dice = { table, visibility: "public", roll: validateRoll(item.roll) };
    } else if (["roll", "visibility", "table"].some((key) => item[key] != null)) fail(`${label} has unexpected dice fields.`);
    return { id, kind, at, duration, text, person, by, ...dice, _inputOrder: index };
  }).sort((a, b) => a.at - b.at || a._inputOrder - b._inputOrder).map((item) => knownKeys(item, item.kind === "roll"
    ? ["id", "kind", "at", "duration", "text", "person", "by", "table", "visibility", "roll"]
    : ["id", "kind", "at", "duration", "text", "person", "by"]));

  const activityIds = new Set();
  const activity = array(root.activity ?? [], "activity").map((raw) => {
    const entry = object(raw, "activity entry");
    if (Object.keys(entry).sort().join(",") !== "action,actor,at,id,person,table") fail("Invalid activity fields.");
    const id = string(entry.id, "activity.id");
    if (!/^[0-9a-f]{32}$/.test(id) || activityIds.has(id)) fail("Invalid activity id.");
    activityIds.add(id);
    const action = string(entry.action, "activity.action");
    if (!Object.hasOwn(ACTIVITY_LABELS, action)) fail("Unknown activity action.");
    const at = dateString(entry.at, "activity.at", "zero-offset");
    const actor = string(entry.actor, "activity.actor", { nullable: true });
    const person = string(entry.person, "activity.person", { nullable: true });
    for (const reference of [actor, person]) {
      if (reference !== null && !people.some((candidate) => candidate.id === reference)) fail("Unknown activity person.");
    }
    const table = string(entry.table, "activity.table", { nullable: true });
    if (table !== null && !/^t[0-9]+$/.test(table)) fail("Invalid activity table.");
    return { id, at, action, actor, person, table };
  });
  return { schema, visitors, phase, generated_at, event, people, tables, events, room_layout, activity };
}

export function slotToMs(timeline, slot) {
  return Date.parse(timeline.event.start) + slot * timeline.event.slot_minutes * 60_000;
}

export function validateRoll(value) {
  const roll = object(value, "roll");
  if (Object.keys(roll).sort().join(",") !== "expression,faces,modifier,sides,total") fail("Invalid roll fields.");
  const sides = number(roll.sides, "roll.sides", { integer: true });
  if (sides < 2 || sides > 1000) fail("Unsupported die size.");
  const modifier = number(roll.modifier, "roll.modifier", { integer: true, min: -1000, max: 1000 });
  const faces = array(roll.faces, "roll.faces").map((face) => number(face, "roll.face", { integer: true, min: 1, max: sides }));
  if (faces.length < 1 || faces.length > 100) fail("Invalid dice count.");
  const expression = `${faces.length}d${sides}${modifier ? `${modifier > 0 ? "+" : ""}${modifier}` : ""}`;
  const total = number(roll.total, "roll.total", { integer: true });
  if (roll.expression !== expression || total !== faces.reduce((sum, face) => sum + face, modifier)) fail("Recorded dice total or expression is inconsistent.");
  return { expression, sides, faces, modifier, total };
}

const DICE_CACHE = new WeakMap();
export function diceAt(timeline, tableId, slot, reducedMotion = false) {
  let tables = DICE_CACHE.get(timeline);
  if (!tables) {
    tables = new Map();
    for (const event of timeline.events) if (event.kind === "roll" && event.visibility === "public") {
      if (!tables.has(event.table)) tables.set(event.table, []);
      tables.get(event.table).push(event);
    }
    DICE_CACHE.set(timeline, tables);
  }
  const rolls = tables.get(tableId) || [];
  let low = 0, high = rolls.length;
  while (low < high) { const middle = (low + high) >>> 1; if (rolls[middle].at <= slot) low = middle + 1; else high = middle; }
  if (!low) return null;
  const event = rolls[low - 1];
  const elapsed = Math.max(0, (slot - event.at) * timeline.event.slot_minutes * 60);
  const progress = reducedMotion ? 1 : Math.min(1, elapsed / 3);
  let seed = 2166136261;
  for (const char of event.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return { event, progress, dice: event.roll.faces.slice(0, 6).map((face, index) => {
    const direction = (seed >>> (index * 4)) & 1 ? 1 : -1;
    return { face, x: index % 3 + direction * (1 - progress) * 1.2,
      y: Math.floor(index / 3) - Math.sin(progress * Math.PI) * .55,
      angle: direction * (1 - progress) * Math.PI * (2 + index) };
  }) };
}

export function diceText(timeline, event) {
  if (!event || event.kind !== "roll" || event.visibility !== "public") return "No public roll at this time.";
  const who = displayName(timeline.people.find((person) => person.id === event.person));
  const roll = event.roll;
  const modifier = roll.modifier ? ` ${roll.modifier > 0 ? "+" : ""}${roll.modifier}` : "";
  return `${who} rolled ${roll.expression}: [${roll.faces.join(", ")}]${modifier} = ${roll.total}.`;
}

export function msToSlot(timeline, milliseconds) {
  return (milliseconds - Date.parse(timeline.event.start)) / (timeline.event.slot_minutes * 60_000);
}

export function effectivePresence(person, totalSlots) {
  const planned = person.presence.planned;
  const arrive = person.presence.actual.here ?? planned?.[0];
  if (arrive === undefined || arrive === null) return null;
  const leave = person.presence.actual.leaving ?? planned?.[1] ?? totalSlots;
  return [arrive, leave];
}

export function inHalfOpen(rangeValue, slot) {
  return rangeValue !== null && slot >= rangeValue[0] && slot < rangeValue[1];
}

export function isPresent(person, slot, totalSlots) {
  return inHalfOpen(effectivePresence(person, totalSlots), slot);
}

const HALL_OCCUPANCY = new WeakMap();

/** Decorative caretaker: event-time motion, without adding attendance or events. */
export function hallAmbience(timeline, slot, layout, reducedMotion = false) {
  let intervals = HALL_OCCUPANCY.get(timeline);
  const secondsPerSlot = timeline.event.slot_minutes * 60;
  if (!intervals) {
    const ranges = timeline.people.map(person => effectivePresence(person, timeline.event.slots))
      .filter(range => range && range[0] < range[1])
      .map(([start, end]) => [Math.max(0, start) * secondsPerSlot, Math.min(timeline.event.slots, end) * secondsPerSlot])
      .sort((a, b) => a[0] - b[0]);
    intervals = [];
    for (const range of ranges) {
      const last = intervals.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else intervals.push(range);
    }
    HALL_OCCUPANCY.set(timeline, intervals);
  }
  // A seek to the exact event end shows completed closing, even with a clamped clock.
  let seconds = Math.max(0, slot * secondsPerSlot);
  if (slot === timeline.event.slots) seconds += 12;
  const opening = Math.max(0, (intervals[0]?.[0] ?? 0) - 60);
  const sinceOpen = seconds - opening;
  const occupied = intervals.find(([start, end]) => seconds >= start && seconds < end);
  const lightSwitch = { x: 1.3, y: layout.door.y - .8 };
  const corridor = { x: layout.trunkX, y: layout.aisles[0] };
  const food = { x: layout.food.x + 6, y: layout.food.y + layout.food.h - 1.2 };
  const lounge = { x: layout.trunkX, y: layout.lounge.y + 2 };
  const route = [lightSwitch, corridor, food, corridor, lounge, corridor, lightSwitch];
  const lengths = route.slice(1).map((point, i) => Math.hypot(point.x - route[i].x, point.y - route[i].y));
  const length = lengths.reduce((sum, value) => sum + value, 0);
  const roam = elapsed => {
    if (reducedMotion) return lightSwitch;
    let distance = Math.max(0, elapsed) * 1.2 % length;
    for (let i = 0; i < lengths.length; i += 1) {
      if (distance <= lengths[i]) {
        const progress = lengths[i] ? distance / lengths[i] : 0;
        return { x: route[i].x + (route[i + 1].x - route[i].x) * progress,
          y: route[i].y + (route[i + 1].y - route[i].y) * progress };
      }
      distance -= lengths[i];
    }
    return lightSwitch;
  };
  const clamp = value => Math.max(0, Math.min(1, value));
  const move = (from, to, progress) => ({ x: from.x + (to.x - from.x) * clamp(progress), y: from.y + (to.y - from.y) * clamp(progress) });
  let staff = roam(seconds), lights = occupied ? 1 : 0, action = 'Staff are on duty; the empty hall’s lights are off.';
  let foodCount = Math.floor(clamp((sinceOpen - 20) / 30) * 6);
  if (sinceOpen >= 0 && sinceOpen < 60) {
    lights = reducedMotion ? 1 : clamp((sinceOpen - 4) / 2);
    if (sinceOpen < 8) {
      staff = move(layout.doorPosition, lightSwitch, sinceOpen / 4);
      action = 'Staff are turning on the lights.';
    } else if (sinceOpen < 20) {
      staff = sinceOpen < 14 ? move(lightSwitch, corridor, (sinceOpen - 8) / 6) : move(corridor, food, (sinceOpen - 14) / 6);
      action = 'Staff are bringing food to the food table.';
    } else {
      staff = food;
      action = 'Staff are setting out food.';
    }
    if (reducedMotion) { staff = food; foodCount = 6; }
  } else if (occupied) {
    staff = roam(seconds - opening - 60);
    action = 'Lights are on. Staff are circulating through the hall.';
    if (occupied !== intervals[0] && seconds - occupied[0] < 12) {
      const elapsed = seconds - occupied[0];
      staff = reducedMotion ? lightSwitch : move(roam(occupied[0]), lightSwitch, elapsed / 8);
      lights = reducedMotion ? 1 : clamp((elapsed - 8) / 4);
      action = 'Staff are turning the lights back on.';
    }
  } else if (sinceOpen >= 60) {
    const departure = intervals.filter(([, end]) => end <= seconds).at(-1)?.[1] ?? opening + 60;
    const elapsed = seconds - departure;
    if (elapsed < 12) {
      staff = reducedMotion ? lightSwitch : move(roam(Math.max(0, departure - opening - 60)), lightSwitch, elapsed / 8);
      lights = reducedMotion ? 0 : 1 - clamp((elapsed - 8) / 4);
      action = 'The hall is empty. Staff are switching off the lights.';
    } else staff = roam(elapsed - 12);
  }
  return { staff: { ...staff, load: sinceOpen >= 8 && sinceOpen < 50 ? 'food' : null },
    lights, foodCount, lightSwitch, action, occupied: Boolean(occupied) };
}

export function effectiveSignupRange(signup) {
  if (signup.actual === null) return [...signup.planned];
  return [signup.actual[0] ?? signup.planned[0], signup.actual[1] ?? signup.planned[1]];
}

export function displayName(person) {
  return !person || person.hidden ? "someone" : person.name;
}

export function visibleVariant(person, paletteSize = PALETTE_SIZE) {
  return !person || person.hidden ? null : person.variant % paletteSize;
}

function validateRoomLayout(raw) {
  const room = object(raw, "room_layout");
  const version = number(required(room, "version", "room_layout"), "room_layout.version", { integer: true });
  if (version !== 1) fail("Unsupported room_layout.version.");
  return {
    version,
    pad_capacity: number(required(room, "pad_capacity", "room_layout"), "room_layout.pad_capacity", { integer: true, min: 1, max: Number.MAX_SAFE_INTEGER }),
    overflow_capacity: number(required(room, "overflow_capacity", "room_layout"), "room_layout.overflow_capacity", { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER }),
  };
}

function validatePadAssignments(tables, room) {
  const pads = new Set();
  let reserved = 0;
  for (const table of tables) {
    if (!Number.isSafeInteger(table.pad) || table.pad < 0 || table.pad >= room.pad_capacity) fail("Table pad is outside room capacity.");
    if (pads.has(table.pad)) fail("Duplicate table pad assignment.");
    pads.add(table.pad);
    reserved += Math.max(0, table.seats - (LOCAL_SEAT_COUNT - 1));
  }
  if (reserved > room.overflow_capacity) fail("Table seat reservations exceed room overflow capacity.");
}

export function tableGridPosition(index) {
  return { column: index % TABLE_COLUMNS, row: Math.floor(index / TABLE_COLUMNS) };
}

const BASE_SEATS = [
  [1, -1], [0, -1], [2, -1], [0, 1], [1, 1], [2, 1], [-1, 0], [3, 0], [-1, 1], [3, 1],
];

/** Relative to the left edge of the three-tile tabletop; seat zero is always the DM. */
export function seatOffset(seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= BASE_SEATS.length) {
    throw new RangeError(`local seat must be between 0 and ${BASE_SEATS.length - 1}`);
  }
  return { x: BASE_SEATS[seat][0], y: BASE_SEATS[seat][1], overflow: false };
}

/**
 * Allocate occupied seats beyond the per-table cell in one deterministic hall-wide
 * area. Schema 4 freezes its bounds from room capacity; legacy packages retain
 * their original dynamic geometry. Only occupied overflow chairs are drawn.
 */
export function createSeatingPlan(tables, room = null) {
  if (room) {
    room = validateRoomLayout(room);
    validatePadAssignments(tables, room);
  }
  const gridX = 4;
  const gridY = 8;
  const cellWidth = 6;
  const cellHeight = 6;
  const tableRows = Math.max(2, Math.ceil(Math.max(room?.pad_capacity ?? tables.length, 2) / TABLE_COLUMNS));
  const tableGridBottom = gridY + tableRows * cellHeight;
  const cells = tables.map((table, index) => ({
    x: gridX + tableGridPosition(room ? table.pad : index).column * cellWidth,
    y: gridY + tableGridPosition(room ? table.pad : index).row * cellHeight,
  }));
  const overflowSeats = [];
  const overflowBySeat = new Map();
  const order = tables.map((_, index) => index);
  if (room) order.sort((a, b) => tables[a].pad - tables[b].pad);
  for (const tableIndex of order) {
    const occupiedSeatCount = tables[tableIndex].signups.length + 1;
    for (let seat = LOCAL_SEAT_COUNT; seat < occupiedSeatCount; seat += 1) {
      const overflowIndex = overflowSeats.length;
      const position = {
        tableIndex,
        seat,
        overflowIndex,
        x: gridX + 0.5 + (overflowIndex % OVERFLOW_COLUMNS) * 2,
        y: tableGridBottom + 2.5 + Math.floor(overflowIndex / OVERFLOW_COLUMNS) * 2,
        overflow: true,
      };
      overflowSeats.push(position);
      overflowBySeat.set(`${tableIndex}:${seat}`, position);
    }
  }
  return {
    columns: TABLE_COLUMNS,
    gridX,
    gridY,
    cellWidth,
    cellHeight,
    tableRows,
    tableGridBottom,
    cells,
    overflowSeats,
    overflowBySeat,
    overflowRows: Math.ceil((room?.overflow_capacity ?? overflowSeats.length) / OVERFLOW_COLUMNS),
  };
}

/** Layout version 1 keeps the original grid origin and freezes all room landmarks. */
export function createRoomLayout(tables, room = null) {
  const layout = { ...createSeatingPlan(tables, room), aisles: [] };
  layout.width = layout.gridX + layout.columns * layout.cellWidth + 8;
  const overflowHeight = layout.overflowRows ? 2 + layout.overflowRows * 2 : 0;
  layout.height = layout.tableGridBottom + overflowHeight + 6;
  layout.stage = { x: layout.width - 7, y: 1, w: 6, h: layout.height - 2 };
  layout.food = { x: 1, y: 1, w: 16, h: 6 };
  layout.lounge = { x: 1, y: layout.height - 6, w: layout.width - 9, h: 5 };
  layout.door = { x: 0, y: layout.gridY + 1 };
  layout.doorPosition = { x: 1.2, y: layout.door.y + 0.5 };
  layout.stageFront = { x: layout.stage.x + 1.5, y: layout.stage.y + layout.stage.h / 2 };
  layout.trunkX = layout.gridX - 0.5;
  layout.aisles.push(layout.gridY - 0.5);
  for (let row = 0; row < layout.tableRows; row += 1) layout.aisles.push(layout.gridY + row * layout.cellHeight + layout.cellHeight - 0.5);
  if (layout.overflowRows) layout.aisles.push(layout.tableGridBottom + 1.5);
  return layout;
}

export function seatPositionForPlan(plan, tableIndex, seat) {
  if (!Number.isInteger(tableIndex) || tableIndex < 0 || !plan.cells[tableIndex]) throw new RangeError("table index is out of range");
  if (!Number.isInteger(seat) || seat < 0) throw new RangeError("seat must be a non-negative integer");
  if (seat >= LOCAL_SEAT_COUNT) {
    const overflow = plan.overflowBySeat.get(`${tableIndex}:${seat}`);
    if (!overflow) throw new RangeError("overflow seat is not occupied");
    return overflow;
  }
  const cell = plan.cells[tableIndex];
  const tableX = cell.x + Math.floor((plan.cellWidth - 3) / 2);
  const tableY = cell.y + 2;
  const offset = seatOffset(seat);
  return { x: tableX + offset.x + 0.5, y: tableY + offset.y + 0.5, tableX, tableY, offset, overflow: false };
}

/** Bounded display chairs plus one chair for every signup that exceeds the local positions. */
export function chairSeatIndices(table) {
  const localCount = Math.min(table.seats + 1, LOCAL_SEAT_COUNT);
  const seats = Array.from({ length: localCount }, (_, seat) => seat);
  for (let seat = LOCAL_SEAT_COUNT; seat <= table.signups.length; seat += 1) seats.push(seat);
  return seats;
}

/** Cache the small movement-event subset so speech history is never scanned per frame. */
export function indexAdminEvents(timeline) {
  let events = ADMIN_EVENT_CACHE.get(timeline);
  if (!events) {
    events = timeline.events.filter((item) => ADMIN_KINDS.has(item.kind));
    ADMIN_EVENT_CACHE.set(timeline, events);
  }
  return events;
}

export function activeEvents(timeline, slot, adminEvents = indexAdminEvents(timeline)) {
  const active = { break: null, meal: null, announce: null, spotlight: null };
  const announceDuration = ANNOUNCE_MINUTES / timeline.event.slot_minutes;
  const spotlightDuration = SPOTLIGHT_MINUTES / timeline.event.slot_minutes;
  for (const item of adminEvents) {
    const kind = item.kind;
    let duration = 0;
    if (kind === "break" || kind === "meal") duration = item.duration;
    else if (kind === "announce") duration = announceDuration;
    else if (kind === "spotlight") duration = spotlightDuration;
    if (duration > 0 && slot >= item.at && slot < item.at + duration) active[kind] = item;
  }
  return active;
}

/** Schedule-derived scenery, with half-open phases clipped to the event window.
 * A compressed dry run scales down the normal 15/5/10-minute setup/ready/cleanup.
 * This does not claim whether a table was canceled or ended early.
 */
export function tableLifecycle(timeline, table, slot) {
  const scale = Math.min(1, timeline.event.slot_minutes / 30);
  const preparation = 15 * scale / timeline.event.slot_minutes;
  const ready = 5 * scale / timeline.event.slot_minutes;
  const cleanup = 10 * scale / timeline.event.slot_minutes;
  const readyAt = Math.max(0, table.start - ready);
  const prepareAt = Math.max(0, table.start - ready - preparation);
  const inactiveAt = Math.min(timeline.event.slots, table.end + cleanup);
  const phase = slot < prepareAt ? "scheduled"
    : slot < readyAt ? "preparing"
    : slot < table.start ? "ready"
    : slot < table.end ? "active"
    : slot < inactiveAt ? "cleaning" : "inactive";
  return {
    phase,
    label: { scheduled: "Scheduled", preparing: "Preparing", ready: "Ready", active: "Playing", cleaning: "Packing up", inactive: "Inactive" }[phase],
    furniture: ["preparing", "ready", "active", "cleaning"].includes(phase),
    props: phase === "ready" || phase === "active",
    prepareAt, readyAt, inactiveAt,
  };
}

/** Anonymous scenery reconstructed from selected time, never from attendee state. */
export function tableScenery(timeline, table, slot, layout, index, reducedMotion = false) {
  const lifecycle = tableLifecycle(timeline, table, slot);
  const between = (value, start, end) => Math.max(0, Math.min(1, (value - start) / (end - start)));
  const seats = chairSeatIndices(table);
  const scene = { furniture: lifecycle.furniture, chairs: seats, map: lifecycle.props ? 1 : 0,
    props: lifecycle.props, stacked: 0, staff: null };
  if (!lifecycle.furniture) return { ...scene, chairs: [] };
  const preparing = lifecycle.phase === "preparing";
  if (!preparing && lifecycle.phase !== "cleaning") return scene;
  const progress = preparing ? between(slot, lifecycle.prepareAt, lifecycle.readyAt)
    : between(slot, table.end, lifecycle.inactiveAt);
  let routeProgress;
  let load = null;
  if (preparing) {
    scene.furniture = progress >= .3;
    scene.chairs = seats.slice(0, Math.floor(seats.length * between(progress, .35, .75)));
    scene.map = between(progress, .75, .9);
    routeProgress = progress < .3 ? progress / .3 : 1 - between(progress, .9, 1);
    if (progress < .3) load = "table";
    else if (progress < .75) load = "chairs";
    else if (progress < .9) load = "map";
  } else {
    scene.furniture = progress < .7;
    scene.chairs = seats.slice(0, Math.ceil(seats.length * (1 - between(progress, .3, .65))));
    scene.stacked = progress >= .3 && progress < .7 ? Math.min(3, seats.length - scene.chairs.length) : 0;
    scene.map = progress < .25 ? 1 - between(progress, .15, .25) : 0;
    routeProgress = progress < .15 ? progress / .15 : 1 - between(progress, .7, 1);
    if (progress >= .7) load = "table";
    else if (progress >= .3) load = "chairs";
    else if (progress >= .15) load = "map";
  }
  if (reducedMotion) {
    scene.map = scene.map > 0 ? 1 : 0;
    return scene; // Same furniture stage, without a moving porter.
  }
  const cell = layout.cells[index];
  // Authored route follows the left aisle and the top edge of this pad's row.
  const route = [{ x: layout.door.x + 1.5, y: layout.door.y + .5 },
    { x: 2.5, y: layout.door.y + .5 }, { x: 2.5, y: cell.y + .25 },
    { x: cell.x + .3, y: cell.y + .25 }, { x: cell.x + .3, y: cell.y + 3.5 }];
  const lengths = route.slice(1).map((point, i) => Math.hypot(point.x - route[i].x, point.y - route[i].y));
  let distance = routeProgress * lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i < lengths.length; i += 1) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const fraction = lengths[i] ? distance / lengths[i] : 0;
      scene.staff = { x: route[i].x + (route[i + 1].x - route[i].x) * fraction,
        y: route[i].y + (route[i + 1].y - route[i].y) * fraction, load };
      break;
    }
    distance -= lengths[i];
  }
  return scene;
}

export function ordinaryLocation(timeline, person, slot) {
  if (!isPresent(person, slot, timeline.event.slots)) return { kind: "absent", label: "outside the hall" };
  for (let tableIndex = 0; tableIndex < timeline.tables.length; tableIndex += 1) {
    const table = timeline.tables[tableIndex];
    if (table.dm === person.id && slot >= table.start && slot < table.end) {
      return { kind: "table", label: table.name, table, tableIndex, seat: 0 };
    }
  }
  for (let tableIndex = 0; tableIndex < timeline.tables.length; tableIndex += 1) {
    const table = timeline.tables[tableIndex];
    if (slot < table.start || slot >= table.end) continue;
    for (let signupIndex = 0; signupIndex < table.signups.length; signupIndex += 1) {
      const signup = table.signups[signupIndex];
      if (signup.person === person.id && inHalfOpen(effectiveSignupRange(signup), slot)) {
        return { kind: "table", label: table.name, table, tableIndex, seat: signupIndex + 1 };
      }
    }
  }
  if (timeline.visitors?.people.includes(person.id)) {
    // Deterministic social visits, not attendance records or game assignments.
    const beat = Math.floor(slot * timeline.event.slot_minutes / 4);
    const seed = Array.from(person.id).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    const group = (seed + beat) % 4;
    if (group === 0) return { kind: "food", label: "the food area (visiting)", visitorBeat: beat };
    if (group === 2) return { kind: "visiting", label: "the hall (visiting)", visitorBeat: beat };
    return { kind: "lounge", label: "the lounge (visiting)", visitorBeat: beat };
  }
  return { kind: "lounge", label: "the lounge" };
}

/** A food visit uses event seconds, so refresh, pause and rewind preserve the meal. */
export function foodVisit(timeline, slot, startedAt) {
  const elapsed = Math.max(0, (slot - startedAt) * timeline.event.slot_minutes * 60);
  // Allow for floating-point conversion at the half-open phase boundaries.
  const seconds = Math.round(elapsed * 1e6) / 1e6;
  if (seconds >= 400) return null;
  const phase = seconds < 20 ? "serving-first" : seconds < 40 ? "serving-second"
    : seconds < 70 ? "seating" : seconds < 370 ? "eating" : "trash";
  const labels = { "serving-first": "the first food table, filling a plate",
    "serving-second": "the second food table, filling a plate", seating: "the food seating with a plate",
    eating: "the food seating, eating", trash: "the trash bin, clearing a plate" };
  return { kind: "food", label: labels[phase], foodPhase: phase,
    plate: seconds < 390, foodRemaining: Math.max(0, Math.min(1, (370 - seconds) / 300)) };
}

/** Explicit choices override automatic activity while their table/visitor context still applies. */
export function resolveLocation(timeline, person, slot, active = activeEvents(timeline, slot)) {
  const ordinary = ordinaryLocation(timeline, person, slot);
  if (ordinary.kind === "absent") return ordinary;
  if (active.break) {
    if (active.spotlight?.person === person.id) return { kind: "spotlight", label: "the stage", event: active.spotlight };
    return { kind: "lounge", label: "the lounge (break)", event: active.break };
  }
  const moves = person.movements || [];
  let finishedFood = false;
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const move = moves[index];
    if (move.at > slot) continue;
    if (ordinary.kind === "table" ? move.table !== ordinary.table.id
      : move.table !== null || !timeline.visitors?.people.includes(person.id)) break;
    // A visitor's choice before a game must not resume after that game ends.
    if (move.table === null && timeline.tables.some((table) => table.start > move.at && table.start <= slot
      && (table.dm === person.id || table.signups.some((signup) => signup.person === person.id)))) break;
    if (move.destination === "food") {
      if (finishedFood) continue;
      const visit = foodVisit(timeline, slot, move.at);
      if (visit) return visit;
      finishedFood = true;
      continue; // Resume the last lounge/table choice, without replaying older meals.
    }
    return move.destination === "table" ? ordinary : { kind: "lounge", label: "the lounge" };
  }
  if (active.spotlight?.person === person.id) return { kind: "spotlight", label: "the stage", event: active.spotlight };
  if (active.meal && !finishedFood) {
    const visit = foodVisit(timeline, slot, active.meal.at ?? slot);
    if (visit) return { ...visit, event: active.meal };
  }
  // Visitors can finish a meal across a four-minute wandering beat.
  if (ordinary.visitorBeat !== undefined && !finishedFood) {
    for (const beat of [ordinary.visitorBeat, ordinary.visitorBeat - 1]) {
      const start = beat * 4 / timeline.event.slot_minutes;
      if (start < 0 || ordinaryLocation(timeline, person, start).kind !== "food") continue;
      const visit = foodVisit(timeline, slot, start);
      if (visit) return visit;
    }
  }
  return ordinary.kind === "food" ? { kind: "lounge", label: "the lounge" } : ordinary;
}

/** Food tables, seats and bin share geometry with the rendered furniture. */
export function foodGeometry(layout, index = 0, count = 1) {
  const { x, y } = layout.food;
  const columns = Math.min(6, Math.max(1, count));
  const rows = Math.ceil(count / columns);
  return {
    first: { x: x + 2, y: y + 2.3 },
    second: { x: x + 5.8, y: y + 2.5 },
    seat: { x: x + 8 + (index % columns) * 1.15,
      y: y + 2.1 + Math.floor(index / columns) * Math.min(1.4, 3 / Math.max(1, rows - 1)) },
    bin: { x: x + 15, y: y + 4.8 },
  };
}

/** Allocate activities once for the people actually in the lounge, excluding speakers and diners. */
export function loungeActivities(layout, people) {
  const result = new Map();
  const ordered = [...people].sort((a, b) => a.id.localeCompare(b.id));
  const count = ordered.length;
  const groups = count <= 6 ? 1 : Math.ceil(count / 4);
  const columns = Math.max(1, Math.min(groups, Math.floor((layout.lounge.w - 6) / 5)));
  const rows = Math.ceil(groups / columns);
  let index = 0;
  for (let group = 0; group < groups; group += 1) {
    const size = Math.floor(count / groups) + (group < count % groups ? 1 : 0);
    const activity = count === 1 ? "reading" : count === 2 ? "chatting"
      : count <= 6 || group % 2 === 0 ? "cards" : "chatting";
    const center = { x: layout.lounge.x + 5 + (group % columns) * (layout.lounge.w - 8) / columns,
      y: layout.lounge.y + 2.5 + (Math.floor(group / columns) - (rows - 1) / 2) * 2 / rows };
    for (let member = 0; member < size; member += 1) {
      const angle = member * Math.PI * 2 / size;
      result.set(ordered[index++].id, { activity, group, center,
        label: `the lounge, ${activity === "cards" ? "playing cards" : activity}`,
        position: { x: center.x + (size === 1 ? 0 : Math.cos(angle) * 1.2),
          y: center.y + (size === 1 ? 0 : Math.sin(angle) * .65) } });
    }
  }
  return result;
}

export function playbackSpeed(requested, active) {
  if (active.announce || active.spotlight) return Math.min(requested, 30);
  if (active.break || active.meal) return Math.min(requested, 120);
  return requested;
}

export function modeAt(timeline, milliseconds) {
  const start = Date.parse(timeline.event.start);
  const endPlusHour = slotToMs(timeline, timeline.event.slots) + 60 * 60_000;
  return milliseconds >= start && milliseconds <= endPlusHour ? "live" : "replay";
}

export function crossedSpeechEvents(timeline, fromSlot, toSlot) {
  if (toSlot <= fromSlot) return [];
  return timeline.events.filter((item) => SPEECH_KINDS.has(item.kind)
    && (item.at > fromSlot || (fromSlot === 0 && item.at === 0))
    && item.at <= toSlot);
}

export function createLiveState(timeline) {
  return {
    snapshot: timeline,
    seenEventIds: new Set(timeline.events.filter((item) => POINT_KINDS.has(item.kind)).map((item) => item.id)),
    speechQueue: [],
  };
}

function capLiveShouts(queue) {
  let shoutCount = queue.reduce((count, event) => count + (event.kind === "shout" ? 1 : 0), 0);
  if (shoutCount <= 10) return queue;
  const result = [];
  for (const event of queue) {
    if (event.kind === "shout" && shoutCount > 10) {
      shoutCount -= 1;
      continue;
    }
    result.push(event);
  }
  return result;
}

/** Apply only a strictly newer valid snapshot. Existing objects disappear when absent from it. */
export function reconcileLiveSnapshot(state, timeline) {
  if (Date.parse(timeline.generated_at) <= Date.parse(state.snapshot.generated_at)) return { ...state, changed: false };
  const seenEventIds = new Set(state.seenEventIds);
  const additions = [];
  for (const event of timeline.events) {
    if (!POINT_KINDS.has(event.kind) || seenEventIds.has(event.id)) continue;
    seenEventIds.add(event.id);
    if (SPEECH_KINDS.has(event.kind)) additions.push(event);
  }
  const speechQueue = capLiveShouts([...state.speechQueue, ...additions]);
  return { snapshot: timeline, seenEventIds, speechQueue, changed: true };
}

export function shiftSpeechQueue(state) {
  if (state.speechQueue.length === 0) return { state, event: null };
  const [event, ...speechQueue] = state.speechQueue;
  return { state: { ...state, speechQueue }, event };
}

export function personTooltip(person, location, moving = false) {
  const who = person?.hidden ? "someone" : `${person?.dm ? "DM " : ""}${displayName(person)}`;
  return `${who} ${moving ? "moving to" : "at"} ${location.label}`;
}

export function speechView(timeline, speechEvent, slot, active = activeEvents(timeline, slot)) {
  const person = timeline.people.find((candidate) => candidate.id === speechEvent.person);
  const place = person ? resolveLocation(timeline, person, slot, active) : { kind: "absent", label: "outside the hall" };
  return {
    kind: speechEvent.kind,
    text: speechEvent.text,
    speaker: displayName(person),
    stageSide: place.kind === "absent",
    label: place.kind === "absent" ? `From ${displayName(person)}` : null,
    person,
    place,
  };
}

/** Plain-text equivalent of every canvas-only event reaction. */
export function accessibleEventText(timeline, active, speechEvent = null) {
  const parts = [];
  if (active.break) parts.push(`Staff announcement: Break time! Take a ${active.break.duration * timeline.event.slot_minutes}-minute break in the lounge, then return to your game.`);
  if (active.announce) parts.push(`Announcement: ${active.announce.text}`);
  if (active.spotlight) {
    const person = timeline.people.find((candidate) => candidate.id === active.spotlight.person);
    parts.push(`Spotlight: ${displayName(person)}${active.spotlight.text ? `. ${active.spotlight.text}` : ""}`);
  }
  if (speechEvent) {
    const person = timeline.people.find((candidate) => candidate.id === speechEvent.person);
    const label = speechEvent.kind === "donation" ? "Table message" : "Reaction";
    parts.push(`${label} from ${displayName(person)}: ${speechEvent.text}`);
  }
  return parts.join(" ");
}

export function tableView(timeline, table) {
  const byId = new Map(timeline.people.map((person) => [person.id, person]));
  return {
    name: table.name,
    system: table.system,
    pitch: table.pitch,
    dm: displayName(byId.get(table.dm)),
    start: table.start,
    end: table.end,
    seats: table.seats,
    signupCount: table.signups.length,
    walkIns: table.walk_ins,
    roster: table.signups.map((signup) => ({
      name: displayName(byId.get(signup.person)),
      planned: [...signup.planned],
      actual: signup.actual && [...signup.actual],
    })),
  };
}


/** Public actions only; resolve names from the current privacy projection. */
export function publicActivity(timeline) {
  const people = new Map(timeline.people.map((person) => [person.id, person]));
  const tables = new Map(timeline.tables.map((table) => [table.id, table]));
  const who = (id) => id === null ? "Event coordinator" : displayName(people.get(id));
  const tableName = (id) => id ? ` — ${tables.get(id)?.name || "removed game"}` : "";
  const entries = (timeline.activity || []).map((entry) => ({
    id: `activity-${entry.id}`, at: Date.parse(entry.at),
    text: `${who(entry.actor)} ${ACTIVITY_LABELS[entry.action]}${entry.person ? ` (${who(entry.person)})` : ""}${tableName(entry.table)}.`,
  }));
  for (const person of timeline.people) {
    for (const [index, move] of (person.movements || []).entries()) {
      const at = slotToMs(timeline, move.at);
      const action = `move_${move.destination}`;
      // Older movement history predates the durable activity log.
      if ((timeline.activity || []).some((entry) => entry.action === action && entry.actor === person.id
        && entry.table === move.table && Math.abs(Date.parse(entry.at) - at) < 2)) continue;
      entries.push({ id: `movement-${person.id}-${index}`, at,
        text: `${who(person.id)} ${ACTIVITY_LABELS[action]}${tableName(move.table)}.` });
    }
  }
  for (const event of timeline.events) {
    let text;
    if (event.kind === "roll") {
      if (event.visibility !== "public") continue;
      text = diceText(timeline, event) + tableName(event.table);
    } else if (["shout", "donation"].includes(event.kind)) text = `${who(event.person)}: ${event.text || ""}`;
    else if (event.kind === "spotlight") text = `${who(event.by)} spotlighted ${who(event.person)}${event.text ? `: ${event.text}` : "."}`;
    else if (event.kind === "announce") text = `${who(event.by)} announced: ${event.text || ""}`;
    else text = `${who(event.by)} started ${event.kind === "meal" ? "a meal" : "a break"}${event.text ? `: ${event.text}` : "."}`;
    entries.push({ id: `event-${event.id}`, at: slotToMs(timeline, event.at), text });
  }
  return entries.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}
