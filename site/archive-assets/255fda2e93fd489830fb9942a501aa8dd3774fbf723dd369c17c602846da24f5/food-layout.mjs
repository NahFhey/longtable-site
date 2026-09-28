/** Food furniture and aisle coordinates, relative to the corner's origin. */
export const FOOD_CORNER = {
  kitchenStations: [[.5, 1.35], [1.5, 1.35], [2.5, 1.35], [3.65, 1.35],
    [.8, 3.05], [1.8, 3.05], [2.8, 3.05], [4.55, 3], [3.4, 2.9]].map(([x, y]) => ({ x, y })),
  kitchenFurniture: [{ x: 0, y: 0, w: 5, h: 1 }, { x: .3, y: 1.75, w: 3, h: 1 },
    { x: .05, y: 3.85, w: 1.9, h: 2.1 }, { x: 1.9, y: 4.95, w: 2.95, h: 1 },
    { x: 4.1, y: 4.05, w: 1, h: 1 }],
  serving: { x: 6, y: 1, w: 5, h: 2 },
  rug: { x: 12, y: 0, w: 11, h: 6 },
  first: { x: 7.3, y: 3.95 }, second: { x: 11.5, y: 2.2 },
  enter: { x: 5.6, y: 6.6 }, exit: { x: 9.6, y: 6.6 },
  bin: { x: 11.4, y: 5.95 }, binStand: { x: 10.45, y: 5.65 },
  pickup: { x: 3.4, y: 2.9 }, staffStand: .55,
  // Below the hearth, then up the kitchen's east edge: a straight line from the pickup crosses the pot.
  staffVia: [{ x: 5.5, y: 2.9 }, { x: 5.5, y: .55 }],
  hearth: { x: 4.05, y: 1.1, w: 1, h: 1.45 },
  staffIn: [{ x: 5.4, y: 6.5 }, { x: 5.4, y: 3.4 }],
  staffSpots: [{ x: 5.4, y: 3.4 }, { x: 7.8, y: 4.3 }, { x: 17, y: 3.1 }],
  slots: [1.6, 2.4].flatMap(y => [7, 8.5, 10].map(x => ({ x, y }))),
  plants: [{ at: [10.95, -.05], plant: [28, 9] }, { at: [16, -.05], plant: [22, 9] }],
  dining: [13, 18].flatMap(x => [.2, 3.5].map(y => ({ x, y, w: 2, h: 2, lantern: true })))
    .concat([.2, 3.5].map(y => ({ x: 22, y, w: 1, h: 2, lantern: false }))),
  seats: [.2, 3.5].flatMap(ty => [.55, 1.45].flatMap(dy =>
    [[12.5, 1, 13.5], [15.5, -1, 14.5], [17.5, 1, 18.5], [20.5, -1, 19.5], [21.5, 1, 22.5]]
      .map(([x, facing, plateX]) => ({ x, y: ty + dy, facing,
        plate: { x: plateX, y: ty + dy + .2 }, lane: x - facing * .35 })))),
  queue: {
    first: [3.95, 4.75, 5.55].flatMap(y => [6.5, 7.2, 7.9, 8.6, 9.3, 10, 10.7].map(x => ({ x, y }))),
    second: [{ x: 11.5, y: 2.2 }, { x: 11.5, y: 3 }],
  },
};
FOOD_CORNER.queue.second.push(...[3.95, 4.75, 5.55].flatMap(y =>
  [10.7, 10, 9.3, 8.6, 7.9, 7.2, 6.5].map(x => ({ x, y }))));

// A tree through the two open floor bands; every station is a graph node.
FOOD_CORNER.kitchenGraph = [[0, 1], [1, 2], [2, 3], [3, 9], [4, 5], [5, 6], [6, 8], [8, 9], [9, 7]];
const kitchenNodes = [...FOOD_CORNER.kitchenStations, { x: 3.65, y: 3 }];
export function kitchenPath(layout, from, to) {
  const path = (here, previous) => {
    if (here === to) return [here];
    for (const edge of FOOD_CORNER.kitchenGraph) {
      if (!edge.includes(here)) continue;
      const next = edge[0] === here ? edge[1] : edge[0];
      if (next === previous) continue;
      const rest = path(next, here);
      if (rest) return [here, ...rest];
    }
    return null;
  };
  return path(from, -1).map(i => atFood(layout, kitchenNodes[i]));
}

export const atFood = (layout, point) => ({ x: layout.food.x + point.x, y: layout.food.y + point.y });
export const sameFoodPoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;

