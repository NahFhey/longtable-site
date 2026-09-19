import { stageGeometry, stagePath, stageQueuePeople, stageQueuePosition } from "./stage.mjs";
import { createViewerClock, followNowClock, seekViewerClock, tickViewerClock, toggleViewerPlayback } from "./clock.mjs";
import { constrainCamera, fitBounds, panCamera, relevantTableIndices, screenToWorld, tableBounds, worldToScreen, zoomAt } from "./camera.mjs";
import { eventActions } from "./event-config.mjs";
import { SPRITES, characterAppearance } from "./characters.mjs";
import {
  PALETTE_SIZE,
  activeEvents,
  accessibleEventText,
  createRoomLayout,
  createLiveState,
  crossedSpeechEvents,
  displayName,
  hallAmbience,
  foodGeometry,
  loungeActivities,
  diceAt,
  diceText,
  indexAdminEvents,
  personTooltip,
  publicActivity,
  reconcileLiveSnapshot,
  resolveLocation,
  seatPositionForPlan,
  shiftSpeechQueue,
  slotToMs,
  speechView,
  tableView,
  tableLifecycle,
  tableScenery,
  validateTimeline,
  visibleVariant,
} from "./model.mjs";

const TILE = 16;
const SCALE = 2;
const STRIDE = 17;
const WALK_TILES_PER_SECOND = 3.2;
const SPEECH_SECONDS = { shout: 4, donation: 6 };

const RPG = {
  floor: { wood: [1,26], lounge: [15,28], stage: [12,28], food: [6,28], wall: [15,13] },
  table: [[23,4],[24,4],[25,4]],
  chairs: { top: [20,3], bottom: [19,3], left: [21,3], right: [22,3] },
  door: [[36,0],[37,0]], banners: [[49,0],[50,0],[51,0]],
  food: [[54,15],[55,16],[56,17],[54,13],[55,13],[56,13]],
  barrel: [23,0], shelf: [[44,12],[44,13]], plant: [18,9], couch: [[13,2],[13,3]],
};

const $ = (id) => document.getElementById(id);
const canvas = $("hall");
const hallDescription = $("canvas-description").textContent;
let ctx = null;
try { ctx = canvas.getContext("2d"); } catch { /* The table list works without canvas. */ }
const mobile = matchMedia("(max-width: 650px)");
$("hall-explorer").open = !mobile.matches;
function arrangeHall() {
  const main = $("hall-content");
  const explorer = $("hall-explorer");
  if (mobile.matches) {
    main.insertBefore($("table-list"), explorer);
    main.insertBefore($("detail"), explorer);
  } else {
    main.append($("table-list"));
    $("hall-layout").append($("detail"));
  }
}
arrangeHall();
mobile.addEventListener?.("change", arrangeHall);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  data: null,
  clock: null,
  time: 0,
  lastTime: 0,
  tablePhaseNodes: new Map(),
  detailPhaseNode: null,
  tableDiceNodes: new Map(),
  detailDiceNode: null,
  lastUrlWrite: 0,
  camera: null,
  manualCamera: false,
  frameKey: null,
  viewport: null,
  speed: 600,
  selectedId: null,
  hover: null,
  layout: null,
  people: new Map(),
  images: { characters: null, rpg: null },
  assetsFailed: false,
  snap: true,
  lastRefresh: 0,
  refreshing: false,
  lastChecked: null,
  feedDelayed: false,
  live: null,
  adminEvents: [],
  activity: [],
  activityLimit: 100,
  activityKey: null,
  activitySecond: null,
  speechQueue: [],
  speech: null,
  stageQueue: [],
  ambience: null,
  leisure: new Map(),
  locations: new Map(),
  diners: [],
  staleMessage: "",
  archive: document.documentElement?.dataset.source === "archive",
  sample: document.documentElement?.dataset.source !== "archive" && new URLSearchParams(location.search).get("sample") === "1",
};

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function setStatus(message, className = "") {
  const status = $("status");
  const nextClass = `status${className ? ` ${className}` : ""}`;
  if (status.textContent !== message) status.textContent = message;
  if (status.className !== nextClass) status.className = nextClass;
}

function append(parent, tag, text, className = "") {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function formatDate(milliseconds, options) {
  try { return new Intl.DateTimeFormat(undefined, { timeZone: state.data.event.tz, ...options }).format(new Date(milliseconds)); }
  catch { return new Date(milliseconds).toISOString(); }
}

function formatSlot(slot, withDay = false) {
  return formatDate(slotToMs(state.data, slot), {
    ...(state.data.event.slots * state.data.event.slot_minutes > 1440 ? { month: "short", day: "numeric" } : {}),
    ...(withDay ? { weekday: "short" } : {}), hour: "numeric", minute: "2-digit",
  });
}

function buildLayout() {
  return { ...createRoomLayout(state.data.tables, state.data.room_layout), scale: SCALE };
}

function viewport() {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width || 960, height: rect.height || 480 };
}

function frameTables(indices, manual = false) {
  state.camera = fitBounds(tableBounds(state.layout, indices), viewport(), state.layout);
  state.manualCamera = manual;
  hideTooltip();
}

function updateCamera() {
  const size = viewport();
  if (state.camera && state.viewport && (size.width !== state.viewport.width || size.height !== state.viewport.height)) {
    const center = screenToWorld(state.camera, { x: state.viewport.width / 2, y: state.viewport.height / 2 });
    state.camera = constrainCamera({ ...state.camera, x: size.width / 2 - center.x * state.camera.zoom, y: size.height / 2 - center.y * state.camera.zoom }, size, state.layout);
    if (!state.manualCamera) state.frameKey = null;
  }
  state.viewport = size;
  const indices = relevantTableIndices(state.data.tables, state.time);
  const showStage = state.speech?.event.kind === "donation" || state.stageQueue.length > 0;
  const key = indices.map((index) => state.data.tables[index].id).join("|") + (showStage ? "|stage" : "");
  if (!state.manualCamera && (state.frameKey !== key || !state.camera)) {
    frameTables(indices);
    if (showStage) {
      const tables = tableBounds(state.layout, indices);
      const stage = state.layout.stage;
      const x = Math.min(tables.x, stage.x - 2);
      const y = Math.min(tables.y, stage.y);
      state.camera = fitBounds({ x, y, width: Math.max(tables.x + tables.width, stage.x + stage.w) - x,
        height: Math.max(tables.y + tables.height, state.layout.height - 1) - y }, size, state.layout);
    }
    state.frameKey = key;
    state.selectedId = indices.length === 1 ? state.data.tables[indices[0]].id : null;
    renderDetail();
  }
  state.camera = constrainCamera(state.camera, size, state.layout);
}

function renderActions() {
  const host = $("event-actions");
  host.replaceChildren();
  for (const action of state.sample || state.archive ? [] : eventActions(state.data.event)) {
    const link = append(host, "a", action.label);
    link.href = action.url;
    if (!action.qr) continue;
    const disclosure = append(host, "details");
    append(disclosure, "summary", `Show QR: ${action.label}`);
    const panel = append(disclosure, "div", undefined, "qr-panel");
    const image = append(panel, "img", undefined, "qr-image");
    image.src = action.qr;
    image.alt = `QR code for ${action.label}. You can also use the link.`;
    image.width = 200; image.height = 200;
    image.addEventListener("error", () => { image.hidden = true; });
    append(panel, "p", action.url);
  }
}

function seatPosition(tableIndex, seat) {
  return seatPositionForPlan(state.layout, tableIndex, seat);
}

function destination(runtime, now, active) {
  const custom = state.speech?.event.kind === "donation" && state.speech.event.person === runtime.person.id;
  if (custom) {
    const leaving = state.speech.phase === "leaving";
    return { kind: leaving ? "stage-exit" : "stage-speaker", label: leaving ? "the stage stairs" : "the stage microphone",
      position: leaving ? stageGeometry(state.layout).foot : state.layout.stageFront, present: true };
  }
  const queueIndex = state.stageQueue.indexOf(runtime.person.id);
  if (queueIndex >= 0) return { kind: "stage-queue", label: "the stage queue", position: stageQueuePosition(state.layout, queueIndex, state.stageQueue.length), present: true };
  const place = state.locations.get(runtime.person.id);
  if (place.kind === "absent") return { ...place, label: "the door", position: state.layout.doorPosition, present: false };
  if (place.kind === "spotlight") return { ...place, position: state.layout.stageFront, present: true };
  const wander = place.visitorBeat ?? Math.floor(now / 9000 + runtime.ordinal * 0.37);
  if (place.kind === "visiting") return { ...place, position: {
    x: state.layout.trunkX,
    y: state.layout.aisles[(wander + runtime.ordinal) % state.layout.aisles.length],
  }, present: true };
  if (place.kind === "lounge") {
    const activity = state.leisure.get(runtime.person.id);
    return { ...place, ...activity, present: true };
  }
  if (place.kind === "food") {
    const geometry = foodGeometry(state.layout, state.diners.indexOf(runtime.person.id), Math.max(4, state.diners.length));
    const position = place.foodPhase === "serving-first" ? geometry.first
      : place.foodPhase === "serving-second" ? geometry.second
      : place.foodPhase === "trash" ? { x: geometry.bin.x - .7, y: geometry.bin.y } : geometry.seat;
    return { ...place, position, present: true };
  }
  return { ...place, position: seatPosition(place.tableIndex, place.seat), present: true };
}

