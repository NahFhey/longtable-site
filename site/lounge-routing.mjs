import { loungeGeometry, clearLoungeSegment } from "./lounge-layout.mjs?v=57da6155641f";

const same = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;

export function inLounge(layout, point) {
  const r = layout.lounge;
  return point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y < r.y + r.h;
}

function nearestWaypoint(geometry, point) {
  const nodes = geometry.graph;
  const seat = geometry.seats.find(s => same(s, point));
  if (seat) return nodes[seat.node];
  let best = null, distance = Infinity;
  for (const node of nodes) {
    if (node.seat) continue;
    const d = Math.hypot(node.x - point.x, node.y - point.y);
    if (d < distance && clearLoungeSegment(geometry, point, node)) { best = node; distance = d; }
  }
  return best;
}

// A small minimum heap keeps retargeting inexpensive even during accelerated replay.
function routeQueue() {
  const entries = [];
  return {
    get length() { return entries.length; },
    push(entry) {
      let index = entries.length;
      entries.push(entry);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (entries[parent].score <= entry.score) break;
        entries[index] = entries[parent];
        index = parent;
      }
      entries[index] = entry;
    },
    pop() {
      const first = entries[0], last = entries.pop();
      if (entries.length) {
        let index = 0;
        while (index * 2 + 1 < entries.length) {
          let child = index * 2 + 1;
          if (child + 1 < entries.length && entries[child + 1].score < entries[child].score) child++;
          if (entries[child].score >= last.score) break;
          entries[index] = entries[child];
          index = child;
        }
        entries[index] = last;
      }
      return first;
    },
  };
}

/** Shortest path through the free-floor graph; seats connect only through their open side. */
export function loungeGraphPath(layout, from, to, geometry = loungeGeometry(layout)) {
  if (same(from, to)) return [];
  const nodes = geometry.graph;
  const start = nearestWaypoint(geometry, from), goal = nearestWaypoint(geometry, to);
  if (!start || !goal) throw new Error("Lounge route has no free-floor connection");
  const distance = new Map([[start.id, 0]]), previous = new Map(), open = routeQueue();
  const push = (id, d) => open.push({ id, d, score: d + Math.hypot(nodes[id].x - goal.x, nodes[id].y - goal.y) });
  push(start.id, 0);
  while (open.length) {
    const { id, d: known } = open.pop();
    if (known !== distance.get(id)) continue;
    if (id === goal.id) break;
    for (const next of nodes[id].edges) {
      // A cushion is an endpoint, never a shortcut through an occupied chair.
      if (nodes[next].seat && next !== goal.id) continue;
      const d = known + Math.hypot(nodes[id].x - nodes[next].x, nodes[id].y - nodes[next].y);
      if (d < (distance.get(next) ?? Infinity)) {
        distance.set(next, d);
        previous.set(next, id);
        push(next, d);
      }
    }
  }
  if (!distance.has(goal.id)) throw new Error("Lounge graph is disconnected");
  const chain = [];
  for (let id = goal.id; id !== undefined; id = previous.get(id)) {
    chain.unshift(nodes[id]);
    if (id === start.id) break;
  }
  const path = chain.map(({ x, y }) => ({ x, y }));
  if (same(path[0], from)) path.shift();
  if (!same(path.at(-1) ?? from, to)) path.push({ x: to.x, y: to.y });
  return path;
}

const pathLength = (from, path) => {
  let length=0;
  for (const to of path) { length+=Math.hypot(to.x-from.x,to.y-from.y);from=to; }
  return length;
};

/** The hall router does not know the overflow lane. Join it at either end, outside
 * the overflow chairs, then follow the lane to the selected gap. */
export function loungeHallPath(layout, from, to, hallPath, entering) {
  if (!layout.overflowRows || Math.abs((entering?from:to).y-(layout.lounge.y-.5))<1e-8) return hallPath(from,to);
  const laneY=layout.lounge.y-.5, aisleY=layout.aisles.at(-1);
  const candidates=[layout.trunkX,layout.stage.x-.8].map(x=>{
    const lane={x,y:laneY},join={x,y:aisleY};
    return entering ? [...hallPath(from,join),lane,to] : [lane,join,...hallPath(join,to)];
  });
  return candidates.reduce((best,p)=>pathLength(from,p)<pathLength(from,best)?p:best);
}

/** Continue to the forward waypoint on a reroute; choose the least total travel
 * through the hall and one of the lounge's entry gaps. Hall-only walks stay in the hall. */
export function loungeRoute(layout, from, to, hallPath, remaining = [], geometry = null) {
  const fromIn = inLounge(layout, from), toIn = inLounge(layout, to);
  if (!fromIn && !toIn) return null;
  geometry ??= loungeGeometry(layout);
  const forward = remaining.find(p => !same(from, p));
  if (forward) {
    const rest = loungeRoute(layout, forward, to, hallPath, [], geometry) ?? hallPath(forward, to);
    return [{ x: forward.x, y: forward.y }, ...rest];
  }
  if (fromIn && toIn) return loungeGraphPath(layout, from, to, geometry);
  let best=null, length=Infinity;
  for (const drop of geometry.drops) {
    const path=toIn
      ? [...loungeHallPath(layout,from,drop,hallPath,true),...loungeGraphPath(layout,drop,to,geometry)]
      : [...loungeGraphPath(layout,from,drop,geometry),...loungeHallPath(layout,drop,to,hallPath,false)];
    const d=pathLength(from,path);
    if (d<length) {best=path;length=d;}
  }
  return best;
}
