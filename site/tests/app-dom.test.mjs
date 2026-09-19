import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRoomLayout } from "../model.mjs";
import { stageQueuePosition } from "../stage.mjs";

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
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 480 }; }
}

function allText(node) {
  return [node.textContent, ...node.children.map(allText)].join(" ");
}

function installDom(dataSequence, search = "?sample=1", options = {}) {
  const ids = ["activity-note", "activity-log", "activity-empty", "activity-more", "backup-feed", "live-feed", "sync-controls", "sync-status", "refresh-now", "event-name", "record-note", "mode-badge", "clock", "scene-event", "current-event", "play", "return-now", "speed", "status", "hall", "canvas-description", "tooltip", "scrubber", "start-label", "now-marker", "end-label", "detail", "tables", "updated", "hall-explorer", "event-actions", "zoom-in", "zoom-out", "recenter", "fit-active", "hall-content", "hall-layout", "table-list"];
  const nodes = new Map(ids.map((id) => [id, new FakeNode(id === "hall" ? "canvas" : "div")]));
  if (options.liveFeed) nodes.get("live-feed").setAttribute("content", options.liveFeed);
  if (options.backupFeed) nodes.get("backup-feed").setAttribute("content", options.backupFeed);
  const contextCalls = [];
  const imageCalls = [];
  const rectCalls = [];
  const transforms = [];
  const context = new Proxy({
    setTransform(...args) { transforms.push(args); },
    measureText(value) { return { width: String(value).length * 5 }; },
    fillText(value) { contextCalls.push(String(value)); },
    fillRect(...args) { rectCalls.push({ color: this.fillStyle, args }); },
    drawImage(image, ...args) { imageCalls.push({ src: image._src, args }); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
  const scene = new FakeNode("div");
  nodes.get("hall").parentElement = scene;
  nodes.get("hall").width = 960;
  nodes.get("hall").height = 480;
  nodes.get("hall").getContext = () => { if (options.contextThrows) throw new Error("Canvas disabled"); return options.noContext ? null : context; };
  nodes.get("hall").setPointerCapture = () => {};

  const documentListeners = new Map();
  globalThis.document = {
    visibilityState: "visible",
    addEventListener(kind, listener) { documentListeners.set(kind, listener); },
    documentElement: { dataset: { source: options.archive ? "archive" : "live" } },
    title: "",
    getElementById(id) { return nodes.get(id); },
    createElement(tag) { return new FakeNode(tag); },
  };
  const urlWrites = [];
  globalThis.location = new URL(`https://longtable.test/${options.archive ? "project/events/0123456789abcdef0123456789abcdef/" : ""}${search}`);
  globalThis.history = { replaceState(_state, _title, url) { urlWrites.push(url); globalThis.location = new URL(url); } };
  globalThis.matchMedia = (query) => ({ matches: query.includes("650") ? !!options.mobile : !!options.reducedMotion, addEventListener() {} });
  const intervals = [];
  globalThis.setInterval = callback => { intervals.push(callback); return intervals.length; };
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.Image = class {
    addEventListener(kind, listener) { if (kind === (options.assetsFailed ? "error" : "load")) queueMicrotask(listener); }
    set src(value) { this._src = value; }
  };
  let fetchIndex = 0;
  const fetchUrls = [];
  globalThis.fetch = async (url) => {
    fetchUrls.push(new URL(url, location.href).href);
    const item = dataSequence[Math.min(fetchIndex++, dataSequence.length - 1)];
    if (item instanceof Error) throw item;
    return { ok: true, async json() { return structuredClone(item); } };
  };
  return { nodes, frames, intervals, documentListeners, contextCalls, imageCalls, rectCalls, transforms, urlWrites, fetchUrls };
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
    harness.rectCalls.length = 0;
    if (frame) frame(performance.now() + 20);
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    console.error = originalError;
  }
  return { ...harness, errors };
}

function stressTimeline(base) {
  const data = structuredClone(base);
  data.room_layout.pad_capacity = 30;
  const additions = [];
  for (let index = 0; data.people.length + additions.length < 150; index += 1) {
    additions.push({
      id: `stress-person-${index}`, name: `Stress Person ${index}`, dm: index < 18, hidden: false,
      variant: (index * 2654435761) >>> 0, appearance: null, presence: { planned: [0, data.event.slots], actual: { here: null, leaving: null } },
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
      pad: data.tables.length, id: `stress-table-${index}`, name: `Stress Table ${index}`, system: "Stress system", pitch: "Temporary rendering fixture.",
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
  sample.schema = 8;
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
  bad.schema = 8;
  bad.generated_at = new Date().toISOString();
  const app = await runApp([sample, bad], "refresh-retention", { search: "" });
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

test("seeking in either direction clears transient speeches without replaying a backlog", async () => {
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
  assert.equal(region.textContent, "");
  app.frames.shift()?.(performance.now() + 10_000);
  assert.equal(region.textContent, "");

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
  assert.ok(app.contextCalls.some((text) => text.includes("Scheduled")));
});

test("schema 4 live deletion and fresh load draw retained tables at the same world coordinates", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 30 * 60_000).toISOString().replace("Z", "+00:00");
  data.generated_at = new Date(Date.now() - 10_000).toISOString();
  data.tables = data.tables.map((table) => ({ ...table, start: 0, end: data.event.slots }));
  const next = structuredClone(data);
  next.generated_at = new Date().toISOString();
  next.tables.splice(0, 1);
  const tableOrigins = (app) => app.imageCalls.filter((call) =>
    call.src.endsWith("roguelikeSheet_transparent.png") && call.args[0] === 23 * 17 && call.args[1] === 4 * 17 && call.args[5] >= 10 * 32
  ).map((call) => call.args.slice(4, 6));
  const app = await runApp([data, next], "stable-pad-refresh", { search: "" });
  const before = tableOrigins(app);
  assert.equal(before.length, 12);
  app.frames.shift()?.(performance.now() + 61_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.imageCalls.length = 0;
  app.frames.shift()?.(performance.now() + 61_020);
  const after = tableOrigins(app);
  assert.deepEqual(after, before.slice(1));
  const reload = await runApp([next], "stable-pad-reload", { search: "" });
  assert.deepEqual(tableOrigins(reload), after);
});

test("pad collisions in a refresh keep the last good hall and table list", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 30 * 60_000).toISOString().replace("Z", "+00:00");
  data.generated_at = new Date(Date.now() - 10_000).toISOString();
  const broken = structuredClone(data);
  broken.generated_at = new Date().toISOString();
  broken.tables[1].pad = broken.tables[0].pad;
  const app = await runApp([data, broken], "duplicate-pad-refresh", { search: "" });
  const before = allText(app.nodes.get("tables"));
  app.frames.shift()?.(performance.now() + 61_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(allText(app.nodes.get("tables")), before);
  assert.match(app.nodes.get("status").textContent, /duplicate table pad.*last good snapshot/i);
});

test("live rewind stays paused through refresh, replays independently, and returns to now without queued speech", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 4 * 30 * 60_000).toISOString().replace("Z", "+00:00");
  data.generated_at = new Date(Date.now() - 10_000).toISOString();
  data.events = [];
  const next = structuredClone(data);
  next.generated_at = new Date().toISOString();
  next.tables[0].name = "Refreshed game";
  next.events.push({ id: "new-reaction", kind: "shout", at: 4, duration: null, text: "No rewind backlog", person: data.people[0].id, by: data.people[0].id });
  const app = await runApp([data, next], "live-rewind", { search: "" });
  assert.equal(app.nodes.get("mode-badge").textContent, "LIVE");
  assert.equal(app.nodes.get("scrubber").disabled, false);
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "1.5" } });
  app.frames.shift()?.(performance.now() + 61_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.frames.shift()?.(performance.now() + 61_020);
  assert.equal(app.nodes.get("scrubber").value, "1.5");
  assert.equal(app.nodes.get("mode-badge").textContent, "PAUSED");
  assert.match(allText(app.nodes.get("tables")), /Refreshed game/);
  assert.equal(app.nodes.get("return-now").hidden, false);
  assert.equal(app.nodes.get("current-event").textContent, "");
  assert.equal(new URL(app.urlWrites.at(-1)).searchParams.get("at"), "1.5");
  app.nodes.get("play").listeners.get("click")();
  app.frames.shift()?.(performance.now() + 61_040);
  assert.equal(app.nodes.get("mode-badge").textContent, "REPLAY");
  assert.ok(Number(app.nodes.get("scrubber").value) > 1.5 && Number(app.nodes.get("scrubber").value) < 2);
  app.nodes.get("return-now").listeners.get("click")();
  app.frames.shift()?.(performance.now() + 61_060);
  assert.equal(app.nodes.get("mode-badge").textContent, "LIVE");
  assert.ok(Number(app.nodes.get("scrubber").value) >= 4);
  assert.equal(app.nodes.get("current-event").textContent, "");
  assert.equal(new URL(app.urlWrites.at(-1)).searchParams.has("at"), false);
});