/** Standing places: two column lines, then unique places along the rug's bottom. */
export function overflowSpot(index) {
  if (index < 10) return { x: 16.5 + Math.floor(index / 5) * .45,
    y: [2.15, 1.25, 4.05, 4.95, 5.85][index % 5] };
  // Subdivide unused intervals on later passes, never wrap onto an earlier place.
  // All bottom places stay below the furniture and above the hall aisle (y 6.5).
  const n = index - 10, pass = Math.floor(Math.log2(Math.floor(n / 30) + 1));
  const start = 30 * (2 ** pass - 1), k = n - start;
  return { x: 12 + (k + .5) * 11 / (30 * 2 ** pass), y: 6.15 };
}

export function queueSpot(layout, which, index) {
  const spots = FOOD_CORNER.queue[which];
  const i = Math.max(0, index);
  return atFood(layout, i < spots.length ? spots[i] : overflowSpot(i - spots.length));
}

/** Collision footprints of the tabletops and stool seats, in hall coordinates. */
export function foodObstacles(layout) {
  return [FOOD_CORNER.serving, ...FOOD_CORNER.dining].map(rect => ({ ...rect, ...atFood(layout, rect), kind: "table" }))
    .concat(FOOD_CORNER.seats.map((seat, index) => ({ ...atFood(layout, { x: seat.x - .25, y: seat.y - .2 }),
      w: .5, h: .4, kind: "stool", index })))
    .concat(FOOD_CORNER.kitchenFurniture.map(rect => ({ ...rect, ...atFood(layout, rect), kind: "kitchen" })))
    .concat({ ...FOOD_CORNER.hearth, ...atFood(layout, FOOD_CORNER.hearth), kind: "hearth" });
}

const GRAPHS = new WeakMap();
/** Shared graph: seats are leaves, so an aisle walk never uses another stool as a shortcut. */
export function foodGraph(layout, overflowCount = 0) {
  const size = Math.max(40, overflowCount);
  const cached = GRAPHS.get(layout);
  if (cached && cached.size >= size) return cached.nodes;
  const nodes = new Map();
  const key = p => `${p.x.toFixed(10)},${p.y.toFixed(10)}`;
  const add = p => {
    const hall = atFood(layout, p), id = key(hall);
    if (!nodes.has(id)) nodes.set(id, { ...hall, key: id, edges: new Set() });
    return nodes.get(id);
  };
  const link = (a, b) => { const aa = add(a), bb = add(b); if (aa !== bb) { aa.edges.add(bb); bb.edges.add(aa); } };
  const chain = points => points.slice(1).forEach((p, i) => link(points[i], p));
  const rowXs = new Set([11.5, 16.5, 16.95, 17]);
  for (const seat of FOOD_CORNER.seats) {
    rowXs.add(seat.lane);
    chain([{ x: seat.lane, y: 3.1 }, { x: seat.lane, y: seat.y }, seat]);
  }
  chain([...rowXs].sort((a, b) => a - b).map(x => ({ x, y: 3.1 })));
  chain([FOOD_CORNER.second, { x: 11.5, y: 3 }, { x: 11.5, y: 3.1 }, { x: 11.5, y: 3.95 },
    { x: 11.5, y: 4.6 }, { x: 11.5, y: 6.15 }, { x: 9.6, y: 6.15 }, FOOD_CORNER.exit]);
  chain([FOOD_CORNER.binStand, { x: 10.45, y: 6.15 }, { x: 9.6, y: 6.15 }]);
  chain([FOOD_CORNER.enter, { x: 5.6, y: 5.55 }, { x: 5.6, y: 4.75 }, { x: 5.6, y: 3.95 }]);
  for (const y of [3.95, 4.75, 5.55]) {
    chain([{ x: 5.6, y }, ...FOOD_CORNER.queue.first.filter(p => p.y === y), { x: 11.5, y }]);
  }
  chain([{ x: 11.5, y: 3.95 }, { x: 11.5, y: 4.6 }, { x: 11.5, y: 4.75 },
    { x: 11.5, y: 5.55 }, { x: 11.5, y: 6.15 }]);
  link(FOOD_CORNER.first, { x: 7.2, y: 3.95 });
  // Staff enter through the kitchen door. Each stop joins a clear aisle.
  chain([FOOD_CORNER.enter, ...FOOD_CORNER.staffIn, FOOD_CORNER.pickup, ...FOOD_CORNER.staffVia]);
  chain([FOOD_CORNER.staffVia.at(-1), ...FOOD_CORNER.slots.slice(0, 3).map(p => ({ x: p.x, y: .55 }))]);
  link(FOOD_CORNER.staffSpots[1], { x: 7.9, y: 3.95 });
  for (let index = 0; index < size; index += 1) {
    const spot = overflowSpot(index);
    if (index < 10) link({ x: spot.x, y: 3.1 }, spot);
    else link({ x: 11.5, y: 6.15 }, spot);
  }
  GRAPHS.set(layout, { size, nodes });
  return nodes;
}

