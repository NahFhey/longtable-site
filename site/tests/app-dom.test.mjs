import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRoomLayout, foodGeometry, gatheringLocations, jukeboxBounds, loungeActivities, seatPositionForPlan, wallFixtures } from "../model.mjs";
import { practiceKitchenServices, practicePlaces } from "../model.mjs";
import { queueSpot } from "../food-layout.mjs";
import { stageQueuePosition } from "../stage.mjs";
import { fitBounds, worldToScreen } from "../camera.mjs";
import { DISCORD_INVITE, WALL_PLAQUES } from "../event-config.mjs";

class FakeNode {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = { setProperty(name, value) { this[name] = String(value); } };
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

const lineOf = (node, className) => node.children.find((child) => child.className === className)?.textContent;
/** One entry per table card: [phase line, dice line]. */
const cardLines = (tables) => tables.children[0].children.map((article) => [lineOf(article, "table-phase"), lineOf(article, "dice-result")]);

function installDom(dataSequence, search = "?sample=1", options = {}) {
  const ids = ["hall-sidebar", "attendees", "attendees-heading", "activity-panel", "activity-note", "activity-log", "activity-empty", "activity-more", "backup-feed", "live-feed", "sync-controls", "sync-status", "refresh-now", "event-name", "record-note", "mode-badge", "clock", "scene-event", "current-event", "play", "return-now", "speed", "status", "hall", "canvas-description", "tooltip", "scrubber", "start-label", "now-marker", "end-label", "detail", "tables", "updated", "hall-explorer", "event-actions", "zoom-in", "zoom-out", "recenter", "fit-active", "hall-content", "hall-layout", "table-list", "fundraising-total", "kiosk-link", "camera-controls", "camera-help", "timeline-controls"];
  const nodes = new Map(ids.map((id) => [id, new FakeNode(id === "hall" ? "canvas" : "div")]));
  nodes.get("fundraising-total").hidden = true;
  nodes.get("hall-sidebar").append(nodes.get("detail"), nodes.get("activity-panel"));
  nodes.get("activity-panel").append(nodes.get("activity-log"));
  if (options.liveFeed) nodes.get("live-feed").setAttribute("content", options.liveFeed);
  if (options.backupFeed) nodes.get("backup-feed").setAttribute("content", options.backupFeed);
  const contextCalls = [];
  const textCalls = [];
  const imageCalls = [];
  const rectCalls = [];
  const transforms = [];
  // Each drawTile save scope records its own flip; outer body motion must not
  // change assertions about the sprite's underlying hall position.
  const scopes = [{}];
  const context = new Proxy({
    setTransform(...args) { transforms.push(args); },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    measureText(value) { return { width: String(value).length * 5 }; },
    fillText(value, x, y) { contextCalls.push(String(value)); textCalls.push({ text: String(value), x, y }); },
    fillRect(...args) { rectCalls.push({ color: this.fillStyle, args }); },
    save() { scopes.push({}); },
    restore() { if (scopes.length > 1) scopes.pop(); },
    translate(x, y) { scopes.at(-1).translation = [x, y]; },
    scale(x, y) { scopes.at(-1).flip = x === -1 && y === 1; },
    drawImage(image, ...args) {
      const local = scopes.at(-1), logicalArgs = [...args];
      if (local.flip && local.translation) {
        logicalArgs[4] = local.translation[0] - args[6];
        logicalArgs[5] = local.translation[1];
      }
      imageCalls.push({ src: image._src, args, logicalArgs });
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
  const scene = new FakeNode("div");
  scene.append(nodes.get("camera-controls"), nodes.get("camera-help"), nodes.get("timeline-controls"));
  nodes.get("hall").parentElement = scene;
  nodes.get("hall").width = 960;
  nodes.get("hall").height = 480;
  nodes.get("hall").getContext = () => { if (options.contextThrows) throw new Error("Canvas disabled"); return options.noContext ? null : context; };
  nodes.get("hall").setPointerCapture = () => {};
  // The jukebox player is optional in the harness: without it setupHallMusic returns null and clicks are no-ops.
  if (options.music) {
    for (const id of ["music-panel", "hall-music", "music-track", "music-toggle", "music-next", "music-close", "music-volume", "music-volume-value", "music-status"]) {
      nodes.set(id, new FakeNode(id === "hall-music" ? "audio" : "div"));
    }
    const panel = nodes.get("music-panel");
    panel.hidden = true;
    panel.parentElement = scene;
    panel.offsetWidth = 224;
    panel.offsetHeight = 160;
    Object.assign(nodes.get("hall-music"), { paused: true, plays: 0, load() {}, pause() { this.paused = true; },
      play() { this.plays += 1; this.paused = false; return Promise.resolve(); } });
  }

  const documentListeners = new Map();
  globalThis.document = {
    visibilityState: options.hidden ? "hidden" : "visible",
    // Several modules listen for the same event; the map keeps one callable per kind that runs them all in order.
    addEventListener(kind, listener) {
      const previous = documentListeners.get(kind);
      documentListeners.set(kind, previous ? (event) => { previous(event); listener(event); } : listener);
    },
    documentElement: { dataset: { source: options.archive ? "archive" : "live" } },
    title: "",
    getElementById(id) { return nodes.get(id); },
    createElement(tag) { return new FakeNode(tag); },
  };
  const wakeLockRequests = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: options.wakeLock ? { wakeLock: {
    async request(kind) { wakeLockRequests.push(kind); if (options.wakeLock === "rejects") throw new Error("NotAllowedError"); return { release() {} }; },
  } } : {} });
  const urlWrites = [];
  globalThis.location = new URL(`https://longtable.test/${options.archive ? "project/events/0123456789abcdef0123456789abcdef/" : ""}${search}`);
  globalThis.history = { replaceState(_state, _title, url) { urlWrites.push(url); globalThis.location = new URL(url); } };
  globalThis.matchMedia = (query) => ({ matches: query.includes("650") ? !!options.mobile : !!options.reducedMotion, addEventListener() {} });
  const intervals = [];
  globalThis.setInterval = callback => { intervals.push(callback); return intervals.length; };
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  // Listeners are attached before `src`; the outcome is decided per URL once the source is known.
  const imageRequests = [];
  globalThis.Image = class {
    constructor() { this.imageListeners = new Map(); }
    addEventListener(kind, listener) { this.imageListeners.set(kind, listener); }
    set src(value) {
      this._src = value;
      imageRequests.push(value);
      const fails = options.assetsFailed || (options.plaquesFail && /-qr\.png$/.test(value));
      queueMicrotask(() => this.imageListeners.get(fails ? "error" : "load")?.());
    }
  };
  let fetchIndex = 0;
  const fetchUrls = [];
  const teamFetches = [];
  globalThis.fetch = async (url, init) => {
    const href = new URL(url, location.href).href;
    // The Extra Life team total has its own stub so it never consumes a timeline from the sequence.
    if (href.startsWith("https://dd.extra-life.org/")) {
      teamFetches.push({ href, init });
      if (options.team instanceof Error) throw options.team;
      return { ok: true, async json() { return structuredClone(options.team ?? { teamID: 74917, sumDonations: 20, fundraisingGoal: 2500 }); } };
    }
    fetchUrls.push(href);
    const item = dataSequence[Math.min(fetchIndex++, dataSequence.length - 1)];
    if (item instanceof Error) throw item;
    return { ok: true, async json() { return structuredClone(item); } };
  };
  return { nodes, frames, intervals, documentListeners, contextCalls, textCalls, imageCalls, imageRequests, rectCalls, transforms, urlWrites, fetchUrls, teamFetches, wakeLockRequests };
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
  const hasLayers = (app, layers) => coordinates(app).some((_, i, drawn) =>
    JSON.stringify(drawn.slice(i, i + layers.length)) === JSON.stringify(layers));
  assert.ok(hasLayers(player, [[0, 51], [238, 153], [323, 34]]), "chosen player layers survive furniture/staff depth sorting");
  assert.ok(!coordinates(player).some(([x]) => x >= 27 * 17 && x <= 31 * 17), "a player never draws a hat");
  assert.equal(coordinates(player).length, 6, "player and caretaker each draw three layers");
  sample.people[0].dm = true;
  const dm = await runApp([sample], "custom-dm");
  assert.ok(hasLayers(dm, [[0, 51], [238, 153], [323, 34], [510, 136]]), "the DM uses the chosen layers including the hat");
  assert.equal(coordinates(dm).length, 7, "only the DM adds a hat layer");
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
  // The desktop view takes the hall's shape: thirty tables make six rows, so the view is taller than it is wide.
  const layout = createRoomLayout(stress.tables, stress.room_layout);
  assert.equal(layout.tableRows, 6);
  assert.equal(app.nodes.get("hall").style["--hall-aspect"], `${layout.width} / ${layout.height - layout.backWall.y}`);
  assert.ok(layout.height - layout.backWall.y > layout.width);
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

test("mobile begins paused with the hall open, camera buttons in the scene, and help, details and tables below it in reading order", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "mobile", { mobile: true });
  assert.equal(app.nodes.get("hall-explorer").open, true, "phones hide the summary, so the hall is always open");
  assert.deepEqual(app.nodes.get("hall-content").children.map((node) => [...app.nodes].find(([, value]) => value === node)?.[0]),
    ["camera-help", "timeline-controls", "hall-sidebar", "table-list"]);
  assert.equal(app.nodes.get("camera-controls").parentElement, app.nodes.get("hall").parentElement, "phones lay the camera buttons over the canvas");
  assert.equal(app.nodes.get("play").textContent, "Play");
  assert.equal(app.nodes.get("hall-sidebar").parentElement, app.nodes.get("hall-content"));
  assert.equal(app.nodes.get("detail").parentElement, app.nodes.get("hall-sidebar"));
  assert.equal(app.nodes.get("activity-panel").parentElement, app.nodes.get("hall-sidebar"));
  assert.equal(app.nodes.get("table-list").parentElement, app.nodes.get("hall-content"));
});

test("desktop keeps the camera tools and timeline inside the scene with the hall open", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "desktop-arrangement");
  const scene = app.nodes.get("hall").parentElement;
  for (const id of ["camera-controls", "camera-help", "timeline-controls"]) assert.equal(app.nodes.get(id).parentElement, scene, id);
  assert.equal(app.nodes.get("hall-explorer").open, true);
  assert.equal(app.nodes.get("hall-sidebar").parentElement, app.nodes.get("hall-layout"));
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

test("one click selects without zooming, a second click deselects, and a double click zooms", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  sample.tables = sample.tables.slice(0, 2).map((table) => ({ ...table, start: 0, end: sample.event.slots, signups: [] }));
  const app = await runApp([sample], "select-zoom");
  const events = app.nodes.get("hall").listeners;
  const nextFrame = () => { app.transforms.length = 0; app.frames.shift()?.(performance.now() + 30); return JSON.stringify(app.transforms[1]); };
  const tap = (x) => { events.get("pointerdown")({ pointerId: 1, clientX: x, clientY: 240, button: 0 }); events.get("pointerup")({ pointerId: 1 }); events.get("click")({ clientX: x, clientY: 240 }); };
  app.nodes.get("fit-active").listeners.get("click")();
  const framed = nextFrame();
  tap(680);
  assert.equal(app.nodes.get("detail").children[0].textContent, sample.tables[1].name);
  assert.equal(nextFrame(), framed, "a single click leaves the camera where it was");
  await new Promise((resolve) => setTimeout(resolve, 450));
  tap(680);
  assert.match(allText(app.nodes.get("detail")), /Select a table/, "clicking the selected table clears it");
  await new Promise((resolve) => setTimeout(resolve, 450));
  tap(680);
  tap(680);
  assert.equal(app.nodes.get("detail").children[0].textContent, sample.tables[1].name);
  assert.notEqual(nextFrame(), framed, "a double click zooms to the table");
});