function closestAisle(y) {
  return state.layout.aisles.reduce((best, aisle) => Math.abs(aisle - y) < Math.abs(best - y) ? aisle : best);
}

function outsideTableGrid(point) {
  const rows = state.layout.tableRows;
  return point.x < state.layout.gridX - 0.2 || point.y < state.layout.gridY - 0.2 || point.y > state.layout.gridY + rows * state.layout.cellHeight - 0.2;
}

function pathBetween(from, to) {
  return stagePath(state.layout, from, to, hallPathBetween);
}

function hallPathBetween(from, to) {
  const firstAisle = closestAisle(from.y);
  const secondAisle = closestAisle(to.y);
  if (outsideTableGrid(from) && outsideTableGrid(to)) return [to];
  const points = [{ x: from.x, y: firstAisle }];
  if (firstAisle !== secondAisle) points.push({ x: state.layout.trunkX, y: firstAisle }, { x: state.layout.trunkX, y: secondAisle });
  points.push({ x: to.x, y: secondAisle }, to);
  return points;
}

function samePoint(a, b) { return a && b && Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001; }

function syncPeople() {
  const previous = state.people;
  const next = new Map();
  state.data.people.forEach((person, ordinal) => {
    const runtime = previous.get(person.id) || {
      person, ordinal, position: null, path: [], visible: false, moving: false, facing: 1, phase: (ordinal * 0.61803398875) % 1,
    };
    runtime.person = person;
    runtime.ordinal = ordinal;
    next.set(person.id, runtime);
  });
  state.people = next;
}

function updatePeople(realSeconds, now, active) {
  state.locations = new Map(state.data.people.map(person => [person.id, resolveLocation(state.data, person, state.time, active)]));
  const onStage = new Set(state.stageQueue);
  if (state.speech?.event.kind === "donation") onStage.add(state.speech.event.person);
  state.leisure = loungeActivities(state.layout, state.data.people.filter(person =>
    state.locations.get(person.id).kind === "lounge" && !onStage.has(person.id)));
  state.diners = state.data.people.filter(person => state.locations.get(person.id).kind === "food" && !onStage.has(person.id))
    .map(person => person.id).sort();
  for (const runtime of state.people.values()) {
    const target = destination(runtime, now, active);
    const elapsed = Math.max(0, (state.time - (runtime.lastSlot ?? state.time)) * state.data.event.slot_minutes * 60);
    runtime.lastSlot = state.time;
    runtime.place = target;
    const targetChanged = !runtime.target || !samePoint(runtime.target.position, target.position) || runtime.target.kind !== target.kind;
    if (!runtime.visible && target.present) {
      runtime.position = { ...state.layout.doorPosition };
      runtime.visible = true;
      runtime.path = pathBetween(runtime.position, target.position);
    } else if (runtime.visible && targetChanged) {
      runtime.path = pathBetween(runtime.position, target.position);
    }
    runtime.target = target;

    if (state.snap || reducedMotion.matches) {
      runtime.position = { ...target.position };
      runtime.path = [];
      runtime.visible = target.present;
      runtime.moving = false;
      continue;
    }
    if (!runtime.visible || !runtime.position) continue;
    // Use the same event-time delta as staff, including accelerated replay and pause.
    // Queued speeches can finish their stage visit while replay is paused for reading.
    const travelSeconds = target.kind.startsWith("stage-") ? Math.max(realSeconds, elapsed) : elapsed;
    let budget = WALK_TILES_PER_SECOND * travelSeconds;
    while (budget > 0 && runtime.path.length) {
      const point = runtime.path[0];
      const dx = point.x - runtime.position.x;
      const dy = point.y - runtime.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        runtime.position = { x: point.x, y: point.y };
        runtime.path.shift();
        budget -= distance;
      } else {
        runtime.position.x += dx / distance * budget;
        runtime.position.y += dy / distance * budget;
        if (Math.abs(dx) > 0.05) runtime.facing = dx < 0 ? -1 : 1;
        budget = 0;
      }
    }
    runtime.moving = runtime.path.length > 0;
    if (!target.present && !runtime.moving) runtime.visible = false;
  }
  state.snap = false;
}

function drawTile(image, coordinate, x, y, flip = false, alpha = 1) {
  if (!image) return false;
  const size = TILE * SCALE;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (flip) {
    ctx.translate(Math.round(x * size + size), Math.round(y * size));
    ctx.scale(-1, 1);
    ctx.drawImage(image, coordinate[0] * STRIDE, coordinate[1] * STRIDE, TILE, TILE, 0, 0, size, size);
  } else {
    ctx.drawImage(image, coordinate[0] * STRIDE, coordinate[1] * STRIDE, TILE, TILE, Math.round(x * size), Math.round(y * size), size, size);
  }
  ctx.restore();
  return true;
}