test("staff scenery renders identically after seeking and reload without changing roster counts", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.tables = [{ ...data.tables[0], start: 2, end: 4, signups: [] }];
  data.events = [];
  const staff = (app) => app.rectCalls.filter((call) => call.color === "#73afb5");
  for (const slot of [1.4, 1.55, 4.2, 4.29]) {
    const seek = await runApp([data], `staff-seek-${slot}`, { mobile: true });
    const roster = allText(seek.nodes.get("tables"));
    seek.nodes.get("scrubber").listeners.get("input")({ target: { value: String(slot) } });
    seek.rectCalls.length = 0;
    seek.frames.shift()?.(performance.now() + 100);
    const expected = staff(seek);
    assert.equal(expected.length, 4, "table staff and the hall caretaker each have a cap and uniform");
    assert.match(allText(seek.nodes.get("tables")), /0\/5/);
    assert.doesNotMatch(roster, /STAFF/);
    const fresh = await runApp([data], `staff-load-${slot}`, { search: `?sample=1&at=${slot}` });
    assert.deepEqual(staff(fresh), expected);
    const reduced = await runApp([data], `staff-reduced-${slot}`, { search: `?sample=1&at=${slot}`, reducedMotion: true });
    assert.equal(staff(reduced).length, 2, "the stationary caretaker remains visible with reduced motion");
  }
});