test("with no game in play the first view shows the whole room, and a game in play frames its tables", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  const frameOf = async (start, label) => {
    const data = { ...sample, tables: sample.tables.slice(0, 2).map((table) => ({ ...table, start, end: sample.event.slots, signups: [] })) };
    const app = await runApp([data], label);
    const nextFrame = () => { app.transforms.length = 0; app.frames.shift()?.(performance.now() + 30); return JSON.stringify(app.transforms[1]); };
    const first = nextFrame();
    app.nodes.get("recenter").listeners.get("click")();
    return { first, room: nextFrame() };
  };
  const waiting = await frameOf(4, "room-before-games");
  assert.equal(waiting.first, waiting.room, "before any game starts the view matches Recenter");
  const playing = await frameOf(0, "room-games-running");
  assert.notEqual(playing.first, playing.room, "a running game is framed closer than the whole room");
});

test("production has one community link and no repeated Discord signup instructions", async () => {
  const production = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  production.event.name = "Longtable";
  production.event.start = "2026-09-19T10:30:00-04:00";
  const app = await runApp([production], "configured-actions", { search: "" });
  const actions = app.nodes.get("event-actions");
  // Discord link and Donate link only: the QR codes hang on the wall plaques, not in the header.
  assert.equal(actions.children.length, 2);
  assert.equal(actions.children[0].href, DISCORD_INVITE);
  assert.equal(actions.children[0].textContent, "Discord");
  assert.equal(actions.children[1].textContent, "Donate");
  assert.ok(actions.children.every((child) => child.tagName === "A"));
  assert.doesNotMatch(allText(actions), /Show QR/);
  assert.doesNotMatch(allText(app.nodes.get("tables")), /Discord|Sign up using Join/);
  const button = app.nodes.get("tables").children[0].children[0].children[0].children[0];
  button.listeners.get("click")();
  assert.doesNotMatch(allText(app.nodes.get("detail")), /Discord|Sign up using Join/);
  const sample = await runApp([production], "sample-actions");
  assert.equal(sample.nodes.get("event-actions").children.length, 0);
});

test("a live page fetches the Extra Life total once at boot and shows the line", async () => {
  const production = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([production], "fundraising-boot", { search: "" });
  assert.equal(app.teamFetches.length, 1);
  assert.equal(app.teamFetches[0].href, "https://dd.extra-life.org/api/teams/74917");
  assert.equal(app.teamFetches[0].init.credentials, "omit");
  const line = app.nodes.get("fundraising-total");
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, "$20 raised of $2,500 · Extra Life");
  // A later timeline refresh reinstalls the timeline without a second setup or fetch.
  app.nodes.get("refresh-now").listeners.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.teamFetches.length, 1);
  // Kiosk mode boots the same way; samples and archives never ask Extra Life.
  const kiosk = await runApp([production], "fundraising-kiosk", { search: "?kiosk=1" });
  assert.equal(kiosk.teamFetches.length, 1);
  assert.equal(kiosk.nodes.get("fundraising-total").textContent, "$20 raised of $2,500 · Extra Life");
  const sample = await runApp([production], "fundraising-sample");
  assert.equal(sample.teamFetches.length, 0);
  assert.equal(sample.nodes.get("fundraising-total").hidden, true);
  const archive = await runApp([production], "fundraising-archive", { search: "", archive: true });
  assert.equal(archive.teamFetches.length, 0);
});

test("a page that boots hidden still fetches the total once, and showing it does not refetch a fresh total", async () => {
  const production = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([production], "fundraising-hidden-boot", { search: "", hidden: true });
  assert.equal(app.teamFetches.length, 1);
  const line = app.nodes.get("fundraising-total");
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, "$20 raised of $2,500 · Extra Life");
  globalThis.document.visibilityState = "visible";
  app.documentListeners.get("visibilitychange")();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.teamFetches.length, 1);
  assert.equal(line.textContent, "$20 raised of $2,500 · Extra Life");
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
  // The selected table's plate still draws in simplified mode.
  app.nodes.get("tables").children[0].children[0].children[0].children[0].listeners.get("click")();
  app.frames.shift()?.(performance.now() + 30);
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

test("each real table stands on a green rug drawn under its furniture, and empty grid spots stay bare", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 30 * 60_000).toISOString().replace("Z", "+00:00");
  data.generated_at = new Date(Date.now() - 10_000).toISOString();
  data.tables = data.tables.slice(0, 2).map((table, index) => ({ ...table, pad: index * 2, start: 0, end: data.event.slots }));
  const app = await runApp([data], "table-rugs", { search: "" });
  assert.equal(app.errors.length, 0);
  const sheet = (call) => call.src.endsWith("roguelikeSheet_transparent.png");
  const isRug = (call) => sheet(call) && [10, 11, 12].includes(call.args[0] / 17) && [16, 17, 18].includes(call.args[1] / 17);
  const isTable = (call) => sheet(call) && [23, 24, 25].includes(call.args[0] / 17) && call.args[1] === 4 * 17;
  const layout = createRoomLayout(data.tables, data.room_layout);
  const rugAt = (spot) => [Math.round((spot.x - .5) * 32), Math.round((spot.y + .5) * 32)];
  const rugCorners = app.imageCalls.filter((call) => isRug(call) && call.args[0] === 10 * 17 && call.args[1] === 16 * 17)
    .map((call) => call.args.slice(4, 6));
  assert.deepEqual(rugCorners, layout.cells.map(rugAt));
  // Six by four tiles per rug, all of them drawn before the first table tile.
  assert.equal(app.imageCalls.filter(isRug).length, 2 * 24);
  const lastRug = app.imageCalls.findLastIndex(isRug);
  const firstTable = app.imageCalls.findIndex(isTable);
  assert.ok(firstTable > lastRug, "tables draw on top of the rugs");
  // Pad 1 sits between the two tables with nothing on it.
  const empty = { x: layout.gridX + layout.cellWidth, y: layout.gridY };
  assert.ok(!layout.cells.some((cell) => cell.x === empty.x && cell.y === empty.y));
  assert.ok(!rugCorners.some(([x, y]) => x === rugAt(empty)[0] && y === rugAt(empty)[1]));
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
  data.people.forEach(person => { person.presence = { planned: null, actual: { here: null, leaving: null } }; });
  const staff = app => app.imageCalls.filter(call => call.src.includes("roguelikeChar"))
    .map(call => ({ src: call.src, args: call.logicalArgs }));
  for (const slot of [1.4, 1.55, 4.2, 4.29]) {
    const seek = await runApp([data], `staff-seek-${slot}`, { mobile: true });
    const roster = allText(seek.nodes.get("tables"));
    seek.nodes.get("scrubber").listeners.get("input")({ target: { value: String(slot) } });
    seek.rectCalls.length = 0;
    seek.imageCalls.length = 0;
    seek.frames.shift()?.(performance.now() + 100);
    const expected = staff(seek);
    assert.equal(expected.length, 3, "the table porter uses three character layers; the caretaker has gone home from a hall nobody entered");
    assert.match(allText(seek.nodes.get("tables")), /0\/5/);
    assert.doesNotMatch(roster, /STAFF/);
    const fresh = await runApp([data], `staff-load-${slot}`, { search: `?sample=1&at=${slot}` });
    assert.deepEqual(staff(fresh), expected);
    const reduced = await runApp([data], `staff-reduced-${slot}`, { search: `?sample=1&at=${slot}`, reducedMotion: true });
    assert.equal(staff(reduced).length, 0, "reduced motion omits the porter, and the caretaker has gone home");
  }
});