function drawNine(rect, base, fallback) {
  for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) {
    const coordinate = [base[0] + (x === 0 ? 0 : x === rect.w - 1 ? 2 : 1), base[1] + (y === 0 ? 0 : y === rect.h - 1 ? 2 : 1)];
    if (!drawTile(state.images.rpg, coordinate, rect.x + x, rect.y + y)) {
      ctx.fillStyle = fallback;
      ctx.fillRect((rect.x + x) * TILE * SCALE, (rect.y + y) * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
  }
}

function drawLabel(value, x, y, options = {}) {
  const size = (options.size || 5) * SCALE;
  ctx.font = `${options.bold ? "700 " : ""}${size}px ui-monospace, monospace`;
  ctx.textAlign = options.align || "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(value).width + 3 * SCALE;
  const height = size + 2 * SCALE;
  const pixelX = x * TILE * SCALE;
  const pixelY = y * TILE * SCALE;
  const boxX = options.align === "left" ? pixelX : pixelX - width / 2;
  if (options.background !== false) {
    ctx.fillStyle = options.background || "rgba(0,0,0,.74)";
    ctx.fillRect(Math.round(boxX), Math.round(pixelY - height / 2), Math.round(width), Math.round(height));
  }
  ctx.fillStyle = options.color || "#fff";
  ctx.fillText(value, options.align === "left" ? pixelX + 1.5 * SCALE : pixelX, pixelY + 0.5);
}

function drawRoom() {
  const layout = state.layout;
  for (let y = 0; y < layout.height; y += 1) for (let x = 0; x < layout.width; x += 1) {
    const wall = x === 0 || y === 0 || x === layout.width - 1 || y === layout.height - 1;
    if (!drawTile(state.images.rpg, wall ? RPG.floor.wall : RPG.floor.wood, x, y)) {
      ctx.fillStyle = wall ? "#34313d" : ((x + y) % 2 ? "#67482f" : "#6d4d33");
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
  }
  drawNine(layout.lounge, RPG.floor.lounge, "#4b4656");
  drawNine(layout.stage, RPG.floor.stage, "#554761");
  drawStageStairs();
  drawNine(layout.food, RPG.floor.food, "#6b5936");

  for (let index = 0; index < 3; index += 1) drawTile(state.images.rpg, RPG.banners[index], layout.stage.x + 1 + index * 2, 0);
  drawTile(state.images.rpg, RPG.barrel, layout.stage.x + 3, layout.stage.y + 1);
  drawLabel("STAGE", layout.stage.x + layout.stage.w / 2, layout.stage.y + 0.5, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.35)" });

  const foodX = layout.food.x + 1;
  const foodY = layout.food.y + 1;
  for (let index = 0; index < 3; index += 1) drawTile(state.images.rpg, RPG.table[index], foodX + index, foodY);
  for (let index = 0; index < 3; index += 1) drawTile(state.images.rpg, RPG.table[index], foodX + 4, foodY + index);
  RPG.food.slice(0, state.ambience?.foodCount ?? 6).forEach((item, index) => drawTile(state.images.rpg, item, index < 3 ? foodX + index : foodX + 4, index < 3 ? foodY : foodY + index - 3));
  const foodScene = foodGeometry(layout);
  // A visible seat for each diner, with a few ready seats when the area is empty.
  for (let index = 0; index < Math.max(4, state.diners.length); index += 1) {
    const { seat } = foodGeometry(layout, index, Math.max(4, state.diners.length));
    if (!drawTile(state.images.rpg, RPG.chairs.bottom, seat.x - .5, seat.y - .3)) {
      ctx.fillStyle = "#99734d";
      ctx.fillRect((seat.x - .4) * TILE * SCALE, (seat.y - .1) * TILE * SCALE, .8 * TILE * SCALE, .4 * TILE * SCALE);
    }
  }
  ctx.fillStyle = "#303e43";
  ctx.fillRect((foodScene.bin.x - .35) * TILE * SCALE, (foodScene.bin.y - .7) * TILE * SCALE, .7 * TILE * SCALE, .9 * TILE * SCALE);
  drawLabel("TRASH", foodScene.bin.x, foodScene.bin.y - 1, { size: 2.5, color: "#fff", background: false });
  drawLabel("FOOD", layout.food.x + layout.food.w / 2, layout.food.y + 0.5, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.35)" });

  drawTile(state.images.rpg, RPG.shelf[0], layout.lounge.x, layout.lounge.y);
  drawTile(state.images.rpg, RPG.shelf[1], layout.lounge.x, layout.lounge.y + 1);
  drawTile(state.images.rpg, RPG.plant, layout.lounge.x + layout.lounge.w - 1, layout.lounge.y);
  drawTile(state.images.rpg, RPG.plant, layout.lounge.x, layout.lounge.y + layout.lounge.h - 1);
  drawTile(state.images.rpg, RPG.couch[0], layout.lounge.x + 1, layout.lounge.y + layout.lounge.h - 2);
  drawTile(state.images.rpg, RPG.couch[1], layout.lounge.x + 1, layout.lounge.y + layout.lounge.h - 1);
  drawLabel("LOUNGE", layout.lounge.x + layout.lounge.w / 2, layout.lounge.y + 0.5, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.35)" });

  const drawnGroups = new Set();
  for (const activity of state.leisure.values()) {
    if (drawnGroups.has(activity.group)) continue;
    drawnGroups.add(activity.group);
    if (activity.activity === "cards") {
      ctx.fillStyle = "#326b54";
      ctx.fillRect((activity.center.x - .6) * TILE * SCALE, (activity.center.y - .35) * TILE * SCALE, 1.2 * TILE * SCALE, .7 * TILE * SCALE);
      drawLabel("♠ ♥", activity.center.x, activity.center.y, { size: 3, color: "#fff4da", background: false });
    }
    drawLabel(activity.activity === "cards" ? "CARDS" : activity.activity === "reading" ? "READING" : "CONVERSATION",
      activity.center.x, activity.center.y - 1.15, { size: 2.8, color: "#fff4da", background: "#302b3d" });
  }

  if (layout.overflowSeats.length) {
    drawLabel("OVERFLOW SEATING", layout.width / 2, layout.tableGridBottom + 0.7, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.55)" });
  }

  if (!drawTile(state.images.rpg, RPG.door[0], layout.door.x, layout.door.y)) {
    ctx.fillStyle = "#bd8c55";
    ctx.fillRect(0, layout.door.y * TILE * SCALE, TILE * SCALE, TILE * SCALE * 2);
  }
  drawTile(state.images.rpg, RPG.door[1], layout.door.x, layout.door.y + 1);
  drawLabel("DOOR", 1.6, layout.door.y - 0.6, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.35)" });
}

function drawStageStairs() {
  const { stairs } = stageGeometry(state.layout);
  const unit = TILE * SCALE;
  ctx.fillStyle = "#292331";
  ctx.fillRect(stairs.x * unit, (stairs.y + .12) * unit, stairs.w * unit, stairs.h * unit);
  for (let step = 0; step < 4; step += 1) {
    const x = (stairs.x + step * stairs.w / 4) * unit;
    ctx.fillStyle = ["#756177", "#8d778c", "#a38b9d", "#b9a2b2"][step];
    ctx.fillRect(x, stairs.y * unit, stairs.w / 4 * unit - 1, stairs.h * unit);
    ctx.fillStyle = "#dfc8ca";
    ctx.fillRect(x, stairs.y * unit, 2, stairs.h * unit);
  }
}

function drawMicrophone() {
  const { microphone } = stageGeometry(state.layout);
  const x = microphone.x * TILE * SCALE;
  const y = microphone.y * TILE * SCALE;
  ctx.fillStyle = "#201e29";
  ctx.fillRect(x - 7, y + 5, 14, 4);
  ctx.fillStyle = "#bbc2cb";
  ctx.fillRect(x - 1, y - 19, 3, 25);
  ctx.fillStyle = "#252936";
  ctx.fillRect(x - 5, y - 24, 10, 8);
  ctx.fillStyle = "#d8dce2";
  ctx.fillRect(x - 4, y - 23, 7, 3);
}

function chairFor(offset) {
  if (offset.overflow) return RPG.chairs.bottom;
  if (offset.y < 0) return RPG.chairs.top;
  if (offset.y > 0) return RPG.chairs.bottom;
  return offset.x < 0 ? RPG.chairs.left : RPG.chairs.right;
}

function truncate(value, length) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }

function drawTables() {
  state.data.tables.forEach((table, index) => {
    const cell = state.layout.cells[index];
    const firstSeat = seatPosition(index, 0);
    const lifecycle = tableLifecycle(state.data, table, state.time);
    const scenery = tableScenery(state.data, table, state.time, state.layout, index, reducedMotion.matches);
    const open = lifecycle.phase === "active";
    if (state.selectedId === table.id) {
      ctx.fillStyle = "rgba(255,210,122,.25)";
      ctx.fillRect(cell.x * TILE * SCALE, cell.y * TILE * SCALE, state.layout.cellWidth * TILE * SCALE, state.layout.cellHeight * TILE * SCALE);
    }
    if (scenery.staff) drawStaff(scenery.staff);
    if (!scenery.furniture) return;
    for (let column = 0; column < 3; column += 1) {
      if (!drawTile(state.images.rpg, RPG.table[column], firstSeat.tableX + column, firstSeat.tableY, false, open ? 1 : 0.45)) {
        ctx.globalAlpha = open ? 1 : 0.45;
        ctx.fillStyle = "#8d633e";
        ctx.fillRect((firstSeat.tableX + column) * TILE * SCALE, firstSeat.tableY * TILE * SCALE, TILE * SCALE, TILE * SCALE);
        ctx.globalAlpha = 1;
      }
    }
    for (const seat of scenery.chairs) {
      const position = seatPosition(index, seat);
      drawTile(state.images.rpg, chairFor(position.offset || position), position.x - 0.5, position.y - 0.5, false, open ? 1 : 0.45);
      if (!state.images.rpg) {
        ctx.fillStyle = open ? "#4c3427" : "#3b312d";
        ctx.fillRect((position.x - 0.28) * TILE * SCALE, (position.y - 0.28) * TILE * SCALE, .56 * TILE * SCALE, .56 * TILE * SCALE);
      }
    }
    if (scenery.props) drawTableProps(firstSeat.tableX, firstSeat.tableY);
    else if (scenery.map && state.camera.zoom >= 12) {
      ctx.fillStyle = "#d8c99f";
      ctx.fillRect(firstSeat.tableX * TILE * SCALE + 25, firstSeat.tableY * TILE * SCALE + 8, 37 * scenery.map, 19);
    }
    for (let chair = 0; chair < scenery.stacked; chair += 1) {
      ctx.fillStyle = "#bd955c";
      ctx.fillRect((firstSeat.tableX + 2.5) * TILE * SCALE, (firstSeat.tableY + 1.2) * TILE * SCALE - chair * 5, 16, 4);
    }
  });
}

function drawDice(index, view) {
  if (!view || state.camera.zoom < 12) return;
  const seat = seatPosition(index, 0);
  const unit = TILE * SCALE;
  for (const die of view.dice) {
    ctx.save();
    ctx.translate((seat.tableX + .55) * unit + die.x * 23, (seat.tableY + .45) * unit + die.y * 17);
    ctx.rotate(die.angle);
    ctx.fillStyle = "#f7efd8"; ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = "#201c27"; ctx.font = "bold 9px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(die.face), 0, 0);
    ctx.restore();
  }
  drawLabel(`${view.event.roll.expression} = ${view.event.roll.total}`, seat.tableX + 1.5, seat.tableY + 2.25,
    { size: 4, color: "#fff2cd" });
}

function drawStaff(staff) {
  const unit = TILE * SCALE;
  const x = staff.x * unit, y = staff.y * unit;
  // Geometric uniform and cap distinguish anonymous staff from participant sprites.
  ctx.fillStyle = "#d8c7a6"; ctx.fillRect(x - 5, y - 20, 10, 9);
  ctx.fillStyle = "#73afb5"; ctx.fillRect(x - 7, y - 25, 14, 5);
  ctx.fillRect(x - 7, y - 11, 14, 14);
  ctx.fillStyle = "#23232d"; ctx.fillRect(x - 6, y + 3, 5, 7); ctx.fillRect(x + 1, y + 3, 5, 7);
  if (staff.load) {
    ctx.fillStyle = staff.load === "map" ? "#d8c99f" : "#bd955c";
    ctx.fillRect(x + 7, y - 8, staff.load === "table" ? 22 : 10, staff.load === "chairs" ? 15 : 7);
  }
  if (state.camera.zoom >= 25) drawLabel("STAFF", staff.x, staff.y - 1.1, { size: 3, color: "#bde8ed" });
}

function drawTableProps(x, y) {
  if (state.camera.zoom < 12) return;
  const unit = TILE * SCALE;
  ctx.save();
  ctx.translate(x * unit, y * unit);
  // Authored geometric props need no external art or new timeline facts.
  ctx.fillStyle = "#eee0b9"; ctx.fillRect(25, 8, 37, 19);
  ctx.strokeStyle = "#a79972"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) { ctx.beginPath(); ctx.moveTo(28 + i * 9, 8); ctx.lineTo(28 + i * 9, 27); ctx.stroke(); }
  ctx.fillStyle = "#443450"; ctx.fillRect(4, 3, 15, 21); // GM screen
  ctx.fillStyle = "#bd955c"; ctx.fillRect(72, 9, 17, 17); // dice tray
  ctx.fillStyle = "#453129"; ctx.fillRect(74, 11, 13, 13);
  if (state.camera.zoom >= 36) {
    ctx.fillStyle = "#fff2d1"; ctx.fillRect(77, 14, 5, 5); ctx.fillRect(58, 3, 9, 5);
    ctx.fillStyle = "#813c35"; ctx.fillRect(3, 25, 11, 5); // book
    ctx.fillStyle = "#84aab4"; ctx.fillRect(39, 15, 4, 4); ctx.fillRect(51, 21, 4, 4);
    ctx.fillStyle = "#ddc492"; ctx.fillRect(65, 23, 5, 6); // mug
  }
  ctx.restore();
}

