import { CHOICE_COUNTS } from "./characters.mjs";
import { FOOD_CORNER, atFood, foodSetOut, foodClearAt, SET_OUT_SECONDS, kitchenPath } from "./food-layout.mjs?v=44523bdb9315";
export { foodGeometry } from "./food-layout.mjs?v=44523bdb9315";

const ADMIN_KINDS = new Set(["break", "meal", "announce", "spotlight"]);
const SPEECH_KINDS = new Set(["shout", "donation"]);
const ALL_KINDS = new Set([...ADMIN_KINDS, ...SPEECH_KINDS, "roll"]);
const POINT_KINDS = new Set(["announce", "spotlight", "shout", "donation", "roll"]);

export const PALETTE_SIZE = 15;
export const ANNOUNCE_MINUTES = 8;
export const SPOTLIGHT_MINUTES = 14;
export const MOVEMENT_PRIORITY = Object.freeze(["spotlight-person", "break", "meal", "ordinary"]);
export const TABLE_COLUMNS = 5;
export const LOCAL_SEAT_COUNT = 10;
// Overflow chairs sit two tiles apart across the table grid's width.
export const OVERFLOW_COLUMNS = TABLE_COLUMNS * 3;

const ACTIVITY_LABELS = Object.freeze({
  set_presence: "updated their event attendance", here: "checked in", leaving: "checked out",
  create_table: "created a game", edit_table: "edited a game", delete_table: "deleted a game",
  end_table: "ended a game", join: "joined or updated their game seat", leave_table: "left a game",
  set_appearance: "changed their character", hide: "hid their identity", unseat: "removed a player from a game",
  join_visitors: "joined the Visitors Table", leave_visitors: "left the Visitors Table",
  open_visitors: "opened visitor signups", close_visitors: "closed visitor signups",
  remove_visitor: "removed a visitor", remove: "removed a public message", finalize: "finalized the event",
  move_food: "went to get food", move_lounge: "went to the lounge", move_table: "returned to the table",
  event_window: "updated the event details",
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
    host_name: string(rawEvent.host_name === undefined ? "" : rawEvent.host_name, "timeline.event.host_name", { max: 100 }),
    host_icon_url: string(rawEvent.host_icon_url === undefined ? "" : rawEvent.host_icon_url, "timeline.event.host_icon_url", { max: 2048 }),
    name: string(required(rawEvent, "name", "timeline.event"), "timeline.event.name", { min: 1 }),
    start: dateString(required(rawEvent, "start", "timeline.event"), "timeline.event.start", "numeric-offset"),
    tz: string(required(rawEvent, "tz", "timeline.event"), "timeline.event.tz", { min: 1 }),
    slot_minutes: number(required(rawEvent, "slot_minutes", "timeline.event"), "timeline.event.slot_minutes", { integer: true, min: 1 }),
    slots: number(required(rawEvent, "slots", "timeline.event"), "timeline.event.slots", { integer: true, min: 1 }),
  };

  if (event.host_icon_url) {
    let icon;
    try { icon = new URL(event.host_icon_url); } catch { fail("Invalid host icon URL."); }
    if (icon.protocol !== "https:" || !icon.hostname || icon.username || icon.password ||
        /[\s\\]/.test(event.host_icon_url) || !event.host_name.trim()) fail("Invalid host icon URL or missing host name.");
  }
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

  // Practice before doors rides the live feed only, as an optional key; every stored snapshot lacks it,
  // and a validated snapshot carries null, so both read as absent.
  let practice = null;
  if (root.practice !== undefined && root.practice !== null) {
    const raw = object(root.practice, "timeline.practice");
    const rawPeople = object(required(raw, "people", "timeline.practice"), "timeline.practice.people");
    const practicePeople = {};
    for (const [id, rawEntry] of Object.entries(rawPeople)) {
      if (!personById.has(id)) fail("Unknown practice person.");
      const label = `timeline.practice.people.${id}`;
      const entry = object(rawEntry, label);
      const position = string(required(entry, "position", label), `${label}.position`);
      if (!["table", "food", "lounge"].includes(position)) fail("Invalid practice position.");
      const table = string(required(entry, "table", label), `${label}.table`, { nullable: true, min: 1 });
      if (table !== null && !tableIds.has(table)) fail("Unknown practice table.");
      practicePeople[id] = { position, table };
    }
    const speech = array(required(raw, "speech", "timeline.practice"), "timeline.practice.speech").map((rawEntry, index) => {
      const label = `timeline.practice.speech[${index}]`;
      const entry = object(rawEntry, label);
      const person = string(required(entry, "person", label), `${label}.person`, { min: 1 });
      if (!personById.has(person)) fail("Unknown practice person.");
      const text = string(required(entry, "text", label), `${label}.text`, { min: 1, max: 200 });
      const at = dateString(required(entry, "at", label), `${label}.at`, "zero-offset");
      return { person, text, at };
    });
    practice = { people: practicePeople, speech };
  }
  return { schema, visitors, phase, generated_at, event, people, tables, events, room_layout, activity, practice };
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

/** Text for the latest public roll; empty when there is none, so the notice only appears once a roll exists. */
export function diceText(timeline, event) {
  if (!event || event.kind !== "roll" || event.visibility !== "public") return "";
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
const CARETAKER_TOURS = new WeakMap();
const CARETAKER_TILES_PER_SECOND = 1.2;
const CARETAKER_LEGS = 40;
const EXIT_SECONDS = 2;
const SWITCHING_OFF = 'The hall is empty. Staff are switching off the lights.';
const HEADING_HOME = 'The lights are off. Staff are heading home.';
const GONE_HOME = 'The hall is dark and empty. Staff have gone home.';
const CIRCULATING = 'Lights are on. Staff are circulating through the hall.';
/** The eve is the last day before doors; the hall empties and goes dark at its start. */
export const EVE_MS = 24 * 60 * 60_000;
/** Tour dwells are 3–10 event-seconds (mean 6.5); at real-time pace one stop should take about half a minute. */
export const GATHERING_DWELL_FACTOR = 4.6;
/** Seconds after the eve begins until the caretaker has switched off and left. */
export const EVE_EXIT_SECONDS = 60 + EXIT_SECONDS;
const GATHERING_TOURS = new WeakMap();

// FNV-1a over the event start seeds a mulberry32 stream, so every replay, seek and reload walks one tour.
function seededRandom(seed) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  let state = hash || 1;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walkable stops for the caretaker; `row` is the corridor each one joins the trunk along. */
function caretakerWaypoints(layout) {
  const nearestAisle = y => layout.aisles.reduce((best, aisle) => Math.abs(aisle - y) < Math.abs(best - y) ? aisle : best);
  const point = (x, y, row = y) => ({ x, y, row });
  const loungeY = layout.lounge.y + 2;
  const stairsX = layout.stage.x - .8;
  const points = [point(1.3, layout.door.y - .8)];
  for (const aisle of layout.aisles) {
    points.push(point(layout.trunkX, aisle));
    for (const fraction of [.25, .5, .75]) points.push(point(Math.round(layout.width * fraction), aisle));
  }
  for (const spot of FOOD_CORNER.staffSpots) {
    const p = atFood(layout, spot);
    points.push(point(p.x, p.y, layout.aisles[0]));
  }
  for (const x of [layout.lounge.x + 1.5, layout.lounge.x + layout.lounge.w - 1.5]) points.push(point(x, loungeY));
  for (const offset of [-3, 0, 3]) {
    const y = Math.max(layout.aisles[0], Math.min(layout.aisles.at(-1), layout.stageFront.y + offset));
    points.push(point(stairsX, y, nearestAisle(y)));
  }
  points.push(point(layout.doorPosition.x, layout.doorPosition.y));
  return points;
}

// Manhattan legs: out to the stop's corridor, along it to the trunk, down the trunk, and in again.
function corridorPath(layout, from, to) {
  const path = [];
  const push = ({ x, y }) => {
    const last = path.at(-1) ?? from;
    if (Math.abs(last.x - x) > 1e-9 || Math.abs(last.y - y) > 1e-9) path.push({ x, y });
  };
  push({ x: from.x, y: from.row });
  if (from.row !== to.row) {
    push({ x: layout.trunkX, y: from.row });
    push({ x: layout.trunkX, y: to.row });
  }
  push({ x: to.x, y: to.row });
  push(to);
  return path;
}

/** The caretaker's seeded tour: stops with dwell, routed along the corridors, ending where it began. */
export function caretakerTour(timeline, layout) {
  const cached = CARETAKER_TOURS.get(timeline);
  if (cached?.layout === layout) return cached.tour;
  const points = caretakerWaypoints(layout);
  const random = seededRandom(String(timeline.event.start ?? ''));
  const pick = exclude => {
    const options = points.filter(point => !exclude.includes(point));
    return options[Math.floor(random() * options.length)];
  };
  const stops = [points[0]];
  for (let index = 1; index < CARETAKER_LEGS; index += 1) {
    const exclude = [stops.at(-1), stops.at(-2)];
    if (index >= CARETAKER_LEGS - 2) exclude.push(points[0]);
    if (index === CARETAKER_LEGS - 1) exclude.push(stops[1]);
    stops.push(pick(exclude));
  }
  const dwell = stops.map(() => 3 + random() * 7);
  stops.push(points[0]);
  const segments = [];
  for (let index = 0; index < CARETAKER_LEGS; index += 1) {
    const here = { x: stops[index].x, y: stops[index].y };
    segments.push({ from: here, to: here, seconds: dwell[index] });
    let from = here;
    for (const to of corridorPath(layout, stops[index], stops[index + 1])) {
      segments.push({ from, to, seconds: Math.hypot(to.x - from.x, to.y - from.y) / CARETAKER_TILES_PER_SECOND });
      from = to;
    }
  }
  const tour = { stops: stops.map(({ x, y }) => ({ x, y })), dwell, segments,
    seconds: segments.reduce((sum, segment) => sum + segment.seconds, 0) };
  CARETAKER_TOURS.set(timeline, { layout, tour });
  return tour;
}

const KITCHEN_SERVICES = new WeakMap();
const SERVICE_SPEED = 2;
const foodTimeKey = seconds => Math.round(seconds * 1e6);
const clampUnit = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const interpolate = (a, b, fraction) => ({ x: a.x + (b.x - a.x) * clampUnit(fraction),
  y: a.y + (b.y - a.y) * clampUnit(fraction) });

function hallIntervals(timeline) {
  let intervals = HALL_OCCUPANCY.get(timeline);
  if (intervals) return intervals;
  const unit = timeline.event.slot_minutes * 60;
  const ranges = timeline.people.map(p => effectivePresence(p, timeline.event.slots))
    .filter(r => r && r[0] < r[1]).map(([a, b]) => [Math.max(0, a) * unit, Math.min(timeline.event.slots, b) * unit])
    .filter(([a, b]) => a < b).sort((a, b) => a[0] - b[0]);
  intervals = [];
  for (const range of ranges) {
    const last = intervals.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else intervals.push(range);
  }
  HALL_OCCUPANCY.set(timeline, intervals);
  return intervals;
}

/** Exact candidates only: no frame or time-grid sampling of the event. */
function rawFoodVisits(timeline) {
  const unit = timeline.event.slot_minutes * 60;
  const meals = (timeline.events ?? []).filter(e => e.kind === 'meal');
  const visits = [];
  for (const person of timeline.people) {
    const presence = effectivePresence(person, timeline.event.slots);
    if (!presence) continue;
    const candidates = new Set(meals.map(e => mealVisitStart(timeline, person, e, e.at)));
    for (const move of person.movements ?? []) if (move.destination === 'food') candidates.add(move.at);
    if (timeline.visitors?.people.includes(person.id)) {
      for (let beat = Math.max(0, Math.ceil(presence[0] * unit / 240)); beat * 240 < Math.min(presence[1], timeline.event.slots) * unit; beat++) {
        const at = beat * 4 / timeline.event.slot_minutes;
        if (ordinaryLocation(timeline, person, at).kind === "food") candidates.add(at);
      }
    }
    for (const at of candidates) {
      if (at < 0 || at >= timeline.event.slots || !isPresent(person, at, timeline.event.slots)) continue;
      visits.push({ start: at * unit, at, person });
    }
  }
  return visits.sort((a, b) => a.start - b.start);
}

function tourState(tour, clock) {
  let elapsed = clock % tour.seconds;
  for (const segment of tour.segments) {
    if (elapsed < segment.seconds) return { position: interpolate(segment.from, segment.to, elapsed / segment.seconds),
      end: segment.to, remaining: distance(segment.from, segment.to) ? segment.seconds - elapsed : 0 };
    elapsed -= segment.seconds;
  }
  return { position: tour.stops[0], end: tour.stops[0], remaining: 0 };
}

function routePoint(layout, position) {
  const stop = caretakerWaypoints(layout).find(p => distance(p, position) < 1e-7);
  // Segment endpoints lie on an aisle/trunk unless they are an authored stop.
  return stop ?? { ...position, row: position.y };
}

function kitchenCooking(layout, start, duration, seed) {
  const random = seededRandom(seed), segments = [];
  let time = start, station = 8;
  const append = (from, to, seconds) => {
    segments.push({ start: time, end: time + seconds, from, to }); time += seconds;
  };
  // Do not cut a straight walking segment short when cleanup is requested.
  while (time < start + duration) {
    const here = atFood(layout, FOOD_CORNER.kitchenStations[station]);
    append(here, here, Math.min(4 + random() * 5, start + duration - time));
    if (time >= start + duration) break;
    const next = (station + 1 + Math.floor(random() * 8)) % 9;
    const path = kitchenPath(layout, station, next);
    let reached = true;
    for (let i = 1; i < path.length; i++) {
      append(path[i - 1], path[i], distance(path[i - 1], path[i]) / CARETAKER_TILES_PER_SECOND);
      if (time >= start + duration) {
        // The kitchen graph is a tree. Return via this segment's forward node.
        const node = [...FOOD_CORNER.kitchenStations, { x: 3.65, y: 3 }]
          .findIndex(p => distance(atFood(layout, p), path[i]) < 1e-7);
        station = node; reached = false; break;
      }
    }
    if (reached) station = next;
  }
  const back = kitchenPath(layout, station, 8);
  for (let i = 1; i < back.length; i++) append(back[i - 1], back[i], distance(back[i - 1], back[i]) / CARETAKER_TILES_PER_SECOND);
  return { segments, end: time };
}

/** Quiet service, including a service whose diners have all been superseded. */
export function kitchenCleanup(layout, start, readyTime, lastDinerEnd = readyTime, emptyAt = Infinity) {
  const requested = Math.max(readyTime, Math.min(lastDinerEnd + 300, emptyAt));
  return { ...kitchenCooking(layout, readyTime, requested - readyTime, String(start)), requested,
    emptied: emptyAt <= lastDinerEnd + 300 };
}

/** One cached event schedule; rounds restart at clock zero after a reopening at the switch. */
function kitchenSchedule(timeline, layout) {
  const cached = KITCHEN_SERVICES.get(timeline);
  if (cached?.layout === layout) return cached;
  const unit = timeline.event.slot_minutes * 60, horizon = timeline.event.slots * unit;
  const intervals = hallIntervals(timeline), visits = rawFoodVisits(timeline);
  const services = [], pieces = [], readyByStart = new Map();
  const tour = caretakerTour(timeline, layout), lightSwitch = tour.stops[0];
  const pickup = atFood(layout, FOOD_CORNER.pickup);
  const kitchenDoor = { ...atFood(layout, FOOD_CORNER.staffSpots[0]), row: layout.aisles[0] };
  const opening = Math.max(0, (intervals[0]?.[0] ?? 0) - 60);
  let now = opening, position = layout.doorPosition, tourClock = 0, vi = 0;
  const nextVisit = () => {
    while (vi < visits.length) {
      const candidate = visits[vi];
      // Readiness of earlier visits is already known. This checks exact supersession without a cycle.
      const selected = resolveLocation(timeline, candidate.person, candidate.at, activeEvents(timeline, candidate.at),
        (_data, slot, at) => {
          const raw = at * unit, effective = Math.max(raw, readyByStart.get(foodTimeKey(raw)) ?? raw);
          return slot * unit < effective + 400 ? { kind: 'food', rawStart: raw } : null;
        });
      if (selected.rawStart !== undefined && foodTimeKey(selected.rawStart) === foodTimeKey(candidate.start)) {
        candidate.reason = selected.event?.kind === 'meal' ? 'meal' : 'visit';
        return candidate;
      }
      vi++;
    }
    return null;
  };
  const occupied = time => intervals.some(([a, b]) => a <= time && time < b);
  const nextArrival = time => intervals.find(([a]) => a > time)?.[0] ?? Infinity;
  const nextDeparture = time => intervals.find(([, b]) => b > time)?.[1] ?? Infinity;
  const add = (end, data) => { if (end > now) pieces.push({ start: now, end, ...data }); now = end; };
  const walk = (path, speed, action, extra = {}) => {
    for (let i = 1; i < path.length; i++) {
      add(now + distance(path[i - 1], path[i]) / speed, { from: path[i - 1], to: path[i], action, ...extra });
    }
    position = path.at(-1);
  };
  const roundUntil = end => { add(end, { roundClock: tourClock, action: CIRCULATING }); tourClock += pieces.at(-1).end - pieces.at(-1).start;
    position = tourState(tour, tourClock).position; };
  const openingAction = 'Staff are turning on the lights.';
  add(now + 4, { from: position, to: lightSwitch, action: openingAction, lightFrom: 0, lightTo: 0 });
  position = lightSwitch;
  add(now + 2, { from: position, to: position, action: openingAction, lightFrom: 0, lightTo: 1 });
  add(now + 2, { from: position, to: position, action: openingAction });
  let returnPath = null, returnToSwitch = false;
  while (now <= horizon || vi < visits.length) {
    const demand = nextVisit()?.start ?? Infinity;
    if (demand <= now && occupied(now)) {
      const start = services.length ? Math.max(now, demand) : demand, service = { start, walkIn: 0, reason: visits[vi].reason };
      services.push(service);
      if (!returnPath) {
        const state = tourState(tour, tourClock);
        if (state.remaining && distance(position, state.position) < 1e-7) {
          walk([position, state.end], CARETAKER_TILES_PER_SECOND, 'Staff are heading to the kitchen.', { service, load: 'food' });
          tourClock += state.remaining;
        }
        const leave = routePoint(layout, position);
        // Return to the segment end, where the paused tour will resume.
        returnPath = [position, ...corridorPath(layout, leave, kitchenDoor), pickup];
        walk(returnPath, SERVICE_SPEED, 'Staff are heading to the kitchen.', { service, load: 'food' });
      }
      service.walkIn = now - start;
      service.setOutStart = now;
      service.readyTime = now + SET_OUT_SECONDS;
      add(service.readyTime, { service, phase: 'set-out', action: 'Staff are setting out food.' });
      position = pickup;
      let quiet = service.readyTime;
      const departure = nextDeparture(start);
      // Extend the quiet window with every visit beginning before cleanup is requested.
      while (nextVisit()?.start < Math.min(quiet + 300, departure)) {
        const visit = visits[vi++];
        readyByStart.set(foodTimeKey(visit.start), service.readyTime);
        quiet = Math.max(quiet, Math.max(visit.start, service.readyTime) + 400);
      }
      let cooking = kitchenCleanup(layout, start, service.readyTime, quiet, departure);
      // Food stays available while the cook returns to pickup. A new diner cancels quiet cleanup.
      while (!cooking.emptied && nextVisit()?.start < cooking.end) {
        const visit = visits[vi++];
        readyByStart.set(foodTimeKey(visit.start), service.readyTime);
        quiet = Math.max(quiet, visit.start + 400);
        while (nextVisit()?.start < Math.min(quiet + 300, departure)) {
          const more = visits[vi++];
          readyByStart.set(foodTimeKey(more.start), service.readyTime); quiet = Math.max(quiet, more.start + 400);
        }
        cooking = kitchenCleanup(layout, start, service.readyTime, quiet, departure);
      }
      service.lastDinerEnd = quiet;
      service.cleanupRequested = cooking.requested;
      service.emptied = cooking.emptied;
      returnToSwitch ||= service.emptied;
      service.cleanupStart = cooking.end;
      for (const part of cooking.segments) add(part.end, { ...part, service, phase: 'cooking', action: 'Staff are cooking in the kitchen.' });
      service.cleanupEnd = now + SET_OUT_SECONDS;
      add(service.cleanupEnd, { service, phase: 'cleanup', action: 'Staff are clearing the food table.' });
      // Requests during cleanup start the next service here, without a trip into the hall.
      if (nextVisit()?.start <= now && occupied(now)) {
        service.backEnd = now;
        continue;
      }
      const target = returnToSwitch || !occupied(now) ? lightSwitch : returnPath[0];
      const path = target === lightSwitch
        ? [pickup, kitchenDoor, ...corridorPath(layout, kitchenDoor, routePoint(layout, lightSwitch))]
        : [...returnPath].reverse();
      walk(path, SERVICE_SPEED, 'Staff are heading back to the hall.', { service });
      service.backEnd = now;
      returnPath = null; returnToSwitch = false;
      if (target === lightSwitch) tourClock = 0;
      continue;
    }
    if (occupied(now) || now < (intervals[0]?.[0] ?? opening + 60)) {
      const end = Math.min(demand, occupied(now) ? nextDeparture(now) : (intervals[0]?.[0] ?? opening + 60), horizon + 1);
      if (end > now) roundUntil(end);
      else if (demand <= now) vi++;
      continue;
    }
    // Finish closing, interrupting from the actual position if attendance resumes.
    const arrival = nextArrival(now);
    const state = tourState(tour, tourClock);
    const finishSegment = state.remaining && distance(state.position, position) < 1e-7;
    const departurePoint = finishSegment ? state.end : position;
    const path = [position, ...(finishSegment ? [departurePoint] : []),
      ...corridorPath(layout, routePoint(layout, departurePoint), routePoint(layout, lightSwitch))];
    let interrupted = false, reopenPath = null;
    for (let i = 1; i < path.length; i++) {
      const speed = finishSegment && i === 1 ? CARETAKER_TILES_PER_SECOND : SERVICE_SPEED;
      const end = now + distance(position, path[i]) / speed;
      const to = arrival < end ? interpolate(position, path[i], (arrival - now) / (end - now)) : path[i];
      add(Math.min(end, arrival), { from: position, to, action: SWITCHING_OFF }); position = to;
      if (now === arrival) { interrupted = true; reopenPath = [position, ...path.slice(i)]; break; }
    }
    if (!interrupted) {
      const fadeEnd = now + 4;
      add(Math.min(fadeEnd, arrival), { from: position, to: position, action: SWITCHING_OFF, lightFrom: 1,
        lightTo: 1 - clampUnit((Math.min(fadeEnd, arrival) - now) / 4) });
      if (now === arrival) interrupted = true;
    }
    if (!interrupted) {
      const end = now + EXIT_SECONDS;
      const to = arrival < end ? interpolate(position, layout.doorPosition, (arrival - now) / EXIT_SECONDS) : layout.doorPosition;
      add(Math.min(end, arrival), { from: position, to, action: HEADING_HOME, lightFrom: 0, lightTo: 0 }); position = to;
      if (now === arrival) interrupted = true;
    }
    if (!interrupted) {
      add(arrival, { gone: true, action: GONE_HOME, lightFrom: 0, lightTo: 0 });
      if (!Number.isFinite(arrival)) break;
    }
    const backAction = 'Staff are turning the lights back on.';
    const backPath = reopenPath ?? [position, ...corridorPath(layout, routePoint(layout, position), routePoint(layout, lightSwitch))];
    const length = backPath.slice(1).reduce((sum, p, i) => sum + distance(backPath[i], p), 0);
    walk(backPath, Math.min(SERVICE_SPEED, length / 8), backAction, { lightFrom: 0, lightTo: 0 });
    add(now + 4, { from: position, to: position, action: backAction, lightFrom: 0, lightTo: 1 });
    tourClock = 0;
    // Ignore candidates whose people left before reopening completed.
    while (nextVisit()?.start < now && !occupied(visits[vi].start)) vi++;
  }
  const result = { layout, services, pieces, readyByStart, tour, intervals, opening };
  KITCHEN_SERVICES.set(timeline, result);
  return result;
}

export function kitchenServices(timeline, layout = KITCHEN_SERVICES.get(timeline)?.layout ?? createRoomLayout(timeline.tables ?? [], timeline.room_layout)) {
  return kitchenSchedule(timeline, layout).services;
}

/** Decorative caretaker and dishes, entirely determined by event seconds. */
export function hallAmbience(timeline, slot, layout, reducedMotion = false) {
  const schedule = kitchenSchedule(timeline, layout);
  let seconds = Math.max(0, slot * timeline.event.slot_minutes * 60);
  if (slot === timeline.event.slots) seconds += 12;
  const lightSwitch = schedule.tour.stops[0], pickup = atFood(layout, FOOD_CORNER.pickup);
  let lo = 0, hi = schedule.pieces.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (schedule.pieces[mid].end <= seconds) lo = mid + 1; else hi = mid; }
  const piece = schedule.pieces[lo];
  let staff = null, foodCount = 0, foodProgress = 0, lights = 0;
  let action = 'The hall is dark. Staff have not arrived yet.';
  if (piece && seconds >= schedule.opening) {
    const fraction = (seconds - piece.start) / (piece.end - piece.start);
    action = piece.action;
    lights = (piece.lightFrom ?? 1) + ((piece.lightTo ?? 1) - (piece.lightFrom ?? 1)) * clampUnit(fraction);
    if (!piece.gone) staff = piece.roundClock !== undefined
      ? tourState(schedule.tour, piece.roundClock + seconds - piece.start).position
      : piece.from ? interpolate(piece.from, piece.to, fraction) : pickup;
    if (piece.phase === 'set-out' || piece.phase === 'cleanup') {
      const elapsed = seconds - piece.start;
      foodProgress = (piece.phase === 'cleanup' ? 1 - elapsed / SET_OUT_SECONDS : elapsed / SET_OUT_SECONDS) * 6;
      const food = piece.phase === 'cleanup' ? foodClearAt(layout, elapsed) : foodSetOut(layout, foodProgress);
      foodCount = food.count; staff = { ...food.staff, carrying: food.dish };
    } else if (piece.phase === 'cooking') { foodCount = 6; foodProgress = 6; }
    if (staff) staff = { ...staff, load: piece.load ?? null, carrying: staff.carrying ?? null };
    if (reducedMotion) {
      staff = staff && { ...(piece.service ? pickup : lightSwitch), load: null, carrying: null };
      foodCount = piece.phase === 'cooking' ? 6 : 0;
      lights = action === SWITCHING_OFF || action === HEADING_HOME || piece.gone ? 0 : 1;
      const departure = schedule.intervals.filter(([, end]) => end <= seconds).at(-1)?.[1] ?? schedule.opening + 60;
      if (!piece.service && (action === SWITCHING_OFF || action === HEADING_HOME) && seconds >= departure + 8) {
        staff = null; action = GONE_HOME;
      }
    }
  }
  return { staff, lights, foodCount, foodProgress, lightSwitch, action,
    occupied: schedule.intervals.some(([a, b]) => a <= seconds && seconds < b) };
}

/** The seeded tour at wall-clock pace: walking legs unchanged, dwells stretched to about half a minute. */
function gatheringTour(timeline, layout) {
  const tour = caretakerTour(timeline, layout);
  let scaled = GATHERING_TOURS.get(tour);
  if (!scaled) {
    const segments = tour.segments.map(segment => segment.from.x === segment.to.x && segment.from.y === segment.to.y
      ? { ...segment, seconds: segment.seconds * GATHERING_DWELL_FACTOR } : segment);
    scaled = { stops: tour.stops, segments, seconds: segments.reduce((sum, segment) => sum + segment.seconds, 0) };
    GATHERING_TOURS.set(tour, scaled);
  }
  return scaled;
}

function doorsOpenText(timeline) {
  const start = Date.parse(timeline.event.start);
  const part = options => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: timeline.event.tz, ...options }).format(new Date(start)); }
    catch { return new Date(start).toISOString(); }
  };
  return `The hall is dark. Doors open ${part({ weekday: 'long' })} at ${part({ hour: 'numeric', minute: '2-digit' })}.`;
}