test("staff remain visible if character assets fail without adding attendees", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.tables = [];
  data.people = [];
  data.events = [];
  const app = await runApp([data], "staff-fallback", { assetsFailed: true });
  assert.equal(app.rectCalls.filter(call => call.color === "#73afb5").length, 2);
  assert.equal(app.nodes.get("attendees-heading").textContent, "Attendees (0)");
  assert.deepEqual(app.errors, []);
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
    assert.deepEqual(cardLines(seek.nodes.get("tables")), [[phase, ""]], "no roll means no roll notice");
    assert.equal(lineOf(seek.nodes.get("detail"), "table-phase"), phase);
    assert.equal(lineOf(seek.nodes.get("detail"), "dice-result"), "");
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
    seen.add(lineOf(app.nodes.get("detail"), "table-phase") || "");
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

test('all attendees appear once with DM precedence and privacy preserved without canvas', async () => {
  const data = JSON.parse(await readFile(new URL('../data/timeline.sample.json', import.meta.url), 'utf8'));
  data.schema = 6;
  data.event.slots = 336;
  const visitor = data.people.find(person => !person.dm);
  visitor.hidden = true; visitor.name = null; visitor.variant = null; visitor.appearance = null;
  const dm = data.people.find(person => person.dm && !person.hidden);
  const player = data.people.find(person => !person.dm && !person.hidden && data.tables.some(table => table.signups.some(signup => signup.person === person.id)));
  const guest = { ...structuredClone(dm), id: 'guest-only', name: dm.name, dm: false };
  data.people.push(guest);
  data.visitors = { open: true, people: [visitor.id, dm.id, player.id, guest.id] };
  const app = await runApp([data], 'visitors-no-canvas', { noContext: true });
  const attendees = app.nodes.get('attendees');
  assert.equal(attendees.children.length, data.people.length);
  assert.equal(app.nodes.get('attendees-heading').textContent, `Attendees (${data.people.length})`);
  const sameNameRows = attendees.children.filter(row => row.children[0]?.textContent === dm.name);
  assert.equal(sameNameRows.length, 2, 'distinct people sharing a display name remain distinct');
  assert.deepEqual(new Set(sameNameRows.map(row => row.children[1].textContent)), new Set(['DM', 'Visitor']));
  const playerRow = attendees.children.find(row => row.children[0]?.textContent === player.name);
  assert.equal(playerRow.children[1].textContent, 'Player');
  const anonymousRows = attendees.children.filter(row => row.children[0]?.textContent === 'someone');
  assert.ok(anonymousRows.length > 0);
  assert.ok(anonymousRows.every(row => row.children.length === 1), 'anonymous attendees do not expose roles');
  assert.doesNotMatch(allText(attendees), new RegExp(visitor.id));
  assert.doesNotMatch(allText(app.nodes.get('tables')), /Visitors Table/);
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


test("live data bypasses deployment, refreshes after two seconds during the event, and reports the check", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.event.start = new Date(Date.now() - 30 * 60_000).toISOString().replace("Z", "+00:00");
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
  assert.equal(app.nodes.get("hall-sidebar").parentElement, app.nodes.get("hall-layout"));
  assert.equal(app.nodes.get("detail").parentElement, app.nodes.get("hall-sidebar"));
  assert.equal(app.nodes.get("activity-panel").parentElement, app.nodes.get("hall-sidebar"));
  const firstEntry = log.children[0];
  const tableButton = app.nodes.get("tables").children[0].children[0].children[0].children[0];
  tableButton.listeners.get("click")();
  assert.equal(log.children[0], firstEntry, "selecting a table preserves the event log");
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


test("attendee walking follows replay speed and freezes when the event clock is paused", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const table = data.tables[0];
  const person = data.people.find(person => person.id === table.dm);
  data.tables = [{ ...table, start: 1, end: 4, signups: [] }];
  data.people = [{ ...person, movements: [], presence: { planned: [0, data.event.slots], actual: { here: null, leaving: null } } }];
  data.events = [];
  data.visitors = { open: true, people: [] };
  const seat = seatPositionForPlan(createRoomLayout(data.tables, data.room_layout), 0, 0);
  const sprites = app => app.imageCalls.filter(call => call.src.includes("roguelikeChar")).map(call => call.logicalArgs.slice(4));
  for (const speed of [1, 30, 600]) {
    const app = await runApp([data], `walking-speed-${speed}`, { search: "?sample=1&at=0.99999" });
    const step = stageStepper(app);
    app.nodes.get("speed").listeners.get("change")({ target: { value: String(speed) } });
    app.nodes.get("play").listeners.get("click")();
    step(100);
    const atSeat = sprites(app).some(args => args[0] === Math.round((seat.x - .5) * 32)
      && args[1] === Math.round((seat.y - .6) * 32));
    if (speed !== 30) assert.equal(atSeat, speed === 600, `speed ${speed}: fast replay must move the attendee all the way to the table`);
    app.nodes.get("play").listeners.get("click")();
    step(100);
    const paused = sprites(app);
    step(1000);
    assert.deepEqual(sprites(app), paused, `speed ${speed}: pause must stop walking`);
    assert.deepEqual(app.errors, []);
  }
});

test('one door opens before arrivals and departures and closes one second after passage', async () => {
  const data = JSON.parse(await readFile(new URL('../data/timeline.sample.json', import.meta.url), 'utf8'));
  const table = data.tables[0];
  const person = data.people.find(person => person.id === table.dm);
  data.tables = [{ ...table, start: 1, end: 2, signups: [] }];
  data.people = [{ ...person, movements: [], presence: { planned: [1, 2], actual: { here: null, leaving: null } } }];
  data.events = []; data.activity = []; data.visitors = { open: true, people: [] };
  const layout = createRoomLayout(data.tables, data.room_layout);
  const seat = seatPositionForPlan(layout, 0, 0);
  const atSeat = app => app.imageCalls.some(call => call.src.includes('roguelikeChar')
    && call.logicalArgs[4] === Math.round((seat.x - .5) * 32)
    && call.logicalArgs[5] === Math.round((seat.y - .6) * 32));
  const doorState = app => {
    const doors = app.imageCalls.filter(call => call.src.includes('roguelikeSheet')
      && call.args[1] === 0 && [36 * 17, 37 * 17].includes(call.args[0]));
    assert.equal(doors.length, 1, 'only one door sprite is drawn');
    assert.equal(doors[0].args[5], layout.door.y * 32);
    return doors[0].args[0] === 37 * 17 ? 'open' : 'closed';
  };
  for (const [action, slot] of [['arrival', .99999], ['departure', 1.99999]]) {
    const app = await runApp([data], `door-${action}`, { search: `?sample=1&at=${slot}` });
    const step = stageStepper(app);
    assert.equal(doorState(app), 'closed');
    app.nodes.get('play').listeners.get('click')();
    step(100);
    assert.equal(doorState(app), 'open');
    assert.equal(atSeat(app), action === 'departure', 'door opens before the person passes');
    step(100);
    assert.equal(atSeat(app), action === 'departure');
    step(100);
    assert.equal(atSeat(app), action === 'arrival');
    assert.equal(doorState(app), 'open');
    step(999);
    assert.equal(doorState(app), 'open');
    step(1);
    assert.equal(doorState(app), 'closed');
    const scrubber = app.nodes.get('scrubber');
    scrubber.value = String(slot);
    scrubber.listeners.get('input')({ target: scrubber });
    step(100);
    assert.equal(doorState(app), 'closed', 'seeking does not replay a stale passage');
    assert.deepEqual(app.errors, []);
  }
  data.people.push({ ...structuredClone(data.people[0]), id: 'second-arrival',
    presence: { planned: [1, 2], actual: { here: 1.1, leaving: null } } });
  const group = await runApp([data], 'door-group', { search: '?sample=1&at=.99999' });
  assert.deepEqual(group.errors, []);
  assert.doesNotMatch(group.nodes.get('status').textContent, /could not be loaded/);
  const step = stageStepper(group);
  group.nodes.get('play').listeners.get('click')();
  step(100); step(100); step(100); // First person enters after the opening lead.
  step(100); // Second person enters through the already-open door.
  step(900);
  assert.equal(doorState(group), 'open', 'the first person\'s timer cannot close on the second');
  step(99);
  assert.equal(doorState(group), 'open');
  step(1);
  assert.equal(doorState(group), 'closed');
});

test('50-person demo uses its own data and never requests the live event', async () => {
  const data = JSON.parse(await readFile(new URL('../data/timeline.demo-50.json', import.meta.url), 'utf8'));
  const app = await runApp([data], 'demo-50', { search: '?sample=50&at=0', liveFeed: 'https://feed.example/timeline.json' });
  assert.equal(app.fetchUrls.length, 1);
  assert.equal(new URL(app.fetchUrls[0]).pathname, '/data/timeline.demo-50.json');
  assert.match(app.nodes.get('attendees-heading').textContent, /50/);
  assert.equal(app.nodes.get('record-note').hidden, false);
  assert.match(app.nodes.get('record-note').textContent, /fictional/);
  assert.equal(app.nodes.get('event-actions').children.length, 0);
  assert.equal(app.nodes.get('sync-controls').hidden, true);
  assert.equal(app.nodes.get('play').textContent, 'Play');
  assert.deepEqual(app.errors, []);
});

test('host ribbon renders the business and remains accessible without an icon', async () => {
  const sample = JSON.parse(await readFile(new URL('../data/timeline.sample.json', import.meta.url), 'utf8'));
  sample.event.host_name = 'Example Games';
  sample.event.name = 'Autumn Games';
  const app = await runApp([sample], 'host-banner');
  assert.equal(app.errors.length, 0);
  assert.ok(app.contextCalls.includes('HOSTED BY'));
  assert.ok(app.contextCalls.includes('Example Games'));
  assert.equal(app.nodes.get('event-name').textContent, 'Autumn Games');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<h1[^>]*><a href="\.\/">Longtable<span/);
  assert.match(html, /<p id="event-name"/);
  assert.match(app.nodes.get('canvas-description').textContent, /Hosted by Example Games/);
  sample.event.host_icon_url = 'javascript:alert(1)';
  const invalid = await runApp([sample], 'invalid-host');
  assert.match(invalid.nodes.get('status').textContent, /host icon/i);
});

function speechSpan(step, pattern, limit = 600) {
  let started = null;
  for (let frame = 0; frame < limit; frame += 1) {
    const text = step();
    if (pattern.test(text)) { if (started === null) started = frame; }
    else if (started !== null) return { started, ended: frame };
  }
  return { started, ended: null };
}

test("quick reactions keep four seconds at 1x and shrink to the one-second floor at 600x", async () => {
  const base = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const shout = base.events.find((event) => event.kind === "shout");
  // Load paused just before the shout, so the speed chosen below is the one in force when it starts.
  base.events = [{ ...shout, at: .041, text: "Huzzah for speed" }];
  for (const [speed, frames] of [[1, 40], [600, 10]]) {
    const app = await runApp([structuredClone(base)], `shout-speed-${speed}`, { search: "?sample=1&at=0.04" });
    app.nodes.get("speed").listeners.get("change")({ target: { value: String(speed) } });
    app.nodes.get("play").listeners.get("click")();
    const step = stageStepper(app);
    const span = speechSpan(step, /Huzzah for speed/);
    assert.notEqual(span.started, null, `the shout appears at ${speed}x`);
    assert.ok(Math.abs(span.ended - span.started - frames) <= 1, `${speed}x shout lasted ${span.ended - span.started} frames, expected ${frames}`);
    assert.deepEqual(app.errors, []);
  }
});

test("at 600x each stage message holds for one second and a queue of three drains in about three seconds", async () => {
  const sample = customStageFixture(JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8")));
  const app = await runApp([sample], "stage-fast");
  app.nodes.get("speed").listeners.get("change")({ target: { value: "600" } });
  const step = stageStepper(app);
  const spoken = [];
  let firstStarted = null, firstEnded = null, lastEnded = null;
  for (let frame = 0; frame < 300; frame += 1) {
    const text = step();
    const match = text.match(/Stage message (\d)/);
    if (match && spoken.at(-1) !== Number(match[1])) spoken.push(Number(match[1]));
    if (text.includes("Stage message 0") && firstStarted === null) firstStarted = frame;
    if (firstStarted !== null && !text.includes("Stage message 0") && firstEnded === null) firstEnded = frame;
    if (spoken.length === 3 && !match) { lastEnded = frame; break; }
  }
  assert.deepEqual(spoken, [0, 1, 2]);
  assert.ok(Math.abs(firstEnded - firstStarted - 10) <= 1, `first message held ${firstEnded - firstStarted} frames`);
  assert.ok(lastEnded - firstStarted >= 30 && lastEnded - firstStarted <= 45, `three messages drained in ${lastEnded - firstStarted} frames`);
  assert.deepEqual(app.errors, []);
});

test("a stage message that starts while the clock is paused keeps its full six seconds", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const speaker = sample.people[0];
  sample.events = [{ id: "late-message", kind: "donation", at: sample.event.slots - .01, duration: null, text: "Late message",
    person: speaker.id, by: sample.people.find((person) => person.dm).id }];
  const app = await runApp([sample], "stage-paused", { search: `?sample=1&at=${sample.event.slots - .1}` });
  app.nodes.get("speed").listeners.get("change")({ target: { value: "600" } });
  app.nodes.get("play").listeners.get("click")();
  const step = stageStepper(app);
  // The badge is refreshed by the frame loop, so step before reading it.
  let text = step();
  for (let frame = 0; frame < 20 && app.nodes.get("mode-badge").textContent !== "PAUSED"; frame += 1) text = step();
  assert.equal(app.nodes.get("mode-badge").textContent, "PAUSED", "replay pauses itself at the event end");
  assert.match(text, /walking to the stage microphone/, "the message crossed at the event end is queued");
  const span = speechSpan(step, /Late message/, 800);
  assert.notEqual(span.started, null, "the speaker still reaches the microphone while paused");
  assert.equal(span.ended - span.started, 60, "paused speech keeps the 1x duration");
  assert.deepEqual(app.errors, []);
});

test("a closed, dark hall draws no caretaker and reports that staff have gone home", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  data.tables = [];
  data.events = [];
  data.people.forEach(person => { person.presence = { planned: null, actual: { here: null, leaving: null } }; });
  const app = await runApp([data], "caretaker-gone", { search: "?sample=1&at=2" });
  assert.equal(app.imageCalls.filter(call => call.src.includes("roguelikeChar")).length, 0, "no staff sprite layers");
  assert.ok(!app.contextCalls.includes("STAFF"), "no STAFF label");
  assert.ok(app.rectCalls.some(call => call.color === "rgba(4, 7, 20, 0.76)"), "the hall is fully dark");
  assert.match(app.nodes.get("canvas-description").textContent, /Staff have gone home/);
  assert.deepEqual(app.errors, []);
});

const DAY = 24 * 60 * 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const nowQuery = (milliseconds) => `now=${encodeURIComponent(new Date(milliseconds).toISOString())}`;
const spritePositions = (app) => new Set(app.imageCalls.filter((call) => call.src.includes("roguelikeChar")).map((call) => `${call.logicalArgs[4]},${call.logicalArgs[5]}`));

test("before doors a phone header shows the short doors date, while the announced text keeps the long one", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  const app = await runApp([sample], "gathering-phone-clock", { search: `?sample=1&${nowQuery(start - 40 * DAY)}`, mobile: true });
  assert.deepEqual(app.errors, []);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.equal(app.nodes.get("clock").textContent, "Sat, Nov 7, 10:00 AM");
  assert.equal(app.nodes.get("clock").dateTime, sample.event.start);
  assert.equal(app.nodes.get("current-event").textContent, "Doors open Saturday, November 7, 10:00 AM. 40 days away.");
});

