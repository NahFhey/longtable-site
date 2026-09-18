import test from "node:test";
import assert from "node:assert/strict";
import { createViewerClock, followNowClock, seekViewerClock, tickViewerClock, toggleViewerPlayback } from "../clock.mjs";

const data = {
  phase: "live", event: { start: "2026-11-07T10:00:00-05:00", slot_minutes: 30, slots: 8 }, events: [],
};
const start = Date.parse(data.event.start);
const slotMs = 30 * 60_000;

test("source, privacy phase, and viewer clock remain independent", () => {
  const during = start + slotMs;
  assert.deepEqual(createViewerClock(data, during), { source: "live", mode: "follow-now", slot: 1, autoFollow: false });
  for (const source of ["archive", "sample"]) {
    const clock = createViewerClock(data, during, { source });
    assert.equal(clock.mode, source === "archive" ? "paused" : "replay");
    assert.equal(clock.slot, 0);
    assert.deepEqual(followNowClock(clock, data, during), clock);
  }
  const final = createViewerClock({ ...data, phase: "final" }, during);
  assert.equal(final.mode, "paused");
  assert.equal(final.source, "live");
  for (const options of [{ mobile: true }, { reducedMotion: true }]) {
    assert.equal(createViewerClock(data, start - 1000, options).mode, "paused");
    assert.equal(createViewerClock(data, during, options).mode, "follow-now");
  }
});

test("manual rewind survives ticks and refreshed data until Return to Now", () => {
  const initial = createViewerClock(data, start + 4 * slotMs);
  const paused = seekViewerClock(initial, data, 1.5);
  const refreshed = { ...data, generated_at: "later" };
  assert.equal(tickViewerClock(paused, refreshed, start + 5 * slotMs, 1, 600).slot, 1.5);
  const playing = toggleViewerPlayback(paused, refreshed);
  const next = tickViewerClock(playing, refreshed, start + 5 * slotMs, 3, 600);
  assert.equal(next.mode, "replay");
  assert.equal(next.slot, 2.5);
  assert.equal(followNowClock(next, refreshed, start + 5 * slotMs).slot, 5);
  assert.equal(toggleViewerPlayback(initial, data).mode, "paused");
});

test("automatic follow starts at doors only until the viewer makes a time choice", () => {
  const preview = createViewerClock(data, start - 1);
  assert.equal(tickViewerClock(preview, data, start, 0.1, 600).mode, "follow-now");
  const chosen = seekViewerClock(preview, data, 3);
  assert.equal(tickViewerClock(chosen, data, start, 0.1, 600).mode, "paused");
  const replay = toggleViewerPlayback(chosen, data);
  assert.equal(tickViewerClock(replay, data, start, 0.1, 600).mode, "replay");
});

test("end boundaries do not rewind follow-now; replay ends paused and can restart", () => {
  const clock = createViewerClock(data, start);
  const atEnd = tickViewerClock(clock, data, start + 10 * slotMs, 1, 600);
  assert.equal(atEnd.slot, 8);
  assert.equal(atEnd.mode, "follow-now");
  const finalized = tickViewerClock(atEnd, { ...data, phase: "final" }, start + 10 * slotMs, 1, 600);
  assert.equal(finalized.mode, "paused");
  assert.equal(finalized.slot, 8);
  const playing = toggleViewerPlayback(seekViewerClock(clock, data, 7.9), data);
  const ended = tickViewerClock(playing, data, start, 1, 600);
  assert.equal(ended.slot, 8);
  assert.equal(ended.mode, "paused");
  assert.equal(toggleViewerPlayback(ended, data).slot, 0);
  assert.equal(seekViewerClock(clock, data, -1).slot, 0);
  assert.equal(seekViewerClock(clock, data, 100).slot, 8);
  assert.deepEqual(seekViewerClock(clock, data, NaN), clock);
});

test("replay obeys slot length and announcement speed caps", () => {
  const compressed = { ...data, event: { ...data.event, slot_minutes: 1 } };
  const clock = createViewerClock(compressed, start, { source: "sample" });
  assert.equal(tickViewerClock(clock, compressed, start, 0.1, 600).slot, 1);
  const announce = { ...compressed, events: [{ kind: "announce", at: 0 }] };
  assert.equal(tickViewerClock(clock, announce, start, 0.1, 600).slot, 0.05);
});
