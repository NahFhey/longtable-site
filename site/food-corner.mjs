import { FOOD_CORNER } from "./food-layout.mjs?v=44523bdb9315";

const TILE = 16, STRIDE = 17, U = 32;
export const DISHES = [[54,15],[56,16],[55,17],[55,13],[56,17],[56,13]];
const HOT = new Set([0, 1, 4]);
const PLATE = [54,13];
let getCtx = () => null, getRpg = () => null, isReduced = () => false;
export function bindFoodDrawing(options) {
  getCtx = options.ctx; getRpg = options.rpg; isReduced = options.reduced;
  resetDishes();
}

// Draw a sheet tile with its bottom-centre at (cx, bottom) in tile units; transforms pivot there.
function tileB(coord, cx, bottom, s = 1, o = {}) {
  const ctx = getCtx(), img = getRpg();
  if (!ctx || !img || s <= 0) return;
  ctx.save();
  ctx.translate(cx * U, bottom * U);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale((o.flip ? -1 : 1) * s * (o.sx ?? 1), s * (o.sy ?? 1));
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  const w = o.clip == null ? 1 : Math.max(0, Math.min(1, o.clip));
  if (w > 0) ctx.drawImage(img, coord[0] * STRIDE, coord[1] * STRIDE, TILE * w, TILE, -U / 2, -U, U * w, U);
  ctx.restore();
}
// Top-left placement, like app.mjs drawTile, but scalable.
function tileTL(coord, x, y, s = 1, o = {}) { tileB(coord, x + s / 2, y + s, s, o); }

function nine(rect, base) {
  for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) {
    const coordinate = [base[0] + (x === 0 ? 0 : x === rect.w - 1 ? 2 : 1), base[1] + (y === 0 ? 0 : y === rect.h - 1 ? 2 : 1)];
    tileTL(coordinate, rect.x + x, rect.y + y);
  }
}

function fill(rect, coord) {
  for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) tileTL(coord, rect.x + x, rect.y + y);
}

