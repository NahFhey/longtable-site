import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoomLayout, seatPositionForPlan, loungeActivities, caretakerTour } from '../model.mjs';
import { loungeGeometry, seatLounge, crossesLoungeRect } from '../lounge-layout.mjs';
import { loungeGraphPath, loungeRoute, inLounge } from '../lounge-routing.mjs';
import { art } from './lounge-art.mjs';
import { FOOD_CORNER } from '../food-layout.mjs';
import { createLoungeDrawing } from '../lounge.mjs';
import { bindFoodDrawing, bodyMotion } from '../food-corner.mjs';

const sample = JSON.parse(readFileSync(new URL('../data/timeline.sample.json', import.meta.url), 'utf8'));
const layout = createRoomLayout(sample.tables, sample.room_layout);
const geometry = loungeGeometry(layout);
const people = n => Array.from({ length: n }, (_, i) => ({ id: `person-${String(i).padStart(3, '0')}` }));
const inside = (r,p) => p.x > r.x + 1e-8 && p.x < r.x + r.w - 1e-8 && p.y > r.y + 1e-8 && p.y < r.y + r.h - 1e-8;
const overlaps = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
const unique = points => new Set(points.map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)).size === points.length;
const artCache=new WeakMap();
const drawn=(g,l=layout)=>{if(!artCache.has(g))artCache.set(g,art(g,l));return artCache.get(g);};
const same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-8;
const rectDistance=(p,r)=>Math.hypot(Math.max(r.x-p.x,0,p.x-r.x-r.w),Math.max(r.y-p.y,0,p.y-r.y-r.h));
function segmentDistance(a,b,p) {
  const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;
  const t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;
  return Math.hypot(a.x+t*dx-p.x,a.y+t*dy-p.y);
}
function segmentRectDistance(a,b,r) {
  if(crossesLoungeRect(a,b,r))return 0;
  return Math.min(rectDistance(a,r),rectDistance(b,r),...[
    {x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x,y:r.y+r.h},{x:r.x+r.w,y:r.y+r.h},
  ].map(p=>segmentDistance(a,b,p)));
}
let minimumChimney=Infinity;
function safePath(g, from, path, l=layout) {
  const start=g.seats.find(s=>same(s,from)),end=path.length && g.seats.find(s=>same(s,path.at(-1)));
  for (const [index,to] of path.entries()) {
    for(const r of drawn(g,l)) {
      const entering=end && index===path.length-1 && r.owner===end.owner && same(from,end.approach);
      const exiting=start && index===0 && r.owner===start.owner && same(to,start.approach);
      if(!entering && !exiting) {
        assert.ok(!crossesLoungeRect(from,to,r),`art ${r.kind}: ${JSON.stringify([from,to])}`);
        for(let i=0;i<=10;i++)assert.ok(!inside(r,{x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10}));
      }
      if(r.kind==='chimney') {
        const distance=segmentRectDistance(from,to,r);minimumChimney=Math.min(minimumChimney,distance);
        assert.ok(distance>=.3-1e-8,`chimney clearance ${distance}`);
      }
    }
    for(const seat of g.seats)if(seat!==start&&seat!==end)assert.ok(segmentDistance(from,to,seat)>=.15-1e-8,'third seat anchor');
    from=to;
  }
}
function hallRouter(l) {
  const closest=y=>l.aisles.reduce((b,a)=>Math.abs(a-y)<Math.abs(b-y)?a:b);
  const outside=p=>p.x<l.gridX-.2||p.y<l.gridY-.2||p.y>l.gridY+l.tableRows*l.cellHeight-.2;
  return (a,b)=>{
    if(outside(a)&&outside(b))return [b];
    const A=closest(a.y),B=closest(b.y),p=[{x:a.x,y:A}];
    if(A!==B)p.push({x:l.trunkX,y:A},{x:l.trunkX,y:B});
    return [...p,{x:b.x,y:B},b];
  };
}
function origins(l) {
  return [l.doorPosition,...l.cells.map((_,i)=>seatPositionForPlan(l,i,0)),
    {x:l.stage.x-.8,y:l.lounge.y-.5},{x:l.food.x+FOOD_CORNER.exit.x,y:l.food.y+FOOD_CORNER.exit.y}];
}
const length=(from,path)=>path.reduce((sum,to)=>{const d=Math.hypot(to.x-from.x,to.y-from.y);from=to;return sum+d;},0);

