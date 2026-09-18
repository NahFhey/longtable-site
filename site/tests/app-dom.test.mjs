import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class FakeNode {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContentWrites = 0;
    this._textContent = "";
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.max = "";
    this.parentElement = null;
  }
  get textContent() { return this._textContent; }
  set textContent(value) { this._textContent = String(value); this.textContentWrites += 1; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  insertBefore(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(kind, listener) { this.listeners.set(kind, listener); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 480 }; }
}

function allText(node) {
  return [node.textContent, ...node.children.map(allText)].join(" ");
}

function installDom(dataSequence, search = "?sample=1", options = {}) {
  const ids = ["event-name", "record-note", "mode-badge", "clock", "scene-event", "current-event", "play", "speed", "status", "hall", "canvas-description", "tooltip", "scrubber", "start-label", "now-marker", "end-label", "detail", "tables", "updated", "hall-explorer", "event-actions", "zoom-in", "zoom-out", "recenter", "fit-active", "hall-content", "hall-layout", "table-list"];
  const nodes = new Map(ids.map((id) => [id, new FakeNode(id === "hall" ? "canvas" : "div")]));
  const contextCalls = [];
  const imageCalls = [];
  const transforms = [];
  const context = new Proxy({
    setTransform(...args) { transforms.push(args); },
    measureText(value) { return { width: String(value).length * 5 }; },
    fillText(value) { contextCalls.push(String(value)); },
    drawImage(image, ...args) { imageCalls.push({ src: image._src, args }); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
  const scene = new FakeNode("div");
  nodes.get("hall").parentElement = scene;
  nodes.get("hall").width = 960;
  nodes.get("hall").height = 480;
  nodes.get("hall").getContext = () => { if (options.contextThrows) throw new Error("Canvas disabled"); return options.noContext ? null : context; };
  nodes.get("hall").setPointerCapture = () => {};

  globalThis.document = {
    title: "",
    getElementById(id) { return nodes.get(id); },
    createElement(tag) { return new FakeNode(tag); },
  };
  globalThis.location = { search };
  globalThis.matchMedia = (query) => ({ matches: query.includes("650") ? !!options.mobile : !!options.reducedMotion, addEventListener() {} });
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.Image = class {
    addEventListener(kind, listener) { if (kind === (options.assetsFailed ? "error" : "load")) queueMicrotask(listener); }
    set src(value) { this._src = value; }
  };
  let fetchIndex = 0;
  globalThis.fetch = async () => {
    const item = dataSequence[Math.min(fetchIndex++, dataSequence.length - 1)];
    if (item instanceof Error) throw item;
    return { ok: true, async json() { return structuredClone(item); } };
  };
  return { nodes, frames, contextCalls, imageCalls, transforms };
}

async function runApp(dataSequence, label, options = {}) {
  const harness = installDom(dataSequence, options.search ?? "?sample=1", options);
  const errors = [];
  const originalError = console.error;
  console.error = (...values) => errors.push(values.join(" "));
  try {
    await import(`../app.mjs?dom-test=${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const frame = harness.frames.shift();
    harness.imageCalls.length = 0;
    if (frame) frame(performance.now() + 20);
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    console.error = originalError;
  }
  return { ...harness, errors };
}

function stressTimeline(base) {
  const data = structuredClone(base);
  const additions = [];
  for (let index = 0; data.people.length + additions.length < 150; index += 1) {
    additions.push({
      id: `stress-person-${index}`, name: `Stress Person ${index}`, dm: index < 18, hidden: false,
      variant: (index * 2654435761) >>> 0, presence: { planned: [0, data.event.slots], actual: { here: null, leaving: null } },
    });
  }
  data.people.push(...additions);
  const players = additions.slice(18);
  let cursor = 0;
  while (data.tables.length < 30) {
    const index = data.tables.length - 12;
    const count = index === 0 ? 17 : Math.min(5, players.length - cursor);
    const assigned = players.slice(cursor, cursor + count);
    cursor += count;
    data.tables.push({
      id: `stress-table-${index}`, name: `Stress Table ${index}`, system: "Stress system", pitch: "Temporary rendering fixture.",
      seats: Math.max(index === 0 ? 18 : 6, count), walk_ins: index % 2 === 0, start: 0, end: data.event.slots,
      dm: additions[index].id, created_at: data.event.start,
      signups: assigned.map((person) => ({ person: person.id, planned: [0, data.event.slots], actual: null })),
    });
  }
  return data;
}

test("the sample boots as 12 tables, 44 contract people, 14 events without console errors", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  assert.equal(sample.tables.length, 12);
  assert.equal(sample.people.length, 44);
  assert.equal(sample.events.length, 14);
  assert.deepEqual(new Set(sample.events.map((event) => event.kind)), new Set(["break", "meal", "announce", "spotlight", "shout", "donation"]));
  const app = await runApp([sample], "sample");
  assert.equal(app.errors.length, 0);
  assert.equal(app.nodes.get("event-name").textContent, sample.event.name);
  assert.equal(app.nodes.get("tables").children[0].children.length, 12);
  assert.match(allText(app.nodes.get("tables")), /someone/);
});

test("a final phase produces the conspicuous final-record note", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.phase = "final";
  const app = await runApp([sample], "final");
  assert.equal(app.nodes.get("record-note").hidden, false);
});

test("schema 3 draws the chosen layers and keeps hats exclusive to DMs", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.schema = 3;
  sample.people = [{
    id: "custom-player", name: "Custom player", hidden: false, dm: false, variant: 0,
    appearance: { skin: 3, shirt: 14, hair: 15, hat: 2 },
    presence: { planned: [0, sample.event.slots], actual: { here: null, leaving: null } },
  }];
  sample.tables = [];
  sample.events = [];
  const coordinates = (app) => app.imageCalls
    .filter(({ src }) => src.includes("roguelikeChar"))
    .map(({ args }) => args.slice(0, 2));
  const player = await runApp([sample], "custom-character");
  assert.equal(player.errors.length, 0);
  assert.deepEqual(coordinates(player), [[0, 51], [238, 153], [323, 34]]);
  sample.people[0].dm = true;
  const dm = await runApp([sample], "custom-dm");
  assert.deepEqual(coordinates(dm), [[0, 51], [238, 153], [323, 34], [510, 136]]);
});

test("an unknown schema fails visibly instead of leaving a blank canvas", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.schema = 4;
  const app = await runApp([sample], "bad-schema");
  assert.match(app.nodes.get("status").textContent, /unsupported schema/i);
  assert.equal(app.nodes.get("status").className, "status error");
  assert.ok(app.contextCalls.includes("The hall is unavailable."));
});

test("a bad live refresh retains the last good rendered table list", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = new Date(Date.now() - 30 * 60_000);
  const offset = -start.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  sample.event.start = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}T${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}:00${sign}${hh}:${mm}`;
  sample.generated_at = new Date(Date.now() - 10_000).toISOString();
  const bad = structuredClone(sample);
  bad.schema = 4;
  bad.generated_at = new Date().toISOString();
  const app = await runApp([sample, bad], "refresh-retention");
  const before = allText(app.nodes.get("tables"));
  const nextFrame = app.frames.shift();
  nextFrame?.(performance.now() + 61_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(allText(app.nodes.get("tables")), before);
  assert.match(app.nodes.get("status").textContent, /last good snapshot/i);
});

test("a temporary 30-table/150-person fixture renders including overflow seats", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const stress = stressTimeline(sample);
  assert.equal(stress.tables.length, 30);
  assert.equal(stress.people.length, 150);
  const app = await runApp([stress], "stress");
  assert.equal(app.errors.length, 0);
  assert.equal(app.nodes.get("tables").children[0].children.length, 30);
});

test("canvas event content has a stable, literal, privacy-safe live-region equivalent", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const announce = structuredClone(sample.events.find((item) => item.kind === "announce"));
  const spotlight = structuredClone(sample.events.find((item) => item.kind === "spotlight"));
  const hiddenSpeech = structuredClone(sample.events.find((item) => (item.kind === "shout" || item.kind === "donation")
    && sample.people.find((person) => person.id === item.person)?.hidden));
  announce.at = 0;
  announce.text = "<script>literal announcement</script>";
  spotlight.at = 0;
  spotlight.person = sample.people.find((person) => person.hidden).id;
  spotlight.text = "literal spotlight reason";
  hiddenSpeech.at = 0;
  hiddenSpeech.text = "<img onerror=literal>";
  sample.events = [announce, spotlight, hiddenSpeech];

  const app = await runApp([sample], "event-live-region");
  const region = app.nodes.get("current-event");
  assert.match(region.textContent, /Announcement: <script>literal announcement<\/script>/);
  assert.match(region.textContent, /Spotlight: someone\. literal spotlight reason/);
  assert.match(region.textContent, /(?:Reaction|Table message) from someone: <img onerror=literal>/);
  assert.doesNotMatch(region.textContent, new RegExp(hiddenSpeech.person));
  const writes = region.textContentWrites;
  app.frames.shift()?.(performance.now() + 50);
  assert.equal(region.textContentWrites, writes, "an unchanged event must not rewrite the live region each frame");
});

test("forward scrubbing serializes every crossed speech, while backward scrubbing clears it", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const speaker = sample.people.find((person) => !person.hidden);
  const by = sample.people.find((person) => person.dm);
  sample.events = [0, 1, 2].map((at, index) => ({
    id: `scrub-speech-${index}`,
    kind: "shout",
    at,
    duration: null,
    text: `Speech ${index}`,
    person: speaker.id,
    by: by.id,
  }));
  const app = await runApp([sample], "scrub-speech");
  const region = app.nodes.get("current-event");
  assert.match(region.textContent, /Speech 0/, "slot-zero speech should start with replay playback");

  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "2" } });
  app.frames.shift()?.(performance.now() + 5_000);
  assert.match(region.textContent, /Speech 1/);
  app.frames.shift()?.(performance.now() + 10_000);
  assert.match(region.textContent, /Speech 2/);

  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "0.5" } });
  app.frames.shift()?.(performance.now() + 10_100);
  assert.equal(region.textContent, "");
});