test("lifecycle scenery and accessible status match direct seek, fresh load and reduced motion", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.tables = [{ ...data.tables[0], start: 2, end: 4, signups: [] }];
  data.events = [];
  data.people.forEach((person) => { person.presence = { planned: null, actual: { here: null, leaving: null } }; });
  const scenery = (app) => ({
    tables: app.imageCalls.filter((call) => call.src.endsWith("roguelikeSheet_transparent.png") && call.args[0] === 23 * 17 && call.args[1] === 4 * 17 && call.args[5] >= 10 * 32).map((call) => call.args.slice(4, 6)),
    maps: app.rectCalls.filter((call) => call.color === "#eee0b9").map((call) => call.args),
  });
  for (const [slot, phase, furniture, props] of [[0, "Scheduled", false, false], [1.5, "Preparing", true, false], [1.9, "Ready", true, true], [3, "Playing", true, true], [4.1, "Packing up", true, false], [4.5, "Inactive", false, false]]) {
    const seek = await runApp([data], `lifecycle-seek-${slot}`, { mobile: true });
    seek.nodes.get("tables").children[0].children[0].children[0].children[0].listeners.get("click")();
    seek.nodes.get("scrubber").listeners.get("input")({ target: { value: String(slot) } });
    seek.imageCalls.length = 0;
    seek.rectCalls.length = 0;
    seek.frames.shift()?.(performance.now() + 100);
    assert.match(allText(seek.nodes.get("tables")), new RegExp(`At selected time: ${phase}`));
    assert.match(allText(seek.nodes.get("detail")), new RegExp(`At selected time: ${phase}`));
    const expected = scenery(seek);
    assert.equal(expected.tables.length > 0, furniture);
    assert.equal(expected.maps.length > 0, props);
    const fresh = await runApp([data], `lifecycle-fresh-${slot}`, { search: `?sample=1&at=${slot}`, reducedMotion: true });
    // Match the explicit focus used above so props have the same level of detail.
    fresh.nodes.get("tables").children[0].children[0].children[0].children[0].listeners.get("click")();
    fresh.imageCalls.length = 0;
    fresh.rectCalls.length = 0;
    fresh.frames.shift()?.(performance.now() + 100);
    assert.deepEqual(scenery(fresh), expected);
    assert.equal(fresh.nodes.get("scrubber").value, String(slot));
    assert.equal(fresh.nodes.get("play").textContent, "Play");
  }
});

