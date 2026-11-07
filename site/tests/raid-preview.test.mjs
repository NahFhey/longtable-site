import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { previewVisible, previewLabel, setupRaidPreview, kioskTrailerPlaying, kioskTrailerCaption,
  kioskTrailerWindow } from "../raid-preview.mjs";
import { setupHallMusic } from "../music.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../app.mjs", import.meta.url), "utf8");

test("preview visibility covers all 64 status × kiosk × curtain × sample × archive combinations", () => {
  let cases = 0;
  for (const status of ["upcoming", "live", "ended", null]) {
    for (const kiosk of [false, true]) for (const curtainPlaying of [false, true]) for (const sample of [false, true])
    for (const archive of [false, true]) {
      assert.equal(previewVisible(status, { kiosk, curtainPlaying, sample, archive }),
        status !== "live" && !kiosk && !curtainPlaying && !sample && !archive,
        JSON.stringify({ status, kiosk, curtainPlaying, sample, archive }));
      cases++;
    }
  }
  assert.equal(cases, 64);
  assert.equal(previewVisible(undefined, {}), true, "no raid in the timeline shows Coming soon");
});

test("preview labels use the hall's short day/date and event-zone time, with a neutral ended label", () => {
  const options = { timeZone: "America/New_York", locale: "en-US" };
  assert.equal(previewLabel("upcoming", Date.parse("2026-10-30T22:00:00Z"), 0, options), "Opens Fri, Oct 30, 6:00 PM");
  assert.equal(previewLabel("upcoming", Date.parse("2026-11-07T14:00:00Z"), 0, options), "Opens Sat, Nov 7, 9:00 AM");
  assert.equal(previewLabel("upcoming", Date.parse("2026-11-07T14:00:00Z"), Date.parse("2027-01-01"), options),
    "Opens Sat, Nov 7, 9:00 AM", "the raid model owns status even when the viewer clock changes");
  assert.equal(previewLabel("ended", null, 0), "Raid trailer");
  for (const status of [null, undefined]) assert.equal(previewLabel(status, NaN, 0), "Coming soon");
  assert.equal(previewLabel("live", null, 0), "");
  assert.equal(previewLabel("upcoming", NaN, 0), "");
});

class Node {
  constructor(doc, attributes = {}) {
    this.doc = doc;
    this.attributes = new Map(Object.entries(attributes));
    this.handlers = new Map();
    this.children = [];
    this.style = {};
    this.hidden = "hidden" in attributes;
    this.textContent = "";
    this.paused = true;
    this.ended = false;
    this.muted = false;
    this.currentTime = 0;
    this.plays = 0;
    this.loads = 0;
    this.requests = [];
  }
  addEventListener(name, handler) {
    const handlers = this.handlers.get(name) ?? [];
    handlers.push(handler);
    this.handlers.set(name, handlers);
  }
  fire(name, event = {}) { for (const handler of this.handlers.get(name) ?? []) handler(event); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  get src() { return this.getAttribute("src"); }
  set src(value) { this.setAttribute("src", value); this.requests.push(value); }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.getAttribute("class") === selector.slice(1)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
  }
  focus() { this.doc.activeElement = this; }
  load() { this.loads++; this.currentTime = 0; }
  pause() { this.paused = true; }
  play() {
    this.plays++;
    this.paused = false;
    this.fire("play");
    return this.playResult?.() ?? Promise.resolve();
  }
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 960, height: 480 }; }
}