function drawTableLabels() {
  const dpr = globalThis.devicePixelRatio || 1;
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const boxes = [];
  // Selected labels take priority when the overview is crowded.
  const indices = state.data.tables.map((_, i) => i).sort((a, b) => Number(state.data.tables[b].id === state.selectedId) - Number(state.data.tables[a].id === state.selectedId));
  for (const index of indices) {
    const table = state.data.tables[index];
    const cell = state.layout.cells[index];
    const point = worldToScreen(state.camera, { x: cell.x + 3, y: cell.y + 5.2 });
    if (point.x < 0 || point.x > state.viewport.width || point.y < 0 || point.y > state.viewport.height - 18) continue;
    ctx.font = "700 13px system-ui, sans-serif";
    const lifecycle = tableLifecycle(state.data, table, state.time);
    const status = lifecycle.phase === "active" ? `${Math.max(0, table.seats - table.signups.length)} seats left` : lifecycle.label;
    const text = `${truncate(table.name, 26)} · ${status}`;
    const width = Math.min(state.viewport.width - 8, ctx.measureText(text).width + 16);
    const height = state.camera.zoom >= 25 ? 40 : 23;
    const left = clamp(point.x - width / 2, 4, state.viewport.width - width - 4);
    const top = Math.min(point.y, state.viewport.height - height - 4);
    if (boxes.some((box) => left < box.x + box.w && left + width > box.x && top < box.y + box.h && top + height > box.y)) continue;
    boxes.push({ x: left, y: top, w: width, h: height, index });
    ctx.fillStyle = "#17141feb"; ctx.fillRect(left, top, width, height);
    ctx.fillStyle = table.id === state.selectedId ? "#ffd27a" : "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(text, left + width / 2, top + 3, width - 8);
    if (height > 23) {
      ctx.font = "12px system-ui, sans-serif"; ctx.fillStyle = "#f1cf91";
      ctx.fillText(`${formatSlot(table.start)}–${formatSlot(table.end)}`, left + width / 2, top + 21, width - 8);
    }
  }
  state.labelBoxes = boxes;
  ctx.restore();
}

function drawPerson(runtime, now, active) {
  const person = runtime.person;
  const place = runtime.place;
  let x = runtime.position.x - 0.5;
  let y = runtime.position.y - 0.6 + (place.foodPhase === "eating" && !runtime.moving ? .15 : 0);
  const movingBob = runtime.moving && !reducedMotion.matches && Math.floor(state.time * state.data.event.slot_minutes * 60 / .14) % 2 ? 0.07 : 0;
  const cheering = active.spotlight && place.kind !== "spotlight" && !place.kind.startsWith("stage-") && !reducedMotion.matches;
  const social = place.activity === "chatting" || place.activity === "cards";
  const talkTime = social ? state.time * state.data.event.slot_minutes * 60 : now / 1000;
  const talk = (place.kind === "table" || social) && !runtime.moving && !reducedMotion.matches && ((talkTime + runtime.phase * 6) % 6) < 0.5;
  y -= movingBob + (cheering ? Math.abs(Math.sin(now / 160 + runtime.phase * 8)) * 0.25 : 0);
  let facing = runtime.facing;
  if (active.announce && !runtime.moving) facing = state.layout.stageFront.x < runtime.position.x ? -1 : 1;
  if (place.kind === "stage-speaker" && !runtime.moving) facing = 1;
  const flip = facing < 0;
  const frame = talk || cheering || (place.kind === "stage-speaker" && state.speech?.phase === "speaking") ? 1 : 0;
  const appearance = characterAppearance(person);
  if (appearance === null) {
    if (!drawTile(state.images.characters, [frame, 1], x, y, flip, 0.85)) {
      ctx.fillStyle = "#292832";
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
    drawTile(state.images.characters, [16, 7], x, y, flip, 0.85);
  } else {
    if (!drawTile(state.images.characters, [frame, SPRITES.skin[appearance.skin]], x, y, flip)) {
      const colors = ["#9e6d50", "#d49b6a", "#6b8fb5", "#9f70ad", "#61a178", "#b06d6d", "#cfaa4d", "#578d98", "#866fbd", "#b37f53", "#6a9b62", "#a85c86", "#6981bd", "#c27c55", "#7d9562"];
      ctx.fillStyle = colors[visibleVariant(person, PALETTE_SIZE)];
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
    drawTile(state.images.characters, SPRITES.shirts[appearance.shirt], x, y, flip);
    drawTile(state.images.characters, SPRITES.hair[appearance.hair], x, y, flip);
    if (person.dm) drawTile(state.images.characters, SPRITES.hats[appearance.hat], x, y - 0.15, flip);
  }
  if (place.plate) {
    const eating = place.foodPhase === "eating" && !runtime.moving;
    const bite = eating && !reducedMotion.matches && (state.time * state.data.event.slot_minutes * 60 % 5) < 1;
    const unit = TILE * SCALE;
    const plateX = x + .7, plateY = y + (bite ? .37 : .68);
    ctx.fillStyle = "#fff2dc";
    ctx.beginPath(); ctx.ellipse(plateX * unit, plateY * unit, .25 * unit, .10 * unit, 0, 0, Math.PI * 2); ctx.fill();
    if (place.foodRemaining > 0 && place.foodPhase !== "trash") {
      ctx.fillStyle = "#d28a42";
      ctx.fillRect((plateX - .16) * unit, (plateY - .06) * unit, .32 * unit * place.foodRemaining, .07 * unit);
    }
  }
  if (place.activity === "reading" && !runtime.moving) {
    ctx.fillStyle = "#e9d5aa";
    ctx.fillRect((x + .35) * TILE * SCALE, (y + .55) * TILE * SCALE, .5 * TILE * SCALE, .3 * TILE * SCALE);
  }
  if (place.kind === "spotlight" && !runtime.moving) drawLabel("★", x + 0.5, y - 0.55, { size: 6, color: "#ffd84a", background: false });
  if (cheering && ((now / 400 + runtime.phase * 3) % 3) < 1) drawLabel("♥", x + 0.5 + runtime.phase * 0.4, y - 0.6, { size: 4, color: "#ff7a9a", background: false });
  if (active.announce && !runtime.moving && ((runtime.phase * 7) % 1) < 0.35) drawLabel("!", x + 0.9, y - 0.35, { size: 4, color: "#ffe066", background: false });
  if (state.hover === runtime && !person.hidden) {
    drawLabel(`${person.dm ? "DM " : ""}${person.name}`, x + 0.5, y - 0.55, { size: 3.6, bold: person.dm, color: person.dm ? "#ffd27a" : "#fff", background: person.dm ? "rgba(60,30,0,.86)" : "rgba(0,0,0,.76)" });
  }
}

function drawBubble(value, x, y, color, label = "") {
  const anchor = worldToScreen(state.camera, { x, y });
  ctx.save();
  const dpr = globalThis.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const size = 13;
  ctx.font = `${size}px ui-monospace, monospace`;
  const text = label ? `${label}: ${value}` : value;
  const words = text.split(/\s+/u);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > Math.min(360, state.viewport.width - 30)) { lines.push(current); current = word; }
    else current = next;
  }
  if (current || lines.length === 0) lines.push(current);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 20) + 4 * SCALE;
  const height = lines.length * (size + SCALE) + 3 * SCALE;
  let left = anchor.x - width / 2;
  left = clamp(left, 2 * SCALE, state.viewport.width - width - 2 * SCALE);
  const top = clamp(anchor.y - height, 2 * SCALE, state.viewport.height - height - 4 * SCALE);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#222";
  ctx.lineWidth = SCALE;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 3 * SCALE);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(clamp(anchor.x, left + 8, left + width - 8) - 2 * SCALE, top + height);
  ctx.lineTo(clamp(anchor.x, left + 8, left + width - 8), top + height + 3 * SCALE);
  ctx.lineTo(clamp(anchor.x, left + 8, left + width - 8) + 2 * SCALE, top + height);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((line, index) => ctx.fillText(line, left + 2 * SCALE, top + 1.5 * SCALE + index * (size + SCALE)));
  ctx.restore();
}

