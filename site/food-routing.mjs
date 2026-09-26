import { FOOD_CORNER, atFood, foodGraph, foodObstacles, sameFoodPoint } from "./food-layout.mjs?v=44523bdb9315";

const contains = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** True when the open segment enters the interior of a furniture footprint. */
export function crossesFoodRect(a, b, r) {
  let lo = 0, hi = 1;
  for (const [axis, size] of [["x", "w"], ["y", "h"]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-10) {
      if (a[axis] <= r[axis] || a[axis] >= r[axis] + r[size]) return false;
    } else {
      const t1 = (r[axis] - a[axis]) / delta, t2 = (r[axis] + r[size] - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    }
  }
  return lo < hi - 1e-9;
}

function clearSegment(obstacles, a, b) {
  return obstacles.every(r => r.kind === "stool" && (contains(r, a) || contains(r, b)) || !crossesFoodRect(a, b, r));
}

function nearestVisible(nodes, point, obstacles) {
  let best = null, distance = Infinity;
  for (const node of nodes.values()) {
    const d = Math.hypot(point.x - node.x, point.y - node.y);
    if (d < distance && clearSegment(obstacles, point, node)) { best = node; distance = d; }
  }
  return best;
}

/** Shortest path on the corner graph, including safe connections at the two ends. */
export function foodGraphPath(layout, from, to, count = 0) {
  if (sameFoodPoint(from, to)) return [];
  const nodes = foodGraph(layout, count), obstacles = foodObstacles(layout);
  const start = nearestVisible(nodes, from, obstacles), goal = nearestVisible(nodes, to, obstacles);
  if (!start || !goal) throw new Error("Food route has no clear connection to an aisle");
  const dist = new Map([[start, 0]]), previous = new Map(), open = new Set([start]);
  while (open.size) {
    let here = null;
    for (const node of open) if (!here || dist.get(node) < dist.get(here)) here = node;
    open.delete(here);
    if (here === goal) break;
    for (const next of here.edges) {
      const d = dist.get(here) + Math.hypot(next.x - here.x, next.y - here.y);
      if (d < (dist.get(next) ?? Infinity)) { dist.set(next, d); previous.set(next, here); open.add(next); }
    }
  }
  const chain = [];
  for (let node = goal; node; node = previous.get(node)) { chain.unshift(node); if (node === start) break; }
  if (chain[0] !== start) throw new Error("Food aisle graph is disconnected");
  const path = chain.map(({ x, y }) => ({ x, y }));
  if (sameFoodPoint(path[0], from)) path.shift();
  if (!sameFoodPoint(path.at(-1) ?? from, to)) path.push({ x: to.x, y: to.y });
  return path;
}

export function inFoodCorner(layout, p) {
  const f = layout.food;
  return sameFoodPoint(p, atFood(layout, FOOD_CORNER.enter)) || sameFoodPoint(p, atFood(layout, FOOD_CORNER.exit))
    || p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y - .5 && p.y <= f.y + 6.35;
}

/** Join the hall routes to the corner's entrance and exit. On a retarget, finish
 * the current edge toward its existing forward waypoint before selecting a new path. */
export function cornerRoute(layout, from, to, hallPath, remaining = [], count = 0) {
  const fromIn = inFoodCorner(layout, from), toIn = inFoodCorner(layout, to);
  const forward = remaining.find(p => !sameFoodPoint(from, p));
  if (!fromIn && !toIn && !remaining.some(p => inFoodCorner(layout, p))) return null;
  if (forward) {
    const rest = cornerRoute(layout, forward, to, hallPath, [], count) ?? hallPath(forward, to);
    return [{ x: forward.x, y: forward.y }, ...rest];
  }
  const enter = atFood(layout, FOOD_CORNER.enter), exit = atFood(layout, FOOD_CORNER.exit);
  if (fromIn && toIn) return foodGraphPath(layout, from, to, count);
  if (toIn) return [...hallPath(from, enter), ...foodGraphPath(layout, enter, to, count)];
  return [...foodGraphPath(layout, from, exit, count), ...hallPath(exit, to)];
}