function fixture({ enabled = false, sample = false, raid = true, without = [] } = {}) {
  const nodes = new Map();
  const doc = new Node(null);
  doc.doc = doc;
  doc.getElementById = id => nodes.get(id) ?? null;
  doc.defaultView = new Node(doc);
  let saved = JSON.stringify({ enabled });
  doc.defaultView.localStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  // Build the preview nodes and attributes from the shipped markup, not a second template.
  for (const fragment of [html.match(/<button id="raid-preview-open"[\s\S]*?<\/button>/)[0],
    html.slice(html.indexOf('<div id="raid-preview"'), html.indexOf("  <footer>"))]) {
    const stack = [];
    for (const [, closing, tag, raw] of fragment.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
      if (closing) { stack.pop(); continue; }
      const attributes = Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)]
        .map(([, key, value]) => [key, value ?? ""]));
      const node = new Node(doc, attributes);
      if (attributes.id) nodes.set(attributes.id, node);
      stack.at(-1)?.children.push(node);
      stack.push(node);
    }
  }
  for (const id of ["hall", "hall-explorer", "hall-music", "music-panel", "music-toggle", "music-next", "music-close",
    "music-volume", "music-volume-value", "music-track", "music-status"]) nodes.set(id, new Node(doc));
  nodes.get("hall-explorer").open = true;
  const canvas = nodes.get("hall");
  canvas.rect = { left: 35, top: 100, width: 960, height: 480 };
  const parent = new Node(doc);
  parent.rect = { left: 20, top: 60, width: 960, height: 600 };
  nodes.get("raid-preview-open").parentElement = parent;
  const music = setupHallMusic(doc);
  const state = { scene: "hall", raid: raid ? { status: "upcoming" } : null, kiosk: false, archive: false, raidCurtain: null,
    camera: { x: 10, y: 20, zoom: 16 }, layout: { stage: { x: 30, y: 1, w: 5, h: 20 }, stageFront: { x: 31.5, y: 11 } },
    time: 3, data: { event: { start: "2026-11-07T14:00:00Z", tz: "America/New_York", slot_minutes: 15 },
      ...(raid ? { raid: { window: { start: 4 } } } : {}) } };
  for (const id of without) nodes.delete(id);
  const preview = setupRaidPreview({ canvas, music, getState: () => state, sample }, doc);
  preview?.update();
  const $ = id => nodes.get(id);
  return { $, doc, state, preview, music, settings: () => JSON.parse(saved),
    open() { $("raid-preview-open").fire("click"); },
    key(key, shiftKey = false) {
      const event = { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
      doc.fire("keydown", event);
      return event;
    } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("video has preload none and no source request before click; clicking opens and plays with sound", () => {
  const f = fixture();
  const video = f.$("raid-preview-video");
  assert.equal(video.getAttribute("preload"), "none");
  assert.equal(video.getAttribute("src"), null);
  assert.deepEqual(video.requests, []);
  assert.equal(video.plays, 0);
  assert.equal(video.getAttribute("controls"), null);
  assert.equal(video.getAttribute("loop"), null);
  assert.equal(video.getAttribute("autoplay"), null);
  // No poster: a still would show the spider mech before the trailer reveals it (Devin, 2026-10-22).
  assert.equal(video.getAttribute("poster"), null);
  f.open();
  assert.equal(f.$("raid-preview").hidden, false);
  assert.equal(f.$("raid-preview-open").getAttribute("aria-expanded"), "true");
  assert.equal(video.plays, 1);
  assert.equal(video.muted, false);
  assert.equal(video.currentTime, 0);
  assert.match(video.src, /assets\/raid\/preview\.mp4$/);
  assert.equal(video.requests.length, 1);
  assert.equal(f.doc.activeElement, f.$("raid-preview-close"));
  f.open();
  assert.equal(video.plays, 1, "an already open player does not restart");
});

for (const route of ["✕", "Escape", "outside", "ended"]) {
  test(`${route} closes the trailer, pauses video and returns focus to the arrow`, () => {
    const f = fixture();
    f.open();
    if (route === "✕") f.$("raid-preview-close").fire("click");
    if (route === "Escape") assert.equal(f.key("Escape").prevented, true);
    if (route === "outside") f.$("raid-preview").fire("click", { target: f.$("raid-preview") });
    if (route === "ended") f.$("raid-preview-video").fire("ended");
    assert.equal(f.$("raid-preview").hidden, true);
    assert.equal(f.$("raid-preview-video").paused, true);
    assert.equal(f.$("raid-preview-open").getAttribute("aria-expanded"), "false");
    assert.equal(f.doc.activeElement, f.$("raid-preview-open"));
    f.open();
    assert.equal(f.$("raid-preview-video").plays, 2);
    assert.equal(f.$("raid-preview-video").requests.length, 1, "reopening reuses the video source");
  });
}

test("clicks inside the frame and ordinary keys keep the overlay open; Tab stays in the controls", () => {
  const f = fixture();
  f.open();
  f.$("raid-preview").fire("click", { target: f.$("raid-preview-video") });
  f.key("a");
  assert.equal(f.$("raid-preview").hidden, false);
  assert.equal(f.key("Tab").prevented, true);
  assert.equal(f.doc.activeElement, f.$("raid-preview-mute"));
  f.key("Tab");
  assert.equal(f.doc.activeElement, f.$("raid-preview-close"));
  f.key("Tab", true);
  assert.equal(f.doc.activeElement, f.$("raid-preview-mute"));
});

test("mute toggles muted and its accessible state; reopening starts unmuted from the beginning", () => {
  const f = fixture();
  f.open();
  const video = f.$("raid-preview-video"), mute = f.$("raid-preview-mute");
  mute.fire("click");
  assert.equal(video.muted, true);
  assert.equal(mute.textContent, "Unmute");
  assert.equal(mute.getAttribute("aria-pressed"), "true");
  mute.fire("click");
  assert.equal(video.muted, false);
  assert.equal(mute.textContent, "Mute");
  mute.fire("click");
  video.currentTime = 12;
  f.key("Escape");
  f.open();
  assert.equal(video.muted, false);
  assert.equal(video.currentTime, 0);
});

test("a playing real jukebox pauses and resumes at 37s without loading or changing its preferences", async () => {
  const f = fixture({ enabled: true });
  await settle();
  const audio = f.music.audio;
  const before = { settings: f.settings(), title: f.music.currentTitle(), loads: audio.loads, plays: audio.plays };
  audio.currentTime = 37;
  assert.equal(audio.paused, false);
  f.open();
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 37);
  // A page-show sync or an earlier pending play must not overlap the trailer.
  f.doc.defaultView.fire("pageshow");
  await settle();
  assert.equal(audio.paused, true);
  const plays = audio.plays;
  f.key("Escape");
  await settle();
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 37);
  assert.equal(audio.plays, plays + 1);
  assert.equal(audio.loads, before.loads);
  assert.equal(f.music.currentTitle(), before.title);
  assert.deepEqual(f.settings(), before.settings);
});