test("before doors the sample with ?now= opens on the settled gathering and previews the planned day on demand", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  const app = await runApp([sample], "gathering-sample", { search: `?sample=1&${nowQuery(start - 40 * DAY)}` });
  assert.deepEqual(app.errors, []);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.equal(app.nodes.get("mode-badge").className, "badge");
  assert.equal(app.nodes.get("clock").textContent, "Saturday, November 7, 10:00 AM");
  assert.ok(cardLines(app.nodes.get("tables")).every(([phase]) => phase === "Scheduled"), "before doors no table reads as playing");
  assert.equal(app.nodes.get("clock").dateTime, sample.event.start);
  assert.equal(app.nodes.get("scene-event").textContent, "40 days away");
  assert.equal(app.nodes.get("current-event").textContent, "Doors open Saturday, November 7, 10:00 AM. 40 days away.");
  assert.equal(app.nodes.get("now-marker").hidden, true);
  assert.equal(app.nodes.get("return-now").hidden, true);
  assert.equal(app.nodes.get("play").textContent, "Play");
  assert.equal(app.nodes.get("scrubber").value, "0");
  assert.equal(app.nodes.get("record-note").hidden, false);
  assert.equal(app.nodes.get("sync-controls").hidden, true);
  const places = gatheringLocations(sample);
  const gathered = [...places.values()].filter((place) => place.kind !== "absent").length;
  assert.equal(gathered, 44);
  const status = app.nodes.get("status");
  assert.match(status.textContent, /^44 gathered so far · \d+ games with signup space · Sign up on Discord$/);
  assert.equal(status.children.length, 0, "the sample shows the invitation as text, not a link");
  // Settled anchors are independent of the idle breathing and look-around transforms.
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const leisure = loungeActivities(layout, sample.people.filter((person) => places.get(person.id).kind === "lounge"));
  const drawn = spritePositions(app);
  for (const person of sample.people) {
    const place = places.get(person.id);
    const position = place.kind === "table" ? seatPositionForPlan(layout, place.tableIndex, place.seat) : leisure.get(person.id).position;
    assert.ok(drawn.has(`${Math.round((position.x - .5) * 32)},${Math.round((position.y - .6) * 32)}`), `${person.id} is drawn at ${place.label}`);
  }
  assert.ok(app.rectCalls.some((call) => call.color === "rgba(4, 7, 20, 0)"), "the lights are on");
  assert.equal(app.rectCalls.filter((call) => call.color === "#f7efd8").length, 0, "no dice");
  assert.ok(!app.contextCalls.some((text) => /Announcement|spotlight|Break time|MEAL/i.test(text)), "no bubbles or banners");
  assert.match(app.nodes.get("canvas-description").textContent, /^Lights are on\. Staff are circulating through the hall\. 44 people have gathered so far\./);
  assert.equal(app.nodes.get("activity-note").textContent, "Newest first · America/New_York");
  assert.equal(app.nodes.get("start-label").textContent, "Sat, Nov 7, 10:00 AM");
  app.frames.shift()?.(performance.now() + 5_000);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING", "nothing auto-plays");
  assert.equal(app.nodes.get("scrubber").value, "0");
  assert.equal(app.urlWrites.length, 0, "waiting for doors is not a time choice");
  app.nodes.get("play").listeners.get("click")();
  app.frames.shift()?.(performance.now() + 5_100);
  assert.equal(app.nodes.get("mode-badge").textContent, "REPLAY");
  assert.equal(app.nodes.get("play").textContent, "Pause");
  assert.equal(app.nodes.get("return-now").hidden, false);
  assert.equal(app.nodes.get("now-marker").hidden, true);
  assert.ok(Number(app.nodes.get("scrubber").value) > 0);
  assert.match(app.nodes.get("clock").textContent, /^Sat, Nov 7, 10:0\d AM$/);
  assert.match(app.nodes.get("status").textContent, /^44 gathered so far/, "the gathering status stays while previewing");
  assert.equal(new URL(app.urlWrites.at(-1)).searchParams.get("now"), new Date(start - 40 * DAY).toISOString(), "the override is kept");
  assert.equal(new URL(app.urlWrites.at(-1)).searchParams.has("at"), true);
  app.nodes.get("return-now").listeners.get("click")();
  app.frames.shift()?.(performance.now() + 5_200);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.equal(app.nodes.get("scrubber").value, "0");
  assert.equal(app.nodes.get("return-now").hidden, true);
  assert.equal(new URL(app.urlWrites.at(-1)).searchParams.has("at"), false);
  assert.deepEqual(app.errors, []);
});

test("at the start of the eve the caretaker stays in the lit hall while attendees leave and the gathered count stays", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  const app = await runApp([sample], "eve-sample", { search: `?sample=1&${nowQuery(start - DAY + 46_000)}` });
  assert.deepEqual(app.errors, []);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.equal(app.nodes.get("scene-event").textContent, "24 hours away");
  assert.equal(spritePositions(app).size, 1, "only the caretaker is drawn");
  assert.ok(!app.rectCalls.some((call) => call.color === "rgba(4, 7, 20, 0.76)"), "the caretaker keeps the hall lit");
  assert.match(app.nodes.get("canvas-description").textContent, /Staff are circulating.*44 people have gathered so far/);
  assert.match(app.nodes.get("status").textContent, /^44 gathered so far · \d+ games with signup space · Sign up on Discord$/);
  app.imageCalls.length = 0;
  app.frames.shift()?.(performance.now() + 3_000);
  assert.equal(spritePositions(app).size, 1);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
});

test("after the empty eve closes the hall is dark with its dated caption and gathered count", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  const app = await runApp([sample], "eve-dark-sample", { search: `?sample=1&${nowQuery(start - DAY + 120_000)}` });
  assert.deepEqual(app.errors, []);
  assert.equal(spritePositions(app).size, 0);
  assert.ok(app.rectCalls.some(call => call.color === "rgba(4, 7, 20, 0.76)"));
  assert.match(app.nodes.get("canvas-description").textContent,
    /The hall is dark\. Doors open Saturday at 10:00 AM\..*44 people have gathered so far/);
  assert.match(app.nodes.get("status").textContent, /^44 gathered so far/);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
});

test("a live tab one minute before doors polls every 2 seconds and hands over to LIVE at the start", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(data.event.start);
  const app = await runApp([data], "doors-handover", { search: `?${nowQuery(start - 60_000)}` });
  assert.deepEqual(app.errors, []);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.equal(app.nodes.get("scene-event").textContent, "Doors open any moment");
  // The sample was published on the event day, so the publish time keeps its time-only form here.
  assert.match(app.nodes.get("sync-status").textContent, /Checked at .*Checking every 2 seconds\. Data published at 3:09:41 PM\.$/);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 90_000;
    app.frames.shift()?.(performance.now() + 100);
    await settle();
    app.frames.shift()?.(performance.now() + 200);
    assert.equal(app.nodes.get("mode-badge").textContent, "LIVE");
    assert.equal(app.nodes.get("mode-badge").className, "badge live");
    assert.equal(app.nodes.get("now-marker").hidden, false);
    assert.equal(app.nodes.get("return-now").hidden, true);
    assert.match(app.nodes.get("clock").textContent, /^Sat, Nov 7, 10:00 AM$/);
    assert.match(app.nodes.get("sync-status").textContent, /Checking every 2 seconds/);
    assert.doesNotMatch(app.nodes.get("sync-status").textContent, /Viewing an earlier time|Previewing/);
    assert.match(app.nodes.get("status").textContent, /games on the schedule/);
    assert.equal(app.nodes.get("activity-note").textContent, "Newest first · Live · America/New_York");
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(app.errors, []);
});

