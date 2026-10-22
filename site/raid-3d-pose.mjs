// Event time is in fractional slots. No wall-clock state participates in collapse.
const LEG_IDS = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'];
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => n * n * (3 - 2 * n);

export function bossPose(boss, { slotMinutes = 30, reducedMotion = false } = {}) {
  const legs = Object.fromEntries(LEG_IDS.map(id => [id, 0]));
  const empty = { model: null, legs, kingDead: false };
  if (!boss || typeof boss !== 'object' || !Number.isFinite(boss.t) ||
      ![1, 2, 3].includes(boss.phase) || (boss.legs != null && !Array.isArray(boss.legs))) return empty;
  const model = boss.phase === 3 ? 'king' : 'mech';
  if (boss.phase === 2) {
    for (const id of LEG_IDS) legs[id] = 1;
  } else {
    const minutes = Number.isFinite(slotMinutes) && slotMinutes > 0 ? slotMinutes : 30;
    for (const leg of boss.legs ?? []) {
      if (!leg || !LEG_IDS.includes(leg.id) || !leg.destroyed) continue;
      legs[leg.id] = reducedMotion || !Number.isFinite(leg.destroyedAt) ? 1 :
        ease(clamp((boss.t - leg.destroyedAt) * minutes * 60 / 0.6));
    }
  }
  return { model, legs, kingDead: boss.phase === 3 && !!boss.king && (boss.king.dead === true || boss.king.hp <= 0) };
}

export function fitRect(rect, aspect = 16 / 9) {
  const w = Math.min(rect.w, rect.h * aspect), h = w / aspect;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

const freeze = obj => {
  for (const value of Object.values(obj)) if (value && typeof value === 'object') freeze(value);
  return Object.freeze(obj);
};
export const RESOLUTION = Object.freeze([400, 225]);
export const CAMERA = freeze({ position: [0, 7.6, 12.5], target: [0, 1.3, 0], fov: 30 });

export function spinTheta(tSec, { reducedMotion = false, theta } = {}) {
  if (Number.isFinite(theta)) return theta * Math.PI / 180;
  if (reducedMotion) return 0;
  const tc = ((tSec % 90) + 90) % 90;
  return tc < 12 ? 0 : 2 * Math.PI * ease(clamp((tc - 12) / 78));
}

// Baked from the exported Y-up GLB by assets/blender/spider_mech.py.
export const FEET = freeze({
  L1: { x: -3.2491, z: 4.2762 }, L2: { x: -4.4678, z: 1.6668 },
  L3: { x: -4.5688, z: -1.1465 }, L4: { x: -3.4262, z: -3.4611 },
  R1: { x: 3.0583, z: 4.0037 }, R2: { x: 4.4678, z: 1.6668 },
  R3: { x: 4.5688, z: -1.1465 }, R4: { x: 3.9647, z: -4.3926 },
});
export const ARENAS = freeze({
  L1: { cx: -4.1094, cz: 5.505, r: 1.15 }, L2: { cx: -5.8774, cz: 2.1798, r: 1.15 },
  L3: { cx: -6.0177, cz: -1.5347, r: 1.15 }, L4: { cx: -4.4298, cz: -4.5758, r: 1.15 },
  R1: { cx: 3.9186, cz: 5.2325, r: 1.15 }, R2: { cx: 5.8774, cz: 2.1798, r: 1.15 },
  R3: { cx: 6.0177, cz: -1.5347, r: 1.15 }, R4: { cx: 4.9166, cz: -5.5518, r: 1.15 },
});

const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const normalize = v => { const length = Math.hypot(...v); return v.map(n => n / length); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Camera lookAt uses right, up, backward as its orthonormal world basis.
const backward = normalize(CAMERA.position.map((v, i) => v - CAMERA.target[i]));
const right = normalize(cross([0, 1, 0], backward));
const up = cross(backward, right);
const originDepth = dot(CAMERA.position, backward);
const focal = 1 / Math.tan(CAMERA.fov * Math.PI / 360);

export function projectGround(x, z, thetaRad, rect) {
  const c = Math.cos(thetaRad), s = Math.sin(thetaRad);
  // Positive parent Y rotation sends +X toward -Z.
  const relative = [c * x + s * z, 0, -s * x + c * z].map((v, i) => v - CAMERA.position[i]);
  const depth = -dot(relative, backward), r = fitRect(rect);
  return { x: r.x + (1 + dot(relative, right) * focal / (16 / 9) / depth) * r.w / 2,
    y: r.y + (1 - dot(relative, up) * focal / depth) * r.h / 2,
    depth, front: depth < originDepth };
}

export function stationsAt(boss, rect, { slotMinutes = 30, reducedMotion = false, theta } = {}) {
  const pose = bossPose(boss);
  if (pose.model === null) return null;
  const angle = pose.model === 'king' ? 0 : spinTheta(boss.t * slotMinutes * 60, { reducedMotion, theta });
  const legs = {};
  for (const id of LEG_IDS) {
    const foot = projectGround(FEET[id].x, FEET[id].z, angle, rect);
    const { cx, cz, r } = ARENAS[id], arena = projectGround(cx, cz, angle, rect);
    const circle = Array.from({ length: 32 }, (_, i) => {
      const a = i * 2 * Math.PI / 32;
      return projectGround(cx + r * Math.cos(a), cz + r * Math.sin(a), angle, rect);
    });
    const xs = circle.map(p => p.x), ys = circle.map(p => p.y);
    legs[id] = { foot: [foot.x, foot.y], arena: [arena.x, arena.y],
      ring: [(Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2],
      depth: arena.depth, behind: !arena.front };
  }
  return { angle, legs };
}
// Approved variant C, including all prototype base values and C overrides.
export const LOOK_C = freeze({
  snapPx: 1, affine: 1, texFilter: 'nearest', baked: 0.85, emit: 1.3,
  ambient: [0.1, 0.1, 0.12], lamp: [1, 0.86, 0.66, 0.004], window: [0.22, 0.28, 0.42, 0.01],
  spot: { color: [2.2, 2, 1.6], k: 0.02, cos: 0.9 },
  dir: { dir: [-0.3, -1, -0.5], color: [0.45, 0.43, 0.4] },
  fog: { color: [0.02, 0.02, 0.03], near: 13, far: 24 },
  post: { bloom: 0.2, thresh: 0.7, radius: 3, trail: 0, exposure: 1.25, contrast: 1.15,
    saturation: 0.5, lift: [0.02, 0.02, 0.015], gain: [1, 1, 0.88], levels: 31, dither: 1, grain: 0.12, letterbox: 0 },
  final: { scanlines: 0.18, interlace: 0, vignette: 0.55, bleed: 0.6, soft: 0 },
});