test("a paused real jukebox stays paused after the trailer closes", async () => {
  const f = fixture({ enabled: true });
  await settle();
  f.$("music-toggle").fire("click");
  const audio = f.music.audio;
  audio.currentTime = 19;
  const plays = audio.plays;
  f.open();
  f.key("Escape");
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 19);
  assert.equal(audio.plays, plays);
  assert.equal(f.settings().enabled, false);
});

test("an untouched jukebox remains unloaded, and playback rejection leaves a closeable player", async () => {
  const f = fixture();
  f.$("raid-preview-video").playResult = () => Promise.reject(Error("unavailable"));
  f.open();
  await settle();
  assert.match(f.$("raid-preview-status").textContent, /Could not play/);
  f.key("Escape");
  assert.equal(f.$("raid-preview").hidden, true);
  assert.equal(f.music.audio.src, null);
  assert.equal(f.music.audio.plays, 0);
});

// The sign rests on the stage floor level with the stairs: anchor (32.5,19), box h 0 here, so y is the anchor's.
test("the per-frame update follows two camera transforms and canvas offsets: (545,364), (766,446)", () => {
  const f = fixture();
  const button = f.$("raid-preview-open");
  assert.equal(button.hidden, false);
  assert.deepEqual([button.style.left, button.style.top], ["545px", "364px"]);
  f.state.camera = { x: -29, y: -50, zoom: 24 };
  f.preview.update();
  assert.deepEqual([button.style.left, button.style.top], ["766px", "446px"]);
  f.state.camera.x = -2000;
  f.preview.update();
  assert.equal(button.hidden, false, "an off-screen curtain keeps the preview visible");
  assert.equal(button.getAttribute("data-pinned"), "true");
  assert.match(app, /updateCamera\(announcer\);\s+raidPreview\?\.update\(active\);\s+if \(!ctx\) return;/,
    "the update uses the current camera before either scene can return");
  assert.match(app, /sample: new URLSearchParams\(location.search\)\.get\("sample"\) === "raid"/);
});

