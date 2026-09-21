import test from "node:test";
import assert from "node:assert/strict";
import { setupHallMusic, MUSIC_SETTINGS_KEY, HALL_PLAYLIST } from "../music.mjs";

class Node {
  constructor() { this.handlers = new Map(); this.value = ""; this.hidden = false; this.focused = 0; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  fire(name, event) { this.handlers.get(name)?.(event); }
  focus() { this.focused += 1; }
}
const PANEL_IDS = ["hall-explorer", "hall-music", "music-panel", "music-toggle", "music-next", "music-close",
  "music-volume", "music-volume-value", "music-track", "music-status"];
/** `saved` seeds storage; `enabled: true` seeds the first-click gate so a test can start from a playing hall. */
function fixture({ open = true, saved = null, enabled = false, storageBroken = false, play, without = [] } = {}) {
  const nodes = Object.fromEntries(PANEL_IDS.filter((id) => !without.includes(id)).map((id) => [id, new Node()]));
  nodes.hall = new Node();
  const audio = nodes["hall-music"];
  if (audio) Object.assign(audio, { paused: true, currentTime: 0, plays: 0, loads: 0,
    load() { this.loads++; this.currentTime = 0; this.error = null; },
    pause() { this.paused = true; },
    play() { this.plays++; this.paused = false; return play?.() ?? Promise.resolve(); },
  });
  if (nodes["hall-explorer"]) nodes["hall-explorer"].open = open;
  nodes["music-panel"] && (nodes["music-panel"].hidden = true);
  const storage = { data: saved ?? (enabled ? JSON.stringify({ enabled: true }) : null),
    getItem(key) { assert.equal(key, MUSIC_SETTINGS_KEY); if (storageBroken) throw Error("blocked"); return this.data; },
    setItem(key, value) { assert.equal(key, MUSIC_SETTINGS_KEY); if (storageBroken) throw Error("blocked"); this.data = value; },
  };
  const page = new Node();
  page.localStorage = storage;
  const music = setupHallMusic({ getElementById: (id) => nodes[id] ?? null, defaultView: page });
  const $ = (id) => nodes[id];
  return { $, audio, storage, page, music, nodes,
    hall(open) { $("hall-explorer").open = open; $("hall-explorer").fire("toggle"); },
    click() { music.togglePanel(); },
    settings() { return JSON.parse(storage.data); },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("music never starts until the jukebox is clicked once; the first click enables, saves, opens and plays", async () => {
  const f = fixture();
  await settle();
  assert.equal(f.audio.plays, 0);
  assert.equal(f.audio.src, undefined);
  assert.equal(f.music.isPlaying(), false);
  assert.equal(f.music.panelOpen(), false);
  assert.equal(f.$("music-panel").hidden, true);
  assert.equal(f.$("music-toggle").textContent, "Play music");
  assert.equal(f.storage.data, null);
  f.click();
  await settle();
  assert.deepEqual(f.settings(), { volume: 0.5, muted: false, track: 0, enabled: true });
  assert.equal(f.music.panelOpen(), true);
  assert.equal(f.$("music-panel").hidden, false);
  assert.equal(f.$("music-toggle").focused, 1, "opening moves focus to the play button");
  assert.equal(f.audio.plays, 1);
  assert.equal(f.music.isPlaying(), true);
  assert.equal(f.music.currentTitle(), "The Old Tower Inn");
  assert.equal(f.$("music-track").textContent, "The Old Tower Inn — RandomMind");
  assert.equal(f.$("music-toggle").textContent, "Pause music");
  assert.equal(f.$("music-status").textContent, "Playing");
});

test("an enabled hall starts at 50%, plays every recording in order, wraps, and remembers the track", async () => {
  const f = fixture({ enabled: true });
  await settle();
  assert.equal(f.audio.volume, 0.5);
  assert.equal(f.audio.muted, false);
  assert.equal(f.audio.playbackRate, 1);
  assert.equal(f.audio.defaultPlaybackRate, 1);
  assert.match(f.audio.src, /The_Old_Tower_Inn.mp3$/);
  assert.equal(f.$("music-status").textContent, "Playing");
  f.audio.fire("ended");
  await settle();
  assert.match(f.audio.src, /The_Bards_Tale.mp3$/);
  assert.equal(f.settings().track, 1);
  assert.equal(f.music.currentTitle(), HALL_PLAYLIST[1].title);
  assert.equal(f.$("music-track").textContent, `${HALL_PLAYLIST[1].title} — ${HALL_PLAYLIST[1].artist}`);
  for (let track = 2; track < HALL_PLAYLIST.length; ++track) {
    f.audio.fire("ended");
    await settle();
    assert.ok(f.audio.src.endsWith(`/${HALL_PLAYLIST[track].file}`), `track ${track}: ${f.audio.src}`);
    assert.equal(f.settings().track, track);
  }
  f.audio.fire("ended");
  await settle();
  assert.match(f.audio.src, /The_Old_Tower_Inn.mp3$/);
  assert.equal(f.settings().track, 0);
  f.$("music-next").fire("click");
  assert.match(f.audio.src, /The_Bards_Tale.mp3$/);
  assert.equal(f.settings().track, 1);
});

test("a saved track index starts on that recording; an invalid one is ignored", async () => {
  const second = fixture({ saved: JSON.stringify({ enabled: true, track: 1 }) });
  await settle();
  assert.match(second.audio.src, /The_Bards_Tale.mp3$/);
  assert.equal(second.music.currentTitle(), "The Bard’s Tale");
  for (const track of [HALL_PLAYLIST.length, -1, 1.5, "1", null]) {
    const f = fixture({ saved: JSON.stringify({ enabled: true, track }) });
    await settle();
    assert.match(f.audio.src, /The_Old_Tower_Inn.mp3$/, `track ${JSON.stringify(track)}`);
  }
});

test("the legacy { volume, muted } shape still loads, with the gate closed until a click", async () => {
  const f = fixture({ saved: JSON.stringify({ volume: 0.23, muted: false }) });
  await settle();
  assert.equal(f.audio.volume, 0.23);
  assert.equal(f.$("music-volume").value, "23");
  assert.equal(f.audio.plays, 0);
  f.click();
  await settle();
  assert.equal(f.audio.plays, 1);
  assert.equal(f.audio.volume, 0.23);
  assert.deepEqual(f.settings(), { volume: 0.23, muted: false, track: 0, enabled: true });
});

test("closed hall defers loading, reopening resumes the same position, and collapsing closes the panel", async () => {
  const f = fixture({ open: false, enabled: true });
  assert.equal(f.audio.src, undefined);
  assert.equal(f.audio.plays, 0);
  f.hall(true);
  await settle();
  f.click();
  assert.equal(f.music.panelOpen(), true);
  f.audio.currentTime = 37;
  f.hall(false);
  assert.equal(f.audio.paused, true);
  assert.equal(f.music.isPlaying(), false);
  assert.equal(f.music.panelOpen(), false);
  assert.equal(f.$("music-panel").hidden, true);
  f.hall(true);
  await settle();
  assert.equal(f.audio.currentTime, 37);
  assert.equal(f.audio.loads, 1);
  assert.equal(f.audio.paused, false);
  assert.equal(f.music.panelOpen(), false, "panel open state is not persisted across hall toggles");
});

test("Pause turns the gate off and saves; Play turns it back on", async () => {
  const f = fixture({ enabled: true });
  await settle();
  assert.equal(f.$("music-toggle").textContent, "Pause music");
  f.$("music-toggle").fire("click");
  assert.equal(f.audio.paused, true);
  assert.equal(f.settings().enabled, false);
  assert.equal(f.$("music-toggle").textContent, "Play music");
  assert.equal(f.$("music-status").textContent, "Music paused.");
  assert.equal(f.music.isPlaying(), false);
  const reloaded = fixture({ saved: f.storage.data });
  await settle();
  assert.equal(reloaded.audio.plays, 0, "a paused jukebox stays quiet on the next visit");
  f.$("music-toggle").fire("click");
  await settle();
  assert.equal(f.audio.paused, false);
  assert.equal(f.settings().enabled, true);
  assert.equal(f.$("music-toggle").textContent, "Pause music");
});

test("the volume slider mutes at zero, unmutes above it, and both persist across page loads", async () => {
  const f = fixture({ enabled: true });
  await settle();
  f.$("music-volume").value = "23";
  f.$("music-volume").fire("input");
  assert.equal(f.audio.volume, 0.23);
  assert.equal(f.audio.paused, false);
  f.$("music-volume").value = "0";
  f.$("music-volume").fire("input");
  assert.equal(f.audio.paused, true);
  assert.equal(f.settings().muted, true);
  assert.equal(f.settings().volume, 0);
  assert.equal(f.$("music-status").textContent, "Music muted.");
  assert.equal(f.music.isPlaying(), false);
  const restored = fixture({ saved: f.storage.data });
  assert.equal(restored.audio.volume, 0);
  assert.equal(restored.audio.muted, true);
  assert.equal(restored.audio.plays, 0);
  restored.$("music-volume").value = "40";
  restored.$("music-volume").fire("input");
  await settle();
  assert.equal(restored.audio.paused, false);
  assert.equal(restored.settings().muted, false);
  assert.equal(restored.audio.volume, 0.4);
  // Play on a muted jukebox restores sound instead of playing silence.
  restored.$("music-volume").value = "0";
  restored.$("music-volume").fire("input");
  restored.$("music-toggle").fire("click");
  await settle();
  assert.equal(restored.audio.paused, false);
  assert.equal(restored.settings().muted, false);
  assert.equal(restored.audio.volume, 0.5);
});

test("the close button and Escape close the panel and return focus to the hall canvas", () => {
  const f = fixture({ enabled: true });
  f.click();
  assert.equal(f.music.panelOpen(), true);
  f.$("music-close").fire("click");
  assert.equal(f.music.panelOpen(), false);
  assert.equal(f.$("music-panel").hidden, true);
  assert.equal(f.nodes.hall.focused, 1);
  f.click();
  f.$("music-panel").fire("keydown", { key: "a" });
  assert.equal(f.music.panelOpen(), true);
  f.$("music-panel").fire("keydown", { key: "Escape" });
  assert.equal(f.music.panelOpen(), false);
  assert.equal(f.nodes.hall.focused, 2);
  f.music.closePanel();
  assert.equal(f.nodes.hall.focused, 2, "closing an already closed panel moves no focus");
  f.click();
  f.click();
  assert.equal(f.music.panelOpen(), false, "a second jukebox click hides the panel");
});

test("invalid or inaccessible saved preferences safely use defaults", () => {
  for (const saved of ["{bad", "null", '"string"', '{"volume":4,"muted":"false","enabled":"yes"}', '{"volume":-1}']) {
    const f = fixture({ saved });
    assert.equal(f.audio.volume, 0.5);
    assert.equal(f.audio.muted, false);
    assert.equal(f.audio.plays, 0);
  }
  const f = fixture({ storageBroken: true });
  f.$("music-volume").value = "80";
  f.$("music-volume").fire("input");
  assert.equal(f.audio.volume, 0.8);
  f.click();
  assert.equal(f.audio.plays, 1, "the gate opens for the session even without storage");
});

test("a missing panel element leaves the hall without music", () => {
  for (const id of ["music-panel", "music-close", "hall-music"]) {
    assert.equal(fixture({ without: [id] }).music, null, id);
  }
});

test("autoplay rejection offers an explicit Play, and the sign reports no music until it succeeds", async () => {
  let blocked = true;
  const f = fixture({ enabled: true, play: () => blocked ? Promise.reject({ name: "NotAllowedError" }) : Promise.resolve() });
  await settle();
  assert.equal(f.$("music-toggle").textContent, "Play music");
  assert.equal(f.$("music-status").textContent, "Press Play music to enable audio.");
  assert.equal(f.music.isPlaying(), false);
  assert.equal(f.storage.data, JSON.stringify({ enabled: true }), "a blocked attempt saves no choice");
  f.click();
  await settle();
  assert.equal(f.music.panelOpen(), true, "a blocked jukebox still opens its panel");
  assert.equal(f.$("music-toggle").textContent, "Play music");
  blocked = false;
  f.$("music-toggle").fire("click");
  await settle();
  assert.equal(f.$("music-status").textContent, "Playing");
  assert.equal(f.music.isPlaying(), true);
  assert.equal(f.audio.muted, false);
});

test("closing or pausing while play is pending prevents late playback", async () => {
  for (const stop of [(f) => f.hall(false), (f) => f.$("music-toggle").fire("click"), (f) => { f.$("music-volume").value = "0"; f.$("music-volume").fire("input"); }]) {
    let resolve;
    const f = fixture({ enabled: true, play: () => new Promise((done) => { resolve = done; }) });
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
  const f = fixture({ enabled: true, play: () => {
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
  const f = fixture({ enabled: true, play: () => broken ? Promise.reject({ name: "NotSupportedError" }) : Promise.resolve() });
  await settle();
  assert.equal(f.$("music-toggle").textContent, "Retry music");
  assert.equal(f.audio.plays, 1);
  assert.equal(f.music.isPlaying(), false);
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

test("page navigation pauses and returning resumes, with a pause respected", async () => {
  const f = fixture({ enabled: true });
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
