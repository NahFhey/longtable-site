import { checkContinuity } from './kitchen-helpers.mjs';
import { FOOD_CORNER, atFood } from "../food-layout.mjs";
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { EVE_EXIT_SECONDS, EVE_MS, GATHERING_DWELL_FACTOR, caretakerTour, createRoomLayout, gatheringAmbience, hallAmbience, receivePracticeSnapshot, practiceNow, practiceKitchenServices, practicePlaces } from '../model.mjs';
const layout=createRoomLayout([]);
const person=(planned, actual={here:null,leaving:null})=>({presence:{planned,actual}});
const fixtures = new Set();
const timeline=people=>{ const data={event:{slots:8,slot_minutes:30},people}; fixtures.add(data); return data; };
const at=(data,seconds,reduced=false)=>{ fixtures.add(data); return hallAmbience(data,seconds/1800,layout,reduced); };
const switchTime = (data, departure) => {
  for (let t=departure;t<departure+120;t+=.01) { const a=at(data,t); if(a.lights<1) return t - (1-a.lights)*4; }
  throw new Error('Closing never reached the switch');
};

test('staff switch lights on and start rounds without setting out food or adding attendees',()=>{
  const data=timeline([person([0,8])]);
  const before=structuredClone(data);
  assert.equal(at(data,0).lights,0);
  assert.equal(at(data,7).lights,1);
  assert.equal(at(data,15).foodCount,0);
  assert.equal(at(data,35).foodCount,0);
  assert.equal(at(data,55).foodCount,0);
  assert.equal(at(data,120).lights,1);
  assert.notDeepEqual(at(data,100).staff,at(data,120).staff);
  assert.deepEqual(data,before);
});
test('only the last attendee leaving triggers closing; actual attendance wins over plans',()=>{
  const data=timeline([person([0,4]),person([0,8],{here:0,leaving:5})]);
  assert.equal(at(data,4*1800+20).lights,1);
  const fade=switchTime(data,5*1800);
  const closing=at(data,fade+1);
  assert.ok(closing.lights>0&&closing.lights<1);
  assert.match(closing.action,/switching off/);
  assert.equal(at(data,fade+4).lights,0);
  assert.equal(at(data,6*1800).staff,null);
  assert.equal(at(data,6*1800).lights,0);
  assert.match(at(data,6*1800).action,/gone home/);
  assert.equal(at(data,6*1800).occupied,false);
});
test('staff reopen for a later arrival and keep an empty event dark after setup',()=>{
  const data=timeline([person([0,2]),person([4,8])]);
  assert.equal(at(data,3*1800).lights,0);
  assert.match(at(data,4*1800+5).action,/back on/);
  assert.equal(at(data,4*1800+12).lights,1);
  const empty=timeline([]);
  assert.equal(at(empty,100).lights,0);
  assert.equal(at(empty,100).staff,null);
  assert.match(at(empty,100).action,/gone home/);
});
test('seeks, reloads, reduced motion and the final event boundary are stable',()=>{
  const data=timeline([person([0,8])]);
  const result=at(data,120);
  at(data,200);
  assert.deepEqual(at(data,120),result);
  assert.deepEqual(at(structuredClone(data),120),result);
  assert.deepEqual(hallAmbience(data,8,layout),at(data,8*1800+12));
  assert.equal(at(data,0,true).foodCount,0);
  assert.equal(at(data,0,true).lights,1);
  assert.deepEqual(at(data,100,true).staff,at(data,105,true).staff);
});
test('after closing the caretaker walks from the switch out through the door and is gone',()=>{
  const data=timeline([person([0,4])]);
  const departure=4*1800;
  const {lightSwitch}=at(data,0);
  const fade=switchTime(data,departure);
  const closing=at(data,fade+1);
  assert.ok(Math.abs(closing.lights-.75)<1e-8);
  assert.ok(Math.hypot(closing.staff.x-lightSwitch.x,closing.staff.y-lightSwitch.y)<1e-9,'at the switch while the lights fade');
  const leaving=at(data,fade+5);
  assert.equal(leaving.lights,0);
  assert.match(leaving.action,/heading home/);
  assert.ok(leaving.staff.y>lightSwitch.y&&leaving.staff.y<layout.doorPosition.y,'between the switch and the door');
  assert.ok(leaving.staff.x<lightSwitch.x&&leaving.staff.x>=layout.doorPosition.x);
  for (const seconds of [fade+6.001,departure+120,8*1800]) {
    const gone=at(data,seconds);
    assert.equal(gone.staff,null);
    assert.equal(gone.lights,0);
    assert.equal(gone.action,'The hall is dark and empty. Staff have gone home.');
  }
});
test('a later arrival brings the caretaker back in from the door before the lights come on',()=>{
  const data=timeline([person([0,2]),person([4,8])]);
  const arrival=4*1800;
  const {lightSwitch}=at(data,0);
  assert.equal(at(data,arrival-1).staff,null);
  assert.deepEqual({x:at(data,arrival).staff.x,y:at(data,arrival).staff.y},layout.doorPosition);
  const returning=at(data,arrival+4);
  assert.match(returning.action,/back on/);
  assert.equal(returning.lights,0);
  assert.ok(returning.staff.y<layout.doorPosition.y&&returning.staff.y>lightSwitch.y,'between the door and the switch');
  assert.deepEqual({x:at(data,arrival+8).staff.x,y:at(data,arrival+8).staff.y},lightSwitch);
  assert.equal(at(data,arrival+12).lights,1);
  // Someone returning while the caretaker is still walking out starts the return from mid-walk, not the door.
  const outboundData=timeline([person([0,2])]);
  const returnAt=switchTime(outboundData,2*1800)+5;
  const quick=timeline([person([0,2]),{presence:{planned:[0,8],actual:{here:returnAt/1800,leaving:null}}}]);
  const midway=at(quick,returnAt);
  const outbound=at(outboundData,returnAt).staff;
  assert.deepEqual({x:midway.staff.x,y:midway.staff.y},{x:outbound.x,y:outbound.y});
  assert.match(midway.action,/back on/);
});
test('reduced motion removes the caretaker as soon as the lights are off, without a walk',()=>{
  const data=timeline([person([0,4])]);
  const off=at(data,4*1800+3,true);
  assert.equal(off.lights,0);
  assert.deepEqual({x:off.staff.x,y:off.staff.y},off.lightSwitch);
  assert.match(off.action,/switching off/);
  for (const seconds of [4*1800+8,4*1800+13,6*1800]) {
    const gone=at(data,seconds,true);
    assert.equal(gone.staff,null);
    assert.equal(gone.lights,0);
    assert.match(gone.action,/gone home/);
  }
  assert.deepEqual({x:at(data,100,true).staff.x,y:at(data,100,true).staff.y},off.lightSwitch);
});
test('the caretaker tours many walkable stops with no back-and-forth legs',()=>{
  const data={...timeline([person([0,8])]),event:{slots:8,slot_minutes:30,start:'2026-11-07T10:00:00-05:00'}};
  fixtures.add(data);
  const tour=caretakerTour(data,layout);
  const key=point=>`${Math.round(point.x)},${Math.round(point.y)}`;
  assert.deepEqual(tour.stops.at(-1),tour.stops[0]);
  assert.notDeepEqual(tour.stops[1],tour.stops.at(-2),'the wrap does not walk straight back');
  for (let i=1;i<tour.stops.length-1;i+=1) {
    assert.notDeepEqual(tour.stops[i+1],tour.stops[i-1],`leg ${i} reverses leg ${i-1}`);
    assert.notDeepEqual(tour.stops[i+1],tour.stops[i],`leg ${i} has zero length`);
  }
  for (const dwell of tour.dwell) assert.ok(dwell>=3&&dwell<=10);
  const near=(a,b)=>Math.abs(a-b)<1e-6;
  const foodStops=FOOD_CORNER.staffSpots.map(p=>atFood(layout,p)), loungeY=layout.lounge.y+2, stairsX=layout.stage.x-.8;
  const walkable=({x,y})=>near(x,layout.trunkX)
    ||layout.aisles.some(aisle=>near(y,aisle)&&x>=layout.trunkX-1e-6&&x<=stairsX+1e-6)
    ||foodStops.some(p=>near(x,p.x)&&y>=p.y-1e-6&&y<=layout.aisles[0]+1e-6)
    ||(near(y,loungeY)&&x>=layout.lounge.x+1.5-1e-6&&x<=layout.lounge.x+layout.lounge.w-1.5+1e-6)
    ||(near(x,stairsX)&&y>=layout.aisles[0]-1e-6&&y<=layout.aisles.at(-1)+1e-6)
    ||(x<=layout.trunkX+1e-6&&y>=layout.door.y-.8-1e-6&&y<=layout.doorPosition.y+1e-6);
  const stops=new Set(tour.stops.map(key));
  const visited=new Set();
  for (let seconds=60;seconds<=3660;seconds+=1) {
    const {staff}=at(data,seconds);
    assert.ok(walkable(staff),`${seconds}s at ${staff.x},${staff.y} is off the corridors`);
    if (stops.has(key(staff))) visited.add(key(staff));
  }
  assert.ok(stops.size>=15&&stops.size<=25,`${stops.size} distinct stops`);
  assert.ok(visited.size>=10,`${visited.size} distinct stops visited in an hour`);
});
test('the tour is fixed per event start and differs between events',()=>{
  const start='2026-11-07T10:00:00-05:00';
  const data={...timeline([person([0,8])]),event:{slots:8,slot_minutes:30,start}};
  fixtures.add(data);
  const positions=[300,900,2400].map(seconds=>at(data,seconds).staff);
  assert.deepEqual([300,900,2400].map(seconds=>at(data,seconds).staff),positions);
  const reloaded={...structuredClone(data)};
  assert.deepEqual([300,900,2400].map(seconds=>at(reloaded,seconds).staff),positions);
  assert.deepEqual(caretakerTour(reloaded,layout).stops,caretakerTour(data,layout).stops);
  const other={...timeline([person([0,8])]),event:{slots:8,slot_minutes:30,start:'2027-03-14T18:00:00-04:00'}};
  fixtures.add(other);
  assert.notDeepEqual(caretakerTour(other,layout).stops,caretakerTour(data,layout).stops);
  assert.deepEqual(caretakerTour(other,layout).stops[0],caretakerTour(data,layout).stops[0],'every tour starts at the light switch');
});
test('before the doors open the hall is dark and nobody is drawn, then the caretaker enters from the door',()=>{
  const data=timeline([person([1,8])]);
  const opening=1800-60;
  for (const seconds of [0,600,opening-1]) for (const reduced of [false,true]) {
    const early=at(data,seconds,reduced);
    assert.equal(early.staff,null);
    assert.equal(early.lights,0);
    assert.equal(early.action,'The hall is dark. Staff have not arrived yet.');
  }
  const {lightSwitch}=at(data,0);
  const entering=at(data,opening+1).staff;
  assert.match(at(data,opening+1).action,/turning on/);
  assert.ok(entering.y<layout.doorPosition.y&&entering.y>lightSwitch.y,'between the door and the switch');
  assert.ok(entering.x>=layout.doorPosition.x&&entering.x<=lightSwitch.x);
});
test('the gathering keeps the lights on and the caretaker touring at real-time pace, the same on every load',()=>{
  const data={...timeline([person([0,8])]),event:{slots:8,slot_minutes:30,start:'2026-11-07T10:00:00-05:00',tz:'America/New_York'}};
  fixtures.add(data);
  const start=Date.parse(data.event.start);
  const instant=start-40*24*3600e3;
  const at=(ms,reduced=false)=>gatheringAmbience(data,layout,ms,reduced);
  const early=at(instant);
  assert.equal(early.lights,1);
  assert.equal(early.foodCount,0);
  assert.equal(early.occupied,true);
  assert.equal(early.staff.load,null);
  assert.match(early.action,/Lights are on\. Staff are circulating/);
  assert.notDeepEqual(at(instant+30_000).staff,early.staff,'the caretaker moves within half a minute');
  const tour=caretakerTour(data,layout);
  const stationary=segment=>segment.from.x===segment.to.x&&segment.from.y===segment.to.y;
  const realSeconds=tour.segments.reduce((sum,segment)=>sum+(stationary(segment)?segment.seconds*GATHERING_DWELL_FACTOR:segment.seconds),0);
  const meanDwell=tour.dwell.reduce((sum,dwell)=>sum+dwell,0)/tour.dwell.length*GATHERING_DWELL_FACTOR;
  assert.ok(meanDwell>22&&meanDwell<38,`mean stop of ${meanDwell.toFixed(1)} s`);
  const later=at(instant+realSeconds*1000).staff;
  assert.ok(Math.hypot(later.x-early.staff.x,later.y-early.staff.y)<1e-6,'the tour repeats after one full real-time cycle');
  assert.deepEqual(at(instant),early,'position is a function of the instant alone');
  assert.deepEqual(gatheringAmbience(structuredClone(data),layout,instant),early);
  for (const ms of [instant,instant+30_000]) {
    const reduced=at(ms,true);
    assert.deepEqual({x:reduced.staff.x,y:reduced.staff.y},tour.stops[0],'reduced motion pins the caretaker at the first stop');
    assert.equal(reduced.lights,1);
  }
});
test('the eve closes the hall: lights off at a minute, caretaker gone after the exit walk, and a dated caption',()=>{
  const data={...timeline([person([0,8])]),event:{slots:8,slot_minutes:30,start:'2026-11-07T10:00:00-05:00',tz:'America/New_York'}};
  fixtures.add(data);
  const eve=Date.parse(data.event.start)-EVE_MS;
  const at=(ms,reduced=false)=>gatheringAmbience(data,layout,ms,reduced);
  const opening=at(eve);
  assert.equal(opening.lights,1);
  assert.ok(opening.staff);
  assert.equal(at(eve-1).lights,1);
  const off=at(eve+60_000);
  assert.equal(off.lights,0);
  assert.match(off.action,/switching off/);
  assert.deepEqual({x:off.staff.x,y:off.staff.y},off.lightSwitch);
  assert.match(at(eve+61_000).action,/heading home/);
  assert.equal(EVE_EXIT_SECONDS,62);
  for (const ms of [eve+EVE_EXIT_SECONDS*1000,eve+3600e3,eve+EVE_MS-1]) {
    const dark=at(ms);
    assert.equal(dark.staff,null);
    assert.equal(dark.lights,0);
    assert.equal(dark.foodCount,0);
    assert.equal(dark.occupied,false);
    assert.equal(dark.action,'The hall is dark. Doors open Saturday at 10:00 AM.');
  }
  const reduced=at(eve+61_000,true);
  assert.equal(reduced.lights,0);
  assert.deepEqual({x:reduced.staff.x,y:reduced.staff.y},reduced.lightSwitch);
  assert.equal(at(eve+EVE_EXIT_SECONDS*1000,true).staff,null);
  const auckland={...data,event:{...data.event,tz:'Pacific/Auckland'}};
  fixtures.add(auckland);
  assert.equal(gatheringAmbience(auckland,layout,eve+3600e3).action,'The hall is dark. Doors open Sunday at 4:00 AM.','the caption uses the event time zone');
});

