import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { activeEvents, isPresent, ordinaryLocation, resolveLocation, speechView, validateTimeline } from "../model.mjs";

const sample = validateTimeline(JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8")));
const byId = new Map(sample.people.map((person) => [person.id, person]));

test("sample late-arrival override and active table boundaries resolve", () => {
  const mara = byId.get("u_mara");
  assert.equal(isPresent(mara, .399, sample.event.slots), false);
  assert.equal(isPresent(mara, .4, sample.event.slots), true);
  assert.equal(ordinaryLocation(sample, mara, 2).seat, 0);
  assert.equal(ordinaryLocation(sample, mara, 10).kind, "lounge");
});

test("sample break, meal, announce, and spotlight scenes activate", () => {
  assert.ok(activeEvents(sample, .9).announce);
  assert.ok(activeEvents(sample, 8.1).break);
  assert.ok(activeEvents(sample, 16.1).meal);
  const spotlight = activeEvents(sample, 20.3);
  assert.ok(spotlight.spotlight);
  assert.equal(resolveLocation(sample, byId.get("u_esme"), 20.3, spotlight).kind, "spotlight");
});

test("sample visible and hidden speech uses current location or a safe stage-side label", () => {
  const speeches = sample.events.filter((event) => event.kind === "shout" || event.kind === "donation");
  const hiddenSpeech = speeches.find((event) => byId.get(event.person).hidden);
  const visibleShout = speeches.find((event) => event.kind === "shout" && !byId.get(event.person).hidden);
  const donation = speeches.find((event) => event.kind === "donation" && !byId.get(event.person).hidden);
  assert.ok(hiddenSpeech && visibleShout && donation);
  const hiddenView = speechView(sample, hiddenSpeech, hiddenSpeech.at);
  assert.equal(hiddenView.speaker, "someone");
  assert.doesNotMatch(JSON.stringify({ speaker: hiddenView.speaker, label: hiddenView.label }), new RegExp(hiddenSpeech.person));
  assert.equal(speechView(sample, visibleShout, visibleShout.at).kind, "shout");
  assert.equal(speechView(sample, donation, donation.at).kind, "donation");
});

test("overnight lull and replay end remain sensible", () => {
  const overnight = sample.people.filter((person) => isPresent(person, 34, sample.event.slots));
  assert.ok(overnight.length > 0 && overnight.length < sample.people.length / 2);
  const atEnd = sample.people.filter((person) => isPresent(person, sample.event.slots, sample.event.slots));
  assert.equal(atEnd.length, 0);
});
