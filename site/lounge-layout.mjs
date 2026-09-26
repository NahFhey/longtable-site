// Pure lounge geometry, seating and navigation in tile units.
export const K = {
  stone: [6, 2], stoneDark: [6, 3], mantel: [30, 2], candle: [20, 7], wainscot: [14, 16],
  shelves: [[46, 12], [47, 14], [48, 12], [45, 14], [49, 12], [50, 14], [45, 12], [48, 14]],
  hearthTop: [54, 9], hearthFire: [[54, 10], [55, 10]],     // tall stone fireplace, two fire frames
  logs: [13, 8],
  book: [49, 15], bookRed: [45, 15], bookGreen: [47, 15],
  teapot: [55, 15], cup: [56, 15],
  rugOrange: [10, 19], rugGreen: [10, 16],
};

/** Furniture seam: every seat, table and lamp is drawn through this table, so swapping art is one edit here.
 * `sheet` names a loaded image in SHEETS; `parts` are [col, row, dx, dy] tiles placed from the piece's top-left;
 * `front` parts ([col, row, dx, dy, fromRow]) are redrawn over a sitter's legs; `seats` are [x, y, facing]
 * sitter anchors from the top-left; `foot` is the floor footprint [dx, dy, w, h]. Tiles are Kenney Roguelike
 * Indoors (roguelikeIndoor_transparent.png, 16 px at stride 17, CC0). R and L armchairs
 * face inward; sofaUp uses the approved row-built fire-facing sofa. */
