import { CHOICE_COUNTS } from "./characters.mjs";

const ADMIN_KINDS = new Set(["break", "meal", "announce", "spotlight"]);
const SPEECH_KINDS = new Set(["shout", "donation"]);
const ALL_KINDS = new Set([...ADMIN_KINDS, ...SPEECH_KINDS]);
const POINT_KINDS = new Set(["announce", "spotlight", "shout", "donation"]);

export const PALETTE_SIZE = 15;
export const ANNOUNCE_MINUTES = 8;
export const SPOTLIGHT_MINUTES = 14;
export const MOVEMENT_PRIORITY = Object.freeze(["spotlight-person", "break", "meal", "ordinary"]);
export const TABLE_COLUMNS = 10;
export const LOCAL_SEAT_COUNT = 10;
export const OVERFLOW_COLUMNS = 30;

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
  if (schema !== 1 && schema !== 2 && schema !== 3 && schema !== 4) fail("This timeline uses an unsupported schema version.");
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

  const room_layout = schema === 4 ? validateRoomLayout(required(root, "room_layout", "timeline")) : null;
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

  const eventIds = new Set();
  const events = array(required(root, "events", "timeline"), "timeline.events").map((raw, index) => {
    const label = `timeline.events[${index}]`;
    const item = object(raw, label);
    const id = string(required(item, "id", label), `${label}.id`, { min: 1 });
    if (eventIds.has(id)) fail("timeline.events contains duplicate identifiers.");
    eventIds.add(id);
    const kind = string(required(item, "kind", label), `${label}.kind`);
    if (!ALL_KINDS.has(kind) || (schema === 1 && !ADMIN_KINDS.has(kind))) fail(`${label}.kind is unsupported for this schema.`);
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
    if ((kind === "spotlight" || kind === "shout" || kind === "donation") !== (person !== null)) fail(`${label}.person is inconsistent with its kind.`);
    if ((kind === "break" || kind === "announce") && text !== null && kind !== "announce") fail(`${label}.text is inconsistent with its kind.`);
    return { id, kind, at, duration, text, person, by, _inputOrder: index };
  }).sort((a, b) => a.at - b.at || a._inputOrder - b._inputOrder).map((item) => knownKeys(item, ["id", "kind", "at", "duration", "text", "person", "by"]));

  return { schema, phase, generated_at, event, people, tables, events, room_layout };
}

export function slotToMs(timeline, slot) {
  return Date.parse(timeline.event.start) + slot * timeline.event.slot_minutes * 60_000;
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
  return { kind: "lounge", label: "the lounge" };
}

/** Movement priority: the spotlighted person, then break, then meal, then ordinary location. */
export function resolveLocation(timeline, person, slot, active = activeEvents(timeline, slot)) {
  const ordinary = ordinaryLocation(timeline, person, slot);
  if (ordinary.kind === "absent") return ordinary;
  if (active.spotlight?.person === person.id) return { kind: "spotlight", label: "the stage", event: active.spotlight };
  if (active.break) return { kind: "lounge", label: "the lounge (break)", event: active.break };
  if (active.meal) return { kind: "food", label: "the food corner", event: active.meal };
  return ordinary;
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