test('whole-event continuity for every ambience timeline fixture', async t => {
  let index = 0;
  for (const data of fixtures) {
    await t.test(`ambience fixture ${++index}`, child => checkContinuity(data, layout, child));
  }
});

const practiceSample = JSON.parse(readFileSync(new URL('../data/timeline.sample.json', import.meta.url)));
const eveStart = Date.parse('2026-11-06T15:00:00Z') / 1000;
const stamp = seconds => new Date((eveStart + seconds) * 1000).toISOString();
const practiceMove = (seconds, destination = 'table') => ({ person: 'u_lena', at: stamp(seconds),
  destination, table: destination === 'table' ? 't01' : null });
const snapshot = (seconds, occupied, moves = []) => ({ ...structuredClone(practiceSample),
  event: { ...practiceSample.event, start: '2026-11-07T15:00:00Z', tz: 'America/New_York' },
  generated_at: stamp(seconds), practice: { moves, speech: [], people: occupied
    ? { u_lena: { position: moves.at(-1)?.destination ?? 'table', table: 't01' } } : {} } });
const receive = (data, previous = null, receipt = Date.parse(data.generated_at)) =>
  receivePracticeSnapshot(data, previous, receipt);
const eveRoom = createRoomLayout(practiceSample.tables, practiceSample.room_layout);
const eveAt = (data, seconds, reduced = false) => gatheringAmbience(data, eveRoom, (eveStart + seconds) * 1000, reduced);
const xy = p => ({ x: p.x, y: p.y });
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const datedCaption = 'The hall is dark. Doors open Saturday at 10:00 AM.';
const dark = state => {
  assert.equal(state.staff, null);
  assert.equal(state.lights, 0);
  assert.equal(state.foodCount, 0);
  assert.equal(state.occupied, false);
  assert.equal(state.action, datedCaption);
};
const eveFixtures = [];
const closingFade = (data, close) => {
  for (let t = close; t < close + 180; t += .05) {
    const a = eveAt(data, t);
    if (a.lights < 1) return t - (1 - a.lights) * 4;
  }
  assert.fail('close never reached the fade');
};

