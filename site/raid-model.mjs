import { ARENAS, stationsAt } from "./raid-3d-pose.mjs?v=185af0fe6885";
import { activeEvents, displayName, resolveLocation } from "./model.mjs?v=d234bf7c553d";
import { raidSubBosses } from "./raid-subboss.mjs?v=b188cdc4f229";

// Immutable timeline snapshots own their index. Seeking uses binary search plus at most 31 folds.
const indexes = new WeakMap();
const STRIDE = 32;
const copy = value => structuredClone(value);
const tableName = (timeline, id) => timeline.tables.find(table => table.id === id)?.name ?? "Organizer";

function initial(raid) {
  return { phase: null, legs: raid.legs.map(leg => ({ ...copy(leg), max: null, hp: null,
    destroyed: false, destroyedAt: null, destroyedBy: null, table: null })), members: [],
  checklist: raid.checklist.map(item => ({ ...item, done: false, table: null })), king: null,
  active: null, timer: null, lastAction: null, scores: [], result: null, endAt: null,
  window: { ...raid.window } };
}
function score(state, timeline, table) {
  if (table === null) return null;
  let row = state.scores.find(row => row.table === table);
  if (!row) {
    row = { table, name: tableName(timeline, table), legs: 0, legDamage: 0, rooms: 0, kingDamage: 0, coinsSpent: 0 };
    state.scores.push(row);
  }
  return row;
}
function assignments(state) {
  for (const leg of state.legs) leg.table = state.members.find(member => member.leg === leg.id)?.table ?? null;
}
function actionText(timeline, entry) {
  const raid = timeline.raid, name = id => tableName(timeline, id);
  const actor = entry.table ? name(entry.table) : "Organizer";
  const legName = id => {
    const leg = raid.legs.find(leg => leg.id === id);
    return leg?.special ? `the ${leg.name} (${id})` : id;
  };
  let text;
  switch (entry.kind) {
    case "open": text = `${raid.name} raid begins`; break;
    case "phase": text = `Phase ${entry.phase} begins`; break;
    case "leg_hp": text = `${actor} reported ${legName(entry.leg)} at ${entry.hp} HP`; break;
    case "leg_max": text = `set leg ${entry.leg} to ${entry.hp}/${entry.max} HP`; break;
    case "leg_destroyed": text = `${actor} destroyed ${legName(entry.leg)}`; break;
    case "leg_revived": text = `revived leg ${entry.leg}`; break;
    case "move": text = `${actor} moved to ${entry.to ? legName(entry.to) : "Reserve"}`; break;
    case "member": text = `${entry.change === "add" ? "added" : "removed"} ${actor}`; break;
    case "strike": text = `${entry.timer === "lair" ? "Lair action" : "Core pulse"}: ${raid.actions.find(action => action.id === entry.action)?.name ?? entry.action} on ${entry.targets.length ? entry.targets.map(name).join(" and ") : "no running tables"}`; break;
    case "push": text = `${actor} pushed the clock by ${entry.minutes} min`; break;
    case "check": text = `${actor} ${entry.undo ? "undid" : "cleared"} the ${raid.checklist.find(item => item.id === entry.item)?.name}`; break;
    case "active": text = `${actor} faces the King`; break;
    case "king_max": text = `King set to ${entry.hp}/${entry.max} HP`; break;
    case "king_hp": text = `${actor} reported the King at ${entry.hp} HP`; break;
    case "discharge": text = `Core discharge at ${entry.threshold}% on ${entry.targets.map(name).join(" and ") || "no running tables"}`; break;
    case "admin": text = entry.action === "window" ? "updated the raid window" : entry.action.replaceAll("_", " "); break;
    case "end": text = entry.result === "won" ? "Victory!" : "The raid is over"; break;
    default: text = entry.kind;
  }
  return entry.admin ? `Organizer: ${text}` : text;
}
function fold(state, timeline, entry) {
  if (state.endAt !== null) return;
  const leg = state.legs.find(leg => leg.id === entry.leg);
  const credited = () => score(state, timeline, entry.table);
  switch (entry.kind) {
    case "open":
      state.phase = 1;
      state.members = copy(entry.members);
      for (const member of state.members) score(state, timeline, member.table);
      for (const init of entry.legs) Object.assign(state.legs.find(leg => leg.id === init.leg), { max: init.max, hp: init.max });
      assignments(state);
      break;
    case "phase": state.phase = entry.phase; break;
    case "leg_hp":
      if (entry.table !== null && !entry.admin) credited().legDamage += Math.max(0, leg.hp - entry.hp);
      leg.hp = entry.hp; break;
    case "leg_max": leg.max = entry.max; leg.hp = entry.hp; break;
    case "leg_destroyed":
      if (!leg.destroyed && entry.table !== null && !entry.admin) {
        credited().legDamage += Math.max(0, leg.hp);
        credited().legs += 1;
        leg.destroyedBy = entry.table;
      }
      leg.hp = 0; leg.destroyed = true; leg.destroyedAt = entry.at; break;
    case "leg_revived":
      if (leg.destroyedBy !== null) score(state, timeline, leg.destroyedBy).legs -= 1;
      Object.assign(leg, { hp: entry.hp, destroyed: false, destroyedAt: null, destroyedBy: null }); break;
    case "move": state.members.find(member => member.table === entry.table).leg = entry.to; assignments(state); break;
    case "member":
      if (entry.change === "add") { state.members.push({ table: entry.table, leg: entry.leg }); credited(); }
      else state.members = state.members.filter(member => member.table !== entry.table);
      assignments(state); break;
    case "timer": state.timer = copy(entry); break;
    case "push": credited().coinsSpent += entry.minutes; break;
    case "check": Object.assign(state.checklist.find(item => item.id === entry.item), { done: !entry.undo, table: entry.undo ? null : entry.table }); break;
    case "active": state.active = entry.table; break;
    case "king_max": state.king = { max: entry.max, hp: entry.hp }; break;
    case "king_hp":
      if (!entry.admin && entry.table === state.active) credited().kingDamage += Math.max(0, state.king.hp - entry.hp);
      state.king.hp = entry.hp; break;
    case "admin": if (entry.action === "window") state.window = { ...entry.window }; break;
    case "end": state.result = entry.result; state.endAt = entry.at; break;
  }
  if (entry.kind !== "timer") state.lastAction = { at: entry.at, kind: entry.kind, text: actionText(timeline, entry) };
}
function indexFor(timeline) {
  let index = indexes.get(timeline);
  if (index) return index;
  const state = initial(timeline.raid), checkpoints = [copy(state)], entries = [];
  for (const entry of timeline.raid.log) {
    if (state.endAt !== null || entry.at > state.window.end) break;
    entries.push(entry);
    fold(state, timeline, entry);
    if (entries.length % STRIDE === 0) checkpoints.push(copy(state));
  }
  index = { entries, checkpoints };
  indexes.set(timeline, index);
  return index;
}