test("sequential replay and reload at the resulting slot paint the same lifecycle props", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.slot_minutes = 1;
  data.tables = [{ ...data.tables[0], start: 2, end: 4, signups: [] }];
  data.events = [];
  data.people.forEach((person) => { person.presence = { planned: null, actual: { here: null, leaving: null } }; });
  const app = await runApp([data], "sequential-lifecycle", { search: "?sample=1&at=1" });
  const button = app.nodes.get("tables").children[0].children[0].children[0].children[0];
  button.listeners.get("click")();
  app.nodes.get("speed").listeners.get("change")({ target: { value: "120" } });
  app.nodes.get("play").listeners.get("click")();
  const baseline = performance.now() + 1_000;
  const seen = new Set();
  let capture;
  for (let frame = 0; frame < 19; frame += 1) {
    app.imageCalls.length = 0;
    app.rectCalls.length = 0;
    app.frames.shift()?.(baseline + frame * 100);
    seen.add(app.nodes.get("detail").children.find((node) => node.className === "table-phase")?.textContent.replace("At selected time: ", "") || "");
    const slot = Number(app.nodes.get("scrubber").value);
    if (slot > 2 && slot < 2.4) capture = { slot, map: app.rectCalls.filter((call) => call.color === "#eee0b9") };
  }
  assert.ok(seen.has("Preparing"));
  assert.ok(seen.has("Ready"));
  assert.ok(seen.has("Playing"));
  assert.ok(seen.has("Packing up"));
  assert.ok(seen.has("Inactive"));
  assert.ok(capture.map.length > 0);
  const fresh = await runApp([data], "sequential-lifecycle-reload", { search: `?sample=1&at=${capture.slot}` });
  assert.deepEqual(fresh.rectCalls.filter((call) => call.color === "#eee0b9"), capture.map);
  assert.equal(Number(fresh.nodes.get("scrubber").value), capture.slot);
});

test("finalization stops live following and polling without resetting the selected time", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 2 * 30 * 60_000).toISOString().replace("Z", "+00:00");
  data.generated_at = new Date(Date.now() - 10_000).toISOString();
  const final = structuredClone(data);
  final.generated_at = new Date().toISOString();
  final.phase = "final";
  const app = await runApp([data, final, new Error("Must not poll final data")], "final-clock", { search: "" });
  app.frames.shift()?.(performance.now() + 61_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.frames.shift()?.(performance.now() + 61_020);
  assert.equal(app.nodes.get("mode-badge").textContent, "PAUSED");
  assert.ok(Number(app.nodes.get("scrubber").value) >= 2);
  const selected = app.nodes.get("scrubber").value;
  assert.equal(app.nodes.get("return-now").hidden, true);
  assert.equal(app.nodes.get("record-note").hidden, false);
  app.frames.shift()?.(performance.now() + 122_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.nodes.get("scrubber").value, selected);
  assert.doesNotMatch(app.nodes.get("status").textContent, /Update failed/);
});