test("DOM visibility follows status and flags, including missing/null raid and the ended hall", () => {
  for (const raid of [false, true]) {
    const f = fixture({ raid });
    const label = () => f.$("raid-preview-open").querySelector(".raid-preview-label").textContent;
    if (!raid) {
      assert.equal(f.$("raid-preview-open").hidden, false);
      assert.equal(label(), "Coming soon");
      f.state.data.raid = null;
      f.preview.update();
      assert.equal(f.$("raid-preview-open").hidden, false);
      assert.equal(label(), "Coming soon");
      f.state.archive = true;
      f.preview.update();
      assert.equal(f.$("raid-preview-open").hidden, true, "archive mode hides the arrow");
      f.state.archive = false;
      f.state.data = null;
      f.preview.update();
      assert.equal(f.$("raid-preview-open").hidden, true, "no timeline loaded yet");
      continue;
    }
    for (const change of [{ kiosk: true }, { raidCurtain: {} }, { raid: { status: "live" } }, { scene: "raid" }, { archive: true }]) {
      const before = { ...f.state };
      Object.assign(f.state, change);
      f.preview.update();
      assert.equal(f.$("raid-preview-open").hidden, true);
      Object.assign(f.state, before);
    }
    f.state.raid.status = "ended";
    f.preview.update();
    assert.equal(f.$("raid-preview-open").hidden, false);
    assert.equal(f.$("raid-preview-open").querySelector(".raid-preview-label").textContent, "Raid trailer");
  }
  const sample = fixture({ sample: true });
  sample.open();
  assert.equal(sample.$("raid-preview-open").hidden, true);
  assert.equal(sample.$("raid-preview-video").plays, 0);
});

test("a transition to live closes playback; optional missing preview markup is harmless", () => {
  const f = fixture();
  f.open();
  f.state.raid.status = "live";
  f.preview.update();
  assert.equal(f.$("raid-preview").hidden, true);
  assert.equal(f.$("raid-preview-video").paused, true);
  assert.equal(fixture({ without: ["raid-preview-video"] }).preview, null);
});

test("CSS guarantees 44×44 targets, a square token-colour frame, phone width and no reduced-motion bob", () => {
  const button = css.match(/\.raid-preview-open\s*\{([^}]+)\}/)[1];
  assert.match(button, /min-width: 44px/);
  assert.match(button, /min-height: 44px/);
  const board = css.match(/\.raid-preview-board\s*\{([^}]+)\}/)[1];
  assert.match(board, /linear-gradient\(#8a2629, #6d1c20\)/);
  assert.match(css, /\.raid-preview-head\s*\{[^}]*font: 700 15px\/19px Georgia, "Times New Roman", serif/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.raid-preview-board::before, \.raid-preview-board::after \{ animation: none; \} \}/);
  const frame = css.match(/\.raid-preview-frame\s*\{([^}]+)\}/)[1];
  assert.match(frame, /border: 2px solid var\(--gold\)/);
  assert.match(frame, /border-radius: 0/);
  assert.match(frame, /width: min\(960px, 100%,/);
  assert.match(css, /@media \(max-width: 650px\) \{ \.raid-preview \{ padding-inline: 0; \} \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.raid-preview-arrow \{ animation: none; \} \}/);
});

function placementFixture({ cameraControls = null } = {}) {
  const f = fixture();
  const button = f.$("raid-preview-open");
  const arrow = button.querySelector(".raid-preview-arrow");
  button.offsetWidth = 80;
  button.offsetHeight = 40;
  button.removeAttribute = name => button.attributes.delete(name);
  Object.assign(arrow, { offsetLeft: 30, offsetTop: 10, offsetWidth: 20, offsetHeight: 20 });
  const controls = cameraControls ? new Node(f.doc) : null;
  if (controls) {
    controls.rect = cameraControls;
    const getElementById = f.doc.getElementById;
    f.doc.getElementById = id => id === "camera-controls" ? controls : getElementById(id);
  }
  // Stage anchor is (32.5,19). Zoom=1 makes these camera offsets easy to check.
  const pointAt = (x, y) => { f.state.camera = { x: x - 32.5, y: y - 19, zoom: 1 }; f.preview.update(); };
  return { ...f, button, arrow, controls, pointAt };
}

test("panning back from a pin removes data-pinned and resets the arrow to 0deg", () => {
  const f = placementFixture();
  f.pointAt(1200, 240);
  assert.equal(f.button.hidden, false);
  assert.equal(f.button.getAttribute("data-pinned"), "true");
  assert.equal(f.arrow.style["--raid-preview-angle"], "-90deg", "plain style objects use the fallback assignment");
  assert.deepEqual([f.button.style.left, f.button.style.top], ["927px", "280px"],
    "right centre=960-8-40=912, plus parent offset (15,40)");
  f.pointAt(500, 200);
  assert.equal(f.button.hidden, false);
  assert.equal(f.button.getAttribute("data-pinned"), null);
  assert.equal(f.arrow.style["--raid-preview-angle"], "0deg");
  assert.deepEqual([f.button.style.left, f.button.style.top], ["515px", "220px"],
    "box bottom on the anchor: 200-20, plus parent offset 40");
});