for (const options of [{ noContext: true }, { contextThrows: true }]) {
  test(`the list and selection work when canvas ${options.noContext ? "returns null" : "throws"}`, async () => {
    const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
    const app = await runApp([sample], `no-canvas-${Object.keys(options)[0]}`, options);
    assert.equal(app.errors.length, 0);
    assert.equal(app.nodes.get("tables").children[0].children.length, 12);
    const button = app.nodes.get("tables").children[0].children[0].children[0].children[0];
    button.listeners.get("click")();
    assert.match(allText(app.nodes.get("detail")), new RegExp(sample.tables[0].name));
    assert.match(app.nodes.get("status").textContent, /use the table list/);
  });
}

test("mobile begins paused with a collapsed hall and visible details in the main reading order", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "mobile", { mobile: true });
  assert.equal(app.nodes.get("hall-explorer").open, false);
  assert.equal(app.nodes.get("play").textContent, "Play");
  assert.equal(app.nodes.get("detail").parentElement, app.nodes.get("hall-content"));
  assert.equal(app.nodes.get("table-list").parentElement, app.nodes.get("hall-content"));
});

test("one relevant game is selected automatically, while two are framed without a selected game", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  sample.tables = sample.tables.slice(0, 2).map((table) => ({ ...table, start: 0, end: sample.event.slots, signups: [] }));
  const two = await runApp([sample], "two-tables");
  assert.match(allText(two.nodes.get("detail")), /Select a table/);
  sample.tables = sample.tables.slice(0, 1);
  const one = await runApp([sample], "one-table");
  assert.equal(one.nodes.get("detail").children[0].textContent, sample.tables[0].name);
});