/** Ambience before the event, driven by the wall clock: a lit gathering, then the eve's closing and a dark hall.
 * Same shape as `hallAmbience`. Position is a function of the instant, so every page load agrees. */
export function gatheringAmbience(timeline, layout, milliseconds, reducedMotion = false) {
  const lightSwitch = { x: 1.3, y: layout.door.y - .8 };
  const tour = gatheringTour(timeline, layout);
  const clamp = value => Math.max(0, Math.min(1, value));
  const move = (from, to, progress) => ({ x: from.x + (to.x - from.x) * clamp(progress), y: from.y + (to.y - from.y) * clamp(progress) });
  const roam = seconds => {
    if (reducedMotion) return { ...tour.stops[0] };
    let remaining = ((seconds % tour.seconds) + tour.seconds) % tour.seconds;
    for (const segment of tour.segments) {
      if (remaining <= segment.seconds) {
        const progress = segment.seconds ? remaining / segment.seconds : 1;
        return { x: segment.from.x + (segment.to.x - segment.from.x) * progress,
          y: segment.from.y + (segment.to.y - segment.from.y) * progress };
      }
      remaining -= segment.seconds;
    }
    return { ...tour.stops[0] };
  };
  const eveStart = Date.parse(timeline.event.start) - EVE_MS;
  const elapsed = (milliseconds - eveStart) / 1000;
  let staff, lights = 1, action = CIRCULATING, occupied = true;
  if (elapsed < 0) {
    staff = roam(milliseconds / 1000);
  } else if (elapsed < 48) {
    // Attendees are walking out (staggered over the first 45 s); the caretaker keeps touring.
    staff = roam(eveStart / 1000 + elapsed);
  } else if (elapsed <= 60) {
    // Walk to the switch (48–56 s), then fade the lights (56–60 s), like the event-day closing.
    staff = reducedMotion ? { ...tour.stops[0] } : elapsed < 56 ? move(roam(eveStart / 1000 + 48), lightSwitch, (elapsed - 48) / 8) : { ...lightSwitch };
    lights = reducedMotion ? (elapsed < 60 ? 1 : 0) : 1 - clamp((elapsed - 56) / 4);
    action = SWITCHING_OFF;
  } else if (elapsed < EVE_EXIT_SECONDS) {
    staff = reducedMotion ? { ...tour.stops[0] } : move(lightSwitch, layout.doorPosition, (elapsed - 60) / EXIT_SECONDS);
    lights = 0;
    action = reducedMotion ? SWITCHING_OFF : HEADING_HOME;
  } else {
    staff = null; lights = 0; occupied = false;
    action = doorsOpenText(timeline);
  }
  return { staff: staff && { ...staff, load: null }, lights, foodCount: 0, lightSwitch, action, occupied };
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
 * area. The hall starts with two rows of tables and gains a row whenever a table's
 * pad (or, in legacy packages, its array index) falls past the last one. In schema 4
 * the overflow area fits every advertised seat, so signups never move the walls.
 * Only occupied overflow chairs are drawn.
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
  const padsInUse = room ? Math.max(0, ...tables.map((table) => table.pad + 1)) : tables.length;
  const tableRows = Math.max(2, Math.ceil(padsInUse / TABLE_COLUMNS));
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
    overflowRows: Math.ceil(Math.max(overflowSeats.length, room ? reservedOverflow(tables) : 0) / OVERFLOW_COLUMNS),
  };
}