test("a boundary timestamp survives URL serialization and a disabled History API leaves replay usable", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const slot = data.tables[0].start - 1 / 6;
  const app = await runApp([data], "exact-timestamp", { mobile: true });
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: String(slot) } });
  app.nodes.get("scrubber").listeners.get("change")();
  const written = new URL(app.urlWrites.at(-1)).searchParams.get("at");
  assert.equal(Number(written), slot);
  globalThis.history.replaceState = () => { throw new Error("Disabled"); };
  assert.doesNotThrow(() => app.nodes.get("play").listeners.get("click")());
  app.frames.shift()?.(performance.now() + 100);
  assert.equal(app.nodes.get("mode-badge").textContent, "REPLAY");
});

test("nested archives pause despite live dates, ignore sample flags, and never poll", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 30 * 60_000).toISOString().replace("Z", "+00:00");
  const app = await runApp([data, new Error("Archive must not refresh")], "archive-entry", { archive: true, search: "?sample=1&at=3.5" });
  assert.equal(app.nodes.get("mode-badge").textContent, "PAUSED");
  assert.equal(app.nodes.get("scrubber").value, "3.5");
  assert.equal(app.nodes.get("return-now").hidden, true);
  assert.equal(app.nodes.get("event-actions").children.length, 0);
  assert.match(app.nodes.get("record-note").textContent, /Archived event replay/);
  assert.doesNotMatch(allText(app.nodes.get("tables")), /Sign up using Join/);
  app.frames.shift()?.(performance.now() + 61_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(app.fetchUrls, ["https://longtable.test/project/events/0123456789abcdef0123456789abcdef/timeline.json"]);
  assert.equal(app.nodes.get("scrubber").value, "3.5");
  app.nodes.get("play").listeners.get("click")();
  app.frames.shift()?.(performance.now() + 61_100);
  assert.equal(app.nodes.get("mode-badge").textContent, "REPLAY");
});

test("an unavailable archive fails visibly without falling back to live or sample data", async () => {
  const app = await runApp([new Error("Missing archive")], "archive-missing", { archive: true, search: "?sample=1" });
  assert.match(app.nodes.get("status").textContent, /could not be loaded/);
  assert.deepEqual(app.fetchUrls, ["https://longtable.test/project/events/0123456789abcdef0123456789abcdef/timeline.json"]);
});

test("recorded dice stay accessible without canvas and reconstruct on seek/reload", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.schema = 5;
  const table = data.tables[0];
  data.events = [{ id: "roll-test", kind: "roll", at: table.start + .125, duration: null,
    text: null, person: table.dm, by: table.dm, table: table.id, visibility: "public",
    roll: { expression: "2d6+3", sides: 6, faces: [3, 4], modifier: 3, total: 10 } }];
  const slot = data.events[0].at + 1.5 / (data.event.slot_minutes * 60);
  const app = await runApp([data], "dice-seek", { search: `?sample=1&at=${slot}` });
  assert.match(allText(app.nodes.get("tables")), /2d6\+3: \[3, 4\] \+3 = 10/);
  const diceRects = (value) => value.rectCalls.filter((call) => call.color === "#f7efd8");
  assert.equal(diceRects(app).length, 2);
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: String(table.start) } });
  app.rectCalls.length = 0;
  app.frames.shift()?.(performance.now() + 100);
  assert.equal(diceRects(app).length, 0);
  assert.doesNotMatch(allText(app.nodes.get("tables")), /2d6/);
  const reload = await runApp([data], "dice-reload", { search: `?sample=1&at=${slot}`, noContext: true });
  assert.match(allText(reload.nodes.get("tables")), /2d6\+3: \[3, 4\] \+3 = 10/);
  assert.deepEqual(reload.errors, []);
  const privateData = structuredClone(data);
  privateData.events[0].visibility = "private";
  privateData.events[0].roll.expression = "PRIVATE SECRET";
  const rejected = await runApp([privateData], "private-dice-rejected");
  assert.doesNotMatch(allText(rejected.nodes.get("tables")), /PRIVATE SECRET/);
  assert.doesNotMatch(rejected.errors.join(" "), /PRIVATE SECRET/);
});

