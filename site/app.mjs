import {
  PALETTE_SIZE,
  activeEvents,
  accessibleEventText,
  chairSeatIndices,
  createSeatingPlan,
  createLiveState,
  crossedSpeechEvents,
  displayName,
  indexAdminEvents,
  modeAt,
  personTooltip,
  playbackSpeed,
  reconcileLiveSnapshot,
  resolveLocation,
  seatPositionForPlan,
  shiftSpeechQueue,
  slotToMs,
  speechView,
  tableView,
  validateTimeline,
  visibleVariant,
} from "./model.mjs";

const TILE = 16;
const SCALE = 2;
const STRIDE = 17;
const WALK_TILES_PER_SECOND = 3.2;
const SPEECH_SECONDS = { shout: 4, donation: 6 };

const SPRITES = {
  skin: [0, 1, 2, 3],
  shirts: [[6,0],[10,0],[14,0],[6,3],[10,3],[14,3],[6,5],[10,5],[14,5],[8,7],[12,7],[16,7],[6,9],[10,9],[14,9]],
  hair: [[20,0],[21,0],[22,0],[24,0],[25,0],[26,0],[20,4],[21,4],[22,4],[24,4],[25,4],[26,4],[20,8],[21,8],[22,8],[19,2]],
  hats: [[28,8],[29,8],[30,8],[31,8]],
};

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
const ctx = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  data: null,
  mode: null,
  time: 0,
  lastTime: 0,
  playing: !reducedMotion.matches,
  speed: 600,
  selectedId: null,
  hover: null,
  layout: null,
  people: new Map(),
  images: { characters: null, rpg: null },
  assetsFailed: false,
  snap: true,
  lastRefresh: 0,
  live: null,
  adminEvents: [],
  speechQueue: [],
  speech: null,
  staleMessage: "",
  sample: new URLSearchParams(location.search).get("sample") === "1",
};

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function hashNumber(value) {
  let n = value >>> 0;
  n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
  return n >>> 0;
}
function random(seed) {
  let n = hashNumber(seed || 1);
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}

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
    ...(withDay ? { weekday: "short" } : {}), hour: "numeric", minute: "2-digit",
  });
}