// Detects duplicate anchors, a misplaced table, or a cushion opening cut through another prop.
test('lounge seats have unique anchors and private open-side approaches', () => {
  assert.equal(geometry.seats.length,43);
  assert.ok(unique(geometry.seats));
  for (const seat of geometry.seats) {
    assert.ok(!drawn(geometry).some(r=>r.owner!==seat.owner&&inside(r,seat)));
    assert.ok(!drawn(geometry).some(r=>inside(r,seat.approach)));
    safePath(geometry,seat.approach,[seat]);
    if(seat.hand) {
      const table=geometry.cards[seat.table].pool.center;
      assert.ok((seat.approach.x-seat.x)*(seat.x-table.x)+(seat.approach.y-seat.y)*(seat.y-table.y)>0,'approach faces away from table');
    }
  }
  assert.ok(geometry.furniture.some(f=>f.kind==='sofaUp' && f.bounds.length && f.footprint.length));
  assert.ok(geometry.furniture.every(f=>Number.isFinite(f.depthEdge)));
});

// Detects caches keyed only by crowd size, or mutation of activities and shared seats.
test('lounge seating is pure across other layouts and preserves activities and labels', () => {
  const activities=new Map(people(44).map((p,i)=>[p.id,{activity:i%8<4?'cards':'chatting',group:Math.floor(i/4),label:`unchanged ${i}`} ]));
  const before=structuredClone(activities), first=seatLounge(layout,activities);
  const otherLayout={...layout,lounge:{...layout.lounge,w:19,y:100}};
  const other=new Map([...activities].map(([id,a])=>[`other-${id}`,{...a,activity:'reading',label:`different ${id}`} ]));
  const second=seatLounge(otherLayout,other);
  assert.deepEqual([...second.keys()],[...other.keys()]);
  assert.ok([...second.values()].every(a=>a.position.y>=100&&a.label.startsWith('different')));
  assert.deepEqual(seatLounge(structuredClone(layout),activities),first);
  assert.deepEqual(activities,before);
  for(const [id,a] of first) {
    assert.equal(a.activity,activities.get(id).activity);
    assert.equal(a.label,activities.get(id).label);
    assert.equal(a.group,activities.get(id).group);
  }
});

// Detects the removed reader quota and standing fallbacks that reuse a seat or obstacle.
test('a 44-person lounge break seats 40 and unique overflow works for 1–80 people', () => {
  assert.equal(sample.people.length,44);
  const full=[...loungeActivities(layout,sample.people).values()];
  assert.equal(full.filter(a=>a.position.seated).length,40);
  assert.equal(full.filter(a=>a.position.standing).length,4);
  assert.equal(full.filter(a=>a.activity==='reading').length,0);
  assert.equal(full.filter(a=>a.activity==='cards').length,24);
  for(let n=1;n<=80;n++) {
    const positions=[...loungeActivities(layout,people(n)).values()].map(a=>a.position);
    assert.equal(positions.length,n);
    assert.ok(unique(positions),`unique crowd ${n}`);
    assert.ok(positions.every(p=>p.seated||!drawn(geometry).some(r=>inside(r,p))),`clear crowd ${n}`);
  }
});