test("a captured drag suppresses table clicks; a fresh tap selects with transformed coordinates", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  sample.tables = sample.tables.slice(0, 2).map((table) => ({ ...table, start: 0, end: sample.event.slots, signups: [] }));
  const app = await runApp([sample], "drag-tap");
  const events = app.nodes.get("hall").listeners;
  events.get("pointerdown")({ pointerId: 1, clientX: 600, clientY: 240, button: 0 });
  events.get("pointermove")({ pointerId: 1, clientX: 650, clientY: 240 });
  events.get("pointerup")({ pointerId: 1 });
  events.get("click")({ clientX: 650, clientY: 240 });
  assert.match(allText(app.nodes.get("detail")), /Select a table/);
  app.nodes.get("fit-active").listeners.get("click")();
  events.get("pointerdown")({ pointerId: 2, clientX: 680, clientY: 240, button: 0 });
  events.get("pointerup")({ pointerId: 2 });
  events.get("click")({ clientX: 680, clientY: 240 });
  assert.equal(app.nodes.get("detail").children[0].textContent, sample.tables[1].name);
});

test("production renders matching event actions and sample mode never displays real event links", async () => {
  const production = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  production.event.name = "Longtable";
  production.event.start = "2026-09-17T13:00:00-04:00";
  const app = await runApp([production], "configured-actions", { search: "" });
  const actions = app.nodes.get("event-actions");
  assert.equal(actions.children[0].href, "https://discord.gg/k6GYjek53");
  assert.equal(actions.children[1].children[1].children[0].src, "./assets/events/discord-k6GYjek53-qr.png");
  const sample = await runApp([production], "sample-actions");
  assert.equal(sample.nodes.get("event-actions").children.length, 0);
});