function buildLayout() {
  const seating = createSeatingPlan(state.data.tables);
  const layout = {
    ...seating, scale: SCALE, aisles: [],
  };
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

function seatPosition(tableIndex, seat) {
  return seatPositionForPlan(state.layout, tableIndex, seat);
}

function spotIn(rect, seed, pad = 0.8) {
  const next = random(seed);
  return {
    x: rect.x + pad + next() * Math.max(0.1, rect.w - pad * 2),
    y: rect.y + pad + 0.5 + next() * Math.max(0.1, rect.h - pad * 2 - 0.5),
  };
}

function destination(runtime, now, active) {
  const place = resolveLocation(state.data, runtime.person, state.time, active);
  if (place.kind === "absent") return { ...place, label: "the door", position: state.layout.doorPosition, present: false };
  if (place.kind === "spotlight") return { ...place, position: state.layout.stageFront, present: true };
  const wander = Math.floor(now / 9000 + runtime.ordinal * 0.37);
  const seed = hashNumber((runtime.person.variant ?? runtime.ordinal + 104729) + wander * 7919);
  if (place.kind === "lounge") return { ...place, position: spotIn(state.layout.lounge, seed), present: true };
  if (place.kind === "food") {
    const queue = { x: state.layout.food.x, y: state.layout.food.y + 2.7, w: state.layout.food.w, h: state.layout.food.h + 1 };
    return { ...place, position: spotIn(queue, seed, 0.6), present: true };
  }
  return { ...place, position: seatPosition(place.tableIndex, place.seat), present: true };
}

function closestAisle(y) {
  return state.layout.aisles.reduce((best, aisle) => Math.abs(aisle - y) < Math.abs(best - y) ? aisle : best);
}

function outsideTableGrid(point) {
  const rows = Math.max(2, Math.ceil(Math.max(state.data.tables.length, 2) / 10));
  return point.x < state.layout.gridX - 0.2 || point.y < state.layout.gridY - 0.2 || point.y > state.layout.gridY + rows * state.layout.cellHeight - 0.2;
}

function pathBetween(from, to) {
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
  for (const runtime of state.people.values()) {
    const target = destination(runtime, now, active);
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
    let budget = WALK_TILES_PER_SECOND * realSeconds;
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
  drawNine(layout.food, RPG.floor.food, "#6b5936");

  for (let index = 0; index < 3; index += 1) drawTile(state.images.rpg, RPG.banners[index], layout.stage.x + 1 + index * 2, 0);
  drawTile(state.images.rpg, RPG.barrel, layout.stage.x + 3, layout.stage.y + 1);
  drawLabel("STAGE", layout.stage.x + layout.stage.w / 2, layout.stage.y + 0.5, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.35)" });

  const foodX = layout.food.x + 1;
  const foodY = layout.food.y + 1;
  for (let index = 0; index < 3; index += 1) drawTile(state.images.rpg, RPG.table[index], foodX + index, foodY);
  for (let index = 0; index < 3; index += 1) drawTile(state.images.rpg, RPG.table[index], foodX + 4, foodY + index);
  RPG.food.forEach((item, index) => drawTile(state.images.rpg, item, index < 3 ? foodX + index : foodX + 4, index < 3 ? foodY : foodY + index - 3));
  drawLabel("FOOD", layout.food.x + layout.food.w / 2, layout.food.y + 0.5, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.35)" });

  drawTile(state.images.rpg, RPG.shelf[0], layout.lounge.x, layout.lounge.y);
  drawTile(state.images.rpg, RPG.shelf[1], layout.lounge.x, layout.lounge.y + 1);
  drawTile(state.images.rpg, RPG.plant, layout.lounge.x + layout.lounge.w - 1, layout.lounge.y);
  drawTile(state.images.rpg, RPG.plant, layout.lounge.x, layout.lounge.y + layout.lounge.h - 1);
  drawTile(state.images.rpg, RPG.couch[0], layout.lounge.x + 1, layout.lounge.y + layout.lounge.h - 2);
  drawTile(state.images.rpg, RPG.couch[1], layout.lounge.x + 1, layout.lounge.y + layout.lounge.h - 1);
  drawLabel("LOUNGE", layout.lounge.x + layout.lounge.w / 2, layout.lounge.y + 0.5, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.35)" });

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
    const open = state.time >= table.start && state.time < table.end;
    if (state.selectedId === table.id) {
      ctx.fillStyle = "rgba(255,210,122,.25)";
      ctx.fillRect(cell.x * TILE * SCALE, cell.y * TILE * SCALE, state.layout.cellWidth * TILE * SCALE, state.layout.cellHeight * TILE * SCALE);
    }
    for (let column = 0; column < 3; column += 1) {
      if (!drawTile(state.images.rpg, RPG.table[column], firstSeat.tableX + column, firstSeat.tableY, false, open ? 1 : 0.45)) {
        ctx.globalAlpha = open ? 1 : 0.45;
        ctx.fillStyle = "#8d633e";
        ctx.fillRect((firstSeat.tableX + column) * TILE * SCALE, firstSeat.tableY * TILE * SCALE, TILE * SCALE, TILE * SCALE);
        ctx.globalAlpha = 1;
      }
    }
    for (const seat of chairSeatIndices(table)) {
      const position = seatPosition(index, seat);
      drawTile(state.images.rpg, chairFor(position.offset || position), position.x - 0.5, position.y - 0.5, false, open ? 1 : 0.45);
      if (!state.images.rpg) {
        ctx.fillStyle = open ? "#4c3427" : "#3b312d";
        ctx.fillRect((position.x - 0.28) * TILE * SCALE, (position.y - 0.28) * TILE * SCALE, .56 * TILE * SCALE, .56 * TILE * SCALE);
      }
    }
    drawLabel(`${truncate(table.name, 16)}  ${table.signups.length}/${table.seats}`, cell.x + 3, cell.y + 5.25, { size: 4, color: open ? "#fff" : "#aaa197", background: open ? "rgba(0,0,0,.74)" : "rgba(0,0,0,.5)" });
    drawLabel(`${formatSlot(table.start)}–${formatSlot(table.end)}`, cell.x + 3, cell.y + 5.72, { size: 3.2, color: open ? "#ffd27a" : "#898174", background: "rgba(0,0,0,.5)" });
  });
}