test('gate 2: footprints keep the eve lit and touring, including reaction-only practice', () => {
  const data = receive(snapshot(-100, true)).timeline;
  for (const seconds of [0, 48, 62, 3600]) {
    const state = eveAt(data, seconds);
    assert.equal(state.lights, 1);
    assert.equal(state.occupied, true);
    assert.equal(state.foodCount, 0);
    assert.match(state.action, /circulating/);
    assert.notDeepEqual(xy(state.staff), xy(eveAt(data, seconds + 50).staff));
    assert.deepEqual(xy(eveAt(data, seconds, true).staff), state.lightSwitch);
  }
});

test('gate 3: the first empty generated_at closes the hall and stays fixed across polls', () => {
  const first = receive(snapshot(-100, true));
  const closed = receive(snapshot(100, false), first);
  const later = receive(snapshot(120, false), closed);
  assert.equal(later.occupancy.changes.length, 2);
  assert.equal(later.occupancy.changes[1].at, Date.parse(stamp(100)));
  const data = later.timeline, fade = closingFade(data, 100);
  assert.match(eveAt(data, 100.001).action, /switching off/);
  assert.equal(eveAt(data, 100.001).occupied, false);
  near(eveAt(data, fade + 2).lights, .5);
  assert.deepEqual(xy(eveAt(data, fade + 2).staff), eveAt(data, fade).lightSwitch);
  const exit = eveAt(data, fade + 5);
  assert.equal(exit.lights, 0);
  assert.match(exit.action, /heading home/);
  assert.notDeepEqual(xy(exit.staff), exit.lightSwitch);
  for (const time of [fade + 6.001, 500, 3600]) for (const reduced of [false, true]) dark(eveAt(data, time, reduced));
  assert.deepEqual(eveAt(data, 101), eveAt(closed.timeline, 101));
  eveFixtures.push({ data, start: 99, end: fade + 8 });
});

