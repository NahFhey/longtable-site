// The optional renderer uses the same world-tile rect as the outline (32 drawing pixels per tile).
let registered = null;
let failed = false;
export function registerBossRenderer(factory) { registered = factory; }
const U = 32;
const anchors = () => Object.fromEntries(["L", "R"].flatMap(side => [1, 2, 3, 4].map(n => [`${side}${n}`, [side === "L" ? .08 : .92, .15 + (n - 1) * .22]])));

function outline(ctx, boss, rect, options, motion = {}) {
  const point = (x, y) => [Math.round((rect.x + x * rect.w) * U), Math.round((rect.y + y * rect.h) * U)];
  const path = (points, color = "#dfba76", width = 4) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    points.forEach(([x, y], index) => { const p = point(x, y); if (index) ctx.lineTo(...p); else ctx.moveTo(...p); }); ctx.stroke();
  };
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.lineCap = "square"; ctx.lineJoin = "miter";
  const collapse = boss.phase === 2 ? motion.collapse ?? 1 : 0;
  const cy = .45 + .27 * collapse, sy = .26 - .14 * collapse;
  path([[.36, cy - sy], [.64, cy - sy], [.7, cy], [.64, cy + sy], [.36, cy + sy], [.3, cy], [.36, cy - sy]], boss.king?.dead ? "#55685b" : "#dfba76", 6);
  const points = anchors();
  for (const [index, leg] of boss.legs.entries()) {
    const [ax, ay] = points[leg.id] ?? [leg.side === "L" ? .08 : .92, .2 + index * .08];
    const left = leg.side === "L", inner = left ? .35 : .65;
    const knee = left ? .2 : .8;
    if (leg.destroyed) path([[inner, cy], [(inner + knee) / 2, cy + .08]], "#b1b5a8");
    else {
      path([[inner, cy], [knee, (ay - .1) * (1 - collapse) + .8 * collapse], [ax, ay * (1 - collapse) + .94 * collapse]], boss.phase === 3 ? "#d9604c" : "#b1b5a8");
      if (leg.special) {
        // Four hard-edged tool silhouettes: injector, shield, conduit, spinner. Definitions choose them.
        const type = leg.special.id;
        if (type.includes("venom")) path([[ax - .02, ay], [ax + .02, ay], [ax, ay + .09], [ax - .02, ay]], "#9cdbcd");
        else if (type.includes("armor")) path([[ax - .035, ay - .05], [ax + .035, ay - .05], [ax + .035, ay + .06], [ax - .035, ay + .06], [ax - .035, ay - .05]], "#dfba76", 6);
        else if (type.includes("nerve")) path([[ax - .03, ay - .06], [ax + .03, ay], [ax - .03, ay + .02], [ax + .02, ay + .09]], "#9cdbcd");
        else path([[ax, ay - .07], [ax + .04, ay], [ax, ay + .07], [ax - .04, ay], [ax, ay - .07], [ax, ay + .07]], "#dfba76");
      }
    }
  }
  if (boss.phase === 3) {
    const fall = boss.king?.dead && !options?.reducedMotion ? motion.crownFall ?? 1 : 0;
    path([[.4, .22], [.4, .1], [.46, .16], [.5, .06], [.54, .16], [.6, .1], [.6, .22]]
      .map(([x, y]) => [x + .08 * fall, y + .74 * fall]), boss.king?.dead ? "#55685b" : "#d9604c", 6);
    path([[.43, .38], [.46, .38]], "#ffb2a7", 8); path([[.54, .38], [.57, .38]], "#ffb2a7", 8);
  } else path([[.44, cy], [.56, cy]], "#9cdbcd", 8);
  ctx.restore();
}

/** Failure is session-wide; readiness is checked again each frame. */
export function createBossRenderer(options) {
  let renderer = null, disposed = false, usedCustom = false, frame = null;
  const discard = () => { try { renderer?.dispose?.(); } catch { /* A failed renderer must not break the outline. */ } renderer = null; };
  if (registered && !failed) {
    try { renderer = registered(options); if (!renderer || typeof renderer.draw !== "function") throw new Error("renderer"); }
    catch { failed = true; discard(); }
  }
  // Read availability and readiness once, before choosing this frame's stations.
  const prepare = (boss, rect) => {
    frame = { custom: false, stations: null };
    if (!disposed && renderer && !failed) {
      try {
        if (renderer.available?.() === false) throw new Error("unavailable");
        if (renderer.ready?.() !== false) frame = { custom: true,
          stations: boss.phase === 1 ? renderer.stations?.(boss, rect) ?? null : null };
      } catch { failed = true; discard(); }
    }
    return frame;
  };
  return {
    prepare,
    draw(ctx, boss, rect, nowMs, motion) {
      usedCustom = false;
      if (disposed) return;
      const selected = frame ?? prepare(boss, rect); frame = null;
      if (selected.custom && renderer && !failed) {
        try {
          // Custom renderers draw in world tiles; this context draws U pixels per tile.
          ctx.save(); ctx.scale(U, U);
          try { renderer.draw(ctx, boss, rect, nowMs); } finally { ctx.restore(); }
          usedCustom = true; return true;
        } catch { failed = true; discard(); }
      } else if (renderer && !failed) {
        // Warm-up: an available renderer that is not ready yet renders its first frame only
        // when drawn (raid-3d.mjs), and paints nothing to ctx until it is ready.
        try { ctx.save(); ctx.scale(U, U); try { renderer.draw(ctx, boss, rect, nowMs); } finally { ctx.restore(); } }
        catch { failed = true; discard(); }
      }
      outline(ctx, boss, rect, options, motion);
      return false;
    },
    stations(boss, rect) {
      return prepare(boss, rect).stations;
    },
    anchors() {
      if (usedCustom && renderer?.anchors) {
        try {
          const value = renderer.anchors();
          if (value && Object.values(value).every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) return value;
        } catch { failed = true; discard(); }
      }
      return anchors();
    },
    dispose() { if (!disposed) { disposed = true; discard(); } },
  };
}