test("during the sign-up window a live tab polls every 30 seconds, never while hidden, links the invitation, and previews on demand", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(data.event.start);
  const app = await runApp([data, data, data], "gathering-polling", { search: `?${nowQuery(start - 40 * DAY)}`, liveFeed: "https://feed.example/timeline.json" });
  assert.deepEqual(app.errors, []);
  assert.equal(app.fetchUrls.length, 1);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.match(app.nodes.get("sync-status").textContent, /Checked at .*Checking every 30 seconds\. Data published at Nov 7, 3:09 PM\.$/);
  assert.doesNotMatch(app.nodes.get("sync-status").textContent, /Viewing an earlier time/);
  const base = performance.now();
  app.frames.shift()?.(base + 2_100);
  await settle();
  assert.equal(app.fetchUrls.length, 1, "no refresh after two seconds");
  app.frames.shift()?.(base + 29_000);
  await settle();
  assert.equal(app.fetchUrls.length, 1);
  app.frames.shift()?.(base + 30_100);
  await settle();
  assert.equal(app.fetchUrls.length, 2, "a refresh after thirty seconds");
  document.hidden = true;
  app.frames.shift()?.(base + 61_000);
  await settle();
  app.intervals[0]();
  await settle();
  assert.equal(app.fetchUrls.length, 2, "no polling while hidden");
  document.hidden = false;
  const status = app.nodes.get("status");
  assert.match(status.textContent, /^44 gathered so far · \d+ games with signup space · $/);
  assert.equal(status.children.length, 1);
  assert.equal(status.children[0].tagName, "A");
  assert.equal(status.children[0].textContent, "Sign up on Discord");
  assert.equal(status.children[0].href, DISCORD_INVITE);
  const writes = status.textContentWrites;
  app.frames.shift()?.(base + 61_100);
  assert.equal(status.textContentWrites, writes, "the status is not rebuilt every frame");
  assert.equal(status.children.length, 1);
  app.nodes.get("play").listeners.get("click")();
  app.frames.shift()?.(base + 61_200);
  assert.equal(app.nodes.get("mode-badge").textContent, "REPLAY");
  assert.equal(app.nodes.get("return-now").hidden, false);
  assert.match(app.nodes.get("sync-status").textContent, /Previewing the planned day\. Choose Return to Now to see the hall as it is\.$/);
  assert.equal(app.nodes.get("activity-note").textContent, "Newest first · Selected time · America/New_York");
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "12" } });
  app.frames.shift()?.(base + 61_300);
  assert.equal(app.nodes.get("mode-badge").textContent, "PAUSED");
  assert.match(app.nodes.get("sync-status").textContent, /Previewing the planned day/);
  app.nodes.get("return-now").listeners.get("click")();
  app.frames.shift()?.(base + 61_400);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.doesNotMatch(app.nodes.get("sync-status").textContent, /Previewing|Viewing an earlier time/);
  assert.equal(app.nodes.get("activity-note").textContent, "Newest first · America/New_York");
  assert.deepEqual(app.errors, []);
});

test("?at= still seeks a paused preview under a now override, and a 24-hour event shows its day in slot labels", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  const seeked = await runApp([sample], "gathering-seek", { search: `?sample=1&${nowQuery(start - 40 * DAY)}&at=12` });
  assert.equal(seeked.nodes.get("mode-badge").textContent, "PAUSED");
  assert.equal(seeked.nodes.get("scrubber").value, "12");
  assert.equal(seeked.nodes.get("clock").textContent, "Sat, Nov 7, 4:00 PM");
  assert.equal(seeked.nodes.get("return-now").hidden, false);
  assert.match(seeked.nodes.get("status").textContent, /^44 gathered so far/);
  const plain = await runApp([sample], "day-labels");
  assert.equal(plain.nodes.get("start-label").textContent, "Sat, Nov 7, 10:00 AM");
  assert.equal(plain.nodes.get("end-label").textContent, "Sun, Nov 8, 10:00 AM");
  assert.match(plain.nodes.get("status").textContent, /games with signup space · Event starts Sat, Nov 7, 10:00 AM$/);
  assert.match(allText(plain.nodes.get("tables")), /Sat, Nov 7, 11:00 AM–Sat, Nov 7, 3:00 PM/);
  assert.equal(plain.nodes.get("mode-badge").textContent, "REPLAY", "the sample without an override still replays");
});

test("the plaque QR images load from the WALL_PLAQUES paths and a missing QR is not a failed asset", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "plaque-images");
  assert.deepEqual(app.errors, []);
  const drawn = app.imageCalls.filter((call) => /-qr\.png$/.test(call.src)).map((call) => call.src);
  assert.deepEqual(drawn, WALL_PLAQUES.map((plaque) => new URL(plaque.qr, new URL("../app.mjs", import.meta.url)).href));
  assert.ok(app.contextCalls.includes("Join the Discord") && app.contextCalls.includes("discord.gg/tc9NqpjBrb"));
  assert.ok(app.contextCalls.includes("Donate · Extra Life") && app.contextCalls.includes("dd.extra-life.org/teams/74917"));
  assert.match(app.nodes.get("canvas-description").textContent, /Two plaques on the back wall carry QR codes/);
  const missing = await runApp([sample], "plaque-images-missing", { plaquesFail: true });
  assert.deepEqual(missing.errors, []);
  assert.equal(missing.imageCalls.filter((call) => /-qr\.png$/.test(call.src)).length, 0);
  assert.ok(missing.contextCalls.includes("Join the Discord"), "the plaque keeps its wood and text without a QR");
  assert.doesNotMatch(missing.nodes.get("status").textContent, /simplified graphics/);
  const archive = await runApp([sample], "plaque-images-archive", { archive: true, search: "" });
  assert.equal(archive.contextCalls.filter((text) => text === "Join the Discord").length, 0, "archives hang no plaques");
  assert.equal(archive.imageRequests.filter((src) => /-qr\.png$/.test(src)).length, 0, "archives never request the QR images");
  assert.equal(app.imageRequests.filter((src) => /-qr\.png$/.test(src)).length, 2, "live pages still request both QR images");
  assert.doesNotMatch(archive.nodes.get("canvas-description").textContent, /Two plaques/);
});

test("the footer kiosk link opens the same view as a kiosk and is not offered on archives", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const live = await runApp([sample], "kiosk-link-live", { search: "" });
  assert.equal(live.nodes.get("kiosk-link").href, "?kiosk=1");
  assert.equal(live.nodes.get("kiosk-link").hidden, false);
  const demo = await runApp([sample], "kiosk-link-demo", { search: "?sample=50&now=2026-11-07T10:00:00-05:00" });
  assert.equal(demo.nodes.get("kiosk-link").href, "?sample=50&now=2026-11-07T10%3A00%3A00-05%3A00&kiosk=1");
  const kiosk = await runApp([sample], "kiosk-link-kiosk", { search: "?kiosk=1&sample=1" });
  assert.equal(kiosk.nodes.get("kiosk-link").href, "?kiosk=1&sample=1");
  const archive = await runApp([sample], "kiosk-link-archive", { search: "", archive: true });
  assert.equal(archive.nodes.get("kiosk-link").hidden, true);
});

test("the jukebox and its sign draw in live, kiosk and archive views and the description names them", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  for (const [label, options] of [["jukebox-live", {}], ["jukebox-kiosk", { search: "?sample=1&kiosk=1" }], ["jukebox-archive", { search: "", archive: true }]]) {
    const app = await runApp([sample], label, options);
    assert.deepEqual(app.errors, [], label);
    assert.ok(app.contextCalls.includes("Click here for music"), `${label}: the sign invites a click while no music plays`);
    assert.match(app.nodes.get("canvas-description").textContent, /A jukebox stands against the back wall under a sign that offers music when clicked\./, label);
    assert.equal(app.nodes.get("music-panel"), undefined, `${label}: no panel in this harness`);
  }
});

test("clicking the jukebox opens the player, starts music and names the track on the sign, in kiosk mode too", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  for (const [label, search] of [["jukebox-click", "?sample=1"], ["jukebox-click-kiosk", "?sample=1&kiosk=1"]]) {
    const app = await runApp([sample], label, { search, music: true });
    app.nodes.get("recenter").listeners.get("click")();
    const layout = createRoomLayout(sample.tables, sample.room_layout);
    const hall = { x: 0, y: layout.backWall.y, width: layout.width, height: layout.height - layout.backWall.y };
    const camera = fitBounds(hall, { width: 960, height: 480 }, hall, 0);
    const box = jukeboxBounds(layout);
    const point = worldToScreen(camera, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
    const canvas = app.nodes.get("hall");
    const events = canvas.listeners;
    events.get("pointermove")({ pointerId: 9, clientX: point.x, clientY: point.y });
    assert.equal(canvas.style.cursor, "pointer", `${label}: pointer over the jukebox`);
    assert.equal(app.nodes.get("tooltip").hidden, false);
    assert.equal(app.nodes.get("tooltip").textContent, "Jukebox — click for music");
    assert.equal(app.nodes.get("tooltip").className, "tooltip jukebox-tip");
    events.get("pointermove")({ pointerId: 9, clientX: 2, clientY: 2 });
    assert.equal(canvas.style.cursor, "", `${label}: cursor restored off the jukebox`);
    const panel = app.nodes.get("music-panel");
    const audio = app.nodes.get("hall-music");
    assert.equal(panel.hidden, true);
    assert.equal(audio.plays, 0, `${label}: nothing plays before the first click`);
    events.get("pointerdown")({ pointerId: 9, clientX: point.x, clientY: point.y, button: 0 });
    events.get("pointerup")({ pointerId: 9 });
    events.get("click")({ clientX: point.x, clientY: point.y });
    assert.equal(panel.hidden, false, `${label}: the first click opens the player`);
    assert.equal(app.nodes.get("music-toggle").focused, true, `${label}: focus moves to the play button`);
    assert.equal(audio.plays, 1, `${label}: the first click starts the music`);
    assert.match(allText(app.nodes.get("detail")), /Select a table/, `${label}: a jukebox click selects no table`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.contextCalls.length = 0;
    app.frames.shift()?.(performance.now() + 60);
    assert.ok(app.contextCalls.includes("♪ The Old Tower Inn"), `${label}: the sign names the playing track`);
    assert.ok(!app.contextCalls.includes("Click here for music"), label);
    assert.match(panel.style.left, /^\d+px$/, `${label}: the panel is anchored in the scene`);
    assert.match(panel.style.top, /^\d+px$/, label);
    assert.equal(app.nodes.get("music-track").textContent, "The Old Tower Inn — RandomMind");
    app.nodes.get("music-toggle").listeners.get("click")();
    assert.equal(audio.paused, true, `${label}: Pause stops the music from the panel`);
    app.contextCalls.length = 0;
    app.frames.shift()?.(performance.now() + 120);
    assert.ok(app.contextCalls.includes("Click here for music"), `${label}: the sign returns to the invitation`);
    events.get("pointerdown")({ pointerId: 9, clientX: point.x, clientY: point.y, button: 0 });
    events.get("pointerup")({ pointerId: 9 });
    events.get("click")({ clientX: point.x, clientY: point.y });
    assert.equal(panel.hidden, true, `${label}: a second click hides the player`);
    assert.equal(canvas.focused, true, `${label}: closing returns focus to the canvas`);
  }
});

test("without ?kiosk the page has no kiosk flag, wake lock or idle key handling", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "no-kiosk", { wakeLock: true });
  assert.equal(document.documentElement.dataset.kiosk, undefined);
  assert.deepEqual(app.wakeLockRequests, [], "no wake lock outside kiosk");
  assert.equal(app.documentListeners.has("keydown"), false);
});