test("update measures the glyph offsets and writes rotation with CSS setProperty", () => {
  const f = placementFixture();
  const writes = [];
  f.arrow.style.setProperty = (name, value) => writes.push([name, value]);
  Object.assign(f.arrow, { offsetLeft: 40, offsetTop: 20 });
  // Box centre=(912,240), glyph centre=(922,250), curtain=(1200,240).
  f.pointAt(1200, 240);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "--raid-preview-angle");
  assert.ok(Math.abs(parseFloat(writes[0][1]) - (-90 - Math.atan(5 / 139) * 180 / Math.PI)) < 1e-9);
  delete f.arrow.offsetTop;
  f.pointAt(1200, 240);
  assert.deepEqual(writes[1], ["--raid-preview-angle", "-90deg"], "missing glyph metrics fall back to its box centre");
});

test("update rereads camera controls and skips hidden or zero-size controls", () => {
  // Canvas=(35,100), parent=(20,60). Controls local=(8,280,44,192).
  const f = placementFixture({ cameraControls: { left: 43, top: 380, width: 44, height: 192 } });
  let reads = 0;
  f.controls.getBoundingClientRect = () => { reads++; return f.controls.rect; };
  // P=(-200,410), Q=(8,358): controls expanded top=272 gives centre y=252.
  f.pointAt(-200, 410);
  assert.deepEqual([f.button.style.left, f.button.style.top], ["63px", "292px"]);
  assert.equal(reads, 1);
  f.controls.rect.top = 330; // Expanded menu grows upward by 50px: local top=230, centre y=202.
  f.controls.rect.height = 242;
  f.pointAt(-200, 410);
  assert.deepEqual([f.button.style.left, f.button.style.top], ["63px", "242px"]);
  assert.equal(reads, 2);
  f.controls.hidden = true;
  f.pointAt(-200, 410);
  assert.deepEqual([f.button.style.left, f.button.style.top], ["63px", "398px"]);
  assert.equal(reads, 2, "hidden controls do not need measuring");
  f.controls.hidden = false;
  f.controls.rect.width = 0;
  f.pointAt(-200, 410);
  assert.deepEqual([f.button.style.left, f.button.style.top], ["63px", "398px"]);
  f.controls.rect.width = 44;
  f.controls.rect.height = 0;
  f.pointAt(-200, 410);
  assert.deepEqual([f.button.style.left, f.button.style.top], ["63px", "398px"]);
  assert.equal(reads, 4);
});

test("the shipped button has a marquee board with heading and label, followed by its pointer", () => {
  const f = fixture();
  const button = f.$("raid-preview-open");
  const board = button.querySelector(".raid-preview-board");
  const head = button.querySelector(".raid-preview-head");
  const label = button.querySelector(".raid-preview-label");
  const arrow = button.querySelector(".raid-preview-arrow");
  assert.deepEqual(button.children, [board, arrow]);
  assert.deepEqual(board.children, [head, label]);
  assert.equal(arrow.getAttribute("aria-hidden"), "true");
  const children = html.match(/<button id="raid-preview-open"[^>]*>([\s\S]*?)<\/button>/)[1].trim();
  assert.equal(children, '<span class="raid-preview-board"><span class="raid-preview-head">PREVIEW</span><span class="raid-preview-label"></span></span><span class="raid-preview-arrow" aria-hidden="true">▼</span>');
});

test("update flips near the canvas top, removes the flip after panning back, and clears it when pinned", () => {
  const f = fixture();
  const button = f.$("raid-preview-open");
  const arrow = button.querySelector(".raid-preview-arrow");
  button.offsetWidth = 194;
  button.offsetHeight = 70;
  // At 32px/tile, anchor y=60 leaves no room for the 70px box above, so it hangs below: centre 60+35.
  f.state.camera = { x: 480 - 32.5 * 32, y: 60 - 19 * 32, zoom: 32 };
  f.preview.update();
  assert.equal(button.getAttribute("data-flip"), "true");
  assert.equal(button.getAttribute("data-pinned"), null);
  assert.equal(arrow.style["--raid-preview-angle"], "180deg");
  assert.deepEqual([button.style.left, button.style.top], ["495px", "135px"]);
  f.state.camera.y = 400 - 19 * 32;
  f.preview.update();
  assert.equal(button.getAttribute("data-flip"), null);
  assert.equal(arrow.style["--raid-preview-angle"], "0deg");
  assert.deepEqual([button.style.left, button.style.top], ["495px", "405px"]);
  f.state.camera.y = 60 - 19 * 32;
  f.preview.update();
  assert.equal(button.getAttribute("data-flip"), "true");
  f.state.camera.x = -2000;
  f.preview.update();
  assert.equal(button.getAttribute("data-flip"), null);
  assert.equal(button.getAttribute("data-pinned"), "true");
});