test("wheel, pinch, and keyboard navigation change the camera and survive time changes", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "camera-controls");
  const events = app.nodes.get("hall").listeners;
  const nextFrame = () => {
    app.transforms.length = 0;
    app.frames.shift()?.(performance.now() + 30);
    return app.transforms[1];
  };
  const before = nextFrame();
  let prevented = false;
  events.get("wheel")({ clientX: 480, clientY: 240, deltaY: -180, deltaMode: 0, preventDefault() { prevented = true; } });
  const zoomed = nextFrame();
  assert.ok(prevented);
  assert.ok(zoomed[0] > before[0]);
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "15" } });
  assert.deepEqual(nextFrame(), zoomed, "changing relevant games must not reset a manually moved camera");
  events.get("pointerdown")({ pointerId: 1, clientX: 400, clientY: 240, button: 0 });
  events.get("pointerdown")({ pointerId: 2, clientX: 500, clientY: 240, button: 0 });
  events.get("pointermove")({ pointerId: 2, clientX: 550, clientY: 240 });
  const pinched = nextFrame();
  assert.ok(pinched[0] > zoomed[0]);
  events.get("pointercancel")({ pointerId: 1 });
  events.get("pointercancel")({ pointerId: 2 });
  events.get("keydown")({ key: "Home", preventDefault() {} });
  const home = nextFrame();
  assert.ok(home[0] < pinched[0]);
  events.get("keydown")({ key: "+", preventDefault() {} });
  assert.ok(nextFrame()[0] > home[0]);
});

test("failed sprite assets retain simplified rendering and the table list", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "asset-failure", { assetsFailed: true });
  assert.equal(app.errors.length, 0);
  assert.equal(app.nodes.get("tables").children[0].children.length, 12);
  assert.match(app.nodes.get("status").textContent, /simplified graphics/);
  assert.ok(app.contextCalls.some((text) => text.includes("seats left")));
});