function drawEvents(active, now) {
  const front = state.layout.stageFront;
  if (active.spotlight) {
    ctx.save();
    ctx.globalAlpha = .28;
    ctx.fillStyle = "#fff4b0";
    ctx.beginPath();
    ctx.moveTo(front.x * TILE * SCALE, (front.y - 6) * TILE * SCALE);
    ctx.lineTo((front.x - 2.2) * TILE * SCALE, (front.y + .9) * TILE * SCALE);
    ctx.lineTo((front.x + 2.2) * TILE * SCALE, (front.y + .9) * TILE * SCALE);
    ctx.closePath(); ctx.fill(); ctx.restore();
    const person = state.data.people.find((candidate) => candidate.id === active.spotlight.person);
    const reason = active.spotlight.text ? ` ${active.spotlight.text}` : "";
    drawBubble(`${displayName(person)} in the spotlight!${reason}`, front.x, front.y - 2.2, "#fff3c4");
  }
  if (active.announce) drawBubble(active.announce.text, front.x, front.y - 2.2, "#fff");
  if (active.break) drawLabel("BREAK — everyone to the lounge", state.layout.width / 2, state.layout.height - .5, { size: 4.5, bold: true, color: "#1b1a22", background: "#ffd27a" });
  if (active.meal) drawLabel(`${active.meal.text || "MEAL"} — food corner is open`, state.layout.width / 2, state.layout.height - .5, { size: 4.5, bold: true, color: "#1b1a22", background: "#9fe08a" });

  if (state.speech?.phase === "speaking") {
    const view = speechView(state.data, state.speech.event, state.time, active);
    let position = state.layout.stageFront;
    const custom = view.kind === "donation";
    if (!custom && !view.stageSide) {
      const runtime = state.people.get(state.speech.event.person);
      if (runtime?.visible) position = runtime.position;
    }
    const color = view.kind === "donation" ? "#ffdd72" : "#eef3d5";
    drawBubble(view.text, position.x, position.y - 1.2, color, custom ? displayName(view.person) : view.stageSide ? view.label : "");
    if (view.kind === "donation" && !reducedMotion.matches) {
      for (let index = 0; index < 5; index += 1) {
        const angle = now / 380 + index * Math.PI * 2 / 5;
        drawLabel("★", position.x + Math.cos(angle) * (1.2 + index * .08), position.y - 1.5 + Math.sin(angle) * .8, { size: 4, color: "#fff0a2", background: false });
      }
    }
  }
}