test('gate 4: food cleanup is requested at the empty snapshot, then switch-off follows', () => {
  const moves = [practiceMove(100, 'food')];
  const first = receive(snapshot(-100, true));
  const fed = receive(snapshot(100, true, moves), first);
  const [original] = practiceKitchenServices(fed.timeline, eveRoom);
  const close = Math.ceil(original.readyTime - eveStart + 30);
  const closed = receive(snapshot(close, false, moves), fed);
  const [service] = practiceKitchenServices(closed.timeline, eveRoom);
  assert.equal(service.cleanupRequested, eveStart + close);
  assert.ok(service.cleanupRequested < original.cleanupRequested);
  assert.equal(service.emptied, true);
  assert.ok(service.cleanupStart >= service.cleanupRequested);
  assert.ok(service.cleanupStart - service.cleanupRequested < 30, 'only the kitchen return precedes clearing');
  assert.equal(eveAt(closed.timeline, close).foodCount, 6);
  assert.match(eveAt(closed.timeline, service.cleanupStart - eveStart + .001).action, /clearing/);
  assert.match(eveAt(closed.timeline, service.backEnd - eveStart + .001).action, /switching off/);
  dark(eveAt(closed.timeline, service.backEnd - eveStart + 7));
  eveFixtures.push({ data: closed.timeline, start: 99, end: service.backEnd - eveStart + 8 });
});