function drawPerson(runtime, now, active) {
  const person = runtime.person;
  const place = runtime.place;
  let x = runtime.position.x - 0.5;
  let y = runtime.position.y - 0.6;
  const movingBob = runtime.moving && !reducedMotion.matches && Math.floor(now / 140) % 2 ? 0.07 : 0;
  const cheering = active.spotlight && place.kind !== "spotlight" && !reducedMotion.matches;
  const talk = place.kind === "table" && !runtime.moving && !reducedMotion.matches && ((now / 1000 + runtime.phase * 6) % 6) < 0.5;
  y -= movingBob + (cheering ? Math.abs(Math.sin(now / 160 + runtime.phase * 8)) * 0.25 : 0);
  let facing = runtime.facing;
  if (active.announce && !runtime.moving) facing = state.layout.stageFront.x < runtime.position.x ? -1 : 1;
  const flip = facing < 0;
  const frame = talk || cheering ? 1 : 0;
  const variant = person.variant;
  if (person.hidden || variant === null) {
    if (!drawTile(state.images.characters, [frame, 1], x, y, flip, 0.85)) {
      ctx.fillStyle = "#292832";
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
    drawTile(state.images.characters, [16, 7], x, y, flip, 0.85);
  } else {
    if (!drawTile(state.images.characters, [frame, SPRITES.skin[variant % 4]], x, y, flip)) {
      const colors = ["#9e6d50", "#d49b6a", "#6b8fb5", "#9f70ad", "#61a178", "#b06d6d", "#cfaa4d", "#578d98", "#866fbd", "#b37f53", "#6a9b62", "#a85c86", "#6981bd", "#c27c55", "#7d9562"];
      ctx.fillStyle = colors[visibleVariant(person, PALETTE_SIZE)];
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
    drawTile(state.images.characters, SPRITES.shirts[(variant >>> 2) % SPRITES.shirts.length], x, y, flip);
    drawTile(state.images.characters, SPRITES.hair[(variant >>> 6) % SPRITES.hair.length], x, y, flip);
    if (person.dm) drawTile(state.images.characters, SPRITES.hats[(variant >>> 10) % SPRITES.hats.length], x, y - 0.15, flip);
  }
  if (place.kind === "spotlight" && !runtime.moving) drawLabel("★", x + 0.5, y - 0.55, { size: 6, color: "#ffd84a", background: false });
  if (cheering && ((now / 400 + runtime.phase * 3) % 3) < 1) drawLabel("♥", x + 0.5 + runtime.phase * 0.4, y - 0.6, { size: 4, color: "#ff7a9a", background: false });
  if (active.announce && !runtime.moving && ((runtime.phase * 7) % 1) < 0.35) drawLabel("!", x + 0.9, y - 0.35, { size: 4, color: "#ffe066", background: false });
  if (state.hover === runtime && !person.hidden) {
    drawLabel(`${person.dm ? "DM " : ""}${person.name}`, x + 0.5, y - 0.55, { size: 3.6, bold: person.dm, color: person.dm ? "#ffd27a" : "#fff", background: person.dm ? "rgba(60,30,0,.86)" : "rgba(0,0,0,.76)" });
  }
}

function drawBubble(value, x, y, color, label = "") {
  const size = 4.2 * SCALE;
  ctx.font = `${size}px ui-monospace, monospace`;
  const text = label ? `${label}: ${value}` : value;
  const words = text.split(/\s+/u);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > 34 * TILE * SCALE / 2) { lines.push(current); current = word; }
    else current = next;
  }
  if (current || lines.length === 0) lines.push(current);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 20) + 4 * SCALE;
  const height = lines.length * (size + SCALE) + 3 * SCALE;
  let left = x * TILE * SCALE - width / 2;
  left = clamp(left, 2 * SCALE, state.layout.width * TILE * SCALE - width - 2 * SCALE);
  const top = clamp(y * TILE * SCALE - height, 2 * SCALE, state.layout.height * TILE * SCALE - height - 4 * SCALE);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#222";
  ctx.lineWidth = SCALE;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 3 * SCALE);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x * TILE * SCALE - 2 * SCALE, top + height);
  ctx.lineTo(x * TILE * SCALE, top + height + 3 * SCALE);
  ctx.lineTo(x * TILE * SCALE + 2 * SCALE, top + height);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((line, index) => ctx.fillText(line, left + 2 * SCALE, top + 1.5 * SCALE + index * (size + SCALE)));
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

  if (state.speech) {
    const view = speechView(state.data, state.speech.event, state.time, active);
    let position = state.layout.stageFront;
    if (!view.stageSide) {
      const runtime = state.people.get(state.speech.event.person);
      if (runtime?.visible) position = runtime.position;
    }
    const color = view.kind === "donation" ? "#ffdd72" : "#eef3d5";
    drawBubble(view.text, position.x, position.y - 1.2, color, view.stageSide ? view.label : "");
    if (view.kind === "donation" && !reducedMotion.matches) {
      for (let index = 0; index < 5; index += 1) {
        const angle = now / 380 + index * Math.PI * 2 / 5;
        drawLabel("★", position.x + Math.cos(angle) * (1.2 + index * .08), position.y - 1.5 + Math.sin(angle) * .8, { size: 4, color: "#fff0a2", background: false });
      }
    }
  }
}

