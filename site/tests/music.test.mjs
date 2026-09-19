import test from "node:test";
import assert from "node:assert/strict";
import { setupHallMusic, MUSIC_SETTINGS_KEY } from "../music.mjs";

class Node {
  constructor() { this.handlers = new Map(); this.value = ""; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  fire(name) { this.handlers.get(name)?.(); }
}
function fixture({ open = true, saved = null, storageBroken = false, play } = {}) {
  const nodes = Object.fromEntries(["hall-explorer", "hall-music", "music-controls", "music-toggle",
    "music-next", "music-volume", "music-volume-value", "music-track", "music-status"].map((id) => [id, new Node()]));
  const audio = nodes["hall-music"];
  Object.assign(audio, { paused: true, currentTime: 0, plays: 0, loads: 0,
    load() { this.loads++; this.currentTime = 0; this.error = null; },
    pause() { this.paused = true; },
    play() { this.plays++; this.paused = false; return play?.() ?? Promise.resolve(); },
  });
  nodes["hall-explorer"].open = open;
  const storage = { data: saved,
    getItem(key) { assert.equal(key, MUSIC_SETTINGS_KEY); if (storageBroken) throw Error("blocked"); return this.data; },
    setItem(key, value) { assert.equal(key, MUSIC_SETTINGS_KEY); if (storageBroken) throw Error("blocked"); this.data = value; },
  };
  const page = new Node();
  page.localStorage = storage;
  setupHallMusic({ getElementById: (id) => nodes[id], defaultView: page });
  const $ = (id) => nodes[id];
  return { $, audio, storage, page, hall(open) { $("hall-explorer").open = open; $("hall-explorer").fire("toggle"); } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("open hall starts at 50%, alternates both recordings, and wraps", async () => {
  const { $, audio } = fixture();
  await settle();
  assert.equal(audio.volume, 0.5);
  assert.equal(audio.muted, false);
  assert.equal(audio.playbackRate, 1);
  assert.equal(audio.defaultPlaybackRate, 1);
  assert.match(audio.src, /The_Old_Tower_Inn.mp3$/);
  assert.equal($("music-status").textContent, "Playing");
  audio.fire("ended");
  await settle();
  assert.match(audio.src, /The_Bards_Tale.mp3$/);
  audio.fire("ended");
  await settle();
  assert.match(audio.src, /The_Old_Tower_Inn.mp3$/);
  $("music-next").fire("click");
  assert.match(audio.src, /The_Bards_Tale.mp3$/);
});

test("closed hall defers loading and reopening resumes the same position", async () => {
  const f = fixture({ open: false });
  assert.equal(f.audio.src, undefined);
  assert.equal(f.audio.plays, 0);
  f.hall(true);
  await settle();
  f.audio.currentTime = 37;
  f.hall(false);
  assert.equal(f.audio.paused, true);
  f.hall(true);
  await settle();
  assert.equal(f.audio.currentTime, 37);
  assert.equal(f.audio.loads, 1);
  assert.equal(f.audio.paused, false);
});

test("volume including zero and mute persist across page loads", async () => {
  const f = fixture();
  await settle();
  f.$("music-volume").value = "23";
  f.$("music-volume").fire("input");
  f.$("music-toggle").fire("click");
  const restored = fixture({ saved: f.storage.data });
  assert.equal(restored.audio.volume, 0.23);
  assert.equal(restored.audio.muted, true);
  assert.equal(restored.audio.src, undefined);
  restored.hall(false);
  restored.hall(true);
  assert.equal(restored.audio.plays, 0);
  restored.$("music-toggle").fire("click");
  await settle();
  assert.equal(restored.audio.paused, false);
  restored.$("music-volume").value = "0";
  restored.$("music-volume").fire("input");
  assert.equal(fixture({ saved: restored.storage.data }).audio.volume, 0);
});

test("invalid or inaccessible saved preferences safely use defaults", () => {
  for (const saved of ["{bad", "null", '"string"', '{"volume":4,"muted":"false"}', '{"volume":-1}']) {
    const f = fixture({ saved });
    assert.equal(f.audio.volume, 0.5);
    assert.equal(f.audio.muted, false);
  }
  const f = fixture({ storageBroken: true });
  f.$("music-volume").value = "80";
  f.$("music-volume").fire("input");
  assert.equal(f.audio.volume, 0.8);
});

test("autoplay rejection offers an explicit retry without saving a mute choice", async () => {
  let blocked = true;
  const f = fixture({ play: () => blocked ? Promise.reject({ name: "NotAllowedError" }) : Promise.resolve() });
  await settle();
  assert.equal(f.$("music-toggle").textContent, "Play music");
  assert.equal(f.storage.data, null);
  blocked = false;
  f.$("music-toggle").fire("click");
  await settle();
  assert.equal(f.$("music-status").textContent, "Playing");
  assert.equal(f.audio.muted, false);
});

test("closing or muting while play is pending prevents late playback", async () => {
  for (const stop of [(f) => f.hall(false), (f) => f.$("music-toggle").fire("click")]) {
    let resolve;
    const f = fixture({ play: () => new Promise((done) => { resolve = done; }) });
    stop(f);
    f.audio.paused = false;
    resolve();
    await settle();
    assert.equal(f.audio.paused, true);
    assert.notEqual(f.$("music-status").textContent, "Playing");
  }
});

test("stale play failures cannot override a new playback attempt", async () => {
  let reject;
  let first = true;
  const f = fixture({ play: () => {
    if (!first) return Promise.resolve();
    first = false;
    return new Promise((_, fail) => { reject = fail; });
  } });
  f.hall(false);
  f.hall(true);
  await settle();
  reject({ name: "NotAllowedError" });
  await settle();
  assert.equal(f.$("music-status").textContent, "Playing");
});

test("media failures offer retry and next without infinite automatic requests", async () => {
  let broken = true;
  const f = fixture({ play: () => broken ? Promise.reject({ name: "NotSupportedError" }) : Promise.resolve() });
  await settle();
  assert.equal(f.$("music-toggle").textContent, "Retry music");
  assert.equal(f.audio.plays, 1);
  broken = false;
  f.$("music-next").fire("click");
  await settle();
  assert.equal(f.$("music-status").textContent, "Playing");
  assert.match(f.audio.src, /The_Bards_Tale.mp3$/);
  f.audio.error = { code: 2 };
  f.audio.fire("error");
  assert.equal(f.$("music-toggle").textContent, "Retry music");
  f.$("music-toggle").fire("click");
  await settle();
  assert.equal(f.$("music-status").textContent, "Playing");
});

test("page navigation pauses and returning resumes, with mute respected", async () => {
  const f = fixture();
  await settle();
  f.page.fire("pagehide");
  assert.equal(f.audio.paused, true);
  f.page.fire("pageshow");
  await settle();
  assert.equal(f.audio.paused, false);
  f.$("music-toggle").fire("click");
  f.page.fire("pagehide");
  f.page.fire("pageshow");
  assert.equal(f.audio.paused, true);
});
