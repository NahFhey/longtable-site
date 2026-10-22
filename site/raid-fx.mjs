export const RAID_EFFECT_CAP = 12;
const DURATIONS = Object.freeze({ hit: 2.4, strike: 2, discharge: 2, collapse: 1, death: 2.4 });
const indexes = new WeakMap();

// Timeline snapshots are immutable, as in raid-model. Build once; frames only seek the index.
function indexFor(timeline) {
  let index = indexes.get(timeline);
  if (index) return index;
  index = [];
  const hp = new Map();
  let king = null, dead = false, end = timeline.raid.window.end;
  for (const entry of timeline.raid.log) {
    if (entry.at > end) break;
    const add = (kind, fields = {}) => {
      if (!entry.admin) index.push({ kind, at: entry.at, duration: DURATIONS[kind], ...fields });
    };
    switch (entry.kind) {
      case "open": for (const leg of entry.legs) hp.set(leg.leg, leg.max); break;
      case "leg_hp":
      case "leg_destroyed": {
        const next = entry.kind === "leg_destroyed" ? 0 : entry.hp;
        const amount = (hp.get(entry.leg) ?? next) - next;
        if (amount > 0) add("hit", { leg: entry.leg, amount });
        hp.set(entry.leg, next); break;
      }
      case "leg_max":
      case "leg_revived": hp.set(entry.leg, entry.hp); break;
      case "king_max": king = entry.hp; dead = king === 0; break;
      case "king_hp":
        if (king !== null && entry.hp < king) add("hit", { amount: king - entry.hp });
        if (entry.hp === 0 && !dead) add("death");
        king = entry.hp; dead = king === 0; break;
      case "strike": add("strike", { timer: entry.timer, targets: [...entry.targets] }); break;
      case "discharge": add("discharge", { targets: [...entry.targets] }); break;
      case "phase": if (entry.phase === 2 && entry.cause === "collapse") add("collapse"); break;
      case "admin": if (entry.action === "window") end = entry.window.end; break;
      case "end":
        if (entry.result === "won" && !dead) add("death");
        indexes.set(timeline, index); return index;
    }
  }
  indexes.set(timeline, index); return index;
}

/** Event seconds, independent of playback speed, wall time, canvas and seek direction. */
export function raidEffects(timeline, slot) {
  if (!timeline.raid || !Number.isFinite(slot)) return [];
  const index = indexFor(timeline), seconds = timeline.event.slot_minutes * 60;
  let lo = 0, hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid].at <= slot) lo = mid + 1; else hi = mid;
  }
  const effects = [];
  // All effects last at most 2.4 s. Even a dense timestamp visits at most the latest 12.
  for (let i = lo - 1; i >= Math.max(0, lo - RAID_EFFECT_CAP); i--) {
    const effect = index[i], elapsed = (slot - effect.at) * seconds;
    if (elapsed >= 2.4) break;
    if (elapsed < effect.duration) effects.push({ ...effect,
      ...(effect.targets ? { targets: [...effect.targets] } : {}), progress: elapsed / effect.duration });
  }
  return effects.reverse();
}

/** A short triangular step every 7.2 s, with a stable per-id phase (FNV-1a). */
export function raidLunge(id, nowMs, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(nowMs)) return 0;
  let hash = 2166136261;
  const text = String(id);
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  // Mix neighbouring numeric ids before assigning their phases.
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0;
  const phase = ((nowMs + hash % 7200) % 7200 + 7200) % 7200;
  return phase < 700 ? 1 - Math.abs(phase / 350 - 1) : 0;
}

const U = 32;
const pixel = n => Math.round(n * U);
export function raidFoot(layout, anchors, id) {
  return layout.stations?.legs[id]?.foot ?? (anchors[id] &&
    [layout.boss.x + anchors[id][0] * layout.boss.w, layout.boss.y + anchors[id][1] * layout.boss.h]);
}
function line(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => { if (i) ctx.lineTo(Math.round(x), Math.round(y)); else ctx.moveTo(Math.round(x), Math.round(y)); });
  ctx.stroke();
}
function burst(ctx, x, y, progress, floor = false) {
  const spread = 10 + progress * 70;
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / (floor ? 11 : 6);
    const dx = Math.cos(angle) * spread, dy = -Math.sin(angle) * spread * (floor ? .35 : 1);
    ctx.fillRect(Math.round(x + dx), Math.round(y + dy), 6, 6);
  }
}