test('gate 5: a table click opens from the door and starts the tour at stop zero', () => {
  const first = receive(snapshot(70, false));
  const opened = receive(snapshot(105, true, [practiceMove(100)]), first);
  const data = opened.timeline;
  dark(eveAt(data, 99.999));
  assert.deepEqual(xy(eveAt(data, 100).staff), eveRoom.doorPosition);
  assert.equal(eveAt(data, 100).lights, 0);
  assert.match(eveAt(data, 100).action, /back on/);
  assert.deepEqual(xy(eveAt(data, 108).staff), eveAt(data, 108).lightSwitch);
  near(eveAt(data, 110).lights, .5);
  assert.equal(eveAt(data, 112).lights, 1);
  assert.deepEqual(xy(eveAt(data, 112).staff), eveAt(data, 112).lightSwitch);
  assert.match(eveAt(data, 112).action, /circulating/);
  const tour = caretakerTour(data, eveRoom);
  const firstDwell = tour.dwell[0] * GATHERING_DWELL_FACTOR;
  assert.deepEqual(xy(eveAt(data, 112 + firstDwell - .001).staff), tour.stops[0]);
  assert.notDeepEqual(xy(eveAt(data, 113 + firstDwell).staff), tour.stops[0]);
  eveFixtures.push({ data, start: 99, end: 170 });
});

test('gate 5: reaction-only opening keeps its first nonempty generated_at across polls', () => {
  const staleMoves = [practiceMove(20)];
  const first = receive(snapshot(70, false, staleMoves));
  const opened = receive(snapshot(100, true, staleMoves), first);
  const polled = receive(snapshot(110, true, staleMoves), opened);
  assert.equal(polled.occupancy.changes.length, 2);
  assert.equal(polled.occupancy.changes[1].opening, Date.parse(stamp(100)));
  assert.deepEqual(xy(eveAt(polled.timeline, 100).staff), eveRoom.doorPosition);
  assert.equal(eveAt(polled.timeline, 110).lights, .5);
  assert.deepEqual(eveAt(polled.timeline, 111), eveAt(opened.timeline, 111));
});

test('gate 6: a dark Get Food opens before kitchen service and queues without a plate', () => {
  const moves = [practiceMove(100, 'food')];
  const first = receive(snapshot(70, false));
  const data = receive(snapshot(100, true, moves), first).timeline;
  const [service] = practiceKitchenServices(data, eveRoom);
  const lit = receive(snapshot(100, true, moves), receive(snapshot(-100, true))).timeline;
  const [litService] = practiceKitchenServices(lit, eveRoom);
  assert.deepEqual(xy(eveAt(data, 100).staff), eveRoom.doorPosition);
  assert.deepEqual(xy(eveAt(data, 108).staff), eveAt(data, 108).lightSwitch);
  assert.match(eveAt(data, 112).action, /heading to the kitchen/);
  assert.ok(service.setOutStart >= eveStart + 112);
  assert.ok(service.readyTime > litService.readyTime);
  const place = time => practicePlaces(data, time * 1000, eveRoom).get('u_lena');
  for (const time of [eveStart + 100, eveStart + 112, service.setOutStart, service.readyTime - .001]) {
    assert.equal(place(time).foodPhase, 'waiting');
    assert.equal(place(time).plate, false);
  }
  assert.equal(place(service.readyTime + 1).foodPhase, 'serving-first');
  assert.equal(eveAt(data, service.readyTime - eveStart).foodCount, 6);
  eveFixtures.push({ data, start: 99, end: service.backEnd - eveStart + 2 });
});

