import assert from 'node:assert/strict';
import { hallAmbience } from '../model.mjs';
const state = (data, seconds, reduced, room) => hallAmbience(data, seconds / (data.event.slot_minutes * 60), room, reduced);

/** Every sample covers the whole event. Locate null transitions exactly to check the door. */
export function checkContinuity(data, room, t) {
  const unit = data.event.slot_minutes * 60, end = data.event.slots * unit;
  let previous = state(data, 0, false, room).staff, largest = 0;
  for (let seconds = .25; seconds < end; seconds += .25) {
    const current = state(data, seconds, false, room).staff;
    if (previous && current) {
      const step = Math.hypot(current.x - previous.x, current.y - previous.y);
      largest = Math.max(largest, step);
      assert.ok(step <= 3.4 * .25 + 1e-6, `${seconds}s: step ${step}`);
    } else if (Boolean(previous) !== Boolean(current)) {
      let lo = seconds - .25, hi = seconds;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2, p = state(data, mid, false, room).staff;
        if (Boolean(p) === Boolean(previous)) lo = mid; else hi = mid;
      }
      const atDoor = state(data, current ? hi : lo, false, room).staff;
      assert.ok(Math.hypot(atDoor.x - room.doorPosition.x, atDoor.y - room.doorPosition.y) < 1e-6,
        `null transition away from door at ${seconds}`);
    }
    previous = current;
  }
  t.diagnostic(`largest step ${largest.toFixed(12)} tiles; full event at 0.25 s`);
}