function occupied(l) {
  return l.cells.flatMap((c,i)=>[
    {x:c.x-.5,y:c.y+.5,w:6,h:4},
    {x:c.x+1,y:c.y+2,w:3,h:2},
    ...Array.from({length:10},(_,seat)=>{
      const p=seatPositionForPlan(l,i,seat); return {x:p.x-.5,y:p.y-.5,w:1,h:1};
    }),
  ]).concat(l.overflowSeats.map(p=>({x:p.x-.5,y:p.y-.5,w:1,h:1})));
}
function clearance(l) {
  const row={x:l.lounge.x,y:l.lounge.y-1,w:l.lounge.w,h:1}, footprints=occupied(l);
  return !footprints.some(r=>overlaps(r,row)||overlaps(r,l.lounge)) && ![l.food,l.stage].some(r=>overlaps(r,l.lounge));
}
// Detects the old cell-rectangle reading, missing chair/rug checks, or moving the lounge up a row.
test('lounge clearance covers all table-row cases and overflow rows, with a one-tile mutation failing', () => {
  let worst=Infinity;
  for(let count=0;count<=1000;count++) for(const overflow of [false,true]) {
    const tables=Array.from({length:count},(_,pad)=>({pad,seats:overflow?10:9,signups:Array(overflow?10:9).fill({})}));
    const l=createRoomLayout(tables);
    assert.ok(clearance(l),`${count} tables; overflow ${overflow}`);
    assert.equal(l.height,l.tableGridBottom+(l.overflowRows?2+l.overflowRows*2:0)+8);
    if(count) {
      worst=Math.min(worst,l.lounge.y-Math.max(...occupied(l).map(r=>r.y+r.h)));
      if (l.overflowRows || count > 5) assert.equal(clearance({...l,lounge:{...l.lounge,y:l.lounge.y-1}}),false);
    }
  }
  assert.equal(worst,1);
  // Counts are uncapped. Each extra table row translates both the last rug and lounge by six;
  // each overflow row translates its last chair and lounge by two. Sparse pads use the same rule.
  for(const pad of [0,9,10,99,10000,1000000]) for(const seats of [9,10,24,25,99]) {
    const l=createRoomLayout([{pad,seats,signups:Array(seats).fill({})}],{version:1,pad_capacity:pad+1,overflow_capacity:100});
    assert.ok(clearance(l));
    if (l.overflowRows || pad >= 5) assert.equal(clearance({...l,lounge:{...l.lounge,y:l.lounge.y-1}}),false);
  }
});

// Detects clipped outer groups, width-independent coordinates, or a nook that follows the hearth.
test('lounge keeps the hearth centred and drops end clusters outside in down to width 19', () => {
  let previous=new Set();
  for(let w=19;w<=33;w++) {
    const l={...layout,lounge:{...layout.lounge,w}},g=loungeGeometry(l);
    const chimney=g.ops.find(o=>o.op==='chimney');
    assert.ok(Math.abs(chimney.x+chimney.w/2-w/2)<1e-9);
    assert.equal(g.seats.find(s=>s.pool==='read').x,layout.lounge.x+.85);
    for(const id of previous)assert.ok(g.clusters.includes(id),`${id} survives at ${w}`);
    previous=new Set(g.clusters);
    assert.ok(g.bounds.every(r=>r.x>=l.lounge.x && r.x+r.w<=l.lounge.x+w+1e-8));
    for(const seat of g.seats)safePath(g,g.entry,loungeGraphPath(l,g.entry,seat,g));
  }
  const narrow=loungeGeometry({...layout,lounge:{...layout.lounge,w:19}});
  assert.equal(narrow.cards.length,2);assert.equal(narrow.pools.filter(p=>p.kind==='chat').length-1,0);
  assert.equal(geometry.cards.length,6);assert.equal(geometry.pools.filter(p=>p.kind==='chat').length-1,3);
  assert.throws(()=>loungeGeometry({...layout,lounge:{...layout.lounge,w:18}}),/require 19/);
});