/** Overlays share the room's world-pixel transform and existing label font. */
export function drawRaidEffects(ctx, effects, layout, anchors, reducedMotion) {
  const boss = layout.boss, bx = pixel(boss.x + boss.w / 2), by = pixel(boss.y + boss.h / 2);
  ctx.save(); ctx.lineWidth = 4; ctx.lineCap = "square"; ctx.lineJoin = "miter";
  for (const effect of effects) {
    const p = reducedMotion ? .3 : effect.progress;
    ctx.globalAlpha = reducedMotion ? .85 : 1 - p * .65;
    if (effect.kind === "hit") {
      const foot = effect.leg ? raidFoot(layout, anchors, effect.leg) : null;
      if (effect.leg && !foot) continue;
      const x = foot ? pixel(foot[0]) : bx, y = foot ? pixel(foot[1]) : by;
      const radius = Math.round(12 + p * 14);
      ctx.fillStyle = "#f1eadb"; ctx.strokeStyle = "#dfba76";
      ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillText(`-${effect.amount}`, x, Math.round(y - 24 - (reducedMotion ? 0 : p * 50)));
    } else if (effect.kind === "strike" || effect.kind === "discharge") {
      const core = effect.timer === "core", discharge = effect.kind === "discharge";
      ctx.strokeStyle = discharge ? "#dfba76" : core ? "#d9604c" : "#9cdbcd";
      ctx.fillStyle = ctx.strokeStyle;
      for (const group of layout.groups) {
        if (!effect.targets.includes(group.table)) continue;
        const tx = pixel(group.x), ty = pixel(group.y), bend = core || discharge ? 20 : -12;
        line(ctx, [[bx, by], [(bx + tx) / 2 + bend, (by + ty) / 2 - bend], [tx, ty]]);
        ctx.fillRect(tx - 5, ty - 5, 10, 10);
        for (const person of layout.people) if (person.table === group.table)
          ctx.strokeRect(pixel(person.x) - 15, pixel(person.y) - 30, 30, 36);
        // Also visible when the party has no seated people, outside its screen-space plate.
        ctx.strokeRect(pixel(group.label.x - group.label.w / 2) - 4,
          pixel(group.label.y - group.label.h / 2) - 4, pixel(group.label.w) + 8, pixel(group.label.h) + 8);
      }
    } else if (effect.kind === "collapse") {
      ctx.fillStyle = "#b1b5a8";
      burst(ctx, bx, pixel(boss.y + boss.h * .94), p, true);
    } else if (effect.kind === "death") {
      ctx.fillStyle = "#f1eadb"; ctx.strokeStyle = "#f1eadb";
      ctx.globalAlpha *= .45;
      ctx.fillRect(bx - 50, by - 65, 100, 100);
      ctx.globalAlpha = reducedMotion ? .85 : 1 - p * .65;
      burst(ctx, bx, by, p);
    }
  }
  ctx.restore();
}

export function drawRaidSlash(ctx, foot, amount) {
  const x = pixel(foot[0]), y = pixel(foot[1]), offset = Math.round(amount * 12);
  ctx.save(); ctx.strokeStyle = "#f1eadb"; ctx.lineWidth = 4;
  line(ctx, [[x - 22, y + 12 - offset], [x - 14, y - 8 - offset], [x + 6, y - 18 - offset], [x + 24, y - 8 - offset]]);
  ctx.restore();
}

/** Shake is in world drawing pixels, quantized to short deterministic event-time beats. */
export function raidShake(effects, reducedMotion) {
  if (reducedMotion) return [0, 0];
  const effect = effects.findLast(effect => effect.kind === "collapse" || effect.kind === "death");
  if (!effect || effect.progress * effect.duration > .45) return [0, 0];
  const beat = Math.floor(effect.progress * effect.duration * 24);
  return [beat % 2 ? -5 : 5, beat % 3 ? 3 : -3];
}