test("the kiosk trailer plays only on a kiosk break, under the arrow's status, curtain, sample and archive rules", () => {
  for (const status of [null, undefined, "upcoming", "live", "ended"])
    for (const kiosk of [false, true]) for (const onBreak of [false, true]) for (const curtainPlaying of [false, true])
      for (const sample of [false, true]) for (const archive of [false, true])
        assert.equal(kioskTrailerPlaying(status, { kiosk, onBreak, curtainPlaying, sample, archive }),
          status !== "live" && kiosk && onBreak && !curtainPlaying && !sample && !archive,
          JSON.stringify({ status, kiosk, onBreak, curtainPlaying, sample, archive }));
});

test("the kiosk caption gives the break's end in the event zone", () => {
  const event = { start: "2026-11-07T14:00:00Z", tz: "America/New_York", slot_minutes: 15 };
  // Slot 2 + 2 slots of 15 minutes is 15:00Z, 10:00 AM in New York.
  assert.match(kioskTrailerCaption({ at: 2, duration: 2 }, event, { locale: "en-US" }), /^BREAK — back to your games at 10:00\sAM$/);
  assert.equal(kioskTrailerCaption({ at: 2, duration: 2 }, { ...event, start: "not a date" }), "BREAK");
});

test("the break's one play is centred on its middle, or starts at once in a break shorter than the trailer", () => {
  // 30-minute slots: the 60 s trailer is 1/30 of a slot.
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
  const { start, end } = kioskTrailerWindow({ at: 8, duration: 1 }, 30);
  close(start, 8 + (1 - 1 / 30) / 2);
  close(end, start + 1 / 30);
  close((start + end) / 2, 8.5);
  const short = kioskTrailerWindow({ at: 8, duration: 1 / 60 }, 30);
  close(short.start, 8);
  close(short.end, 8 + 1 / 30);
});

test("a kiosk break plays the trailer once, muted, in its middle under a caption, and nothing on screen closes it", () => {
  const f = fixture();
  f.state.kiosk = true;
  const overlay = f.$("raid-preview"), video = f.$("raid-preview-video"), caption = f.$("raid-preview-caption");
  // 15-minute slots: the 60 s trailer is 1/15 slot, centred on slot 3, the middle of slots 2 to 4.
  const onBreak = { kind: "break", at: 2, duration: 2 };
  f.state.time = 2.5;
  f.preview.update({ break: onBreak });
  assert.equal(overlay.hidden, true, "not at the start of the break");
  assert.deepEqual(video.requests, []);
  f.state.time = 3 - 1 / 30;
  f.preview.update({ break: onBreak });
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.getAttribute("data-kiosk"), "true");
  assert.equal(video.muted, true);
  assert.notEqual(video.loop, true, "one play, no loop");
  assert.equal(video.plays, 1);
  assert.equal(video.currentTime, 0);
  assert.match(video.src, /assets\/raid\/preview\.mp4$/);
  assert.match(caption.textContent, /^BREAK — back to your games at 10:00/);
  assert.equal(f.$("raid-preview-open").hidden, true, "the kiosk still shows no arrow");
  // A polled timeline hands over a new but equal break object every few seconds.
  f.state.time = 3;
  f.preview.update({ break: { ...onBreak } });
  assert.equal(video.plays, 1, "later frames of the same break never restart it");
  assert.equal(f.key("Escape").prevented, false);
  f.$("raid-preview").fire("click", { target: overlay });
  f.$("raid-preview-close").fire("click");
  assert.equal(overlay.hidden, false, "nobody at the projector can close it");
  f.preview.update({ break: { ...onBreak, duration: 4 } });
  assert.match(caption.textContent, /at 10:30/, "a stretched break moves the caption");
  f.state.time = 3.1;
  f.preview.update({ break: onBreak });
  assert.equal(overlay.hidden, false, "buffering past the window does not cut the play short");
  video.fire("ended");
  assert.equal(overlay.hidden, true);
  assert.equal(video.paused, true);
  assert.equal(overlay.getAttribute("data-kiosk"), null);
  assert.equal(caption.textContent, "");
  f.state.time = 3;
  f.preview.update({ break: onBreak });
  assert.equal(overlay.hidden, true, "once per break");
  assert.equal(video.plays, 1);

  const next = { kind: "break", at: 6, duration: 2 };
  f.state.time = 7;
  for (const change of [{ raid: { status: "live" } }, { raidCurtain: {} }, { scene: "raid" }, { archive: true }, { data: null }]) {
    const before = { ...f.state };
    Object.assign(f.state, change);
    f.preview.update({ break: next });
    assert.equal(overlay.hidden, true, JSON.stringify(Object.keys(change)));
    Object.assign(f.state, before);
  }
  f.preview.update({ break: next });
  assert.equal(overlay.hidden, false, "the next break gets its own play");
  assert.equal(video.plays, 2);
  f.preview.update({ break: null });
  assert.equal(overlay.hidden, true, "the break ending closes a play still running");

  const raid = fixture();
  raid.state.kiosk = true;
  raid.preview.update({ break: onBreak });
  assert.equal(raid.$("raid-preview").hidden, false);
  raid.state.raid = { status: "live" };
  raid.preview.update({ break: onBreak });
  assert.equal(raid.$("raid-preview").hidden, true, "the raid opening mid-play takes the projector back");

  const desk = fixture();
  desk.preview.update({ break: onBreak });
  assert.equal(desk.$("raid-preview").hidden, true, "a break never opens the trailer off the kiosk");
  assert.equal(desk.$("raid-preview-video").plays, 0);
});