export const LOUNGE_FURNITURE = {
  // Top-down upholstered armchairs (grey frame, cream back cushion on the side they face away from).
  armR:       { sheet: "indoor", parts: [[15, 9, 0, 0]], front: [[15, 9, 0, 0, 12]], seats: [[.5, .45, 1]], foot: [.05, .15, .9, .8] },
  armL:       { sheet: "indoor", parts: [[14, 9, 0, 0]], front: [[14, 9, 0, 0, 12]], seats: [[.5, .45, -1]], foot: [.05, .15, .9, .8] },
  armDown:    { sheet: "indoor", parts: [[14, 10, 0, 0]], front: [[14, 10, 0, 0, 11]], seats: [[.5, .45, 1]], foot: [.1, .1, .8, .85] },
  armGreenR:  { sheet: "indoor", parts: [[15, 11, 0, 0]], front: [[15, 11, 0, 0, 12]], seats: [[.5, .45, 1]], foot: [.05, .15, .9, .8] },
  armGreenL:  { sheet: "indoor", parts: [[14, 11, 0, 0]], front: [[14, 11, 0, 0, 12]], seats: [[.5, .45, -1]], foot: [.05, .15, .9, .8] },
  armGreenDown:{ sheet: "indoor", parts: [[14, 12, 0, 0]], front: [[14, 12, 0, 0, 11]], seats: [[.5, .45, 1]], foot: [.1, .1, .8, .85] },
  // Short sofa facing up (toward the fire), 2 × 0.875 tiles, built row by row from the top row of the pack's
  // U sectional, [23,11] (left) and [24,11] (right), at natural width: source rows 1–3 (frame), 11–8 (seat),
  // 7–4 (back), 3–1 (frame). The notch rows 12–15 are left out. `front` redraws from destination row 7 (the
  // back and the lower frame) over the sitters, so they read as seen over the sofa back.
  sofaUp:     { sheet: "indoor", rows: { left: [23, 11], right: [24, 11], order: [1, 2, 3, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }, frontRow: 7,
                seats: [[.5, .35, 1], [1.5, .35, -1]], foot: [0, .05, 2, .85] },
  chairR:     { sheet: "indoor", parts: [[2, 2, 0, 0]], front: null, seats: [[.5, .5, 1]], foot: [.15, .3, .7, .7] },
  chairL:     { sheet: "indoor", parts: [[3, 2, 0, 0]], front: null, seats: [[.5, .5, -1]], foot: [.15, .3, .7, .7] },
  chairFront: { sheet: "indoor", parts: [[0, 2, 0, 0]], front: null, seats: [[.5, .5, -1]], foot: [.15, .3, .7, .7] },
  chairBack:  { sheet: "indoor", parts: [[1, 2, 0, 0]], front: null, seats: [[.5, .5, 1]], foot: [.15, .3, .7, .7] },
  coffeeTable:{ sheet: "indoor", parts: [[0, 1, 0, 0], [1, 1, 1, 0], [2, 1, 2, 0]], front: null, seats: [], foot: [0, .1, 3, .9] },
  sideTable:  { sheet: "indoor", parts: [[7, 4, 0, 0]], front: null, seats: [], foot: [.05, .2, .9, .7] },
  cardTable:  { sheet: "indoor", parts: [[19, 11, 0, 0], [20, 11, 1, 0]], front: null, seats: [], foot: [0, .05, 2, .95] },
  lamp:       { sheet: "indoor", parts: [[20, 4, 0, 0], [20, 5, 0, 1]], front: null, seats: [], foot: [.25, 1.3, .5, .6] },
};
function furnitureFoot(g, kind, x, y) {
  const [dx, dy, w, h] = LOUNGE_FURNITURE[kind].foot;
  footAdd(g, x + dx, y + dy, w, h);
}
/** Place a piece: its draw op (sorted by `depth`), footprint, and a seat per anchor in pool `p`. */
function furniture(g, kind, x, y, p = null, depth = null) {
  const f = LOUNGE_FURNITURE[kind];
  g.ops.push({ op: "furn", kind, x, y, depth: depth ?? (y + f.foot[1] + f.foot[3]) });
  furnitureFoot(g, kind, x, y);
  if (p) for (const [sx, sy, facing] of f.seats) seat(g, p, { x: x + sx, y: y + sy, facing, depth: y + f.foot[1] + f.foot[3] + .01, front: f.front || f.rows ? { kind, x, y } : null });
}

// ---------- geometry builders (lounge-local tile units; x 0..w, y 0..7) ----------
function G() { return { ops: [], seats: [], foot: [], cards: [], pools: [], read: [], hearth: null, watch: [], ring: [] }; }
const footAdd = (g, x, y, w, h) => g.foot.push({ x, y, w, h, owner: g.ops.length - 1 });
function rug(g, x, y, w, h, base) { g.ops.push({ op: "nine", base, x, y, w, h, flat: true }); }
function shelf(g, x, y, coord) { g.ops.push({ op: "tile", coord, x, y, s: 1, depth: y + 1 }); footAdd(g, x + .05, y + .2, .9, .8); }
/** Standing candelabra (2 tall) with a glow at its candles. */
function lamp(g, x, y) {
  furniture(g, "lamp", x, y - .6);
  g.ops.push({ op: "glow", x: x + .5, y: y - .45, r: 1.3, depth: y + 1.3 });
}
function hearth(g, x, y, s = 1.4) {
  g.ops.push({ op: "hearth", x, y, s, depth: y + 2 * s }); footAdd(g, x, y + .5, s, 2 * s - .5);
  g.hearth = { x: x + s / 2, y: y + 2 * s + .4 };
}
/** A chimney breast built into a wall section, rising from above the strip's top edge to the hearth's base. */
function chimney(g, x, y, w, bottom) {
  g.ops.push({ op: "chimney", x, y, w, h: bottom - y, depth: bottom - .02 }); footAdd(g, x, y, w, bottom - y);
}
function mantel(g, x, y, w) { g.ops.push({ op: "mantel", x, y, w, depth: 3.935 }); }
function wainscot(g, x, y, w, h) { g.ops.push({ op: "wainscot", x, y, w, h, depth: y + h }); footAdd(g, x, y, w, h); }
function logs(g, x, y) { g.ops.push({ op: "tile", coord: K.logs, x, y, s: .8, depth: y + .8 }); footAdd(g, x + .1, y + .4, .6, .4); }
function seat(g, pool, seatObject) { const index = g.seats.length; g.seats.push({ ...seatObject, pool, owner: g.ops.length - 1 }); pool.seats.push(index); return index; }
function pool(g, kind, name) { const p = { kind, name, seats: [], center: null }; (kind === "read" ? g.read : g.pools).push(p); return p; }
/** Armchair facing `facing` (orange, or green for "armchairCream"/nook). */
function armchair(g, p, x, y, colour, facing) {
  furniture(g, (colour === "armchairCream" ? "armGreen" : "arm") + (facing === 0 ? "Down" : facing > 0 ? "R" : "L"), x, y, p);
}
function coffee(g, x, y, w, items = [K.teapot, K.cup, K.cup]) {
  furniture(g, "coffeeTable", x + (w - 3) / 2, y);
  g.ops.push({ op: "items", x: x + (w - 3) / 2 + .3, y, w: 2.4, items, depth: y + 1.01 });
}
function smallTable(g, x, y, item = K.teapot) {
  furniture(g, "sideTable", x, y);
  g.ops.push({ op: "items", x, y: y - .12, w: 1, items: [item], depth: y + 1.01 });
}
function cardTable(g, cx, cy) {
  const index = g.cards.length;
  const p = pool(g, "cards", `cards${index}`);
  p.center = { x: cx, y: cy };
  g.cards.push({ cx, cy, pool: p });
  g.ops.push({ op: "cards", cx, cy, index, depth: cy + .5 }); footAdd(g, cx - 1, cy - .45, 2, .95);
  // Fill order left, right, top, bottom: a pair faces each other across the cloth.
  const spots = [
    { key: "left", x: cx - 1.4, y: cy + .05, kind: "chairR", tuck: [.3, 0] },
    { key: "right", x: cx + 1.4, y: cy + .05, kind: "chairL", tuck: [-.3, 0] },
    { key: "top", x: cx, y: cy - .85, kind: "chairBack", tuck: [0, .25] },
    { key: "bottom", x: cx, y: cy + .95, kind: "chairFront", tuck: [0, -.3] },
  ];
  for (const spot of spots) {
    const f = LOUNGE_FURNITURE[spot.kind];
    g.ops.push({ op: "furn", kind: spot.kind, x: spot.x - .5, y: spot.y - .5, depth: spot.y + .5, table: index, tuck: spot.tuck });
    furnitureFoot(g, spot.kind, spot.x - .5, spot.y - .5);
    seat(g, p, { x: spot.x, y: spot.y, facing: f.seats[0][2], depth: spot.y + .51, front: null, hand: spot.key, table: index });
  }

}


const geometries = new WeakMap();
export function loungeGeometry(layout) {
  if (geometries.has(layout)) return geometries.get(layout);
  const { x: ox, y: oy, w, h } = layout.lounge;
  if (w < 19) throw new RangeError("The nook and centred hearth require 19 tiles");
  const g = G();
  g.clusters = [];
  const shift = w / 2 - 16, endShift = (w - 33) / 2;
  wainscot(g, 0, -.15, 4.4, .75);
  [[.1, 0], [1.1, 1], [2.1, 2], [3.1, 3]].forEach(([x, k]) => shelf(g, x, .2, K.shelves[k]));
  rug(g, .1, 1.4, 4, 3, K.rugGreen);
  // Nook: two green armchairs facing each other across a standing candelabra, a third facing out by a side table.
  const nook = pool(g, "read", "nook");
  armchair(g, nook, .35, 1.7, "armchairCream", 1); lamp(g, 1.35, 1.6); armchair(g, nook, 2.3, 1.7, "armchairCream", -1);
  armchair(g, nook, .35, 3.3, "armchairCream", 0); smallTable(g, 1.35, 3.45, K.bookRed);
  // Inner clusters survive longest. Remove the outermost item on either side first.
  const clusters = [
    { id: "left-cards", side: "left", edge: 9.2, draw: () => { cardTable(g, 7.3 + endShift, 1.75); cardTable(g, 7.3 + endShift, 5.15); } },
    { id: "left-pair", side: "left", edge: 3.4, draw: () => pair(.4 + endShift, 5.2, "left") },
    { id: "right-cards", side: "right", edge: 24.8, draw: () => { cardTable(g, 23.4 + endShift, 1.75); cardTable(g, 22.6 + endShift, 5.15); } },
    { id: "right-pairs", side: "right", edge: 29.2, draw: () => { pair(26.2 + endShift, .9, "upper"); pair(25.2 + endShift, 4.6, "lower"); } },
    { id: "outer-cards", side: "right", edge: 32.8, draw: () => { cardTable(g, 30.9 + endShift, 1.75); cardTable(g, 30.7 + endShift, 5.15); } },
  ];
  function pair(x, y, name) {
    const p = pool(g, "chat", name);
    armchair(g, p, x, y, "armchair", 1); smallTable(g, x + 1, y + .1); armchair(g, p, x + 2, y, "armchair", -1);
  }
  // At full width keep the approved left pair under the nook. As the hearth moves left,
  // omit it first; the remaining left card cluster must clear the nook's right edge.
  for (const c of clusters) {
    const fits = c.id === "left-pair" ? w >= 33
      : c.side === "left" ? 5.4 + endShift >= 4.6 : c.edge + endShift <= w;
    if (fits) { c.draw(); g.clusters.push(c.id); }
  }
  // The hearth room: a chimney breast built up from the top edge, the fire at its base, a mantel above.
  rug(g, 11.6 + shift, 2.6, 9, 4, K.rugOrange);
  chimney(g, 14.85 + shift, -.15, 2.3, 3.95);
  hearth(g, 15.25 + shift, .95, 1.5); mantel(g, 14.7 + shift, .58, 2.6); logs(g, 14.05 + shift, 3.15);
  const pit = pool(g, "chat", "pit");
  armchair(g, pit, 13.6 + shift, 1.5, "armchair", 0); armchair(g, pit, 17.4 + shift, 1.5, "armchair", 0);        // flanking the fire
  armchair(g, pit, 12.1 + shift, 3.4, "armchair", 1); armchair(g, pit, 12.1 + shift, 4.7, "armchair", 1);        // rug sides, facing in
  armchair(g, pit, 19.0 + shift, 3.4, "armchair", -1); armchair(g, pit, 19.0 + shift, 4.7, "armchair", -1);
  coffee(g, 14.5 + shift, 4.25, 3, [K.teapot, K.cup, K.bookGreen, K.cup]);
  furniture(g, "sofaUp", 13.8 + shift, 5.55, pit); furniture(g, "sofaUp", 16.2 + shift, 5.55, pit);            // facing the fire
  pit.center = { ...g.hearth };
  // Overflow, taken in list order: behind the sofas' backs, the rug's front edge, then its flanks.
  g.ring = [{ x: 11.5, y: 3.9 }, { x: 20.5, y: 3.9 }, { x: 11.5, y: 5.2 }, { x: 20.5, y: 5.2 },
    { x: 13.2, y: 6.45 }, { x: 18.8, y: 6.45 }, { x: 12.6, y: 6.1 }, { x: 19.4, y: 6.1 },
    { x: 12.6, y: 2.7 }, { x: 19.4, y: 2.7 }, { x: 11.2, y: 2.3 }, { x: 20.8, y: 2.3 }].map(p => ({ ...p, x: p.x + shift, ordered: true }));
  g.watch = g.cards.flatMap(({ cx, cy }, table) => [-1, 1].map(side => ({ x: cx + side * 2.15, y: cy < 3.5 ? cy - .55 : cy + .6, table })));

  for (const p of [...g.pools, ...g.read]) {
    if (!p.center) p.center = { x: p.seats.reduce((sum, i) => sum + g.seats[i].x, 0) / p.seats.length,
      y: p.seats.reduce((sum, i) => sum + g.seats[i].y, 0) / p.seats.length };
  }
  // Navigation uses the entire drawn rectangle, including the raised chimney and tall lamps.
  g.bounds = g.ops.flatMap((o, owner) => {
    const rect = (x,y,w,h) => [{x:x+ox,y:y+oy,w,h,owner}];
    if (o.flat) return [];
    if (o.op === "furn") {
      const f = LOUNGE_FURNITURE[o.kind];
      if (f.rows) return rect(o.x,o.y,2,f.rows.order.length/16);
      const xs=f.parts.map(p=>p[2]),ys=f.parts.map(p=>p[3]);
      return rect(o.x+Math.min(...xs),o.y+Math.min(...ys),Math.max(...xs)-Math.min(...xs)+1,Math.max(...ys)-Math.min(...ys)+1);
    }
    if (o.op === "cards") return rect(o.cx-1,o.cy-.5,2,1);
    if (o.op === "tile") return rect(o.x,o.y,o.s??1,o.s??1);
    if (o.op === "hearth") return rect(o.x,o.y,o.s,2*o.s);
    if (o.op === "mantel") return rect(o.x,o.y,o.w,1);
    if (["chimney","wainscot"].includes(o.op)) return rect(o.x,o.y,o.w,o.h);
    return [];
  });
  g.foot = g.bounds.map(r => g.ops[r.owner].op === "chimney"
    ? {...r,x:r.x-.3,y:r.y-.3,w:r.w+.6,h:r.h+.6} : {...r});
  for (const s of g.seats) {
    const op=g.ops[s.owner], r=g.bounds.find(r=>r.owner===s.owner);
    const p={x:s.x+ox,y:s.y+oy};
    const direction=s.hand ? {left:[-1,0],right:[1,0],top:[0,-1],bottom:[0,1]}[s.hand]
      : op.kind === "sofaUp" ? [0,-1] : op.kind.endsWith("Down") ? [0,1] : [s.facing,0];
    const [dx,dy]=direction;
    // Diagonal approaches on the open half of an armchair also permit entry beside a prop.
    const candidates=[0,.3,-.3,.6,-.6,.9,-.9,1.2,-1.2].map(offset=>({
      x:dx ? (dx>0?r.x+r.w+.01:r.x-.01) : p.x+offset,
      y:dy ? (dy>0?r.y+r.h+.01:r.y-.01) : p.y+offset,
    }));
    const approach=candidates.find(a=>!g.foot.some(b=>contains(b,a)) &&
      g.foot.every(b=>b.owner===s.owner || !crossesLoungeRect(p,a,b)));
    if (!approach) throw new Error(`No open approach for ${s.pool.name}/${s.hand??op.kind}`);
    s.approach={x:approach.x-ox,y:approach.y-oy};
  }
  const absolute = p => ({...p,x:p.x+ox,y:p.y+oy});
  g.furniture = g.ops.flatMap((o,index) => o.flat ? [] : [{ ...o, kind:o.kind ?? o.op,
    position:{x:ox+(o.x ?? o.cx),y:oy+(o.y ?? o.cy)}, depthEdge:oy+o.depth,
    footprint:g.foot.filter(r=>r.owner===index), bounds:g.bounds.filter(r=>r.owner===index) }]);
  g.seats = g.seats.map(s=>({...absolute(s), pool:s.pool.kind, area:s.pool.name, depth:s.depth+oy,
    approach:absolute(s.approach),front:s.front?absolute(s.front):null}));
  for(const p of [...g.pools,...g.read]) p.center=absolute(p.center);
  g.hearth=absolute(g.hearth);
  const clear=p=>p.x>ox+.3&&p.x<ox+w-.3&&p.y>oy+.55&&p.y<oy+h-.35
    && !g.foot.some(r=>p.x+.28>r.x&&p.x-.28<r.x+r.w&&p.y+.28>r.y&&p.y-.28<r.y+r.h);
  g.watch=g.watch.map(absolute).filter(clear); g.ring=g.ring.map(absolute).filter(clear);
  g.free=[];
  for(let y=oy+.75;y<oy+h-.35;y+=.7) for(let x=ox+.6;x<ox+w-.3;x+=.7) {
    const p={x,y}; if(clear(p)&&![...g.watch,...g.ring].some(s=>Math.hypot(s.x-x,s.y-y)<.6))g.free.push(p);
  }
  g.entry={x:layout.trunkX ?? ox+.25,y:oy-.5};
  g.staffStops=[...g.free].sort((a,b)=>a.x-b.x).filter((_,i,arr)=>i===0||i===arr.length-1);
  // Each unobstructed interval along the top has its own drop from the entry lane.
  const blocked=g.foot.filter(r=>r.y<oy+.65 && r.y+r.h>oy-.5).sort((a,b)=>a.x-b.x);
  g.drops=[];
  let edge=ox+.1;
  for (const r of [...blocked,{x:ox+w-.1,w:0}]) {
    if (r.x-edge>.2) g.drops.push({x:(edge+r.x)/2,y:oy-.5});
    edge=Math.max(edge,r.x+r.w);
  }
  g.graph=buildGraph(layout,g);
  // All seat node IDs are assigned before publication. Routing never mutates this geometry.
  const freeze=value=>{if(value && typeof value==='object' && !Object.isFrozen(value)) {
    Object.freeze(value);for(const child of Object.values(value))freeze(child);
  }};
  freeze(g);
  geometries.set(layout,g);
  return g;
}

const contains=(r,p)=>p.x>r.x+1e-9&&p.x<r.x+r.w-1e-9&&p.y>r.y+1e-9&&p.y<r.y+r.h-1e-9;

/** True if a segment enters a solid furniture footprint (touching its edge is permitted). */
export function crossesLoungeRect(a,b,r) {
  let lo=0,hi=1;
  for(const [axis,size] of [["x","w"],["y","h"]]) {
    const d=b[axis]-a[axis];
    if(Math.abs(d)<1e-10) {if(a[axis]<=r[axis]+1e-9||a[axis]>=r[axis]+r[size]-1e-9)return false;}
    else {const t1=(r[axis]-a[axis])/d,t2=(r[axis]+r[size]-a[axis])/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}
  }
  return lo<hi-1e-9;
}
export function clearLoungeSegment(g,a,b) {
  const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),top=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y);
  return g.foot.every(r=>right<=r.x || left>=r.x+r.w || bottom<=r.y || top>=r.y+r.h || !crossesLoungeRect(a,b,r));
}
function buildGraph(layout,g) {
  const {x,y,w,h}=layout.lounge, nodes=[],grid=new Map(), buckets=new Map(), exact=new Map();
  const key=p=>`${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  const add=p=>{
    const node={...p,id:nodes.length,edges:[]};nodes.push(node);exact.set(key(p),node);
    const bucket=`${Math.floor(p.x)},${Math.floor(p.y)}`;
    if(!buckets.has(bucket))buckets.set(bucket,[]);buckets.get(bucket).push(node);return node;
  };
  const connect=(a,b)=>{if(a&&b&&clearLoungeSegment(g,a,b)){a.edges.push(b.id);b.edges.push(a.id);}};
  // Half-tile lattice resolves the narrow gaps between the approved furniture pieces.
  for(let iy=-1;iy<h*2;iy++)for(let ix=1;ix<w*2;ix++) {
    const p={x:x+ix/2,y:y+iy/2};if(g.foot.some(r=>contains(r,p)))continue;
    const n=add(p);grid.set(`${ix},${iy}`,n);connect(n,grid.get(`${ix-1},${iy}`));connect(n,grid.get(`${ix},${iy-1}`));
  }
  const attach=p=>{
    const existing=exact.get(key(p));if(existing)return existing;
    const near=[];
    for(let bx=Math.floor(p.x)-1;bx<=Math.floor(p.x)+1;bx++) for(let by=Math.floor(p.y)-1;by<=Math.floor(p.y)+1;by++)
      for(const q of buckets.get(`${bx},${by}`)??[])if(Math.hypot(q.x-p.x,q.y-p.y)<.8)near.push(q);
    const n=add(p);for(const q of near)connect(n,q);return n;
  };
  // Corners connect the half-tile grid through sub-tile gaps beside side tables.
  const corners=[];
  for (const r of g.foot) for (const x of [r.x-.01,r.x+r.w+.01]) for (const y of [r.y-.01,r.y+r.h+.01]) {
    if (x>layout.lounge.x && x<layout.lounge.x+layout.lounge.w && y>=layout.lounge.y-.5 && y<layout.lounge.y+layout.lounge.h
      && !g.foot.some(r=>contains(r,{x,y}))) corners.push(attach({x,y}));
  }
  // Long edges connect corridors too narrow to contain a half-tile lattice column.
  for(const [i,a] of corners.entries())for(const b of corners.slice(i+1))
    if(a!==b && (Math.abs(a.x-b.x)<1e-8 || Math.abs(a.y-b.y)<1e-8))connect(a,b);
  attach(g.entry);
  for(const p of g.drops)attach(p);
  for(const p of g.staffStops)attach(p);
  for(const s of g.seats) {
    const approach=attach(s.approach),n=add({x:s.x,y:s.y,seat:true});
    n.edges.push(approach.id);approach.edges.push(n.id);s.node=n.id;
  }
  return nodes;
}

export function seatLounge(layout, activities, g = loungeGeometry(layout)) {
  const ox = 0, oy = 0;
  const ids = [...activities.keys()];
  const groups = [];
  for (const id of ids) {
    const a = activities.get(id);
    if (!groups[a.group]) groups[a.group] = { activity: a.activity, ids: [] };
    groups[a.group].ids.push(id);
  }
  const readers = ids.filter(id => activities.get(id).activity === "reading");
  const reading = new Set(readers);
  for (const group of groups) if (group) group.ids = group.ids.filter(id => !reading.has(id));
  const used = new Set();
  const result = new Map();
  const free = [...g.free];
  const watch = [...g.watch];
  const ring = [...g.ring];
  const place = (id, activity, group, s, extra = {}) => result.set(id, {
    ...activities.get(id), activity, group: activities.get(id).group, center: { x: ox + (extra.center?.x ?? s.x), y: oy + (extra.center?.y ?? s.y) },
    label: activities.get(id).label,
    position: { x: ox + s.x, y: oy + s.y, facing: s.facing ?? 1, seated: !extra.standing, standing: !!extra.standing,
      front: s.front ? { ...s.front, x: ox + s.front.x, y: oy + s.front.y } : null, hand: s.hand, table: s.table, depth: s.depth },
  });
  const reserved=new Set([...g.seats,...g.free,...g.watch,...g.ring].map(p=>`${p.x.toFixed(6)},${p.y.toFixed(6)}`));
  function* extraSpots() {
    const {x,y,w,h}=layout.lounge;
    for(let step=.35;;step/=2) for(let py=y+.5;py<y+h-.2;py+=step) for(let px=x+.2;px<x+w-.2;px+=step) {
      const p={x:px,y:py},key=`${px.toFixed(6)},${py.toFixed(6)}`;
      if(reserved.has(key)||g.foot.some(r=>contains(r,p)))continue;
      reserved.add(key);yield p;
    }
  }
  const extras=extraSpots();
  const stand = (id, activity, group, target, prefer = []) => {
    const pick = (list) => {
      if (!list.length) return null;
      if (list[0].ordered) return list.shift();
      let best = 0;
      list.forEach((p, i) => { if (Math.hypot(p.x - target.x, p.y - target.y) < Math.hypot(list[best].x - target.x, list[best].y - target.y)) best = i; });
      return list.splice(best, 1)[0];
    };
    const spot = pick(prefer) ?? pick(free) ?? extras.next().value;
    place(id, activity, group, { ...spot, facing: target.x >= spot.x ? 1 : -1 }, { standing: true, center: target });
  };
  // Readers.
  const readSeats = g.read.flatMap(p => p.seats);
  readers.forEach((id, k) => {
    const s = readSeats[k];
    if (s != null) { used.add(s); place(id, "reading", -1, g.seats[s]); }
    else stand(id, "reading", -1, g.read[0]?.center ?? { x: 2, y: 3 });
  });
  groups.forEach((group, index) => {
    if (!group || !group.ids.length) return;
    if (group.activity === "cards") {
      const table = g.pools.find(p => p.kind === "cards" && p.seats.every(s => !used.has(s)));
      if (table) {
        group.ids.forEach((id, k) => {
          const s = table.seats[k];
          if (s != null) { used.add(s); place(id, "cards", index, g.seats[s], { center: table.center }); }
          else stand(id, "cards", index, table.center, watch);
        });
        return;
      }
      // No free table: they gather to watch the nearest game.
      const target = g.cards[index % Math.max(1, g.cards.length)]?.pool.center ?? { x: 16, y: 3.4 };
      group.ids.forEach(id => stand(id, "cards", index, target, watch));
      return;
    }
    // Chat (and a lone reader handled above): the first conversation area with room for the whole group,
    // else the one with most room, spilling the rest to stand by it (or by the hearth).
    const room = (p) => p.seats.filter(s => !used.has(s)).length;
    const chats = g.pools.filter(p => p.kind === "chat");
    // A group too big for any one area splits across the nearest areas (the small clusters take pairs).
    const area = chats.find(p => room(p) >= group.ids.length) ?? [...chats].sort((a, b) => room(b) - room(a))[0];
    const near = area ? [...chats].sort((a, b) => Math.hypot(a.center.x - area.center.x, a.center.y - area.center.y)
      - Math.hypot(b.center.x - area.center.x, b.center.y - area.center.y)) : [];
    const seats = near.flatMap(p => p.seats.filter(s => !used.has(s)).map(s => [s, p]));
    group.ids.forEach((id, k) => {
      const [s, p] = seats[k] ?? [];
      if (s != null) { used.add(s); place(id, "chatting", index, g.seats[s], { center: p.center }); }
      else stand(id, "chatting", index, g.hearth ?? area?.center ?? { x: 16, y: 3.4 }, ring);
    });
  });
  return result;
}