test("?kiosk=1 flags the document, opens the hall on mobile, adds no side rail and keeps the clock mode", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "kiosk", { search: "?sample=1&kiosk=1", mobile: true, wakeLock: true });
  assert.deepEqual(app.errors, []);
  assert.equal(document.documentElement.dataset.kiosk, "1");
  assert.equal(app.nodes.get("hall-explorer").open, true);
  assert.equal(app.nodes.get("mode-badge").textContent, "PAUSED", "kiosk never changes the derived mode (mobile begins paused)");
  // The QR codes are the wall plaques on the canvas; no DOM rail is added beside the scene.
  assert.equal(app.nodes.get("hall-layout").children.length, 0);
  const drawn = app.imageCalls.filter((call) => /-qr\.png$/.test(call.src)).map((call) => call.src);
  assert.deepEqual(drawn, WALL_PLAQUES.map((plaque) => new URL(plaque.qr, new URL("../app.mjs", import.meta.url)).href));
  assert.deepEqual(app.wakeLockRequests, ["screen"]);
  document.hidden = false;
  app.documentListeners.get("visibilitychange")();
  assert.deepEqual(app.wakeLockRequests, ["screen", "screen"], "each return to visible re-requests the lock");
});

test("kiosk keeps ?kiosk=1 while the clock writes and deletes ?at=", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "kiosk-url", { search: "?sample=1&kiosk=1" });
  app.nodes.get("scrubber").listeners.get("input")({ target: { value: "15" } });
  app.nodes.get("scrubber").listeners.get("change")();
  assert.equal(location.searchParams.get("kiosk"), "1");
  assert.equal(location.searchParams.get("at"), "15");
  app.nodes.get("return-now").listeners.get("click")();
  assert.equal(location.searchParams.get("kiosk"), "1");
  assert.equal(location.searchParams.get("sample"), "1");
});

test("kiosk returns a manual camera to automatic framing after 45 s idle, hides the cursor after 3 s, and swallows a refused wake lock", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "kiosk-idle", { search: "?sample=1&kiosk=1", wakeLock: "rejects" });
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.wakeLockRequests, ["screen"]);
  const dataset = document.documentElement.dataset;
  const events = app.nodes.get("hall").listeners;
  const frameAt = (offset) => {
    app.transforms.length = 0;
    app.frames.shift()?.(performance.now() + offset);
    return app.transforms[1];
  };
  const automatic = frameAt(30);
  assert.equal(dataset.idle, undefined);
  events.get("wheel")({ clientX: 480, clientY: 240, deltaY: -180, deltaMode: 0, preventDefault() {} });
  const zoomed = frameAt(60);
  assert.ok(zoomed[0] > automatic[0]);
  assert.deepEqual(frameAt(4_000), zoomed, "a manual camera holds well within the idle window");
  assert.equal(dataset.idle, "1", "the cursor hides after three seconds without pointer movement");
  app.documentListeners.get("pointermove")();
  assert.deepEqual(frameAt(1_000), zoomed);
  assert.equal(dataset.idle, undefined, "movement brings the cursor back");
  assert.deepEqual(frameAt(46_000), automatic, "after 45 s without input the projection reframes automatically");
  // The projector's automatic frame is the whole room, wall to lounge, not a close-up of the relevant tables.
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const room = { x: 0, y: layout.backWall.y, width: layout.width, height: layout.height - layout.backWall.y };
  const whole = fitBounds(room, { width: 960, height: 480 }, room, 0);
  // The camera transform draws tiles at 32 px per unit (TILE * SCALE), so its scale is the zoom over 32.
  assert.deepEqual(automatic, [whole.zoom / 32, 0, 0, whole.zoom / 32, whole.x, whole.y], "kiosk frames the whole hall");
  const plain = await runApp([sample], "plain-idle", { search: "?sample=1" });
  const held = (() => { plain.transforms.length = 0; plain.frames.shift()?.(performance.now() + 30); return plain.transforms[1]; })();
  plain.nodes.get("hall").listeners.get("wheel")({ clientX: 480, clientY: 240, deltaY: -180, deltaMode: 0, preventDefault() {} });
  plain.transforms.length = 0; plain.frames.shift()?.(performance.now() + 60);
  const plainZoomed = plain.transforms[1];
  assert.ok(plainZoomed[0] > held[0]);
  plain.transforms.length = 0; plain.frames.shift()?.(performance.now() + 60_000);
  assert.deepEqual(plain.transforms[1], plainZoomed, "outside kiosk a manual camera never resets");
  assert.equal(document.documentElement.dataset.idle, undefined);
});

test("kiosk toggles fullscreen on f only outside inputs and ignores a missing or refusing API", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const app = await runApp([sample], "kiosk-fullscreen", { search: "?sample=1&kiosk=1" });
  const calls = [];
  document.documentElement.requestFullscreen = async () => { calls.push("enter"); throw new Error("Not allowed"); };
  document.exitFullscreen = async () => { calls.push("exit"); };
  const keydown = app.documentListeners.get("keydown");
  keydown({ key: "f" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["enter"]);
  document.fullscreenElement = document.documentElement;
  keydown({ key: "F" });
  assert.deepEqual(calls, ["enter", "exit"]);
  document.activeElement = { tagName: "INPUT" };
  keydown({ key: "f" });
  assert.deepEqual(calls, ["enter", "exit"], "typing an f into a field is not a toggle");
  document.activeElement = null;
  keydown({ key: "f", ctrlKey: true });
  assert.deepEqual(calls, ["enter", "exit"], "ctrl+f stays the browser's find");
  delete document.documentElement.requestFullscreen;
  delete document.fullscreenElement;
  keydown({ key: "f" });
  assert.deepEqual(app.errors, []);
});

test("the plaques join the automatic frame before doors and on the projector, never in a live view of the public page", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const { plaques } = wallFixtures(layout);
  // Camera transform [zoom / 32, 0, 0, zoom / 32, camera.x, camera.y] on the 960-wide fake viewport.
  const rightEdge = (app) => {
    app.transforms.length = 0;
    app.frames.shift()?.(performance.now() + 30);
    const [scale, , , , x] = app.transforms[1];
    return (960 - x) / (scale * 32);
  };
  const live = structuredClone(sample);
  live.event.start = new Date(Date.now() - 30 * 60_000).toISOString().replace("Z", "+00:00");
  live.generated_at = new Date(Date.now() - 10_000).toISOString();
  // Only the first two tables are relevant now, so a live frame zooms to the left of the hall.
  live.tables = live.tables.map((table, index) => index < 2 ? { ...table, start: 0, end: live.event.slots } : { ...table, start: live.event.slots - 2, end: live.event.slots, signups: [] });
  const following = await runApp([live], "frame-follow-now", { search: "", liveFeed: "https://feed.example/timeline.json" });
  assert.equal(following.nodes.get("mode-badge").textContent, "LIVE");
  assert.ok(rightEdge(following) < plaques[0].x, "follow-now on the public page keeps zooming to the relevant tables");
  const kiosk = await runApp([live], "frame-follow-now-kiosk", { search: "?kiosk=1", liveFeed: "https://feed.example/timeline.json" });
  assert.equal(kiosk.nodes.get("mode-badge").textContent, "LIVE");
  assert.ok(rightEdge(kiosk) >= plaques[1].x + plaques[1].w, "the projector frames the whole room including both plaques");
  const start = Date.parse(sample.event.start);
  const upcomingApp = await runApp([sample], "frame-upcoming", { search: `?sample=1&${nowQuery(start - 40 * DAY)}` });
  assert.equal(upcomingApp.nodes.get("mode-badge").textContent, "UPCOMING");
  assert.ok(rightEdge(upcomingApp) >= plaques[1].x + plaques[1].w, "before doors the public page frames the plaques too");
});

// --- Practice before doors: the live feed's optional `practice` key ---
const LIVE_FEED = "https://feed.example/timeline.json";
const drawnKey = (position) => `${Math.round((position.x - .5) * 32)},${Math.round((position.y - .6) * 32)}`;
/** The seated pose lowers a diner a few pixels from their logical stool anchor. */
const drawnNear = (drawn, position, tolerance = 8) => [...drawn].some((key) => {
  const [x, y] = key.split(",").map(Number);
  return x === Math.round((position.x - .5) * 32) && Math.abs(y - (position.y - .6) * 32) <= tolerance;
});
const laterStamp = (sample, seconds) => new Date(Date.parse(sample.generated_at) + seconds * 1000).toISOString().replace(".000Z", "Z");
/** Runs one frame and returns every canvas text drawn in it. */
function canvasStepper(app, start = performance.now() + 100) {
  let now = start;
  const step = (milliseconds = 100) => {
    now += milliseconds;
    app.contextCalls.length = 0;
    app.textCalls.length = 0;
    app.rectCalls.length = 0;
    app.transforms.length = 0;
    app.frames.shift()?.(now);
    return app.contextCalls.join(" ");
  };
  step.at = () => now;
  return step;
}