function render(now, active) {
  const width = state.layout.width * TILE * SCALE;
  const height = state.layout.height * TILE * SCALE;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.imageSmoothingEnabled = false;
  drawRoom();
  drawTables();
  [...state.people.values()].filter((person) => person.visible).sort((a, b) => a.position.y - b.position.y).forEach((person) => drawPerson(person, now, active));
  drawEvents(active, now);
}

function actualText(actual) {
  if (!actual) return "not recorded";
  return `${actual[0] === null ? "?" : formatSlot(actual[0])}–${actual[1] === null ? "?" : formatSlot(actual[1])}`;
}

function renderDetail(focus = false) {
  const panel = $("detail");
  panel.replaceChildren();
  const table = state.data.tables.find((candidate) => candidate.id === state.selectedId);
  if (!table) {
    append(panel, "h2", "Table details");
    append(panel, "p", "Select a table in the hall or in the accessible list below.", "muted");
    return;
  }
  const view = tableView(state.data, table);
  const heading = append(panel, "h2", view.name);
  heading.tabIndex = -1;
  append(panel, "p", view.system, "system");
  append(panel, "p", view.pitch);
  append(panel, "p", `DM ${view.dm}`);
  append(panel, "p", `${formatSlot(view.start, true)}–${formatSlot(view.end, true)} · ${view.signupCount}/${view.seats} signups${view.walkIns ? " · walk-ins welcome" : ""}`, "muted");
  append(panel, "h3", "Roster");
  const list = append(panel, "ul");
  if (view.roster.length === 0) append(list, "li", "No signups yet.", "muted");
  for (const person of view.roster) append(list, "li", `${person.name}: planned ${formatSlot(person.planned[0])}–${formatSlot(person.planned[1])}; actual ${actualText(person.actual)}`);
  if (focus) heading.focus();
}

function selectTable(id, focus = false) {
  state.selectedId = state.selectedId === id ? null : id;
  renderDetail(focus && state.selectedId !== null);
}

function renderTableList() {
  const host = $("tables");
  host.replaceChildren();
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
    const details = append(article, "dl");
    append(details, "dt", "DM"); append(details, "dd", view.dm);
    append(details, "dt", "Window"); append(details, "dd", `${formatSlot(view.start, true)}–${formatSlot(view.end, true)}`);
    append(details, "dt", "Signups"); append(details, "dd", `${view.signupCount}/${view.seats}${view.walkIns ? "; walk-ins welcome" : ""}`);
    append(article, "p", "Roster", "muted");
    const roster = append(article, "ul", undefined, "roster");
    if (view.roster.length === 0) append(roster, "li", "No signups yet.");
    for (const person of view.roster) append(roster, "li", `${person.name}: planned ${formatSlot(person.planned[0])}–${formatSlot(person.planned[1])}; actual ${actualText(person.actual)}`);
  }
}