// Detects an obstacle-crossing edge, a disconnected waypoint pair, or an unsafe hall/seat connection.
test('drawn art protects every waypoint pair, every hall origin and seat pair, and chimney clearance', () => {
  const nodes=geometry.graph;
  const checked=new Set();
  // Every segment used by any graph path is sampled once in both directions.
  for(const a of nodes)for(const id of a.edges) {
    safePath(geometry,a,[nodes[id]]);checked.add(`${a.id}:${id}`);
  }
  assert.ok(checked.size>nodes.length);
  // Breadth-first paths from every waypoint visit every other waypoint, never using a seat as transit.
  // This covers all ordered waypoint pairs without repeatedly sampling the same edges.
  for(const start of nodes) {
    const visited=new Set([start.id]),queue=[start.id];
    for(const id of queue) {
      if(nodes[id].seat && id!==start.id)continue;
      for(const next of nodes[id].edges)if(!visited.has(next)){visited.add(next);queue.push(next);}
    }
    assert.equal(visited.size,nodes.length,`all destinations reachable from waypoint ${start.id}`);
  }
  const hallPath=hallRouter(layout);
  for(const hall of origins(layout)) for(const seat of geometry.seats) {
    const path=loungeRoute(layout,hall,seat,hallPath,[],geometry);
    safePath(geometry,hall,path);
    assert.deepEqual(path.at(-2),seat.approach);
    safePath(geometry,seat,loungeRoute(layout,seat,hall,hallPath,[],geometry));
  }
  for(const a of geometry.seats)for(const b of geometry.seats)safePath(geometry,a,loungeGraphPath(layout,a,b,geometry));
  const chimney=geometry.ops.find(o=>o.op==='chimney');
  assert.ok(layout.lounge.y+chimney.y-geometry.entry.y>=.3);
  console.log(`minimum sampled chimney clearance: ${minimumChimney.toFixed(6)}`);
});

// Detects retargeting toward the nearest node behind a walker or cutting diagonally across a table.
test('a lounge reroute finishes its forward waypoint before selecting a new seat', () => {
  const first=geometry.seats.at(-1),next=geometry.seats[0];
  const path=loungeGraphPath(layout,geometry.entry,first,geometry);
  const from={x:(path[2].x+path[3].x)/2,y:(path[2].y+path[3].y)/2};
  const remaining=path.slice(3);
  const rerouted=loungeRoute(layout,from,next,(_a,b)=>[b],remaining,geometry);
  assert.deepEqual(rerouted[0],remaining[0]);
  safePath(geometry,from,rerouted);
});

// Detects the old caretaker stops inside the nook or old straight lounge tour legs.
test('caretaker lounge stops are free floor and tour segments use the lounge graph', () => {
  assert.equal(geometry.staffStops.length,2);
  for(const p of geometry.staffStops)assert.ok(drawn(geometry).every(r=>rectDistance(p,r)>=.25-1e-8),'staff clearance');
  const tour=caretakerTour(sample,layout);
  assert.ok(tour.stops.some(p=>inLounge(layout,p)));
  for(const segment of tour.segments)safePath(geometry,segment.from,[segment.to]);
});

function drawing(reduced,indoor={}) {
  const calls=[];
  const ctx=new Proxy({createRadialGradient:(...args)=>{calls.push(['gradient',...args]);return {addColorStop:(...args)=>calls.push(['stop',...args])};}}, {
    get:(target,key)=>target[key] ?? ((...args)=>calls.push([key,...args])),
    set:(target,key,value)=>{target[key]=value;calls.push(['set',key,value]);return true;},
  });
  const options={ctx:()=>ctx,rpg:()=>({sheet:'rpg'}),indoor:()=>indoor,reduced:()=>reduced};
  bindFoodDrawing(options);
  return {calls,draw:createLoungeDrawing(options)};
}
function drawScene(renderer,now) {
  renderer.calls.length=0;
  renderer.draw.drawLoungeFloor(layout);
  for(const item of renderer.draw.loungeDepthItems(layout,now,loungeActivities(layout,sample.people)))item.draw();
  renderer.draw.drawBook(3,layout.lounge.y+2,1,now,.2);
  return JSON.parse(JSON.stringify(renderer.calls));
}
// Detects real-time fire, card pips, dealing, pages or breathing leaking into reduced motion.
test('reduced motion freezes dealing, page turns, breathing and hearth flicker', () => {
  const still=drawing(true);
  const baseline=drawScene(still,0),motion=bodyMotion(.2,false,0,true,true);
  // 50 ms steps over multiple 7 s card, 5–8 s book, breathing and flame cycles.
  for(let now=50;now<=28000;now+=50) {
    assert.deepEqual(drawScene(still,now),baseline,`reduced drawing at ${now} ms`);
    assert.deepEqual(bodyMotion(.2,false,now,true,true),motion);
  }
  const moving=drawing(false);
  assert.notDeepEqual(drawScene(moving,400),drawScene(moving,8900));
});