test("practising people are drawn at their practice position before doors and stay through the eve", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  // u_lena is planned at t01 seat 1 and also signed up on t04 (index 3) as its third player; u_tess is lounge-only.
  const practice = { people: { u_lena: { position: "table", table: "t04" }, u_tess: { position: "food", table: null } }, speech: [] };
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const lenaPractice = seatPositionForPlan(layout, 3, 3);
  const lenaPlanned = seatPositionForPlan(layout, 0, 1);
  const tessPractice = queueSpot(layout, "first", 0);
  assert.deepEqual(gatheringLocations(sample).get("u_lena"), { ...gatheringLocations(sample).get("u_lena"), tableIndex: 0, seat: 1 });

  const app = await runApp([{ ...sample, practice }], "practice-placement", { search: `?${nowQuery(start - 40 * DAY)}`, liveFeed: LIVE_FEED });
  assert.deepEqual(app.errors, []);
  assert.equal(app.nodes.get("mode-badge").textContent, "UPCOMING");
  const drawn = spritePositions(app);
  assert.ok(drawn.has(drawnKey(lenaPractice)), "Lena is drawn at her t04 seat");
  assert.ok(!drawn.has(drawnKey(lenaPlanned)), "not at her planned t01 seat");
  assert.ok(drawnNear(drawn, tessPractice), "Tess waits in the food queue");
  assert.match(app.nodes.get("status").textContent, /^44 gathered so far/);

  const eve = await runApp([{ ...sample, practice }], "practice-eve", { search: `?${nowQuery(start - DAY + 120_000)}`, liveFeed: LIVE_FEED });
  assert.deepEqual(eve.errors, []);
  assert.equal(eve.nodes.get("scene-event").textContent, "24 hours away");
  assert.ok(!eve.rectCalls.some((call) => call.color === "rgba(4, 7, 20, 0.76)"), "the caretaker keeps the hall lit");
  const eveDrawn = spritePositions(eve);
  assert.ok(eveDrawn.has(drawnKey(lenaPractice)), "Lena still practises in the eve");
  assert.ok(drawnNear(eveDrawn, tessPractice), "Tess still practises in the eve");
  assert.ok(!eveDrawn.has(drawnKey(seatPositionForPlan(layout, 0, 0))), "Mara, not practising, has left");
  assert.equal(eveDrawn.size, 3, "the two practising people and caretaker remain");
  eve.imageCalls.length = 0;
  eve.frames.shift()?.(performance.now() + 3_000);
  assert.equal(spritePositions(eve).size, 3);
});

test("each practice speech entry shows once at the person: never on load, not on repeat, and the next one alone", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  const people = { u_lena: { position: "table", table: "t04" } };
  const old = { person: "u_lena", text: "Old news", at: laterStamp(sample, -30) };
  const first = { person: "u_lena", text: "Practice huzzah", at: laterStamp(sample, 1) };
  const second = { person: "u_lena", text: "Second cheer", at: laterStamp(sample, 3) };
  const base = { ...sample, practice: { people, speech: [old] } };
  const withSpeech = { ...sample, generated_at: laterStamp(sample, 1), practice: { people, speech: [old, first] } };
  const withSpeechAgain = { ...sample, generated_at: laterStamp(sample, 2), practice: { people, speech: [old, first] } };
  const withSpeech2 = { ...sample, generated_at: laterStamp(sample, 3), practice: { people, speech: [old, first, second] } };
  const app = await runApp([base, withSpeech, withSpeechAgain, withSpeech2], "practice-speech", { search: `?${nowQuery(start - 40 * DAY)}`, liveFeed: LIVE_FEED });
  assert.deepEqual(app.errors, []);
  assert.equal(app.fetchUrls.length, 1);
  const step = canvasStepper(app);
  const texts = (frames) => { const seen = []; for (let frame = 0; frame < frames; frame += 1) seen.push(step()); return seen.join("\n"); };
  assert.doesNotMatch(texts(10), /Old news|Practice huzzah/, "no bubble after the initial load");
  assert.equal(app.fetchUrls.length, 1);

  step(4_100);                       // past the 5-second practice cadence: the first refresh starts
  await settle();
  assert.equal(app.fetchUrls.length, 2);
  let bubble = null;
  let camera = null;
  let shown = 0;
  for (let frame = 0; frame < 100 && (shown === 0 || app.contextCalls.includes("Practice huzzah")); frame += 1) {
    if (step().includes("Practice huzzah")) {
      shown += 1;
      bubble ??= app.textCalls.find((call) => call.text === "Practice huzzah");
      // The hall transform is the one that is not a reset to the identity; its scale is zoom over the 32 px tile.
      const world = app.transforms.find((entry) => entry[0] !== 1 || entry[4] !== 0 || entry[5] !== 0);
      camera ??= { zoom: world[0] * 32, x: world[4], y: world[5] };
    }
  }
  assert.ok(shown >= 38 && shown <= 42, `the bubble held for ${shown} frames (about four seconds)`);
  assert.ok(bubble, "the bubble text was drawn");
  assert.ok(!app.contextCalls.includes("Practice huzzah") && !app.contextCalls.some((text) => /^From /.test(text)), "never labelled stage-side");
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const seat = seatPositionForPlan(layout, 3, 3);
  // drawBubble writes the text at left + 2·SCALE; the stub measures 5 px per character and pads 4·SCALE.
  const left = bubble.x - 4;
  const width = "Practice huzzah".length * 5 + 8;
  const atPerson = worldToScreen(camera, { x: seat.x, y: seat.y - 1.2 });
  const atStage = worldToScreen(camera, layout.stageFront);
  assert.ok(Math.abs(left + width / 2 - atPerson.x) < 1, `the bubble is centred on Lena (${left + width / 2} vs ${atPerson.x})`);
  assert.ok(Math.abs(left + width / 2 - atStage.x) > 10, "and not on the stage");
  assert.doesNotMatch(texts(5), /Practice huzzah|Old news/);

  await settle();                    // the repeat carries the same entry under a newer generated_at
  assert.equal(app.fetchUrls.length, 3);
  assert.doesNotMatch(texts(30), /Practice huzzah|Old news/, "the same entry is not replayed");

  await settle();                    // the third snapshot adds a second entry
  assert.equal(app.fetchUrls.length, 4);
  const later = texts(60);
  assert.match(later, /Second cheer/, "the new entry appears");
  assert.doesNotMatch(later, /Practice huzzah|Old news/, "the earlier ones stay quiet");
  assert.deepEqual(app.errors, []);
});

test("practice drops polling to 5 seconds and back to 30 when nobody practises; sample pages ignore the key", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(sample.event.start);
  const practising = { ...sample, practice: { people: { u_lena: { position: "food", table: "t01" } }, speech: [] } };
  const nobody = { ...sample, generated_at: laterStamp(sample, 1), practice: { people: {}, speech: [] } };
  const app = await runApp([practising, nobody, nobody], "practice-cadence", { search: `?${nowQuery(start - 40 * DAY)}`, liveFeed: LIVE_FEED });
  assert.deepEqual(app.errors, []);
  assert.equal(app.fetchUrls.length, 1);
  assert.match(app.nodes.get("sync-status").textContent, /Checked at .*Checking every 5 seconds\. Data published at Nov 7, 3:09 PM\.$/);
  const base = performance.now();
  app.frames.shift()?.(base + 2_100);
  await settle();
  assert.equal(app.fetchUrls.length, 1, "no refresh after two seconds");
  app.frames.shift()?.(base + 5_100);
  await settle();
  assert.equal(app.fetchUrls.length, 2, "a refresh after five seconds");
  app.frames.shift()?.(base + 5_200);
  assert.match(app.nodes.get("sync-status").textContent, /Checking every 30 seconds\./, "an empty people object restores the sign-up cadence");
  app.frames.shift()?.(base + 29_000);
  await settle();
  assert.equal(app.fetchUrls.length, 2);
  app.frames.shift()?.(base + 35_300);
  await settle();
  assert.equal(app.fetchUrls.length, 3);
  assert.deepEqual(app.errors, []);

  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const demo = await runApp([practising], "practice-sample", { search: `?sample=1&${nowQuery(start - 40 * DAY)}` });
  assert.deepEqual(demo.errors, []);
  assert.equal(demo.nodes.get("sync-controls").hidden, true);
  const drawn = spritePositions(demo);
  assert.ok(drawn.has(drawnKey(seatPositionForPlan(layout, 0, 1))), "Lena is at her planned seat");
  assert.ok(!drawnNear(drawn, foodGeometry(layout, 0, 4).seat), "nobody is eating in practice");
  assert.ok(!drawnNear(drawn, queueSpot(layout, "first", 0)), "nobody queues in practice on a sample page");
  demo.frames.shift()?.(performance.now() + 6_000);
  await settle();
  demo.intervals[0]();
  await settle();
  assert.equal(demo.fetchUrls.length, 1, "a sample page never fetches again");
});

test("only the selected or hovered table shows its name plate", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  sample.tables = sample.tables.slice(0, 2).map((table) => ({ ...table, start: 0, end: sample.event.slots, signups: [] }));
  const app = await runApp([sample], "name-plates");
  const events = app.nodes.get("hall").listeners;
  const plates = () => { app.contextCalls.length = 0; app.frames.shift()?.(performance.now() + 30); return app.contextCalls.filter((call) => /seats left$/.test(call)).length; };
  assert.equal(plates(), 0, "no plate while nothing is selected");
  app.nodes.get("fit-active").listeners.get("click")();
  plates();
  events.get("pointermove")({ pointerId: 1, clientX: 680, clientY: 240 });
  assert.equal(plates(), 1, "hovering a table shows its plate");
  events.get("pointerleave")({});
  assert.equal(plates(), 0, "leaving the hall hides it again");
  events.get("pointerdown")({ pointerId: 1, clientX: 680, clientY: 240, button: 0 });
  events.get("pointerup")({ pointerId: 1 });
  events.get("click")({ clientX: 680, clientY: 240 });
  assert.equal(plates(), 1, "the selected table gets its plate");
});

test("the projector labels every table, and a zoomed-in plate wraps its full title above its seats", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  sample.tables = sample.tables.slice(0, 2).map((table) => ({ ...table, start: 0, end: sample.event.slots, signups: [] }));
  sample.tables[1].name = "A Very Long Adventure Title That Would Never Fit On One Line";
  const kiosk = await runApp([sample], "kiosk-plates", { search: "?kiosk=1" });
  kiosk.textCalls.length = 0;
  kiosk.frames.shift()?.(performance.now() + 30);
  const texts = kiosk.textCalls.map((call) => call.text);
  // At this small projector zoom a plate keeps one title line, cut with an ellipsis when it is long.
  assert.ok(texts.some((text) => text.startsWith("The Sunken")) && texts.some((text) => text.startsWith("A Very")), "every table has a plate on the projector");

  const app = await runApp([sample], "zoomed-plate");
  const events = app.nodes.get("hall").listeners;
  const tap = (x) => { events.get("pointerdown")({ pointerId: 1, clientX: x, clientY: 240, button: 0 }); events.get("pointerup")({ pointerId: 1 }); events.get("click")({ clientX: x, clientY: 240 }); };
  app.nodes.get("fit-active").listeners.get("click")();
  tap(680);
  tap(680);
  for (let frame = 0; frame < 90; frame += 1) app.frames.shift()?.(performance.now() + 30 + frame * 16);
  app.textCalls.length = 0;
  app.frames.shift()?.(performance.now() + 2000);
  const seats = app.textCalls.filter((call) => /seats left$/.test(call.text));
  const words = new Set(sample.tables[1].name.split(" "));
  const title = app.textCalls.filter((call) => call.text.split(" ").every((word) => words.has(word.replace("…", ""))));
  assert.ok(title.length >= 2, "the long title wraps onto more than one line");
  const seatLine = seats.find((call) => Math.abs(call.x - title[0].x) < 1);
  assert.ok(seatLine && title.every((line) => line.y < seatLine.y), "seats sit on the line under the title");
});


