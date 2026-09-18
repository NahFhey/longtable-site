import { activeEvents, modeAt, msToSlot, playbackSpeed } from "./model.mjs";

const clampSlot = (timeline, slot) => Math.max(0, Math.min(timeline.event.slots, slot));

/** Source, publication phase, and the viewer's clock are independent. */
export function createViewerClock(timeline, now, { source = "live", mobile = false, reducedMotion = false } = {}) {
  const canFollow = source === "live" && timeline.phase === "live";
  const follow = canFollow && modeAt(timeline, now) === "live";
  return {
    source,
    mode: follow ? "follow-now" : mobile || reducedMotion || source === "archive" || timeline.phase === "final" ? "paused" : "replay",
    slot: follow ? clampSlot(timeline, msToSlot(timeline, now)) : 0,
    autoFollow: canFollow && now < Date.parse(timeline.event.start),
  };
}

export function seekViewerClock(clock, timeline, slot) {
  if (!Number.isFinite(slot)) return clock;
  return { ...clock, mode: "paused", slot: clampSlot(timeline, slot), autoFollow: false };
}

export function toggleViewerPlayback(clock, timeline) {
  if (clock.mode !== "paused") return { ...clock, mode: "paused", autoFollow: false };
  return { ...clock, mode: "replay", slot: clock.slot >= timeline.event.slots ? 0 : clock.slot, autoFollow: false };
}

export function followNowClock(clock, timeline, now) {
  if (clock.source !== "live" || timeline.phase !== "live") return clock;
  return { ...clock, mode: "follow-now", slot: clampSlot(timeline, msToSlot(timeline, now)), autoFollow: false };
}

export function tickViewerClock(clock, timeline, now, elapsedSeconds, requestedSpeed) {
  if (clock.source === "live" && timeline.phase === "live"
      && (clock.mode === "follow-now" || (clock.autoFollow && now >= Date.parse(timeline.event.start)))) {
    return followNowClock(clock, timeline, now);
  }
  if (clock.mode === "follow-now") return seekViewerClock(clock, timeline, clock.slot);
  const slot = clampSlot(timeline, clock.slot);
  if (clock.mode !== "replay") return { ...clock, slot };
  const speed = playbackSpeed(requestedSpeed, activeEvents(timeline, slot));
  const next = clampSlot(timeline, slot + Math.max(0, elapsedSeconds) * speed / (timeline.event.slot_minutes * 60));
  return { ...clock, slot: next, mode: next >= timeline.event.slots ? "paused" : "replay" };
}