test('gate 7: movement interrupts both fixed eve closing and D5 from the actual staff position', () => {
  const beforeEve = receive(snapshot(-100, false));
  const lit = receive(snapshot(-100, true));
  const closed = receive(snapshot(100, false), lit);
  const fade = closingFade(closed.timeline, 100);
  for (const [base, arrivals] of [[beforeEve, [30, 52, 58, 61]], [closed, [101, fade + 2, fade + 5]]]) {
    for (const time of arrivals) {
      const arrival = Math.round(time * 1000) / 1000;
      const opened = receive(snapshot(arrival, true, [practiceMove(arrival)]), base);
      const state = eveAt(opened.timeline, arrival);
      assert.deepEqual(xy(state.staff), xy(eveAt(base.timeline, arrival).staff));
      assert.match(state.action, base === beforeEve && arrival < 48 ? /circulating/ : /back on/);
      if (base === beforeEve && arrival < 48) assert.equal(state.lights, 1);
      assert.equal(eveAt(opened.timeline, arrival + 150).lights, 1);
      eveFixtures.push({ data: opened.timeline, start: arrival - 1, end: arrival + 150 });
    }
  }
});

test('gate 8: two snapshot-driven open-close cycles render deterministically', () => {
  let session = receive(snapshot(70, false));
  const sequence = [[100, true], [200, false], [400, true], [500, false]];
  const moves = [];
  for (const [seconds, occupied] of sequence) {
    if (occupied) moves.push(practiceMove(seconds));
    session = receive(snapshot(seconds, occupied, [...moves]), session);
  }
  const data = session.timeline;
  for (const start of [100, 400]) {
    assert.deepEqual(xy(eveAt(data, start).staff), eveRoom.doorPosition);
    assert.equal(eveAt(data, start + 12).lights, 1);
  }
  for (const end of [200, 500]) {
    assert.match(eveAt(data, end + .001).action, /switching off/);
    dark(eveAt(data, end + 150));
  }
  for (const seconds of [99, 100, 110, 112, 201, 350, 400, 410, 412, 501, 650]) {
    assert.deepEqual(eveAt(data, seconds), eveAt(structuredClone(data), seconds));
  }
  eveFixtures.push({ data, start: 70, end: 660 });
});

test('gate 9: an empty first eve snapshot is dark immediately despite retained old moves', () => {
  for (const generated of [-100, 1, 300]) {
    const raw = snapshot(generated, false, [practiceMove(-300, 'food'), practiceMove(-200)]);
    const before = structuredClone(raw);
    const session = receive(raw, null, (eveStart + Math.max(1, generated)) * 1000);
    for (const reduced of [false, true]) dark(eveAt(session.timeline, Math.max(1, generated), reduced));
    assert.deepEqual(raw, before);
    assert.equal(practiceKitchenServices(session.timeline, eveRoom).length, 0);
  }
  const first = receive(snapshot(1, false, [practiceMove(.5, 'food')]));
  const opened = receive(snapshot(2, true, [practiceMove(.5, 'food'), practiceMove(2)]), first);
  assert.deepEqual(xy(eveAt(opened.timeline, 2).staff), eveRoom.doorPosition);
});

test('gate 10: viewers with different receipt clocks agree at the same bot-clock instant', () => {
  let regular = null, slow = null;
  for (const [seconds, occupied] of [[-100, true], [100, false], [300, true], [500, false]]) {
    const raw = snapshot(seconds, occupied); // no-move reopening also uses bot time
    regular = receive(raw, regular, (eveStart + seconds + 1) * 1000);
    slow = receive(raw, slow, (eveStart + seconds - 90) * 1000);
  }
  assert.equal(regular.offset, 0);
  assert.equal(slow.offset, 90000);
  assert.deepEqual(regular.occupancy, slow.occupancy);
  for (const seconds of [99, 100, 101, 200, 300, 304, 310, 312, 501, 650]) {
    const a = gatheringAmbience(regular.timeline, eveRoom, practiceNow(regular, (eveStart + seconds) * 1000));
    const b = gatheringAmbience(slow.timeline, eveRoom, practiceNow(slow, (eveStart + seconds - 90) * 1000));
    assert.deepEqual(a, b);
  }
});

test('gate 11: empty gathering stays lit and doors discard practice state', () => {
  const first = receive(snapshot(-1000, true, [practiceMove(-1100)]));
  const empty = receive(snapshot(-900, false, [practiceMove(-1100)]), first);
  for (const seconds of [-900, -100, -1]) {
    const state = eveAt(empty.timeline, seconds);
    assert.equal(state.lights, 1);
    assert.equal(state.occupied, true);
    assert.match(state.action, /circulating/);
    assert.ok(state.staff);
  }
  const event = { ...snapshot(86400, false), practice: null };
  const doors = receive(event, empty);
  assert.equal(doors.timeline, event);
  assert.equal(doors.occupancy, undefined);
  assert.equal(doors.moves.length, 0);
  assert.equal(doors.seen.size, 0);
  assert.deepEqual(hallAmbience(doors.timeline, 0, eveRoom), hallAmbience(event, 0, eveRoom));
});