function updateHeader(active) {
  const clockText = formatSlot(state.time, true);
  if ($("clock").textContent !== clockText) $("clock").textContent = clockText;
  const eventLabel = active.spotlight ? "SPOTLIGHT" : active.announce ? "ANNOUNCEMENT" : active.break ? "BREAK" : active.meal ? (active.meal.text || "MEAL").toUpperCase() : "";
  if ($("scene-event").textContent !== eventLabel) $("scene-event").textContent = eventLabel;
  const eventText = accessibleEventText(state.data, active, state.speech?.event || null);
  if ($("current-event").textContent !== eventText) $("current-event").textContent = eventText;
  $("scrubber").value = String(state.time);
  $("play").textContent = state.playing ? "Pause" : "Play";
  const visible = [...state.people.values()].filter((person) => person.visible);
  const atTables = visible.filter((person) => person.place?.kind === "table").length;
  const base = `${visible.length} in the hall, ${atTables} at tables · ${state.data.tables.length} tables`;
  if (!state.staleMessage) setStatus(state.assetsFailed ? `${base} · Sprite art unavailable; simplified graphics are in use.` : base, state.assetsFailed ? "stale" : "");
}

function setMode(nextMode) {
  if (state.mode === nextMode) return;
  state.mode = nextMode;
  const live = nextMode === "live";
  const badge = $("mode-badge");
  badge.textContent = live ? "LIVE" : "REPLAY";
  badge.className = `badge${live ? " live" : ""}`;
  $("scrubber").disabled = live;
  $("speed").disabled = live;
  $("play").disabled = live || reducedMotion.matches;
  $("now-marker").hidden = !live;
  if (live) {
    state.live = createLiveState(state.data);
    state.speechQueue = [];
    state.speech = null;
  }
  state.snap = true;
}

function updateMode() {
  const automatic = modeAt(state.data, Date.now());
  if (automatic !== state.mode) setMode(automatic);
  if (state.mode === "live") {
    state.time = clamp((Date.now() - Date.parse(state.data.event.start)) / (state.data.event.slot_minutes * 60_000), 0, state.data.event.slots);
    $("now-marker").textContent = `Now: ${formatDate(Date.now(), { hour: "numeric", minute: "2-digit" })}`;
  }
}

function queueSpeech(events) { state.speechQueue.push(...events); }

function advanceSpeech(now) {
  if (state.speech && now >= state.speech.until) state.speech = null;
  if (!state.speech) {
    let event = null;
    if (state.mode === "live" && state.live) {
      const shifted = shiftSpeechQueue(state.live);
      state.live = shifted.state;
      event = shifted.event;
    } else if (state.speechQueue.length) {
      event = state.speechQueue.shift();
    }
    if (!event) return;
    state.speech = { event, until: now + SPEECH_SECONDS[event.kind] * 1000 };
  }
}

async function fetchTimeline() {
  const url = state.sample ? "./data/timeline.sample.json" : "./data/timeline.json";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("fetch");
  let input;
  try { input = await response.json(); }
  catch { throw new Error("json"); }
  return validateTimeline(input);
}

function installTimeline(data, initial = false) {
  state.data = data;
  document.title = `${data.event.name} — Great Hall`;
  $("event-name").textContent = data.event.name;
  $("record-note").hidden = data.phase !== "final";
  $("updated").textContent = formatDate(Date.parse(data.generated_at), { dateStyle: "medium", timeStyle: "short" });
  $("scrubber").max = String(data.event.slots);
  $("start-label").textContent = formatSlot(0, true);
  $("end-label").textContent = formatSlot(data.event.slots, true);
  state.layout = buildLayout();
  state.adminEvents = indexAdminEvents(data);
  syncPeople();
  if (state.selectedId && !data.tables.some((table) => table.id === state.selectedId)) state.selectedId = null;
  renderTableList();
  renderDetail();
  if (initial) state.time = 0;
  state.snap = true;
}