test('schema 6 visitor roster precedes games and week labels show dates without canvas', async () => {
  const data = JSON.parse(await readFile(new URL('../data/timeline.sample.json', import.meta.url), 'utf8'));
  data.schema = 6;
  data.event.slots = 336;
  const visitor = data.people.find(person => !person.dm);
  visitor.hidden = true; visitor.name = null; visitor.variant = null; visitor.appearance = null;
  data.visitors = { open: true, people: [visitor.id] };
  const app = await runApp([data], 'visitors-no-canvas', { noContext: true });
  const text = allText(app.nodes.get('tables'));
  assert.ok(text.indexOf('Visitors Table') < text.indexOf(data.tables[0].name));
  assert.match(text, /someone/);
  assert.match(app.nodes.get('start-label').textContent, /Nov/);
  assert.notEqual(app.nodes.get('start-label').textContent, app.nodes.get('end-label').textContent);
});

function customStageFixture(sample, count = 3) {
  sample.events = Array.from({ length: count }, (_, index) => ({
    id: `stage-message-${index}`, kind: "donation", at: 0, duration: null,
    text: `Stage message ${index}`, person: sample.people[index % 2].id,
    by: sample.people.find((person) => person.dm).id,
  }));
  sample.people[1].hidden = true;
  sample.people[1].name = null;
  sample.people[1].variant = null;
  return sample;
}

function stageStepper(app) {
  let now = performance.now() + 100;
  return (milliseconds = 100) => {
    now += milliseconds;
    app.imageCalls.length = 0;
    app.rectCalls.length = 0;
    app.contextCalls.length = 0;
    app.frames.shift()?.(now);
    return app.nodes.get("current-event").textContent;
  };
}

test("custom speakers walk to the mic, queue once per person, speak in order, and leave between messages", async () => {
  const sample = customStageFixture(JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8")));
  const app = await runApp([sample], "stage-walking");
  app.nodes.get("speed").listeners.get("change")({ target: { value: "1" } });
  assert.match(app.nodes.get("current-event").textContent, /walking to the stage microphone/);
  assert.match(app.nodes.get("current-event").textContent, /1 waiting to speak/);
  assert.doesNotMatch(app.nodes.get("current-event").textContent, /Stage message 0/);
  const step = stageStepper(app);
  const spoken = [];
  let firstStarted = null;
  let firstEnded = null;
  let secondStarted = null;
  for (let frame = 0; frame < 1200; frame += 1) {
    const text = step();
    const match = text.match(/Stage message (\d)/);
    if (match && spoken.at(-1) !== Number(match[1])) spoken.push(Number(match[1]));
    if (text.includes("Stage message 0") && firstStarted === null) firstStarted = frame;
    if (firstStarted !== null && !text.includes("Stage message 0") && firstEnded === null) firstEnded = frame;
    if (text.includes("Stage message 1") && secondStarted === null) {
      secondStarted = frame;
      assert.match(text, /Table message from someone/);
      assert.doesNotMatch(text, new RegExp(sample.people[1].id));
    }
    if (spoken.length === 3 && !match && !text.includes("walking")) break;
  }
  assert.deepEqual(spoken, [0, 1, 2]);
  assert.ok(firstStarted > 1, "travel must take time");
  assert.equal(firstEnded - firstStarted, 60, "all six seconds are available after arrival");
  assert.ok(secondStarted - firstEnded > 2, "the first speaker must walk down before the next speaks");
});

test("reduced motion retains every custom message in a burst and seeking clears the stage queue", async () => {
  const sample = customStageFixture(JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8")), 25);
  const app = await runApp([sample], "stage-reduced-motion", { reducedMotion: true });
  app.nodes.get("play").listeners.get("click")();
  app.nodes.get("speed").listeners.get("change")({ target: { value: "1" } });
  const step = stageStepper(app);
  assert.match(step(), /Stage message 0/);
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const waiting = stageQueuePosition(layout, 0, 1);
  assert.ok(app.imageCalls.some(({ src, args }) => src.includes("roguelikeChar")
    && args[4] === Math.round((waiting.x - .5) * 32) && args[5] === Math.round((waiting.y - .6) * 32)),
  "the waiting character is actually drawn below the stairs");
  assert.ok(app.imageCalls.some(({ src, args }) => src.includes("roguelikeChar")
    && args[4] === Math.round((layout.stageFront.x - .5) * 32) && args[5] === Math.round((layout.stageFront.y - .6) * 32)),
  "the speaking character is actually drawn at the microphone");
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "0.5" } });
  assert.equal(step(), "", "seeking clears the active message and the entire waiting queue");
  assert.equal(step(10000), "");
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "0" } });
  app.nodes.get("play").listeners.get("click")();
  assert.match(step(), /Stage message 0/);
  for (let index = 1; index < 25; index += 1) {
    assert.doesNotMatch(step(6001), /Stage message \d/, "leave the microphone between speakers");
    assert.match(step(), new RegExp(`Stage message ${index}(?:$|\\s)`));
  }
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "0.5" } });
  assert.equal(step(), "");
  assert.equal(step(10000), "");
});