// Keep the sample's event-start spelling: it seeds the tour used in the reported fixtures.
const round2Snapshot = (...args) => {
  const data = snapshot(...args);
  data.event.start = practiceSample.event.start;
  return data;
};
const clickDuringFixedClose = arrival => {
  const move = { ...practiceMove(arrival), table: 't04' };
  const raw = round2Snapshot(arrival + .3, true, [move]);
  raw.practice.people.u_lena.table = 't04';
  return receive(raw, receive(round2Snapshot(-600, false))).timeline;
};

test('round 2 gate 1: E+30 keeps lights on and the same uninterrupted tour, then closes by D5', () => {
  const data = clickDuringFixedClose(30), touring = receive(round2Snapshot(-600, true)).timeline;
  for (let i = 0; i <= (120 - 29) * 20; i++) {
    const seconds = 29 + i / 20;
    for (const reduced of [false, true]) {
      const state = eveAt(data, seconds, reduced);
      assert.equal(state.lights, 1);
      assert.ok(state.staff);
      assert.match(state.action, /circulating/);
      near(state.staff.x, eveAt(touring, seconds, reduced).staff.x);
      near(state.staff.y, eveAt(touring, seconds, reduced).staff.y);
    }
  }
  const opened = receive(round2Snapshot(30.3, true, data.practice.moves), receive(round2Snapshot(-600, false)));
  const closed = receive(round2Snapshot(130, false, data.practice.moves), opened).timeline;
  assert.match(eveAt(closed, 130).action, /switching off/);
  dark(eveAt(closed, closingFade(closed, 130) + 6.001));
  eveFixtures.push({ data, start: 29, end: 120 });
});

test('round 2 gate 2: E+50 holds full light on the remaining switch walk and resets only after reopening', () => {
  const data = clickDuringFixedClose(50), base = receive(round2Snapshot(-600, false)).timeline;
  const initial = eveAt(base, 50).staff, lightSwitch = eveAt(base, 50).lightSwitch;
  const walkSeconds = Math.max(8, Math.hypot(initial.x - lightSwitch.x, initial.y - lightSwitch.y) / 2);
  const fadeStart = 50 + walkSeconds, tourStart = fadeStart + 4;
  assert.deepEqual(xy(eveAt(data, 50).staff), xy(initial));
  for (let i = 0; i <= (120 - 49) * 20; i++) {
    const seconds = 49 + i / 20, state = eveAt(data, seconds);
    assert.equal(state.lights, 1);
    assert.ok(state.staff);
    if (seconds >= 50 && seconds < fadeStart) {
      const fraction = (seconds - 50) / walkSeconds;
      near(state.staff.x, initial.x + (lightSwitch.x - initial.x) * fraction);
      near(state.staff.y, initial.y + (lightSwitch.y - initial.y) * fraction);
    }
  }
  assert.deepEqual(xy(eveAt(data, fadeStart).staff), lightSwitch);
  assert.match(eveAt(data, tourStart - .001).action, /back on/);
  assert.match(eveAt(data, tourStart).action, /circulating/);
  const dwell = caretakerTour(data, eveRoom).dwell[0] * GATHERING_DWELL_FACTOR;
  assert.deepEqual(xy(eveAt(data, tourStart + dwell - .001).staff), lightSwitch);
  assert.notDeepEqual(xy(eveAt(data, tourStart + dwell + 1).staff), lightSwitch);
  eveFixtures.push({ data, start: 49, end: 120 });
});

const checkMidFadeReopen = (render, arrival, level) => {
  near(level, .5, .0002);
  const initial = render(arrival);
  assert.deepEqual(xy(initial.staff), initial.lightSwitch, 'mid-fade arrival is already at the switch: no return walk');
  near(initial.lights, level);
  for (let i = 0; i <= 80; i++) {
    const elapsed = i / 20, state = render(arrival + elapsed);
    assert.ok(state.lights >= level - 1e-7, 'reopening cannot lower the interrupted level');
    near(state.lights, level + (1 - level) * elapsed / 4);
    assert.deepEqual(xy(state.staff), state.lightSwitch);
    assert.match(state.action, elapsed < 4 ? /back on/ : /circulating/);
  }
  assert.equal(render(arrival + 4).lights, 1, 'unchanged four-second fade after the zero-length switch walk');
  for (let i = 81; i <= 400; i++) assert.equal(render(arrival + i / 20).lights, 1);
};

test('round 2 gate 3: D5 mid-fade interruption preserves light level and four-second timing in the eve and event', () => {
  const closed = receive(round2Snapshot(100, false), receive(round2Snapshot(-600, true)));
  const arrival = Math.round((closingFade(closed.timeline, 100) + 2) * 1000) / 1000;
  const data = receive(round2Snapshot(arrival + .3, true, [practiceMove(arrival)]), closed).timeline;
  checkMidFadeReopen(seconds => eveAt(data, seconds), arrival, eveAt(closed.timeline, arrival).lights);
  eveFixtures.push({ data, start: 99, end: arrival + 20 });
  const event = timeline([person([0, 2])]);
  const eventArrival = switchTime(event, 3600) + 2;
  const reopened = timeline([person([0, 2]), person([0, 8], { here: eventArrival / 1800, leaving: null })]);
  checkMidFadeReopen(seconds => at(reopened, seconds), eventArrival, at(event, eventArrival).lights);
});

