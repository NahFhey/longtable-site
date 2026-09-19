import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateTimeline, ordinaryLocation, resolveLocation, createRoomLayout } from '../model.mjs';
const sample=JSON.parse(await readFile(new URL('../data/timeline.sample.json', import.meta.url),'utf8'));
function fixture() {
  const data=structuredClone(sample);
  data.schema=6;
  const person=data.people.find(p=>!p.dm);
  person.presence={planned:[0,data.event.slots],actual:{here:null,leaving:null}};
  data.visitors={open:true,people:[person.id]};
  data.events=[];
  return {data, person};
}
test('visitors use the food, hall and lounge while actual game assignments take priority',()=>{
  const {data,person}=fixture();
  const originalLayout=createRoomLayout(data.tables,data.room_layout);
  for(const table of data.tables) table.signups=table.signups.filter(s=>s.person!==person.id);
  const timeline=validateTimeline(data);
  const seen=new Set();
  for(let minutes=0;minutes<16;minutes+=4) {
    const slot=minutes/data.event.slot_minutes;
    const result=ordinaryLocation(timeline,person,slot);
    seen.add(result.kind);
    assert.deepEqual(result,ordinaryLocation(validateTimeline(structuredClone(data)),person,slot));
  }
  assert.deepEqual(seen,new Set(['lounge','food','visiting']));
  const table=data.tables[0];
  table.signups.push({person:person.id,planned:[table.start,table.end],actual:null});
  // Other attendees may fill the sample table; remove them for this isolated assignment.
  table.signups=table.signups.filter(s=>s.person===person.id);
  const booked=validateTimeline(data);
  assert.equal(ordinaryLocation(booked,person,table.start).kind,'table');
  assert.notEqual(ordinaryLocation(booked,person,table.end).kind,'table');
  assert.equal(ordinaryLocation(booked,person,data.event.slots).kind,'absent');
  assert.equal(resolveLocation(booked,person,table.start,{meal:{id:'meal'}}).kind,'food');
  assert.equal(createRoomLayout(data.tables,data.room_layout).width,originalLayout.width);
});
test('visitor roster requires valid unique references and preserves old schemas',()=>{
  const {data,person}=fixture();
  for(const people of [[person.id,person.id],['missing'],[null]]) {
    const bad=structuredClone(data);bad.visitors.people=people;
    assert.throws(()=>validateTimeline(bad));
  }
  const old=structuredClone(sample);old.schema=5;
  assert.deepEqual(validateTimeline(old).visitors,{open:true,people:[]});
  person.hidden=true;person.name=null;person.variant=null;person.appearance=null;
  assert.equal(validateTimeline(data).people.find(p=>p.id===person.id).name,null);
});