function render(now, active) {
  const ambienceSlot = state.clock.mode === "follow-now" ? Math.max(state.time,
    (Date.now() - Date.parse(state.data.event.start)) / (state.data.event.slot_minutes * 60000)) : state.time;
  state.ambience = hallAmbience(state.data, ambienceSlot, state.layout, reducedMotion.matches);
  updateCamera();
  if (!ctx) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const width = Math.round(state.viewport.width * dpr);
  const height = Math.round(state.viewport.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const scale = dpr * state.camera.zoom / (TILE * SCALE);
  ctx.setTransform(scale, 0, 0, scale, state.camera.x * dpr, state.camera.y * dpr);
  ctx.imageSmoothingEnabled = false;
  drawRoom();
  drawTables();
  [...state.people.values()].filter((person) => person.visible).sort((a, b) => a.position.y - b.position.y).forEach((person) => drawPerson(person, now, active));
  state.data.tables.forEach((table, index) => {
    if (tableLifecycle(state.data, table, state.time).phase === "active") {
      drawDice(index, diceAt(state.data, table.id, state.time, reducedMotion.matches));
    }
  });
  drawMicrophone();
  // Dim only the room artwork; controls, table details and speech remain readable.
  const lights = [...state.people.values()].some(person => person.visible) && state.ambience.foodCount === 6
    ? Math.max(.85, state.ambience.lights) : state.ambience.lights;
  ctx.fillStyle = `rgba(4, 7, 20, ${(1 - lights) * .76})`;
  ctx.fillRect(0, 0, state.layout.width * TILE * SCALE, state.layout.height * TILE * SCALE);
  drawStaff(active.break ? { x: state.layout.stageFront.x + 2, y: state.layout.stageFront.y } : state.ambience.staff);
  if (active.break) drawBubble(`Break time! Back at ${formatSlot(active.break.at + active.break.duration)}.`,
    state.layout.stageFront.x + 2, state.layout.stageFront.y - 1.3, "#b6e0df", "Staff");
  const lightSwitch = state.ambience.lightSwitch;
  ctx.fillStyle = lights > .5 ? "#fff3ac" : "#697a9d";
  ctx.fillRect((lightSwitch.x - .8) * TILE * SCALE, (lightSwitch.y - .7) * TILE * SCALE, 6, 10);
  drawTableLabels();
  drawEvents(active, now);
}

function actualText(actual) {
  if (!actual) return "not recorded";
  return `${actual[0] === null ? "?" : formatSlot(actual[0])}–${actual[1] === null ? "?" : formatSlot(actual[1])}`;
}

function renderDetail(focus = false) {
  const panel = $("detail");
  panel.replaceChildren();
  state.detailPhaseNode = null;
  state.detailDiceNode = null;
  const table = state.data.tables.find((candidate) => candidate.id === state.selectedId);
  if (!table) {
    append(panel, "h2", "Table details");
    append(panel, "p", "Select a table in the hall or in the table list.", "muted");
    return;
  }
  const view = tableView(state.data, table);
  const heading = append(panel, "h2", view.name);
  heading.tabIndex = -1;
  append(panel, "p", view.system, "system");
  append(panel, "p", view.pitch);
  state.detailPhaseNode = append(panel, "p", `At selected time: ${tableLifecycle(state.data, table, state.time).label}`, "table-phase");
  state.detailDiceNode = append(panel, "p", diceText(state.data, diceAt(state.data, table.id, state.time)?.event), "dice-result");
  append(panel, "p", `DM ${view.dm}`);
  append(panel, "p", `${formatSlot(view.start, true)}–${formatSlot(view.end, true)} · ${view.signupCount}/${view.seats} signups${view.walkIns ? " · walk-ins welcome" : ""}`, "muted");
  append(panel, "p", state.archive ? "Saved roster for this event." : "In Discord, open the tables board and use Join. In your game room, Player Options lets you get food, visit the lounge, return to your table, or roll dice. Public rolls appear here.", "join-instructions");
  append(panel, "h3", "Roster");
  const list = append(panel, "ul");
  if (view.roster.length === 0) append(list, "li", "No signups yet.", "muted");
  for (const person of view.roster) append(list, "li", `${person.name}: planned ${formatSlot(person.planned[0])}–${formatSlot(person.planned[1])}; actual ${actualText(person.actual)}`);
  if (focus) heading.focus();
}

function selectTable(id, focus = false) {
  state.selectedId = id;
  const index = state.data.tables.findIndex((table) => table.id === id);
  if (index >= 0) frameTables([index], true);
  renderDetail(focus && state.selectedId !== null);
}

function renderTableList() {
  const host = $("tables");
  host.replaceChildren();
  state.tablePhaseNodes.clear();
  state.tableDiceNodes.clear();
  if (state.data.schema >= 6) {
    const article = append(host, "article", undefined, "table-card visitors-card");
    append(article, "h3", "Visitors Table · Just visiting");
    append(article, "p", "Hosted by the event coordinator. Use Get Food or Go to Lounge in the Discord Visitors Table room to move your character. Visitors also mingle between games.");
    append(article, "p", state.archive ? "Saved visitor roster." : "Choose Just visiting first in Discord’s Browse Games menu.");
    const roster = append(article, "ul", undefined, "roster");
    if (!state.data.visitors.people.length) append(roster, "li", "No visitors yet.");
    const byId = new Map(state.data.people.map((person) => [person.id, person]));
    for (const id of state.data.visitors.people) append(roster, "li", displayName(byId.get(id)));
  }
  if (state.data.tables.length === 0) { append(host, "p", "No tables have been posted.", "muted"); return; }
  const grid = append(host, "div", undefined, "table-grid");
  for (const table of state.data.tables) {
    const view = tableView(state.data, table);
    const article = append(grid, "article", undefined, "table-card");
    const heading = append(article, "h3");
    const button = append(heading, "button", view.name);
    button.type = "button";
    button.setAttribute("aria-label", `Show details for ${view.name}`);
    button.addEventListener("click", () => selectTable(table.id, true));
    append(article, "p", `${view.system} — ${view.pitch}`);
    state.tablePhaseNodes.set(table.id, append(article, "p", `At selected time: ${tableLifecycle(state.data, table, state.time).label}`, "table-phase"));
    const diceNode = append(article, "p", diceText(state.data, diceAt(state.data, table.id, state.time)?.event), "dice-result");
    diceNode.setAttribute("aria-live", "polite");
    diceNode.setAttribute("aria-atomic", "true");
    state.tableDiceNodes.set(table.id, diceNode);
    const details = append(article, "dl");
    append(details, "dt", "DM"); append(details, "dd", view.dm);
    append(details, "dt", "Window"); append(details, "dd", `${formatSlot(view.start, true)}–${formatSlot(view.end, true)}`);
    append(details, "dt", "Signups"); append(details, "dd", `${view.signupCount}/${view.seats}${view.walkIns ? "; walk-ins welcome" : ""}`);
    append(article, "p", state.archive ? "Saved roster for this event." : "Sign up using Join on the Discord tables board.", "join-instructions");
    append(article, "p", "Roster", "muted");
    const roster = append(article, "ul", undefined, "roster");
    if (view.roster.length === 0) append(roster, "li", "No signups yet.");
    for (const person of view.roster) append(roster, "li", `${person.name}: planned ${formatSlot(person.planned[0])}–${formatSlot(person.planned[1])}; actual ${actualText(person.actual)}`);
  }
}

function updateHeader(active) {
  const activityCounts = { reading: 0, chatting: 0, cards: 0 };
  for (const person of state.leisure.values()) activityCounts[person.activity] += 1;
  const loungeDescription = `Lounge: ${activityCounts.reading} reading, ${activityCounts.chatting} chatting, ${activityCounts.cards} playing cards. Food: ${state.diners.length} collecting, eating or clearing plates.`;
  const staffAction = active.break ? "Staff are announcing the break from the stage." : state.ambience?.action ?? "";
  const staffDescription = `${hallDescription} ${staffAction} ${loungeDescription}`.trim();
  if ($("canvas-description").textContent !== staffDescription) $("canvas-description").textContent = staffDescription;
  const clockText = formatSlot(state.time, true);
  if ($("clock").textContent !== clockText) $("clock").textContent = clockText;
  const eventLabel = active.spotlight ? "SPOTLIGHT" : active.announce ? "ANNOUNCEMENT" : active.break ? "BREAK" : active.meal ? (active.meal.text || "MEAL").toUpperCase() : "";
  if ($("scene-event").textContent !== eventLabel) $("scene-event").textContent = eventLabel;
  let eventText = accessibleEventText(state.data, active, state.speech?.phase === "speaking" ? state.speech.event : null);
  if (state.speech?.event.kind === "donation" && state.speech.phase === "approaching") {
    eventText += ` ${displayName(state.people.get(state.speech.event.person)?.person)} is walking to the stage microphone.`;
  }
  if (state.stageQueue.length) eventText += ` ${state.stageQueue.length} waiting to speak at the stage.`;
  eventText = eventText.trim();
  if ($("current-event").textContent !== eventText) $("current-event").textContent = eventText;
  $("scrubber").value = String(state.time);
  const following = state.clock.mode === "follow-now";
  $("play").textContent = state.clock.mode === "paused" ? "Play" : "Pause";
  $("play").disabled = false;
  $("scrubber").disabled = false;
  $("speed").disabled = following;
  const canFollow = state.clock.source === "live" && state.data.phase === "live";
  $("return-now").hidden = !canFollow || following;
  $("now-marker").hidden = !canFollow;
  if (canFollow) $("now-marker").textContent = `Now: ${formatDate(Date.now(), { hour: "numeric", minute: "2-digit" })}`;
  const badge = $("mode-badge");
  badge.textContent = following ? (state.time >= state.data.event.slots ? "EVENT ENDED" : Date.now() < Date.parse(state.data.event.start) ? "UPCOMING" : "LIVE") : state.clock.mode === "paused" ? "PAUSED" : "REPLAY";
  badge.className = `badge${following ? " live" : ""}`;
  for (const table of state.data.tables) {
    const text = `At selected time: ${tableLifecycle(state.data, table, state.time).label}`;
    const result = diceText(state.data, diceAt(state.data, table.id, state.time)?.event);
    const diceNode = state.tableDiceNodes.get(table.id);
    if (diceNode && diceNode.textContent !== result) diceNode.textContent = result;
    if (state.selectedId === table.id && state.detailDiceNode && state.detailDiceNode.textContent !== result) state.detailDiceNode.textContent = result;
    const node = state.tablePhaseNodes.get(table.id);
    if (node && node.textContent !== text) node.textContent = text;
    if (state.selectedId === table.id && state.detailPhaseNode && state.detailPhaseNode.textContent !== text) state.detailPhaseNode.textContent = text;
  }
  const beforeEvent = Date.now() < Date.parse(state.data.event.start);
  const available = state.data.tables.filter((table) => table.signups.length < table.seats && (beforeEvent || state.time < table.end)).length;
  const count = state.data.tables.length;
  const base = state.archive ? `${count} ${count === 1 ? "game" : "games"} in the saved schedule · Figures follow planned and recorded attendance` : beforeEvent ? `${available} ${available === 1 ? "game" : "games"} with signup space · Event starts ${formatSlot(0, true)}` : `${count} ${count === 1 ? "game" : "games"} on the schedule · Figures follow planned and recorded attendance`;
  const note = !ctx ? " · Hall graphics unavailable; use the table list." : state.assetsFailed ? " · Sprite art unavailable; simplified graphics are in use." : "";
  if (!state.staleMessage) setStatus(base + note, !ctx || state.assetsFailed ? "stale" : "");
}

function clearSpeech() {
  state.speechQueue = [];
  state.speech = null;
  state.stageQueue = [];
  if (state.live) state.live = { ...state.live, speechQueue: [] };
}

function setClock(clock, persistNow = true, snap = true) {
  state.clock = clock;
  state.time = clock.slot;
  state.snap = snap;
  clearSpeech();
  persistClockSelection(performance.now(), persistNow);
}

function persistClockSelection(now, force = false) {
  if (!globalThis.history?.replaceState || !location.href || (!force && now - state.lastUrlWrite < 1000)) return;
  const url = new URL(location.href);
  if (state.clock.mode === "follow-now") url.searchParams.delete("at");
  else url.searchParams.set("at", String(state.time));
  if (url.href !== location.href) {
    try { history.replaceState(null, "", url.href); }
    catch { /* A restricted History API must not stop the viewer. */ }
  }
  state.lastUrlWrite = now;
}

function queueSpeech(events) {
  const queue = [...state.speechQueue, ...events];
  let shouts = queue.filter((event) => event.kind === "shout").length;
  state.speechQueue = queue.filter((event) => event.kind !== "shout" || shouts-- <= 20);
}

function advanceSpeech(now) {
  const speech = state.speech;
  if (speech && !state.people.has(speech.event.person)) state.speech = null;
  else if (speech?.phase === "speaking" && now >= speech.until) {
    if (speech.event.kind === "donation") speech.phase = "leaving";
    else state.speech = null;
  }
  if (!state.speech) {
    let event = null;
    do {
      if (state.clock.mode === "follow-now" && state.live) {
        const shifted = shiftSpeechQueue(state.live);
        state.live = shifted.state;
        event = shifted.event;
      } else event = state.speechQueue.shift();
    } while (event && !state.people.has(event.person));
    if (event) state.speech = { event, phase: event.kind === "donation" ? "approaching" : "speaking",
      until: event.kind === "donation" ? null : now + SPEECH_SECONDS[event.kind] * 1000 };
  }
  const queue = state.clock.mode === "follow-now" && state.live ? state.live.speechQueue : state.speechQueue;
  state.stageQueue = stageQueuePeople(queue, state.speech, state.people);
}

function settleStageSpeech(now) {
  const speech = state.speech;
  if (speech?.event.kind !== "donation") return;
  const runtime = state.people.get(speech.event.person);
  if (!runtime?.visible || runtime.moving) return;
  if (speech.phase === "approaching" && samePoint(runtime.position, state.layout.stageFront)) {
    speech.phase = "speaking";
    speech.until = now + SPEECH_SECONDS.donation * 1000;
  } else if (speech.phase === "leaving" && samePoint(runtime.position, stageGeometry(state.layout).foot)) {
    state.speech = null;
  }
}

async function readTimeline(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("fetch");
  let input;
  try { input = await response.json(); }
  catch { throw new Error("json"); }
  return validateTimeline(input);
}

async function fetchTimeline() {
  if (state.archive || state.sample) {
    return readTimeline(state.archive ? "./timeline.json" : "./data/timeline.sample.json");
  }
  const liveFeed = $("live-feed")?.getAttribute("content");
  state.feedDelayed = false;
  if (!liveFeed) return readTimeline("./data/timeline.json");
  const freshUrl = (value) => {
    const url = new URL(value, location.href);
    url.searchParams.set("check", String(Date.now()));
    return url.href;
  };
  // The live service reads the primary database and forbids intermediary caching.
  try { return await readTimeline(freshUrl(liveFeed)); }
  catch { state.feedDelayed = true; }
  const backups = ["./data/timeline.json", $("backup-feed")?.getAttribute("content")].filter(Boolean);
  const results = await Promise.allSettled(backups.map(url => readTimeline(freshUrl(url))));
  const snapshots = results.filter(result => result.status === "fulfilled").map(result => result.value);
  if (!snapshots.length) throw results[0].reason;
  return snapshots.sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at))[0];
}