// Detects a missing indoor atlas making furniture disappear instead of drawing fallback rectangles.
test('missing indoor art draws furniture and the floor as rectangles', () => {
  const renderer=drawing(true,null);
  const calls=drawScene(renderer,0);
  assert.ok(calls.some(c=>c[0]==='set'&&c[1]==='fillStyle'&&c[2]==='#4b4656'));
  assert.ok(calls.filter(c=>c[0]==='fillRect').length>43);
  const sofa=geometry.seats.find(s=>s.front?.kind==='sofaUp');
  renderer.draw.drawSeatFront(sofa.front);
  assert.ok(renderer.calls.some(c=>c[0]==='set'&&c[2]==='#826244'));
});


test('300 people in a 30-table lounge stand on unique drawn-art-free floor',()=>{
  const l=createRoomLayout(Array.from({length:30},(_,pad)=>({pad,seats:10,signups:Array(10).fill({})})));
  const g=loungeGeometry(l),positions=[...loungeActivities(l,people(300)).values()].map(a=>a.position);
  assert.equal(positions.length,300);assert.ok(unique(positions));
  const standing=positions.filter(p=>p.standing);
  for(const p of standing)assert.ok(!drawn(g,l).some(r=>inside(r,p)));
  assert.deepEqual(loungeActivities(l,people(300)),loungeActivities(l,people(300)));
  console.log(`300 people: ${standing.length} standing; all 300 spots unique`);
});

test('geometry is shared per layout and remains immutable after routing',()=>{
  const g=loungeGeometry(layout),before=JSON.stringify(g);
  assert.equal(loungeGeometry(layout),g);
  loungeActivities(layout,people(44));loungeGraphPath(layout,g.seats[0],g.seats[1],g);
  assert.equal(JSON.stringify(g),before);assert.ok(Object.isFrozen(g.seats[0]));
  assert.ok([...g.free,...g.ring,...g.watch].every(p=>!drawn(g).some(r=>inside(r,p))));
});

test('entry and exit routes meet the best-drop bound from every hall origin',()=>{
  let worst=0;
  for(const overflow of [false,true]) {
    const l=overflow?createRoomLayout(Array.from({length:30},(_,pad)=>({pad,seats:10,signups:Array(10).fill({})}))):layout;
    const g=loungeGeometry(l),hall=hallRouter(l);
    assert.ok(g.drops.length>2);
    // Independently construct the hall's two overflow joins; direct hall routing is unchanged.
    const access=(from,to,enter)=>{
      if(!overflow || Math.abs((enter?from:to).y-(l.lounge.y-.5))<1e-8)return hall(from,to);
      return [l.trunkX,l.stage.x-.8].map(x=>{
        const a={x,y:l.aisles.at(-1)},b={x,y:l.lounge.y-.5};
        return enter?[...hall(from,a),b,to]:[b,a,...hall(a,to)];
      }).sort((a,b)=>length(from,a)-length(from,b))[0];
    };
    for(const from of origins(l))for(const seat of g.seats)for(const enter of [true,false]) {
      const a=enter?from:seat,b=enter?seat:from;
      const best=Math.min(...g.drops.map(d=>enter
        ?length(from,access(from,d,true))+length(d,loungeGraphPath(l,d,seat,g))
        :length(seat,loungeGraphPath(l,seat,d,g))+length(d,access(d,from,false))));
      const path=loungeRoute(l,a,b,hall,[],g),actual=length(a,path);
      assert.ok(actual<=best+.01,`${actual} exceeds ${best}`);worst=Math.max(worst,actual/best);
      safePath(g,a,path,l);
    }
  }
  console.log(`worst entry/exit best-drop ratio: ${worst.toFixed(6)}`);
});

test('the entry lane and bottom hall aisle never activate lounge routing',()=>{
  const from={x:layout.trunkX,y:layout.lounge.y-.5},to={x:layout.stage.x-.8,y:from.y};
  assert.equal(loungeRoute(layout,from,to,hallRouter(layout),[geometry.seats[0]],geometry),null);
});