test("new live custom messages use the stage queue without teleporting on refresh", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.event.start = new Date(Date.now() - 60 * 60_000).toISOString().replace("Z", "+00:00");
  sample.phase = "live";
  sample.events = [];
  const updated = customStageFixture(structuredClone(sample), 2);
  updated.generated_at = new Date(Date.parse(sample.generated_at) + 1000).toISOString();
  const app = await runApp([sample, updated], "stage-live", { search: "" });
  assert.equal(app.nodes.get("mode-badge").textContent, "LIVE");
  const step = stageStepper(app);
  step(60001);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const text = step();
  assert.match(text, /walking to the stage microphone/);
  assert.match(text, /1 waiting to speak/);
  assert.doesNotMatch(text, /Stage message 0/);
});


test("live data bypasses deployment, refreshes after two seconds, and reports the check", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.generated_at = new Date(Date.now() - 10_000).toISOString();
  const next = structuredClone(data);
  next.generated_at = new Date().toISOString();
  next.tables[0].name = "Just changed in Discord";
  const app = await runApp([data, next], "direct-live-feed", { search: "", liveFeed: "https://feed.example/timeline.json" });
  assert.equal(new URL(app.fetchUrls[0]).hostname, "feed.example");
  assert.ok(new URL(app.fetchUrls[0]).searchParams.has("check"));
  assert.equal(app.fetchUrls.length, 1);
  app.frames.shift()(performance.now() + 2_100);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.fetchUrls.length, 2);
  assert.notEqual(app.fetchUrls[0], app.fetchUrls[1]);
  assert.match(allText(app.nodes.get("tables")), /Just changed in Discord/);
  assert.match(app.nodes.get("sync-status").textContent, /Checked at.*every 2 seconds/);
});

test("feed failure falls back visibly without replacing a newer view, then recovers manually", async () => {
  const old = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  old.generated_at = new Date(Date.now() - 10_000).toISOString();
  const newer = structuredClone(old);
  newer.generated_at = new Date().toISOString();
  newer.tables[0].name = "Latest table";
  const app = await runApp([newer, new Error("offline"), old, newer], "feed-fallback", { search: "", liveFeed: "https://feed.example/timeline.json" });
  app.nodes.get("refresh-now").listeners.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(app.nodes.get("sync-status").textContent, /Live feed delayed/);
  assert.equal(new URL(app.fetchUrls[2]).pathname, "/data/timeline.json");
  assert.match(allText(app.nodes.get("tables")), /Latest table/);
  app.nodes.get("refresh-now").listeners.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(app.nodes.get("sync-status").textContent, /Checked at/);
});

test("archive and sample never contact the configured live feed", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  for (const archive of [false, true]) {
    const app = await runApp([data], `isolated-feed-${archive}`, { archive, liveFeed: "https://feed.example/timeline.json" });
    app.nodes.get("refresh-now").listeners.get("click")();
    app.frames.shift()(performance.now() + 61_000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(app.fetchUrls.length, 1);
    assert.equal(new URL(app.fetchUrls[0]).hostname, "longtable.test");
    assert.equal(app.nodes.get("sync-controls").hidden, true);
  }
});