function updateSyncStatus() {
  const controls = $("sync-controls");
  if (!controls) return;
  controls.hidden = state.archive || state.sample;
  if (controls.hidden) return;
  const final = state.data?.phase === "final";
  $("refresh-now").disabled = state.refreshing;
  $("refresh-now").textContent = state.refreshing ? "Checking…" : "Check for updates";
  controls.className = `sync-controls${state.staleMessage || state.feedDelayed ? " delayed" : ""}`;
  const checked = state.lastChecked ? formatDate(state.lastChecked, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
  let message = state.refreshing ? "Checking for updates…"
    : state.staleMessage ? "Updates unavailable. Your last loaded view is still shown; we’ll retry."
    : state.feedDelayed ? "Live feed delayed. Showing the newest backup; retrying the live connection."
    : final ? "Final event record. Automatic updates have stopped."
    : `Checked at ${checked}. Checking every 2 seconds.`;
  if (state.data) message += ` Data published at ${formatDate(Date.parse(state.data.generated_at), { hour: "numeric", minute: "2-digit", second: "2-digit" })}.`;
  if (!final && state.clock && state.clock.mode !== "follow-now") message += " Viewing an earlier time — choose Return to Now to see current actions.";
  if ($("sync-status").textContent !== message) $("sync-status").textContent = message;
}

function installTimeline(data, initial = false) {
  state.data = data;
  document.title = `${data.event.name} — Great Hall`;
  $("event-name").textContent = data.event.name;
  $("record-note").hidden = !state.archive && data.phase !== "final";
  $("record-note").textContent = state.archive ? "Archived event replay. This shows the final saved schedule." : "This is the final event record.";
  $("updated").textContent = formatDate(Date.parse(data.generated_at), { dateStyle: "medium", timeStyle: "medium" });
  $("scrubber").max = String(data.event.slots);
  $("start-label").textContent = formatSlot(0, true);
  $("end-label").textContent = formatSlot(data.event.slots, true);
  state.layout = buildLayout();
  state.frameKey = null;
  renderActions();
  state.adminEvents = indexAdminEvents(data);
  syncPeople();
  state.activity = publicActivity(data);
  state.activityKey = null;
  state.activitySecond = null;
  if (state.selectedId && !data.tables.some((table) => table.id === state.selectedId)) state.selectedId = null;
  renderTableList();
  renderDetail();
  if (initial) state.time = 0;
  if (initial) state.snap = true;
}

async function refresh() {
  if (state.refreshing || state.archive || state.sample) return;
  state.refreshing = true;
  state.lastRefresh = performance.now();
  updateSyncStatus();
  try {
    const next = await fetchTimeline();
    if (!state.live) state.live = createLiveState(state.data);
    const result = reconcileLiveSnapshot(state.live, next);
    state.live = state.clock.mode === "follow-now" ? result : { ...result, speechQueue: [] };
    if (result.changed) {
      installTimeline(result.snapshot);
    }
    state.staleMessage = "";
    state.lastChecked = Date.now();
  } catch (error) {
    state.staleMessage = error?.name === "TimelineError" ? `Update rejected: ${error.message} Showing the last good snapshot.` : "Update failed. Showing the last good snapshot.";
    setStatus(state.staleMessage, "stale");
  } finally {
    state.refreshing = false;
    updateSyncStatus();
    renderActivity();
  }
}

$("refresh-now")?.addEventListener("click", () => { void refresh(); });
function checkLiveUpdates() {
  if (state.data?.phase === "live" && state.clock?.source === "live"
      && performance.now() - state.lastRefresh >= 2_000) void refresh();
}
// Polling must survive suspended animation frames and catch up on returning from Discord.
setInterval(checkLiveUpdates, 2_000);
document.addEventListener?.("visibilitychange", () => {
  if (!document.hidden && state.data?.phase === "live") void refresh();
});

function renderActivity() {
  if (!state.data || !state.clock) return;
  const cutoff = state.clock.mode === "follow-now" ? Date.now() : slotToMs(state.data, state.time);
  const second = Math.floor(cutoff / 1000);
  if (second === state.activitySecond) return;
  state.activitySecond = second;
  const visible = state.activity.filter((entry) => entry.at <= cutoff);
  const entries = visible.slice(0, state.activityLimit);
  const key = `${state.activityLimit}:${entries.map((entry) => entry.id).join(",")}:${visible.length}`;
  $("activity-note").textContent = `Newest first · Times in ${state.data.event.tz} · ${state.clock.mode === "follow-now" ? "Live actions" : "Actions up to the selected time"}. Private rolls are not shown. Earlier signup and edit history may be unavailable.`;
  if (key === state.activityKey) return;
  state.activityKey = key;
  const list = $("activity-log");
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("li");
    const time = document.createElement("time");
    time.dateTime = new Date(entry.at).toISOString();
    time.textContent = formatDate(entry.at, { dateStyle: "medium", timeStyle: "medium" });
    row.append(time);
    append(row, "span", entry.text);
    list.append(row);
  }
  list.scrollTop = scrollTop;
  $("activity-empty").hidden = entries.length !== 0;
  $("activity-more").hidden = visible.length <= state.activityLimit;
}