test("a game that has ended takes its plate down, and a plate stays between its table and the one above", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  sample.tables = sample.tables.slice(0, 3).map((table) => ({ ...table, start: 0, end: sample.event.slots, signups: [] }));
  sample.tables[0].name = "Still Playing";
  sample.tables[1].name = "Long Finished";
  sample.tables[1].end = 4;
  sample.tables[2].name = "Just Ended";
  sample.tables[2].end = 24;
  const kiosk = await runApp([sample], "ended-plates", { search: "?kiosk=1&sample=1&at=24" });
  kiosk.textCalls.length = 0;
  kiosk.rectCalls.length = 0;
  kiosk.transforms.length = 0;
  kiosk.frames.shift()?.(performance.now() + 30);
  const texts = kiosk.textCalls.map((call) => call.text);
  assert.ok(texts.includes("Still Playing"), "the game in progress keeps its plate");
  assert.ok(!texts.includes("Long Finished") && !texts.includes("Inactive"), "an inactive game has no plate");
  assert.ok(!texts.includes("Just Ended") && !texts.includes("Packing up"), "a game packing up has no plate");

  // The hall transform is the one that is not a reset to the identity; its scale is zoom over the 32 px tile.
  const world = kiosk.transforms.find((entry) => entry[0] !== 1 || entry[4] !== 0 || entry[5] !== 0);
  const camera = { zoom: world[0] * 32, x: world[4], y: world[5] };
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const topSeat = seatPositionForPlan(layout, 0, 1);
  const seatTop = worldToScreen(camera, { x: topSeat.x, y: topSeat.y - .5 });
  // The table above ends with its roll label, 1.4 tiles above this table's cell.
  const aboveEnds = worldToScreen(camera, { x: topSeat.x, y: layout.cells[0].y - 1.4 });
  // The wall plaques share the wood colour but are drawn in world units, a few pixels wide.
  const plates = kiosk.rectCalls.filter((call) => call.color === "#4a3524" && call.args[2] > 20);
  assert.equal(plates.length, 1, "one plate is drawn");
  const [left, top, width, height] = plates[0].args;
  assert.ok(top >= aboveEnds.y && top + height <= seatTop.y, `the plate (${top}–${top + height}) stays between the table above (${aboveEnds.y}) and its own top seats (${seatTop.y})`);
  // Seat zero (the DM) sits at the middle of the three-tile tabletop.
  const middle = worldToScreen(camera, seatPositionForPlan(layout, 0, 0));
  assert.ok(Math.abs(left + width / 2 - middle.x) < 1, `and is centred on its tabletop (${left + width / 2} vs ${middle.x})`);
});


test("a hovered player's name draws on top of their table's plate", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  sample.events = [];
  sample.tables = sample.tables.slice(0, 2).map((table) => ({ ...table, start: 0, end: sample.event.slots, signups: [] }));
  const app = await runApp([sample], "hover-name-over-plate", { search: "?sample=1&at=12" });
  app.nodes.get("fit-active").listeners.get("click")();
  app.transforms.length = 0;
  app.frames.shift()?.(performance.now() + 30);
  const world = app.transforms.find((entry) => entry[0] !== 1 || entry[4] !== 0 || entry[5] !== 0);
  const camera = { zoom: world[0] * 32, x: world[4], y: world[5] };
  const layout = createRoomLayout(sample.tables, sample.room_layout);
  const dm = worldToScreen(camera, seatPositionForPlan(layout, 0, 0));
  app.nodes.get("hall").listeners.get("pointermove")({ pointerId: 1, clientX: dm.x, clientY: dm.y });
  app.textCalls.length = 0;
  app.frames.shift()?.(performance.now() + 60);
  const texts = app.textCalls.map((call) => call.text);
  const plate = texts.indexOf(sample.tables[0].name);
  const name = texts.findIndex((text) => text.startsWith("DM "));
  assert.ok(plate >= 0, "hovering the DM shows their table's plate");
  assert.ok(name > plate, "and the DM's name is drawn after it, on top");
});


test("a stale practice snapshot loads at the correct wall-clock position", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const click = Date.parse(data.event.start) - 40 * DAY;
  data.generated_at = new Date(click + 300).toISOString();
  data.practice = { people: { u_lena: { position: "food", table: "t01" } }, speech: [],
    moves: [{ person: "u_lena", at: new Date(click).toISOString(), destination: "food", table: null }] };
  const originalNow = Date.now;
  Date.now = () => click + 180300;
  try {
    const app = await runApp([data], "practice-stale-load", { search: "?nocache=practice", liveFeed: LIVE_FEED });
    const layout = createRoomLayout(data.tables, data.room_layout);
    const expected = practicePlaces(data, Date.now(), layout).get("u_lena");
    assert.equal(expected.foodPhase, "eating");
    assert.ok(drawnNear(spritePositions(app), foodGeometry(layout, 0, 4).seat));
    assert.deepEqual(app.errors, []);
  } finally { Date.now = originalNow; }
});

test("practice clock uses the unchanged successful live poll and ignores failed polls and backups", async () => {
  const stale = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const start = Date.parse(stale.event.start) - 40 * DAY;
  stale.generated_at = new Date(start - 180000).toISOString();
  stale.practice = { people: { u_lena: { position: "table", table: "t01" } }, speech: [], moves: [] };
  const click = start + 8000;
  const changed = { ...stale, generated_at: new Date(click).toISOString(), practice: {
    people: { u_lena: { position: "food", table: "t01" } }, speech: [],
    moves: [{ person: "u_lena", at: new Date(click).toISOString(), destination: "food", table: null }],
  } };
  const layout = createRoomLayout(changed.tables, changed.room_layout);
  const [service] = practiceKitchenServices(changed, layout);
  const originalNow = Date.now;
  let wall = start + 90000;
  Date.now = () => wall;
  try {
    const app = await runApp([stale, stale, new Error("live unavailable"), stale, changed], "practice-poll-bound",
      { search: "?nocache=practice", liveFeed: LIVE_FEED });
    const refreshAt = async time => {
      wall = time;
      app.nodes.get("refresh-now").listeners.get("click")();
      await settle();
    };
    await refreshAt(start + 95000); // Unchanged successful poll: the next upper bound must use this time.
    assert.equal(app.fetchUrls.length, 2);
    await refreshAt(start + 97000); // Failed live poll followed by a successful stale backup.
    assert.equal(app.fetchUrls.length, 4);
    await refreshAt(click + 91000); // New snapshot received one server second after generation.
    assert.equal(app.fetchUrls.length, 5);
    document.hidden = true;
    let frame = performance.now() + 100;
    // hi = (start + 8 s) - (start + 95 s) + 2 s = -85 s: five seconds ahead of true time.
    // These positions straddle a phase boundary: using the load or failed poll time moves it.
    for (const [elapsed, phase, position] of [
      [19, "serving-first", queueSpot(layout, "first", 0)],
      [21, "serving-second", queueSpot(layout, "second", 0)],
      [100, "eating", foodGeometry(layout, 0, 4).seat],
      [401, undefined, seatPositionForPlan(layout, 0, 1)],
    ]) {
      const seconds = service.readyTime + elapsed;
      wall = seconds * 1000 + 85000;
      for (let i = 0; i < 400; i++) {
        app.imageCalls.length = 0;
        app.frames.shift()?.(frame += 100);
      }
      const expected = practicePlaces(changed, wall - 85000, layout).get("u_lena");
      assert.equal(expected.foodPhase, phase);
      assert.ok(drawnNear(spritePositions(app), position), `position at ${elapsed} s after readiness`);
    }
    assert.equal(app.fetchUrls.length, 5);
    assert.deepEqual(app.errors, []);
  } finally { Date.now = originalNow; }
});

test("practice food advances per frame using corrected wall time, without another poll", async () => {
  const data = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const click = Date.parse(data.event.start) - 40 * DAY;
  data.generated_at = new Date(click + 1000).toISOString();
  data.practice = { people: { u_lena: { position: "food", table: "t01" } }, speech: [],
    moves: [{ person: "u_lena", at: new Date(click).toISOString(), destination: "food", table: null }] };
  const layout = createRoomLayout(data.tables, data.room_layout), [service] = practiceKitchenServices(data, layout);
  const originalNow = Date.now;
  let wall = click - 89000; // This viewer's clock is 90 seconds slow.
  Date.now = () => wall;
  try {
    const app = await runApp([data], "practice-per-frame", { search: "?nocache=practice", liveFeed: LIVE_FEED });
    assert.deepEqual(app.errors, []);
    globalThis.document.hidden = true; // Frames keep running; no refresh can advance the phase for us.
    assert.ok(drawnNear(spritePositions(app), queueSpot(layout, "first", 0)));
    let frame = performance.now() + 100;
    const settleAt = seconds => {
      wall = seconds * 1000 - 90000;
      for (let i = 0; i < 400; i++) {
        app.imageCalls.length = 0;
        app.frames.shift()?.(frame += 100);
      }
      return spritePositions(app);
    };
    assert.ok(drawnNear(settleAt(service.readyTime + 1), queueSpot(layout, "first", 0)), "plating at the first queue");
    assert.ok(drawnNear(settleAt(service.readyTime + 100), foodGeometry(layout, 0, 4).seat), "eating at a stool");
    assert.ok(drawnNear(settleAt(service.readyTime + 401), seatPositionForPlan(layout, 0, 1)), "auto-return to the seat");
    assert.equal(app.fetchUrls.length, 1, "all phases advanced between polls");
  } finally { Date.now = originalNow; }
});

test("the host's break bubble draws above the table labels, like the other speech bubbles", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const brk = sample.events.find((event) => event.kind === "break");
  const app = await runApp([sample], "break-layer", { search: `?sample=1&kiosk=1&at=${brk.at + .2}` });
  const text = stageStepper(app)();
  assert.match(text, /Break time/);
  const bubble = app.contextCalls.findIndex((value) => value.includes("Break time!"));
  // The projector plates every table; a plate's title may wrap or end in an ellipsis, so any piece of a name counts.
  const labels = app.contextCalls.map((value) => value.replace(/…$/u, ""))
    .map((value, index) => value.length > 3 && sample.tables.some((table) => table.name.includes(value)) ? index : -1)
    .filter((index) => index >= 0);
  assert.ok(bubble >= 0, "the break bubble is drawn");
  assert.ok(labels.length > 0, "table labels are drawn");
  assert.ok(bubble > Math.max(...labels), `the bubble (call ${bubble}) follows every table label (last at ${Math.max(...labels)})`);
  assert.deepEqual(app.errors, []);
});
