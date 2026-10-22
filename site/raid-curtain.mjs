/** The raid room (and its page layout) takes over from the hall at this point of the sequence. */
export const CURTAIN_RAID_MS = 5000;
const clamp = value => Math.max(0, Math.min(1, value));

/** Only continuous forward playback across the opening gets a cinematic. */
export function shouldPlayRaidCurtain({ previousScene, nextScene, previousTime, nextTime,
  windowStart, reducedMotion, cause }) {
  return cause === "tick" && !reducedMotion && previousScene === "hall" && nextScene === "raid"
    && Number.isFinite(previousTime) && Number.isFinite(nextTime) && Number.isFinite(windowStart)
    && previousTime < windowStart && nextTime >= windowStart
    && nextTime - previousTime > 0 && nextTime - previousTime < 1;
}

function pointOnRoute(points, progress) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let distance = lengths.reduce((sum, length) => sum + length, 0) * progress;
  for (let index = 0; index < lengths.length; index++) {
    if (distance > lengths[index]) { distance -= lengths[index]; continue; }
    const from = points[index], to = points[index + 1], fraction = lengths[index] ? distance / lengths[index] : 0;
    return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction,
      facing: to.x < from.x ? -1 : 1 };
  }
  return { ...points.at(-1), facing: 1 };
}

/** Drawing overrides only. Members carry their seat and optional hall-aisle approach.
 * Parties leave in stable table order; everyone reaches the opening before 4s.
 * No event time, runtime sprite or ambience object is changed here.
 */
export function curtainFrame(elapsedMs, members, { foot, landing, opening }) {
  const elapsed = Math.max(0, elapsedMs);
  const tables = [...new Set(members.map(member => member.table))].sort();
  const entrance = { x: opening.x + opening.w / 2, y: opening.y + opening.h / 2 };
  const parties = new Map(tables.map(table => [table, members.filter(member => member.table === table)
    .slice().sort((a, b) => a.id.localeCompare(b.id))]));
  const people = members.flatMap(member => {
    const party = parties.get(member.table);
    const start = 1000 + tables.indexOf(member.table) / Math.max(1, tables.length - 1) * 1200
      + party.indexOf(member) / Math.max(1, party.length - 1) * 250;
    const progress = clamp((elapsed - start) / 1500);
    if (progress === 1) return [];
    const position = pointOnRoute([member.seat, ...(member.approach ?? []), foot, landing, entrance], progress);
    return [{ id: member.id, table: member.table, ...position, moving: progress > 0 }];
  });
  return {
    beat: elapsed < 1000 ? "curtain" : elapsed < 4000 ? "walk" : elapsed < CURTAIN_RAID_MS ? "dark" : "raid",
    curtain: { open: clamp(elapsed / 1000), opening: { ...opening } }, people,
    dark: clamp((elapsed - 4000) / 1000), raidAlpha: clamp((elapsed - CURTAIN_RAID_MS) / 1000), done: elapsed >= 6000,
  };
}