export function foodGeometry(layout, index = 0, count = 1) {
  const safe = Math.max(0, index), standing = safe >= FOOD_CORNER.seats.length;
  const seat = standing ? { ...overflowSpot(safe - 20), facing: safe % 2 ? -1 : 1 } : FOOD_CORNER.seats[safe];
  return {
    first: atFood(layout, FOOD_CORNER.first), second: atFood(layout, FOOD_CORNER.second),
    bin: atFood(layout, FOOD_CORNER.bin), binStand: atFood(layout, FOOD_CORNER.binStand),
    seat: { ...atFood(layout, seat), facing: seat.facing, standing,
      plate: seat.plate ? atFood(layout, seat.plate) : null },
    seats: FOOD_CORNER.seats.map(p => ({ ...p, ...atFood(layout, p), plate: atFood(layout, p.plate) })),
    queue: Object.fromEntries(Object.entries(FOOD_CORNER.queue).map(([name, points]) => [name, points.map(p => atFood(layout, p))])),
    overflow: Array.from({ length: Math.max(0, count - 20) }, (_, i) => atFood(layout, overflowSpot(i))),
    staffSpots: FOOD_CORNER.staffSpots.map(p => atFood(layout, p)), pickup: atFood(layout, FOOD_CORNER.pickup),
    graph: foodGraph(layout, Math.max(count - 20, safe - 19)),
  };
}

const STAFF_WALK = 3.4;
// ---------- staff set-out ----------
// A schedule of per-dish legs: walk pickup → stand, pause (dish pops at mid-pause), walk back.
function setOutSchedule(corner, ox, oy) {
  const pickup = { x: ox + corner.pickup.x, y: oy + corner.pickup.y };
  const via = (corner.staffVia ?? []).map((p) => ({ x: ox + p.x, y: oy + p.y }));
  return corner.slots.map((slot) => {
    const stand = { x: ox + slot.x, y: oy + corner.staffStand };
    const pts = [pickup, ...via, stand];
    let length = 0;
    for (let i = 1; i < pts.length; i += 1) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const walk = length / STAFF_WALK;
    return { pickup, stand, pts, back: [...pts].reverse(), length, walk, pause: .8, total: walk * 2 + .8 };
  });
}

/** Set-out at `seconds` into the run: dishes placed so far, the staff position, and the dish carried. */
function setOutAt(schedule, seconds, clearing = false) {
  let t = Math.max(0, seconds);
  for (let k = 0; k < schedule.length; k += 1) {
    const dish = clearing ? schedule.length - 1 - k : k;
    const leg = schedule[dish];
    const result = (removed, staff, carrying, moving, facing) => ({
      count: clearing ? schedule.length - k - Number(removed) : k + Number(removed),
      staff, dish: carrying ? dish : null, moving, facing });
    if (t < leg.total) {
      if (t < leg.walk) {
        const p = samplePolyline(leg.pts, t / leg.walk * leg.length);
        return result(false, { x: p.x, y: p.y }, !clearing, true, Math.sign(p.dx) || 1);
      }
      if (t < leg.walk + leg.pause) {
        const placed = t >= leg.walk + leg.pause / 2;
        return result(placed, { ...leg.stand }, clearing ? placed : !placed, false, Math.sign(leg.stand.x - leg.pickup.x) || 1);
      }
      const p = samplePolyline(leg.back, (t - leg.walk - leg.pause) / leg.walk * leg.length);
      return result(true, { x: p.x, y: p.y }, clearing, true, Math.sign(p.dx) || -1);
    }
    t -= leg.total;
  }
  return { count: clearing ? 0 : 6, staff: { ...schedule[0].pickup }, dish: null, moving: false, done: true };
}

const SET_OUT_SCHEDULE = setOutSchedule(FOOD_CORNER, 0, 0);
export const SET_OUT_SECONDS = SET_OUT_SCHEDULE.reduce((sum, leg) => sum + leg.total, 0);
function foodRun(layout, seconds, clearing) {
  const state = setOutAt(SET_OUT_SCHEDULE, seconds, clearing);
  return { ...state, staff: atFood(layout, state.staff) };
}
/** Real hall: map the ambience's 0–6 progress onto the natural schedule. */
export function foodSetOut(layout, progress) { return foodRun(layout, progress / 6 * SET_OUT_SECONDS, false); }
export function foodClearAt(layout, seconds) { return foodRun(layout, seconds, true); }

function samplePolyline(pts, distance) {
  let left = distance;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= d || i === pts.length - 1) {
      const t = d ? Math.min(1, left / d) : 1;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x };
    }
    left -= d;
  }
  return { ...pts.at(-1), dx: 0 };
}

