import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomLayout, hallAmbience } from '../model.mjs';
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
  assert.ok(at(data,6*1800).staff);
  assert.equal(at(data,6*1800).occupied,false);
});
test('staff reopen for a later arrival and keep an empty event dark after setup',()=>{
  const data=timeline([person([0,2]),person([4,8])]);
  assert.equal(at(data,3*1800).lights,0);
  assert.match(at(data,4*1800+5).action,/back on/);
  assert.equal(at(data,4*1800+12).lights,1);
  const empty=timeline([]);
  assert.equal(at(empty,100).lights,0);
  assert.ok(at(empty,100).staff);
  assert.notDeepEqual(at(empty,100).staff,at(empty,105).staff);
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