/** All values depend on selected event time, never on receipt time or wall time. */
export function raidStateAt(timeline, slot) {
  if (!timeline.raid) return null;
  const { entries, checkpoints } = indexFor(timeline);
  let lo = 0, hi = entries.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (entries[mid].at <= slot) lo = mid + 1; else hi = mid; }
  const base = Math.floor(lo / STRIDE) * STRIDE;
  const state = copy(checkpoints[base / STRIDE]);
  for (let i = base; i < lo; i += 1) fold(state, timeline, entries[i]);
  const ended = state.endAt !== null || slot >= state.window.end;
  const at = ended ? state.endAt ?? state.window.end : slot;
  const status = slot < state.window.start ? "upcoming" : ended ? "ended" : "live";
  const members = state.members.map(member => {
    const table = timeline.tables.find(table => table.id === member.table);
    return { ...member, running: table.start <= at && at < table.end };
  });
  const leaderboard = state.scores.map(row => ({ ...row,
    rooms: state.checklist.filter(item => item.done && item.table === row.table).length,
  })).sort((a, b) => b.legs - a.legs || (b.legDamage + b.kingDamage) - (a.legDamage + a.kingDamage) || a.name.localeCompare(b.name));
  const timer = !ended && state.timer?.timer ? { kind: state.timer.timer,
    seconds: state.timer.paused ? state.timer.remaining * 60 : Math.max(0, (state.timer.next - at) * timeline.event.slot_minutes * 60),
    paused: state.timer.paused, pushesLeftSeconds: state.timer.pushes_left * 60 } : null;
  return { status, phase: state.phase, legs: state.legs.map(({ destroyedBy, ...leg }) => leg),
    reserves: members.filter(member => member.leg === null).map(member => member.table), members,
    checklist: state.checklist, king: state.king, active: state.active, timer, lastAction: state.lastAction,
    leaderboard, result: ended ? state.result ?? "unfinished" : null, window: state.window, endAt: state.endAt };
}