function reservedOverflow(tables) {
  return tables.reduce((sum, table) => sum + Math.max(0, table.seats - (LOCAL_SEAT_COUNT - 1)), 0);
}

/** The grid origin and landmark rules are fixed; the room's size follows the tables it holds. */
export function createRoomLayout(tables, room = null) {
  const layout = { ...createSeatingPlan(tables, room), aisles: [] };
  layout.width = layout.gridX + layout.columns * layout.cellWidth + 8;
  const overflowHeight = layout.overflowRows ? 2 + layout.overflowRows * 2 : 0;
  layout.height = layout.tableGridBottom + overflowHeight + 6;
  layout.backWall = { x: 0, y: -6, w: layout.width, h: 6 };
  layout.stage = { x: layout.width - 7, y: 1, w: 6, h: layout.height - 2 };
  layout.food = { x: 1, y: 1, w: 23, h: 6 };
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

/**
 * Fixtures hung on the back wall, in tile units: the host banner over the entrance and the QR
 * plaques flush right. Every rect lies inside `layout.backWall` above the chair rail.
 */
export function wallFixtures(layout, { plaques = 2, banner = true } = {}) {
  const plaque = { w: 4.6, h: 5.2, y: -5.6 };
  const rects = [];
  for (let index = 0; index < plaques; index += 1) {
    rects.unshift({ x: Number((layout.width - 1 - (index + 1) * plaque.w - index).toFixed(2)), y: plaque.y, w: plaque.w, h: plaque.h });
  }
  // The banner leaves room for the jukebox and its sign before the plaques' place, whether or not they
  // hang, and never shrinks below eight tiles.
  const plaquesStart = layout.width - 1 - 2 * plaque.w - 1;
  const bannerWidth = Math.max(8, Math.min(25, Number((plaquesStart - 10).toFixed(2))));
  return { banner: banner ? { x: 3, y: -4.7, w: bannerWidth, h: 3.5 } : null, plaques: rects };
}

/**
 * The jukebox stands on the floor with its back to the back wall, two tiles right of the host banner's end
 * (the food area fills the wall's left end), so it moves with the banner and never sits under it or the plaques.
 * Its top overlaps the wall's lowest brick row like furniture pushed against a wall.
 */
export function jukeboxBounds(layout) {
  const { banner } = wallFixtures(layout);
  return { x: banner.x + banner.w + 2, y: -1.2, w: 2, h: 3 };
}

/** The music sign hangs on the wall directly above the jukebox, one tile wider on each side. */
export function jukeboxSignBounds(layout) {
  const box = jukeboxBounds(layout);
  return { x: box.x - 1, y: box.y - 1.4, w: box.w + 2, h: 1 };
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
    events = (timeline.events ?? []).filter((item) => ADMIN_KINDS.has(item.kind));
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
  for (let tableIndex = 0; tableIndex < (timeline.tables ?? []).length; tableIndex += 1) {
    const table = timeline.tables[tableIndex];
    if (table.dm === person.id && slot >= table.start && slot < table.end) {
      return { kind: "table", label: table.name, table, tableIndex, seat: 0 };
    }
  }
  for (let tableIndex = 0; tableIndex < (timeline.tables ?? []).length; tableIndex += 1) {
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
  const unit = timeline.event.slot_minutes * 60;
  kitchenServices(timeline);
  const ready = KITCHEN_SERVICES.get(timeline).readyByStart.get(foodTimeKey(startedAt * unit)) ?? startedAt * unit;
  if (slot * unit < ready) return { kind: "food", label: "the food queue, waiting for food", foodPhase: "waiting",
    plate: false, foodRemaining: 1 };
  const elapsed = Math.max(0, slot * unit - Math.max(startedAt * unit, ready));
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

/** Someone arriving mid-meal, on a break or still on stage when it starts, starts their own visit on
 * arrival or when the break or their spotlight ends, so they queue and collect like everyone else.
 * A break or spotlight that begins after their visit has started does not move it. */
function mealVisitStart(timeline, person, meal, slot) {
  let start = Math.max(meal.at ?? slot, effectivePresence(person, timeline.event.slots)?.[0] ?? -Infinity);
  const spotlightDuration = SPOTLIGHT_MINUTES / timeline.event.slot_minutes;
  for (;;) {
    const active = activeEvents(timeline, start);
    if (active.break) start = active.break.at + active.break.duration;
    else if (active.spotlight?.person === person.id) start = active.spotlight.at + spotlightDuration;
    else return start;
  }
}

/** Explicit choices override automatic activity while their table/visitor context still applies. */
export function resolveLocation(timeline, person, slot, active = activeEvents(timeline, slot), visitAt = foodVisit) {
  const ordinary = ordinaryLocation(timeline, person, slot);
  if (ordinary.kind === "absent") return ordinary;
  if (active.break) {
    if (active.spotlight?.person === person.id) return { kind: "spotlight", label: "the stage", event: active.spotlight };
    return { kind: "lounge", label: "the lounge (break)", event: active.break };
  }
  const moves = person.movements || [];
  let finishedFood = false, ateMeal = false, mealStart;
  // A choice made before this person's meal start does not keep them from the meal.
  const beforeMeal = (move) => active.meal
    && move.at < (mealStart ??= mealVisitStart(timeline, person, active.meal, slot));
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
      const visit = visitAt(timeline, slot, move.at);
      if (visit) return visit;
      finishedFood = true;
      // A snack still running at the meal start stands in for that meal; an earlier one does not.
      if (!beforeMeal(move) || visitAt(timeline, mealStart, move.at)) ateMeal = true;
      continue; // Resume the last lounge/table choice, without replaying older meals.
    }
    // Hand over to the meal while it runs, then the choice resumes. A spotlit diner keeps the choice.
    if (!ateMeal && beforeMeal(move) && slot >= mealStart && visitAt(timeline, slot, mealStart)) break;
    return move.destination === "table" ? ordinary : { kind: "lounge", label: "the lounge" };
  }
  if (active.spotlight?.person === person.id) return { kind: "spotlight", label: "the stage", event: active.spotlight };
  if (active.meal && !ateMeal) {
    const visit = visitAt(timeline, slot, mealStart ??= mealVisitStart(timeline, person, active.meal, slot));
    if (visit) return { ...visit, event: active.meal };
  }
  // Visitors can finish a meal across a four-minute wandering beat.
  if (ordinary.visitorBeat !== undefined && !finishedFood) {
    for (const beat of [ordinary.visitorBeat, ordinary.visitorBeat - 1]) {
      const start = beat * 4 / timeline.event.slot_minutes;
      if (start < 0 || ordinaryLocation(timeline, person, start).kind !== "food") continue;
      const visit = visitAt(timeline, slot, start);
      if (visit) return visit;
    }
  }
  return ordinary.kind === "food" ? { kind: "lounge", label: "the lounge" } : ordinary;
}

/** Where everyone waits during the gathering: the earliest table they run or joined, else the lounge
 * for a planned attendance, else outside. Plans only; nobody is really here yet. */
export function gatheringLocations(timeline) {
  const ordered = timeline.tables.map((table, tableIndex) => ({ table, tableIndex }))
    .sort((a, b) => a.table.start - b.table.start || a.tableIndex - b.tableIndex);
  const result = new Map();
  for (const person of timeline.people) {
    let place = null;
    for (const { table, tableIndex } of ordered) {
      if (table.dm === person.id) { place = { kind: "table", label: table.name, table, tableIndex, seat: 0 }; break; }
      const signupIndex = table.signups.findIndex((signup) => signup.person === person.id);
      if (signupIndex >= 0) { place = { kind: "table", label: table.name, table, tableIndex, seat: signupIndex + 1 }; break; }
    }
    if (!place) place = person.presence.planned !== null ? { kind: "lounge", label: "the lounge" } : { kind: "absent", label: "outside the hall" };
    result.set(person.id, place);
  }
  return result;
}

/** Where practising people stand before doors, from the live feed's optional practice key: the seat they
 * hold on the table whose thread they practised in, else their planned placement, else the lounge. */
export function practicePlaces(timeline) {
  const result = new Map();
  const entries = Object.entries(timeline.practice?.people ?? {});
  if (entries.length === 0) return result;
  const planned = gatheringLocations(timeline);
  for (const [id, entry] of entries) {
    if (entry.position === "food") {
      result.set(id, { kind: "food", label: "the food seating, eating", foodPhase: "eating", plate: true, foodRemaining: 1 });
      continue;
    }
    if (entry.position === "lounge") {
      result.set(id, { kind: "lounge", label: "the lounge" });
      continue;
    }
    const tableIndex = timeline.tables.findIndex((table) => table.id === entry.table);
    const table = timeline.tables[tableIndex];
    let place = null;
    if (table) {
      const signupIndex = table.signups.findIndex((signup) => signup.person === id);
      if (table.dm === id) place = { kind: "table", label: table.name, table, tableIndex, seat: 0 };
      else if (signupIndex >= 0) place = { kind: "table", label: table.name, table, tableIndex, seat: signupIndex + 1 };
    }
    if (!place) {
      const fallback = planned.get(id);
      place = fallback?.kind === "table" ? fallback : { kind: "lounge", label: "the lounge" };
    }
    result.set(id, place);
  }
  return result;
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

/** "gathering" | "eve" | "day" | "after" for a wall-clock instant. */
export function hallStage(timeline, milliseconds) {
  if (modeAt(timeline, milliseconds) === "live") return "day";
  const start = Date.parse(timeline.event.start);
  if (milliseconds > start) return "after";
  return milliseconds >= start - EVE_MS ? "eve" : "gathering";
}

/** Countdown to doors for the header, rounded up to the coarsest unit that still moves. */
export function countdownText(remainingMs) {
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  const away = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} away`;
  if (remainingMs > day) return away(Math.ceil(remainingMs / day), "day");
  if (remainingMs > hour) return away(Math.ceil(remainingMs / hour), "hour");
  if (remainingMs > minute) return away(Math.ceil(remainingMs / minute), "minute");
  return "Doors open any moment";
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

export function speechView(timeline, speechEvent, slot, active = activeEvents(timeline, slot), place = null) {
  const person = timeline.people.find((candidate) => candidate.id === speechEvent.person);
  if (!place) place = person ? resolveLocation(timeline, person, slot, active) : { kind: "absent", label: "outside the hall" };
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
