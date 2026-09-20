import test from 'node:test';
import assert from 'node:assert/strict';
import { EVE_EXIT_SECONDS, EVE_MS, GATHERING_DWELL_FACTOR, caretakerTour, createRoomLayout, gatheringAmbience, hallAmbience } from '../model.mjs';
const layout=createRoomLayout([]);
const person=(planned, actual={here:null,leaving:null})=>({presence:{planned,actual}});
const timeline=people=>({event:{slots:8,slot_minutes:30},people});
const at=(data,seconds,reduced=false)=>hallAmbience(data,seconds/1800,layout,reduced);

test('staff switch lights on, place food, and remain on duty without adding attendees',()=>{
  const data=timeline([person([0,8])]);
  const before=structuredClone(data);
  assert.equal(at(data,0).lights,0);
  assert.equal(at(data,7).lights,1);
  assert.equal(at(data,15).foodCount,0);
  assert.equal(at(data,35).foodCount,3);
  assert.equal(at(data,55).foodCount,6);
  assert.equal(at(data,120).lights,1);
  assert.notDeepEqual(at(data,100).staff,at(data,105).staff);
  assert.deepEqual(data,before);
});
test('only the last attendee leaving triggers closing; actual attendance wins over plans',()=>{
  const data=timeline([person([0,4]),person([0,8],{here:0,leaving:5})]);
  assert.equal(at(data,4*1800+20).lights,1);
  const closing=at(data,5*1800+9);
  assert.ok(closing.lights>0&&closing.lights<1);
  assert.match(closing.action,/switching off/);
  assert.equal(at(data,5*1800+12).lights,0);
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
  assert.equal(hallAmbience(data,8,layout).lights,0);
  assert.equal(at(data,0,true).foodCount,6);
  assert.equal(at(data,0,true).lights,1);
  assert.deepEqual(at(data,100,true).staff,at(data,105,true).staff);
});
test('after closing the caretaker walks from the switch out through the door and is gone',()=>{
  const data=timeline([person([0,4])]);
  const departure=4*1800;
  const {lightSwitch}=at(data,0);
  const closing=at(data,departure+9);
  assert.equal(closing.lights,.75);
  assert.ok(Math.hypot(closing.staff.x-lightSwitch.x,closing.staff.y-lightSwitch.y)<1e-9,'at the switch while the lights fade');
  const leaving=at(data,departure+13);
  assert.equal(leaving.lights,0);
  assert.match(leaving.action,/heading home/);
  assert.ok(leaving.staff.y>lightSwitch.y&&leaving.staff.y<layout.doorPosition.y,'between the switch and the door');
  assert.ok(leaving.staff.x<lightSwitch.x&&leaving.staff.x>=layout.doorPosition.x);
  for (const seconds of [departure+14,departure+60,8*1800]) {
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
  const quick=timeline([person([0,2]),{presence:{planned:[0,8],actual:{here:2+13/1800,leaving:null}}}]);
  const midway=at(quick,2*1800+13);
  const outbound=at(timeline([person([0,2])]),2*1800+13).staff;
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
  const foodY=layout.food.y+layout.food.h-1.2, loungeY=layout.lounge.y+2, stairsX=layout.stage.x-.8;
  const walkable=({x,y})=>near(x,layout.trunkX)
    ||layout.aisles.some(aisle=>near(y,aisle)&&x>=layout.trunkX-1e-6&&x<=stairsX+1e-6)
    ||(near(y,foodY)&&x>=layout.food.x+1.5-1e-6&&x<=layout.food.x+layout.food.w-2.5+1e-6)
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
  const positions=[300,900,2400].map(seconds=>at(data,seconds).staff);
  assert.deepEqual([300,900,2400].map(seconds=>at(data,seconds).staff),positions);
  const reloaded={...structuredClone(data)};
  assert.deepEqual([300,900,2400].map(seconds=>at(reloaded,seconds).staff),positions);
  assert.deepEqual(caretakerTour(reloaded,layout).stops,caretakerTour(data,layout).stops);
  const other={...timeline([person([0,8])]),event:{slots:8,slot_minutes:30,start:'2027-03-14T18:00:00-04:00'}};
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
  assert.equal(gatheringAmbience(auckland,layout,eve+3600e3).action,'The hall is dark. Doors open Sunday at 4:00 AM.','the caption uses the event time zone');
});