test("the timestamped activity log follows replay and paginates older public changes", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 4 * 30 * 60_000).toISOString().replace("Z", "+00:00");
  data.generated_at = new Date().toISOString();
  data.events = [];
  data.activity = Array.from({ length: 105 }, (_, index) => ({
    id: index.toString(16).padStart(32, "0"), action: "edit_table", actor: data.people[0].id,
    table: data.tables[0].id, person: null,
    at: new Date(Date.parse(data.event.start) + 30 * 60_000 + index * 1000).toISOString(),
  }));
  data.tables[0].name = "<script>literal text</script>";
  const app = await runApp([data], "activity-log", { search: "" });
  const log = app.nodes.get("activity-log");
  assert.equal(log.children.length, 100);
  assert.equal(log.children[0].children[0].dateTime, data.activity[104].at);
  assert.match(allText(log), /<script>literal text<\/script>/);
  assert.equal(log.children[0].children[1].tagName, "SPAN");
  app.nodes.get("activity-more").listeners.get("click")();
  assert.equal(log.children.length, 105);
  assert.equal(app.nodes.get("activity-more").hidden, true);
  app.nodes.get("scrubber").value = "0.5";
  app.nodes.get("scrubber").listeners.get("input")({ target: app.nodes.get("scrubber") });
  app.frames.shift()(performance.now() + 30);
  assert.equal(log.children.length, 0);
  assert.equal(app.nodes.get("activity-empty").hidden, false);
  app.nodes.get("return-now").listeners.get("click")();
  app.frames.shift()(performance.now() + 40);
  assert.equal(log.children.length, 105);
});

test("manual and automatic checks share one bounded request", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([data], "one-refresh", { search: "" });
  let calls = 0, resolveFetch, signal;
  globalThis.fetch = (_url, options) => {
    calls += 1; signal = options.signal;
    return new Promise(resolve => { resolveFetch = resolve; });
  };
  app.nodes.get("refresh-now").listeners.get("click")();
  app.nodes.get("refresh-now").listeners.get("click")();
  app.frames.shift()(performance.now() + 6_000);
  assert.equal(calls, 1);
  assert.ok(signal instanceof AbortSignal);
  assert.equal(app.nodes.get("refresh-now").disabled, true);
  resolveFetch({ ok: true, json: async () => structuredClone(data) });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.nodes.get("refresh-now").disabled, false);
});


test("failed live service compares backup snapshots instead of trusting a stale raw response", async () => {
  const old = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  old.generated_at = new Date(Date.now() - 180_000).toISOString();
  const current = structuredClone(old);
  current.generated_at = new Date().toISOString();
  current.tables[0].name = "Action from seconds ago";
  const app = await runApp([old, new Error("offline"), current, old], "valid-stale-feed", {
    search: "", liveFeed: "https://feed.example/timeline.json", backupFeed: "https://feed.example/timeline.json",
  });
  app.nodes.get("refresh-now").listeners.get("click")();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(allText(app.nodes.get("tables")), /Action from seconds ago/);
  assert.match(app.nodes.get("sync-status").textContent, /Live feed delayed.*Data published at/);
});


test("returning to a visible page catches up without animation frames", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.generated_at = new Date(Date.now() - 10000).toISOString();
  const next = structuredClone(data);
  next.generated_at = new Date().toISOString();
  next.tables[0].name = "Updated while hidden";
  const app = await runApp([data, next], "visible-live-catchup", { search: "", liveFeed: "https://feed.example/timeline.json" });
  assert.ok(app.intervals.length >= 1);
  document.hidden = true;
  app.documentListeners.get("visibilitychange")();
  assert.equal(app.fetchUrls.length, 1);
  document.hidden = false;
  app.documentListeners.get("visibilitychange")();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.fetchUrls.length, 2);
  assert.match(allText(app.nodes.get("tables")), /Updated while hidden/);
});