function glow(cx, cy, r, now, seed) {
  const ctx = getCtx();
  if (!ctx) return;
  const live = !isReduced();
  const flicker = live ? .08 * Math.sin(now / 83 + seed) * Math.sin(now / 137 + seed * 2.3) + .04 * Math.sin(now / 41 + seed * 5) : 0;
  const alpha = .22 + flicker;
  const g = ctx.createRadialGradient?.(cx * U, cy * U, 0, cx * U, cy * U, r * U * (1 + flicker));
  if (!g?.addColorStop) return;
  g.addColorStop(0, `rgba(255, 200, 110, ${alpha})`);
  g.addColorStop(1, "rgba(255, 170, 80, 0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx * U, cy * U, r * U * 1.1, 0, Math.PI * 2); ctx.fill();
}

// The sheet has no cooking pot, so draw one in its pixel style: stew under a rim, sitting in the flames.
const CAULDRON = [
  "..rrrrrrrrrr..",
  ".rsskssssskssr",
  ".rrrrrrrrrrrr.",
  "rdhddddddddddr",
  ".dhdddddddddd.",
  ".dhdddddddddd.",
  "..dddddddddd..",
  "...dddddddd...",
];
const CAULDRON_INK = { r: "#4a4a52", d: "#26262b", h: "#5c5c66", s: "#b8672e", k: "#d98a45" };
function cauldron(cx, bottom) {
  const ctx = getCtx();
  if (!ctx) return;
  const px = U / TILE, left = cx * U - CAULDRON[0].length * px / 2, top = bottom * U - CAULDRON.length * px;
  CAULDRON.forEach((row, y) => [...row].forEach((ink, x) => {
    if (!CAULDRON_INK[ink]) return;
    ctx.fillStyle = CAULDRON_INK[ink];
    ctx.fillRect(left + x * px, top + y * px, px, px);
  }));
}

// Steam: three puffs per source, stateless (time-derived), rising and fading.
function steam(cx, top, now, seed, strength = 1) {
  const ctx = getCtx();
  if (!ctx) return;
  if (isReduced()) now = 0;
  ctx.save();
  for (let k = 0; k < 3; k += 1) {
    const t = ((now / 1000) * .7 + k / 3 + seed * .37) % 1;
    const x = cx + Math.sin(t * 6 + seed + k) * .1 * strength;
    const y = top - t * .8 * strength;
    ctx.fillStyle = `rgba(245, 245, 240, ${(1 - t) * .45})`;
    ctx.beginPath(); ctx.arc(x * U, y * U, (.05 + .09 * t) * U * strength, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Back-eased pop, 0 → ~1.1 → 1 over 0.35 s.
function popScale(ageSeconds) {
  if (ageSeconds == null || ageSeconds < 0) return 0;
  if (isReduced()) return 1;
  const t = Math.min(1, ageSeconds / .35);
  return 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
}

// ---------- dish visibility tracking (pop when a slot fills) ----------
const shownAt = new Array(6).fill(null);
const hiddenAt = new Array(6).fill(null);
let previousCount = null;
export function resetDishes() { shownAt.fill(null); hiddenAt.fill(null); previousCount = null; }

export function drawFoodArea(layout, now, trashAge = null) {
  const { x: ox, y: oy } = layout.food;
  const T = (coord, rx, ry, s = 1, o) => tileTL(coord, ox + rx, oy + ry, s, o);
  const B = (coord, rx, rb, s = 1, o) => tileB(coord, ox + rx, oy + rb, s, o);
  const lights = [], steams = [];
  nine({ ...layout.food }, [6,28]);
  nine({ ...FOOD_CORNER.rug, x: ox + FOOD_CORNER.rug.x, y: oy + FOOD_CORNER.rug.y }, [10,19]);
  fill({ x: ox, y: oy, w: 5, h: layout.food.h }, [6,2]);                        // kitchen flagstones
  // Wall shelves and kettles above the kitchen.
  T([12,4], .2, -1.15); T([13,4], 1.2, -1.15); T([31,3], 3.2, -1.15);
  // Back row: two ovens, stove, sink counter.
  T([13,0], 0, 0); T([14,0], 1, 0); T([51,16], 2, 0); T([28,0], 3, 0); T([29,0], 4, 0);
  steams.push([ox + 2.5, oy + .15, 1.2], [ox + .5, oy + .2, .8]);
  lights.push([ox + .5, oy + .6], [ox + 1.5, oy + .6]);
  // Prep counter with ingredients, a pot on the fire.
  T([23,3], .3, 1.75); T([24,3], 1.3, 1.75); T([25,3], 2.3, 1.75);
  B([56,12], .8, 2.45); B([54,16], 1.8, 2.45); B([55,16], 2.8, 2.45);
  T([14,8], 4.05, 1.55); cauldron(ox + 4.55, oy + 2.2);
  steams.push([ox + 4.55, oy + 1.7, 1]);
  // Stores.
  T([23,0], .05, 3.85); T([24,0], .05, 4.85); T([22,0], .95, 4.9);
  T([14,6], .95, 3.95); T([13,7], 1.9, 4.95); T([14,7], 2.85, 4.95);
  T([25,2], 3.8, 4.9); T([26,2], 4.1, 4.05);
  for (const { at: [px, py], plant } of FOOD_CORNER.plants) {
    B([25,0], px + .5, py + 1, .62);
    B(plant, px + .5, py + .72, .8);
  }
  for (const seat of FOOD_CORNER.seats) T([18,6], seat.x - .5, seat.y - .3);
  const kick = trashAge != null && !isReduced() && trashAge > .65 && trashAge < 1.05
    ? Math.sin(Math.PI * (trashAge - .65) / .4) : 0;
  B([27,0], FOOD_CORNER.bin.x, FOOD_CORNER.bin.y - .1 * kick, 1.2, { sy: 1 - .16 * kick, sx: 1 + .096 * kick });
  for (const [x, y, k] of steams) steam(x, y, now, x * 3.1 + y, k);
  lights.forEach(([x, y], i) => glow(x, y, 1.1, now, i * 1.7 + x));
}

function drawDishes(layout, now, count, steams, playing) {
  const { x: ox, y: oy } = layout.food;
  const s = 1.45;
  FOOD_CORNER.slots.forEach((slot, i) => {
    const visible = i < count;
    if (visible && (previousCount === null || i >= previousCount)) {
      shownAt[i] = previousCount !== null && playing ? now : -Infinity;
      hiddenAt[i] = null;
    }
    if (!visible && previousCount !== null && i < previousCount) hiddenAt[i] = playing ? now : null;
    const scale = visible ? popScale((now - shownAt[i]) / 1000)
      : hiddenAt[i] !== null && !isReduced() ? Math.max(0, 1 - (now - hiddenAt[i]) / 200) : 0;
    tileB(DISHES[i], ox + slot.x, oy + slot.y + s / 2, s * scale);
    if (visible && HOT.has(i)) steams.push([ox + slot.x, oy + slot.y - s * .15, 1]);
  });
  previousCount = count;
}

// Deep wood tabletops.
// Palette of the sheet's furniture wood (sampled from [23,4] and [34–36,12]).
const WOOD = { outline: "#8f673f", face: "#b98b5e", inset: "#9c7650", top: "#c8a480" };

/** A W×H tabletop built from sheet slices: rim from panel tiles [34,12] (left) / [35,12] (middle) / [36,12]
 * (right), split into an 8-px top rim, one interior row stretched, and an 8-px bottom rim with the light
 * lip; drawn plank grain over the inset; apron and legs sliced from table tile [23,4] rows 11–15. */
export function woodTable(x, y, w, h) {
  const ctx = getCtx(), img = getRpg();
  if (!ctx || !img) return;
  const S = (c, r, sx, sy, sw, sh, dx, dy, dw, dh) =>
    ctx.drawImage(img, c * STRIDE + sx, r * STRIDE + sy, sw, sh, dx * U, dy * U, dw * U, dh * U);
  const px = 1 / 16;
  for (const [c, sx, sw, dx, dw] of [[34, 0, 8, x, .5], [35, 0, 16, x + .5, w - 1], [36, 8, 8, x + w - .5, .5]]) {
    S(c, 12, sx, 0, sw, 8, dx, y, dw, .5);
    S(c, 12, sx, 8, sw, 1, dx, y + .5, dw, h - 1);
    S(c, 12, sx, 8, sw, 8, dx, y + h - .5, dw, .5);
  }
  // Plank grain inside the inset (x+3px … x+w−3px, y+3px … y+h−3px): seams every 6 px in the outline
  // colour at 45%, staggered butt joints, and short highlight streaks in the face colour.
  const ix = x + 3 * px, iy = y + 3 * px, iw = w - 6 * px, ih = h - 6 * px;
  ctx.save();
  ctx.globalAlpha = .45; ctx.fillStyle = WOOD.outline;
  for (let row = 1; row * 6 * px < ih; row += 1) ctx.fillRect(ix * U, (iy + row * 6 * px) * U, iw * U, px * U);
  for (let row = 0; row * 6 * px < ih; row += 1) {
    for (let joint = (row % 2 ? 1.3 : .6); joint < iw - .2; joint += 1.9) {
      ctx.fillRect((ix + joint) * U, (iy + row * 6 * px) * U, px * U, Math.min(6 * px, ih - row * 6 * px) * U);
    }
  }
  ctx.globalAlpha = .6; ctx.fillStyle = WOOD.face;
  for (let row = 0; row * 6 * px < ih; row += 1) {
    for (let k = 0; k < iw * 1.2; k += 1) {
      const hash = Math.sin((row + 1) * 91.3 + k * 17.7) * 43758.5453 % 1;
      const sx = Math.abs(hash) * (iw - .5), len = (3 + Math.abs(hash * 7) % 5) * px;
      ctx.fillRect((ix + sx) * U, (iy + row * 6 * px + (2 + (k % 3)) * px) * U, len * U, px * U);
    }
  }
  ctx.restore();
  // Apron and legs: [23,4] rows 11–15 (face, shadow line, legs), ends 3 px, middle stretched; legs lengthened 3 px.
  const ay = y + h;
  S(23, 4, 0, 11, 3, 5, x, ay, 3 * px, 5 * px);
  S(23, 4, 3, 11, 10, 5, x + 3 * px, ay, w - 6 * px, 5 * px);
  S(23, 4, 13, 11, 3, 5, x + w - 3 * px, ay, 3 * px, 5 * px);
  const legs = w >= 3 ? [x, x + w - 3 * px, x + w / 2 - 1.5 * px] : [x, x + w - 3 * px];   // centre leg on long tables only
  for (const lx of legs) S(23, 4, 0, 15, 3, 1, lx, ay + 5 * px, 3 * px, 3 * px);
}

/** Tables and their props sort with people by the front of each tabletop. */
export function foodDepthItems(layout, now, count, playing = true) {
  const { x: ox, y: oy } = layout.food;
  const t = FOOD_CORNER.serving;
  return [{ y: oy + t.y + t.h, draw: () => {
    woodTable(ox + t.x, oy + t.y, t.w, t.h);
    const steams = [];
    drawDishes(layout, now, count, steams, playing);
    for (const [x, y, k] of steams) steam(x, y, now, x * 3.1 + y, k);
  } }, ...FOOD_CORNER.dining.map(t => ({ y: oy + t.y + t.h, draw: () => {
    woodTable(ox + t.x, oy + t.y, t.w, t.h);
    if (t.lantern) {
      tileTL([52,17], ox + t.x + t.w / 2 - .35, oy + t.y + t.h / 2 - .75, .7);
      glow(ox + t.x + t.w / 2, oy + t.y + t.h / 2 - .35, 1.1, now, t.x + t.y);
    }
  } }))];
}

function lerp(a, b, t) { const k = Math.max(0, Math.min(1, t)); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }

// ---------- plates ----------
/** A plate in front of a person at position (px, py); `plate` from the attendee food phase. */
export function drawPlate(plate, px, py, facing, now) {
  if (!plate || plate.drop >= 1) return;
  let cx = px + facing * .3, cy = py + .12, s = .72;
  if (plate.mode === "table" && plate.at) { cx = plate.at.x; cy = plate.at.y; s = .8; }
  else if (plate.mode === "table") { cx = px + facing * .55; cy = py + .2; s = .8; }
  if (plate.lift) { cx = px + facing * .28; cy = py - .12; }
  if (plate.toward) { const p = lerp({ x: cx, y: cy }, plate.toward, plate.drop); cx = p.x; cy = p.y; s *= 1 - plate.drop * .5; }
  tileB(PLATE, cx, cy + s * .5, s);
  const items = plate.items ?? [];
  items.forEach((item, i) => {
    const pop = item.pop == null ? 1 : popScale(item.pop);
    if (pop <= 0) return;
    const offset = items.length > 1 ? (i ? .1 : -.1) : 0;
    // The first dish is eaten first: it clips away, then the second.
    const remaining = plate.remaining ?? 1;
    const share = items.length > 1 ? (i === 0 ? Math.max(0, remaining * 2 - 1) : Math.min(1, remaining * 2)) : remaining;
    if (share <= 0) return;
    tileB(item.coord, cx + offset, cy + s * .42, s * .72 * pop, { clip: share });
  });
}

/** Map a real diner's foodPhase onto a plate (per-person dish choice by ordinal). */
export function realPlate(place, ordinal, moving) {
  if (!place.plate) return null;
  const a = { coord: DISHES[(ordinal * 2) % 6] }, b = { coord: DISHES[(ordinal * 2 + 3) % 6] };
  const phase = place.foodPhase;
  const standing = !!place.position?.standing;
  if (phase === "serving-first") return { mode: "held", items: moving ? [] : [a], remaining: 1 };
  if (phase === "serving-second") return { mode: "held", items: moving ? [a] : [a, b], remaining: 1 };
  if (phase === "seating") return { mode: moving || standing ? "held" : "table", items: [a, b], remaining: 1, at: moving ? null : place.position?.plate };
  if (phase === "eating") return { mode: moving || standing ? "held" : "table", items: [a, b], remaining: place.foodRemaining, at: moving ? null : place.position?.plate };
  return { mode: "held", items: [], remaining: 0 };
}

/** A dish carried by staff, held up in front. */
export function drawCarried(coord, px, py, facing) {
  if (!coord) return;
  tileB(coord, px + facing * .25, py - .05, .9);
}

/** Real-time walk cycle and idle motion; event time is only used for path travel. */
export function bodyMotion(phase, moving, now, seated = false, reduced = isReduced()) {
  const m = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, look: false };
  if (reduced) return m;
  const p = phase * 7;
  if (moving) {
    const w = Math.sin(now / 210 * Math.PI + p);
    m.rot = w * .1; m.dy = -Math.abs(w) * .06;
  } else {
    m.sy = 1 - .03 * Math.max(0, Math.sin(now / 1300 + p * 1.3));
    m.sx = 1 + (1 - m.sy) * .5;
    const period = 5 + phase * 4;
    m.look = ((now / 1000 + phase * 23) % period) < 1.1;
  }
  return m;
}

/** Apply a body transform around the feet of a sprite drawn at top-left (x, y). Caller saves/restores. */
export function applyMotion(ctx, m, x, y) {
  if (!m.dx && !m.dy && !m.rot && m.sx === 1 && m.sy === 1) return;
  const px = (x + .5) * U, py = (y + 1) * U;
  ctx.translate(px + m.dx * U, py + m.dy * U);
  if (m.rot) ctx.rotate(m.rot);
  ctx.scale(m.sx, m.sy);
  ctx.translate(-px, -py);
}