/** Share one selected-time fold across the app's drawing, header and detail readers.
 * Timeline snapshots are immutable; consumers treat the cached result as read-only.
 * The count lets integration tests observe folds without replacing ES-module imports.
 */
export function createRaidStateMemo(foldState = raidStateAt) {
  let previousTimeline, previousSlot, value;
  const memo = (timeline, slot) => {
    if (timeline !== previousTimeline || slot !== previousSlot) {
      value = foldState(timeline, slot);
      previousTimeline = timeline; previousSlot = slot; memo.folds += 1;
    }
    return value;
  };
  memo.folds = 0;
  return memo;
}

/** Hold the result for one complete slot after the logged end, then return to the hall. */
export function defaultRaidScene(state, slot) {
  return state && (state.status === "live" || (state.endAt !== null && slot >= state.endAt && slot < state.endAt + 1)) ? "raid" : "hall";
}
export function raidTableLabel(timeline, state, table) {
  if (!state) return "";
  const roster = state.status === "upcoming"
    ? timeline.raid.log.find(entry => entry.kind === "open")?.members ?? timeline.raid.members : state.members;
  const member = roster.find(member => member.table === table);
  return member ? `${timeline.raid.name} raid · ${member.leg ? `Leg ${member.leg}` : "Reserve"}` : "";
}
export function raidHallCountdown(timeline, slot) {
  if (!timeline.raid) return null;
  const seconds = (timeline.raid.window.start - slot) * timeline.event.slot_minutes * 60;
  return seconds > 0 && seconds <= 3600 ? `${timeline.raid.name} raid in ${raidClockText(seconds)}` : null;
}
export function raidClockText(seconds) {
  const whole = Math.max(0, Math.ceil(seconds - 1e-7));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
export const RAID_WORLD = Object.freeze({ x: 0, y: 0, w: 64, h: 50 });
export const RAID_BOSS_RECT = Object.freeze({ x: 20, y: 9, w: 24, h: 13.5 });
/** CSS-pixel fit shared by the screen layout and the canvas transform. */
export function raidWorldFit({ width, height }, world = RAID_WORLD) {
  const scale = Math.min(width / world.w, height / world.h);
  return { x: (width - world.w * scale) / 2, y: (height - world.h * scale) / 2,
    w: world.w * scale, h: world.h * scale, scale };
}
/** Desktop boxes, in viewport CSS pixels. The phone keeps its existing flow. */
export function raidScreenLayout({ width, height, kiosk = false, fundStrip = 0, deskBar = 52.5 }) {
  if (width < 900) return null;
  const frame = { x: 12, y: kiosk ? 12 : fundStrip + deskBar + 12, w: width - 24,
    h: height - (kiosk ? 24 : fundStrip + deskBar + 24) };
  const sidebar = kiosk ? 576 : 448, gap = 8;
  const fit = raidWorldFit({ width: frame.w - sidebar - 12, height: frame.h });
  const canvas = { x: frame.x + fit.x, y: frame.y + fit.y, w: fit.w, h: fit.h };
  const sx = frame.x + frame.w - sidebar, legsHeight = kiosk ? 236 : 206, checkHeight = kiosk ? 248 : 224;
  const legs = { x: sx, y: frame.y, w: sidebar, h: legsHeight };
  const checklist = { x: sx, y: legs.y + legs.h + gap, w: sidebar, h: checkHeight };
  const board = { x: sx, y: checklist.y + checklist.h + gap, w: sidebar,
    h: frame.y + frame.h - checklist.y - checklist.h - gap };
  const center = { x: canvas.x, y: canvas.y, w: canvas.w, h: 96 };
  const timeline = kiosk ? null : { x: canvas.x, y: canvas.y + canvas.h - 96, w: canvas.w, h: 96 };
  return { frame, canvas, legs, checklist, board, center, timeline };
}
export function raidLegAnchors() {
  return Object.fromEntries(["L", "R"].flatMap(side => [1, 2, 3, 4].map((n) => [`${side}${n}`, [side === "L" ? .08 : .92, .15 + (n - 1) * .22]])));
}
export const RAID_RESERVE_RECT = Object.freeze({ x: 1, y: 34, w: 62, h: 7 });
function arenaPlate(station, boss) {
  const side = station.arena[0] < boss.x + boss.w / 2 ? -1 : 1;
  return { x: station.arena[0] + side * (station.ring[0] + 5.15), y: station.arena[1], w: 9.5, h: 1.2 };
}
// The pose exports geometry only; use the existing UI palette until it supplies colours.
const arenaColors = { L1: "#9cdbcd", L4: "#dfba76", R1: "#d9604c", R4: "#b1b5a8" };
/** The hall resolver still decides who sits. Renderer stations are plain values:
 * placement and ordering remain pure selected-time math.
 */
export function raidRoomLayout(state, timeline, slot, { slotMinutes = timeline.event.slot_minutes,
  reducedMotion = false, theta, stations } = {}) {
  const groups = [], people = [], boss = { ...RAID_BOSS_RECT };
  const layout = { world: { ...RAID_WORLD }, boss, reserve: { ...RAID_RESERVE_RECT }, stations: null, arenas: [], groups, people,
    subBosses: raidSubBosses(state, timeline) };
  if (!state) return layout;
  const at = state.status === "ended" ? state.endAt ?? state.window.end : slot;
  if (state.phase === 1) {
    layout.stations = stations ?? stationsAt(raidBossState(state, timeline, slot), boss, { slotMinutes, reducedMotion, theta: reducedMotion ? 0 : theta });
    layout.arenas = state.legs.map(leg => ({ id: leg.id, ...copy(layout.stations.legs[leg.id]), label: arenaPlate(layout.stations.legs[leg.id], boss), destroyed: leg.destroyed,
      color: ARENAS[leg.id].color ?? arenaColors[leg.id] ?? "#55685b" }));
  }
  const active = activeEvents(timeline, at);
  const seated = state.status !== "upcoming" ? timeline.people.map(person => ({ person, place: resolveLocation(timeline, person, at, active) })) : [];
  let hollow = 0, reserve = 0;
  for (const member of state.members.filter(member => member.running)) {
    const table = timeline.tables.find(table => table.id === member.table);
    const station = state.phase === 1 && member.leg ? layout.stations.legs[member.leg] : null;
    let x, y;
    if (station) [x, y] = station.arena;
    else if (state.phase === 1) { x = 6.4 + (reserve % 5) * 12.8; y = 35.5 + Math.floor(reserve++ / 5) * 4; }
    else if (state.phase === 3 && member.table === state.active) { x = 32; y = 27; }
    else { x = 6.4 + (hollow % 5) * 12.8; y = 35.5 + Math.floor(hollow++ / 5) * 4; }
    const label = station ? arenaPlate(station, boss) : { x, y: y - 1.4, w: 9.5, h: 1.2 };
    groups.push({ table: table.id, name: table.name, leg: member.leg, x, y, label,
      behind: station?.behind ?? false, depth: station?.depth ?? 0 });
    const party = seated.filter(({ place }) => place.kind === "table" && place.table.id === table.id)
      .sort((a, b) => a.person.id.localeCompare(b.person.id));
    party.forEach(({ person, place }, index) => {
      const angle = -Math.PI / 2 + index * 2 * Math.PI / party.length;
      people.push({ id: person.id, table: table.id, leg: member.leg,
        name: person.hidden ? null : displayName(person), hidden: person.hidden,
        x: station ? x + station.ring[0] * Math.cos(angle) : x + (index % 5 - (Math.min(5, party.length) - 1) / 2) * 1.15,
        y: station ? y + station.ring[1] * Math.sin(angle) : y + Math.floor(index / 5) * 1.2,
        behind: station?.behind ?? false, depth: station?.depth ?? 0, seat: place.seat });
    });
  }
  return layout;
}
export function raidBossState(state, timeline, slot) {
  return { t: slot, phase: state.phase, legs: state.legs.map(({ id, side, special, destroyed, destroyedAt }) => ({ id, side, special, destroyed, destroyedAt })),
    king: state.king ? { ...state.king, dead: state.king.hp === 0 || state.result === "won" } : null, art: copy(timeline.raid.art) };
}