$("activity-more").addEventListener("click", () => {
  state.activityLimit += 100;
  state.activitySecond = null;
  renderActivity();
});

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function canvasPoint(event) { return screenToWorld(state.camera, pointerPoint(event)); }
function hideTooltip() { state.hover = null; $("tooltip").hidden = true; }
const pointers = new Map();
let gesture = null;
let suppressClick = false;
function gesturePosition() {
  const points = [...pointers.values()];
  return { center: { x: points.reduce((n, p) => n + p.x, 0) / points.length, y: points.reduce((n, p) => n + p.y, 0) / points.length }, distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0 };
}
function moveCamera(dx, dy) {
  if (!state.camera) return;
  state.camera = panCamera(state.camera, dx, dy, viewport(), state.layout);
  state.manualCamera = true;
  hideTooltip();
}
function zoomCamera(factor, point = { x: viewport().width / 2, y: viewport().height / 2 }) {
  if (!state.camera) return;
  state.camera = zoomAt(state.camera, point, factor, viewport(), state.layout);
  state.manualCamera = true;
  hideTooltip();
}
canvas.addEventListener("pointerdown", (event) => {
  if (!state.camera || (event.button !== undefined && event.button !== 0)) return;
  if (!pointers.size) suppressClick = false;
  pointers.set(event.pointerId, pointerPoint(event));
  canvas.setPointerCapture(event.pointerId);
  gesture = gesturePosition();
  if (pointers.size > 1) suppressClick = true;
  hideTooltip();
});
canvas.addEventListener("pointermove", (event) => {
  if (!state.camera) return;
  if (pointers.has(event.pointerId)) {
    pointers.set(event.pointerId, pointerPoint(event));
    const next = gesturePosition();
    const dx = next.center.x - gesture.center.x, dy = next.center.y - gesture.center.y;
    if (pointers.size > 1 || suppressClick || Math.hypot(dx, dy) > 5) {
      suppressClick = true;
      if (next.distance && gesture.distance) zoomCamera(next.distance / gesture.distance, gesture.center);
      moveCamera(dx, dy);
      gesture = next;
    }
    return;
  }
  const point = canvasPoint(event);
  let best = null;
  let distance = .72;
  for (const runtime of state.people.values()) {
    if (!runtime.visible) continue;
    const candidate = Math.hypot(runtime.position.x - point.x, runtime.position.y - point.y + .1);
    if (candidate < distance) { best = runtime; distance = candidate; }
  }
  state.hover = best;
  const tooltip = $("tooltip");
  if (!best) { tooltip.hidden = true; return; }
  tooltip.textContent = personTooltip(best.person, best.place, best.moving);
  const sceneRect = canvas.parentElement.getBoundingClientRect();
  tooltip.style.left = `${clamp(event.clientX - sceneRect.left + 12, 0, Math.max(0, sceneRect.width - 280))}px`;
  tooltip.style.top = `${Math.max(0, event.clientY - sceneRect.top - 30)}px`;
  tooltip.hidden = false;
});
function finishPointer(event) {
  pointers.delete(event.pointerId);
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  gesture = pointers.size ? gesturePosition() : null;
}
canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", (event) => { suppressClick = true; finishPointer(event); });
canvas.addEventListener("lostpointercapture", finishPointer);
canvas.addEventListener("pointerleave", hideTooltip);
canvas.addEventListener("click", (event) => {
  if (!state.camera || suppressClick) return;
  const screen = pointerPoint(event);
  const label = state.labelBoxes?.find((box) => screen.x >= box.x && screen.x < box.x + box.w && screen.y >= box.y && screen.y < box.y + box.h);
  const point = canvasPoint(event);
  const index = label?.index ?? state.layout.cells.findIndex((cell) => point.x >= cell.x && point.x < cell.x + 6 && point.y >= cell.y && point.y < cell.y + 6);
  if (index >= 0 && state.data.tables[index]) selectTable(state.data.tables[index].id);
});
canvas.addEventListener("wheel", (event) => {
  if (!state.camera) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport().height : 1;
  zoomCamera(Math.exp(-clamp(event.deltaY * unit, -300, 300) * .002), pointerPoint(event));
}, { passive: false });
function recenter() {
  if (!state.layout) return;
  state.camera = fitBounds({ x: 0, y: 0, width: state.layout.width, height: state.layout.height }, viewport(), state.layout, 0);
  state.manualCamera = true;
  hideTooltip();
}
$("zoom-in").addEventListener("click", () => zoomCamera(1.25));
$("zoom-out").addEventListener("click", () => zoomCamera(.8));
$("recenter").addEventListener("click", recenter);
$("fit-active").addEventListener("click", () => { if (state.data) frameTables(relevantTableIndices(state.data.tables, state.time), true); });
canvas.addEventListener("keydown", (event) => {
  const keys = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
  if (keys[event.key]) { event.preventDefault(); moveCamera(...keys[event.key]); }
  else if (["+", "=", "-", "Home"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "Home") recenter(); else zoomCamera(event.key === "-" ? .8 : 1.25);
  }
});

$("play").addEventListener("click", () => {
  if (!state.data) return;
  const next = toggleViewerPlayback(state.clock, state.data);
  setClock(next, true, next.slot !== state.clock.slot);
  state.lastTime = performance.now();
});
$("return-now").addEventListener("click", () => {
  if (!state.data) return;
  setClock(followNowClock(state.clock, state.data, Date.now()));
});
$("speed").addEventListener("change", (event) => {
  const speed = Number(event.target.value);
  if ([1, 30, 120, 600, 1800].includes(speed)) state.speed = speed;
});
$("scrubber").addEventListener("input", (event) => {
  if (!state.data) return;
  setClock(seekViewerClock(state.clock, state.data, Number(event.target.value)), false);
});

$("scrubber").addEventListener("change", () => {
  if (state.data) persistClockSelection(performance.now(), true);
});
globalThis.addEventListener?.("pagehide", () => {
  if (state.clock) persistClockSelection(performance.now(), true);
});

reducedMotion.addEventListener?.("change", () => {
  if (state.clock?.mode === "replay" && reducedMotion.matches) setClock(seekViewerClock(state.clock, state.data, state.time));
  state.snap = true;
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = url;
  });
}

async function loadAssets() {
  const results = await Promise.allSettled([
    loadImage(new URL("./assets/roguelikeChar_transparent.png", import.meta.url).href),
    loadImage(new URL("./assets/roguelikeSheet_transparent.png", import.meta.url).href),
  ]);
  state.images.characters = results[0].status === "fulfilled" ? results[0].value : null;
  state.images.rpg = results[1].status === "fulfilled" ? results[1].value : null;
  state.assetsFailed = results.some((result) => result.status === "rejected");
}

function loop(now) {
  if (!state.data) return;
  const realSeconds = Math.max(0, Math.min(.1, (now - state.lastTime) / 1000 || 0));
  state.lastTime = now;
  const previous = state.clock;
  state.clock = tickViewerClock(previous, state.data, Date.now(), realSeconds, state.speed);
  state.time = state.clock.slot;
  if (previous.mode === "replay" && state.clock.mode !== "follow-now") queueSpeech(crossedSpeechEvents(state.data, previous.slot, state.time));
  if (previous.mode !== state.clock.mode && (previous.mode === "follow-now" || state.clock.mode === "follow-now")) { clearSpeech(); state.snap = true; }
  const active = activeEvents(state.data, state.time, state.adminEvents);
  if (state.clock.source === "live" && state.data.phase === "live" && now - state.lastRefresh >= 2_000) {
    state.lastRefresh = now;
    void refresh();
  }
  persistClockSelection(now);
  advanceSpeech(now);
  updatePeople(realSeconds, now, active);
  settleStageSpeech(now);
  render(now, active);
  updateHeader(active);
  updateSyncStatus();
  renderActivity();
  requestAnimationFrame(loop);
}

async function boot() {
  try {
    const [data] = await Promise.all([fetchTimeline(), loadAssets()]);
    installTimeline(data, true);
    state.lastChecked = Date.now();
    state.lastRefresh = performance.now();
    state.clock = createViewerClock(data, Date.now(), { source: state.archive ? "archive" : state.sample ? "sample" : "live", mobile: mobile.matches, reducedMotion: reducedMotion.matches });
    const at = new URLSearchParams(location.search).get("at");
    if (at !== null && at.trim() !== "" && Number.isFinite(Number(at))) state.clock = seekViewerClock(state.clock, data, Number(at));
    state.time = state.clock.slot;
    if (state.clock.source === "live") state.live = createLiveState(data);
    state.lastTime = performance.now();
    state.lastRefresh = state.lastTime;
    const active = activeEvents(state.data, state.time, state.adminEvents);
    updatePeople(0, state.lastTime, active);
    render(state.lastTime, active);
    updateHeader(active);
    requestAnimationFrame(loop);
  } catch (error) {
    const message = error?.name === "TimelineError" ? `Timeline could not be loaded: ${error.message}` : "Timeline could not be loaded. Check that the published data file is available.";
    setStatus(message, "error");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = "#24222c";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f5efe4";
    ctx.font = "20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("The hall is unavailable.", width / 2, height / 2);
  }
}

void boot();