test("the muted kiosk trailer leaves the projector's jukebox playing", async () => {
  const f = fixture({ enabled: true });
  await settle();
  f.state.kiosk = true;
  const audio = f.music.audio;
  audio.currentTime = 37;
  const plays = audio.plays;
  f.preview.update({ break: { kind: "break", at: 2, duration: 2 } });
  assert.equal(f.$("raid-preview").hidden, false);
  f.doc.defaultView.fire("pageshow");
  await settle();
  assert.equal(audio.paused, false);
  f.preview.update({ break: null });
  await settle();
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 37);
  assert.equal(audio.plays, plays, "closing never restarts music it did not pause");
});

test("a kiosk trailer that cannot play gives the hall back for the rest of that break", async () => {
  const f = fixture();
  f.state.kiosk = true;
  const overlay = f.$("raid-preview"), video = f.$("raid-preview-video");
  video.playResult = () => Promise.reject(Error("unavailable"));
  f.preview.update({ break: { kind: "break", at: 2, duration: 2 } });
  await settle();
  assert.equal(overlay.hidden, true);
  assert.equal(f.$("raid-preview-status").textContent, "", "no close-and-retry message on a projector");
  f.preview.update({ break: { kind: "break", at: 2, duration: 2 } });
  assert.equal(video.plays, 1, "the same break does not retry every frame");
  video.playResult = null;
  f.state.time = 6.5;
  f.preview.update({ break: { kind: "break", at: 6, duration: 1 } });
  assert.equal(overlay.hidden, false);
  assert.equal(video.plays, 2);
  video.fire("error");
  assert.equal(overlay.hidden, true, "a media error mid-play also returns to the hall");
  f.preview.update({ break: { kind: "break", at: 6, duration: 1 } });
  assert.equal(overlay.hidden, true);
});

test("the hall passes each frame's admin events, and kiosk CSS fills the screen with no controls", () => {
  assert.match(app, /raidPreview\?\.update\(active\);/);
  assert.match(html, /<p id="raid-preview-caption"><\/p>/);
  assert.match(css, /\.raid-preview\[data-kiosk\] \.raid-preview-controls \{ display: none; \}/);
  assert.match(css, /\.raid-preview\[data-kiosk\] \.raid-preview-frame \{\s*width: min\(100%, calc\(100vh \* 16 \/ 9\)\); width: min\(100%, calc\(100dvh \* 16 \/ 9\)\);/);
  assert.match(css, /#raid-preview-caption:empty \{ display: none; \}/);
});