async function refresh() {
  try {
    const next = await fetchTimeline();
    if (!state.live) state.live = createLiveState(state.data);
    const result = reconcileLiveSnapshot(state.live, next);
    state.live = result;
    if (result.changed) {
      installTimeline(result.snapshot);
    }
    state.staleMessage = "";
  } catch (error) {
    state.staleMessage = error?.name === "TimelineError" ? `Update rejected: ${error.message} Showing the last good snapshot.` : "Update failed. Showing the last good snapshot.";
    setStatus(state.staleMessage, "stale");
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width / (TILE * SCALE),
    y: (event.clientY - rect.top) * canvas.height / rect.height / (TILE * SCALE),
  };
}

canvas.addEventListener("pointermove", (event) => {
  if (!state.data) return;
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
  tooltip.style.left = `${event.clientX - sceneRect.left + 12}px`;
  tooltip.style.top = `${event.clientY - sceneRect.top - 30}px`;
  tooltip.hidden = false;
});

canvas.addEventListener("pointerleave", () => { state.hover = null; $("tooltip").hidden = true; });
canvas.addEventListener("click", (event) => {
  if (!state.data) return;
  const point = canvasPoint(event);
  const index = state.layout.cells.findIndex((cell) => point.x >= cell.x && point.x < cell.x + 6 && point.y >= cell.y && point.y < cell.y + 6);
  if (index >= 0 && state.data.tables[index]) selectTable(state.data.tables[index].id);
});

$("play").addEventListener("click", () => {
  if (state.mode === "live" || reducedMotion.matches) return;
  state.playing = !state.playing;
});
$("speed").addEventListener("change", (event) => { state.speed = Number(event.target.value); });
$("scrubber").addEventListener("input", (event) => {
  if (!state.data || state.mode === "live") return;
  const previous = state.time;
  const next = Number(event.target.value);
  if (next > previous) queueSpeech(crossedSpeechEvents(state.data, previous, next));
  else if (next < previous) {
    state.speechQueue = [];
    state.speech = null;
  }
  state.time = next;
  state.playing = false;
  state.snap = true;
});

reducedMotion.addEventListener?.("change", () => {
  if (reducedMotion.matches) state.playing = false;
  if (state.data) $("play").disabled = state.mode === "live" || reducedMotion.matches;
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
    loadImage("./assets/roguelikeChar_transparent.png"),
    loadImage("./assets/roguelikeSheet_transparent.png"),
  ]);
  state.images.characters = results[0].status === "fulfilled" ? results[0].value : null;
  state.images.rpg = results[1].status === "fulfilled" ? results[1].value : null;
  state.assetsFailed = results.some((result) => result.status === "rejected");
}

function loop(now) {
  if (!state.data) return;
  const realSeconds = Math.min(.1, (now - state.lastTime) / 1000 || 0);
  state.lastTime = now;
  updateMode();
  let active = activeEvents(state.data, state.time, state.adminEvents);
  if (state.mode === "replay" && state.playing && !reducedMotion.matches) {
    const before = state.time;
    const speed = playbackSpeed(state.speed, active);
    state.time = clamp(state.time + realSeconds * speed / (state.data.event.slot_minutes * 60), 0, state.data.event.slots);
    queueSpeech(crossedSpeechEvents(state.data, before, state.time));
    if (state.time >= state.data.event.slots) state.playing = false;
    if (state.time !== before) active = activeEvents(state.data, state.time, state.adminEvents);
  }
  if (state.mode === "live" && now - state.lastRefresh >= 60_000) {
    state.lastRefresh = now;
    void refresh();
  }
  advanceSpeech(now);
  updatePeople(realSeconds, now, active);
  render(now, active);
  updateHeader(active);
  requestAnimationFrame(loop);
}

async function boot() {
  try {
    const [data] = await Promise.all([fetchTimeline(), loadAssets()]);
    installTimeline(data, true);
    setMode(modeAt(data, Date.now()));
    if (reducedMotion.matches) state.playing = false;
    state.lastTime = performance.now();
    state.lastRefresh = state.lastTime;
    requestAnimationFrame(loop);
  } catch (error) {
    const message = error?.name === "TimelineError" ? `Timeline could not be loaded: ${error.message}` : "Timeline could not be loaded. Check that the published data file is available.";
    setStatus(message, "error");
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