test('round 2 gate 4: a completed pre-eve meal preserves the tour across E and the fixed close timings', () => {
  const moves = [practiceMove(-2400, 'food')];
  const first = receive(round2Snapshot(-2399.7, true, moves));
  const data = receive(round2Snapshot(-600, false, moves), first).timeline;
  assert.ok(practiceKitchenServices(data, eveRoom)[0].backEnd < eveStart - 600);
  for (let i = 0; i < (48 + 5) * 20; i++) {
    const seconds = -5 + i / 20, state = eveAt(data, seconds);
    assert.match(state.action, /circulating/);
    near(state.staff.x, eveAt(first.timeline, seconds).staff.x);
    near(state.staff.y, eveAt(first.timeline, seconds).staff.y);
  }
  assert.match(eveAt(data, 48).action, /switching off/);
  assert.equal(eveAt(data, 56).lights, 1);
  near(eveAt(data, 58).lights, .5);
  assert.equal(eveAt(data, 60).lights, 0);
  for (const seconds of [62, 70, 3600]) dark(eveAt(data, seconds));
  eveFixtures.push({ data, start: -5, end: 70 });
});

test('round 2 gate 5: a service running at E requests immediate D5 cleanup and closes without teleporting', () => {
  const moves = [practiceMove(-120, 'food')];
  const first = receive(round2Snapshot(-120, true, moves));
  const empty = receive(round2Snapshot(-1, false, moves), first), data = empty.timeline;
  const [service] = practiceKitchenServices(data, eveRoom);
  assert.ok(service.readyTime < eveStart);
  assert.equal(service.cleanupRequested, eveStart);
  assert.equal(service.emptied, true);
  assert.ok(service.cleanupStart >= eveStart && service.cleanupStart < eveStart + 30);
  assert.equal(eveAt(data, 0).foodCount, 6);
  assert.deepEqual(eveAt(data, -2), eveAt(first.timeline, -2));
  assert.deepEqual(xy(eveAt(data, 0).staff), xy(eveAt(first.timeline, 0).staff));
  assert.match(eveAt(data, service.cleanupStart - eveStart).action, /clearing/);
  assert.match(eveAt(data, service.backEnd - eveStart).action, /switching off/);
  near(eveAt(data, service.backEnd - eveStart + 2).lights, .5);
  const end = service.backEnd - eveStart + 6;
  for (const reduced of [false, true]) dark(eveAt(data, end + .001, reduced));
  eveFixtures.push({ data, start: -5, end: end + 1 });
});

test('gates 11 and 12: eve fixtures stay continuous at 0.05 seconds through dark load, openings and closes', () => {
  for (const { data, start, end } of eveFixtures) {
    // E3 keeps the old fixed eight-second walk to the switch, whatever its length.
    const walkFrom = eveAt(data, 48);
    const fixedWalk = /switching off/.test(walkFrom.action) && walkFrom.staff
      ? Math.hypot(walkFrom.lightSwitch.x - walkFrom.staff.x, walkFrom.lightSwitch.y - walkFrom.staff.y) / 8 : 0;
    let previous = eveAt(data, start);
    for (let seconds = start + .05; seconds <= end; seconds += .05) {
      const current = eveAt(data, seconds);
      assert.ok(current.lights >= 0 && current.lights <= 1);
      assert.ok(Math.abs(current.lights - previous.lights) <= .05 / 4 + 1e-6,
        `light step ${current.lights - previous.lights} at E+${seconds}`);
      if (previous.staff && current.staff) {
        const step = Math.hypot(current.staff.x - previous.staff.x, current.staff.y - previous.staff.y);
        const speed = seconds > 48 && seconds <= 56 + .05 ? Math.max(3.4, fixedWalk) : 3.4;
        assert.ok(step <= speed * .05 + 2e-6, `step ${step} at E+${seconds}`);
      } else if (Boolean(previous.staff) !== Boolean(current.staff)) {
        const staff = current.staff ?? previous.staff;
        assert.ok(Math.hypot(staff.x - eveRoom.doorPosition.x, staff.y - eveRoom.doorPosition.y) <= 3.4 * .05 + 2e-6);
      }
      if (!current.staff) dark(current);
      previous = current;
    }
  }
});

test('gate 2: a move before E published after E keeps the hall lit, including reduced motion', () => {
  const first = receive(snapshot(-100, false));
  const opened = receive(snapshot(1, true, [practiceMove(-1)]), first);
  for (const seconds of [0, 48, 60, 62, 3600]) {
    for (const reduced of [false, true]) {
      const state = eveAt(opened.timeline, seconds, reduced);
      assert.equal(state.lights, 1);
      assert.equal(state.occupied, true);
      assert.match(state.action, /circulating/);
      assert.ok(state.staff);
    }
  }
});
