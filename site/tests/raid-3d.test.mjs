import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.js';
import { bossPose, fitRect, spinTheta, FEET, ARENAS, projectGround, stationsAt, LOOK_C, CAMERA, RESOLUTION } from '../raid-3d-pose.mjs';
import { createBoss3D } from '../raid-3d.mjs';

const IDS = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'];
const state = (extra = {}) => ({ t: 40, phase: 1, legs: [], king: null, ...extra });
const broken = (t, destroyedAt = 40) => state({ t, legs: [{ id: 'L1', destroyed: true, destroyedAt }] });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const settle = () => new Promise(resolve => setImmediate(resolve));
const rect = { x: 10, y: 20, w: 800, h: 450 };
const recording = () => ({ calls: [], save() { this.calls.push('save'); }, restore() { this.calls.push('restore'); },
  drawImage(...args) { this.calls.push(args); } });

test('phase maps to the two models', () => {
  assert.equal(bossPose(state()).model, 'mech');
  assert.equal(bossPose(state({ phase: 2 })).model, 'mech');
  assert.equal(bossPose(state({ phase: 3 })).model, 'king');
});
for (const minutes of [30, 2]) {
  const duration = 0.6 / (minutes * 60);
  test(`collapse is clamped before, at, mid and after 0.6 seconds with ${minutes} minute slots`, () => {
    for (const [offset, expected] of [[-duration, 0], [0, 0], [duration / 4, 0.15625], [duration / 2, 0.5], [duration, 1], [duration * 2, 1]]) {
      near(bossPose(broken(40 + offset), { slotMinutes: minutes }).legs.L1, expected);
    }
  });
}
test('destroyedAt null snaps a destroyed leg; an intact leg stays up', () => {
  assert.equal(bossPose(broken(40, null)).legs.L1, 1);
  assert.equal(bossPose(state({ legs: [{ id: 'L1', destroyed: false, destroyedAt: 39 }] })).legs.L1, 0);
});
test('reduced motion snaps collapse even at the destruction instant', () => {
  assert.equal(bossPose(broken(40), { reducedMotion: true }).legs.L1, 1);
});
test('phase 2 forces all eight legs down', () => {
  assert.deepEqual(bossPose(state({ phase: 2 })).legs, Object.fromEntries(IDS.map(id => [id, 1])));
});
test('King death requires phase 3 and hp <= 0', () => {
  for (const hp of [0, -1]) assert.equal(bossPose(state({ phase: 3, king: { max: 2000, hp } })).kingDead, true);
  assert.equal(bossPose(state({ phase: 3, king: { max: 2000, hp: 1 } })).kingDead, false);
  assert.equal(bossPose(state({ phase: 3 })).kingDead, false);
  assert.equal(bossPose(state({ king: { hp: 0 } })).kingDead, false);
});
test('missing and invalid boss input has no model', () => {
  for (const boss of [null, undefined, false, 0, 'boss', {}, state({ phase: 0 }), state({ phase: '1' }), state({ t: NaN }), state({ t: Infinity }), state({ legs: {} })]) {
    assert.equal(bossPose(boss).model, null);
  }
});
test('unknown leg ids are ignored and missing legs default to zero', () => {
  const pose = bossPose(state({ legs: [{ id: '__proto__', destroyed: true }, { id: 'L9', destroyed: true }, null] }));
  assert.deepEqual(pose.legs, Object.fromEntries(IDS.map(id => [id, 0])));
  assert.deepEqual(bossPose(state({ legs: undefined })).legs, pose.legs);
});
test('pose is deterministic without mutating its input, including reverse seeks', () => {
  const boss = broken(40.0001), copy = structuredClone(boss);
  const first = bossPose(boss); bossPose(broken(42));
  assert.deepEqual(bossPose(boss), first); assert.deepEqual(boss, copy);
});
test('fitRect letterboxes a wide rectangle', () => {
  assert.deepEqual(fitRect({ x: 10, y: 20, w: 1000, h: 450 }), { x: 110, y: 20, w: 800, h: 450 });
});
test('fitRect letterboxes a tall rectangle', () => {
  assert.deepEqual(fitRect({ x: 10, y: 20, w: 800, h: 900 }), { x: 10, y: 245, w: 800, h: 450 });
});
test('fitRect preserves exact rectangles and supports another aspect', () => {
  assert.deepEqual(fitRect(rect), rect);
  assert.deepEqual(fitRect({ x: 0, y: 0, w: 400, h: 200 }, 1), { x: 100, y: 0, w: 200, h: 200 });
});
test('the frozen look contains the approved merged C values', () => {
  assert.ok(Object.isFrozen(LOOK_C)); assert.ok(Object.isFrozen(LOOK_C.post));
  assert.deepEqual(LOOK_C.ambient, [0.1, 0.1, 0.12]); assert.equal(LOOK_C.post.bloom, 0.2);
  assert.equal(LOOK_C.post.thresh, 0.7); assert.equal(LOOK_C.final.bleed, 0.6);
  assert.deepEqual(RESOLUTION, [400, 225]); assert.deepEqual(CAMERA.position, [0, 7.6, 12.5]);
});

test('no document disables 3D without invoking the loader', () => {
  assert.equal(typeof document, 'undefined'); let calls = 0;
  const boss = createBoss3D({ loader: async () => { calls++; } }), ctx = recording();
  assert.equal(boss.available(), false); assert.equal(boss.ready(), false);
  assert.doesNotThrow(() => boss.draw(ctx, state(), rect, 0)); assert.deepEqual(ctx.calls, []); assert.equal(calls, 0);
  boss.dispose(); boss.dispose();
});

test('a rejecting loader permanently disables 3D and draws nothing', async () => {
  const previous = globalThis.document;
  globalThis.document = {};
  try {
    let calls = 0;
    const boss = createBoss3D({ loader: async () => { calls++; throw new Error('test rejection'); } });
    await settle(); const ctx = recording();
    assert.equal(calls, 1); assert.equal(boss.available(), false); assert.equal(boss.ready(), false);
    assert.equal(boss.stations(state(), rect), null);
    assert.doesNotThrow(() => boss.draw(ctx, state(), rect, 0)); assert.deepEqual(ctx.calls, []);
    boss.dispose(); boss.dispose();
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('renderer source imports vendor modules only dynamically', async () => {
  const source = await readFile(new URL('../raid-3d.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s+(?:[^'";]*?\s+from\s*)?['"][^'"]*vendor\//);
  assert.match(source, /import\('\.\/vendor\/three\/three\.module\.js'\)/);
});

// Real three.js matrices and scene nodes, with only GPU and browser surfaces faked.
async function rig(run, { kingError, mechError, missingLeg = false, contextError = false, reducedMotion = true, gate, theta, assetBase } = {}) {
  const previous = globalThis.document, caches = [], roots = {}, counts = { renders: 0, dispose: 0, lost: 0, freed: 0, urls: [] };
  globalThis.document = { createElement() {
    const ctx = { clearRect() {}, drawImage() {} };
    const c = { width: 0, height: 0, getContext: () => ctx, addEventListener() {}, removeEventListener() {}, remove() {} };
    caches.push(c); return c;
  } };
  function root(name) {
    const root = new THREE.Group(), body = new THREE.Group(); body.name = 'body'; root.add(body);
    for (const [i, id] of IDS.entries()) {
      if (missingLeg && id === 'R4') continue;
      const leg = new THREE.Group(); leg.name = id; leg.position.set(i < 4 ? -1 : 1, 2, i % 4);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, i < 4 ? -2 : 2, -2, 1, 0, 1, 0], 3));
      geo.addEventListener('dispose', () => counts.freed++);
      leg.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial())); body.add(leg);
    }
    roots[name] = root; return root;
  }
  class Renderer {
    constructor() { if (contextError) throw new Error('no WebGL'); }
    setPixelRatio() {} setSize() {}
    dispose() { counts.dispose++; } forceContextLoss() { counts.lost++; }
  }
  class Loader {
    async loadAsync(url) {
      counts.urls.push(url);
      const name = url.includes('spider_king') ? 'king' : 'mech';
      if (gate) await gate;
      const error = name === 'king' ? kingError : mechError;
      if (error) throw error;
      return { scene: root(name) };
    }
  }
  class Pipeline {
    constructor() { this.materials = []; this.sources = []; }
    adopt(root) {
      root.traverse(o => {
        if (!o.isMesh) return;
        this.sources.push(o.material);
        o.material = { uniforms: { uTint: { value: new THREE.Vector3(1, 1, 1) }, uEmit: { value: 1.3 } }, dispose() {} };
        this.materials.push(o.material);
      });
    }
    apply() {} setLights() {} render() { counts.renders++; }
    dispose() { for (const mat of [...this.sources, ...this.materials]) mat.dispose(); }
  }
  const boss = createBoss3D({ reducedMotion, theta, assetBase, loader: async () => ({ THREE: { ...THREE, WebGLRenderer: Renderer }, GLTFLoader: Loader, retro: { RetroPipeline: Pipeline } }) });
  try { await settle(); await run({ boss, roots, counts, caches }); }
  finally {
    boss.dispose();
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
}

test('successful loading produces a fitted 2D frame and stations before ready', async () => rig(({ boss, counts }) => {
  const ctx = recording(); assert.equal(boss.available(), true); assert.equal(boss.ready(), false);
  assert.deepEqual(boss.stations(state(), rect), stationsAt(state(), rect, { reducedMotion: true }));
  boss.draw(ctx, state(), { x: 10, y: 20, w: 1000, h: 450 }, 0);
  assert.equal(boss.ready(), true); assert.equal(counts.renders, 1);
  assert.deepEqual(ctx.calls[1].slice(1), [110, 20, 800, 450]);
  assert.equal(ctx.imageSmoothingEnabled, false);
  const a = boss.stations(state(), rect); assert.deepEqual(Object.keys(a.legs), IDS);
  a.legs.L1.foot[0] = 999; assert.notEqual(boss.stations(state(), rect).legs.L1.foot[0], 999);
}));

test('missing King alone leaves mech rendering usable and phase 3 unready', async () => rig(({ boss }) => {
  const ctx = recording(); boss.draw(ctx, state(), rect, 0); assert.equal(boss.ready(), true);
  ctx.calls.length = 0; boss.draw(ctx, state({ phase: 3 }), rect, 100);
  assert.equal(boss.available(), true); assert.equal(boss.ready(), false); assert.deepEqual(ctx.calls, []);
  assert.equal(boss.stations(state({ phase: 3 }), rect).angle, 0);
  boss.draw(ctx, state(), rect, 200); assert.equal(boss.ready(), true);
}, { kingError: { response: { status: 404 } } }));

test('King parse errors and missing rig nodes disable the renderer', async () => {
  await rig(({ boss }) => { assert.equal(boss.available(), false); }, { kingError: new Error('bad GLB') });
  await rig(({ boss }) => { assert.equal(boss.available(), false); }, { missingLeg: true });
});

test('mech fetch and WebGL creation failures disable the renderer', async () => {
  await rig(({ boss }) => { assert.equal(boss.available(), false); }, { mechError: new Error('missing mech') });
  await rig(({ boss }) => { assert.equal(boss.available(), false); }, { contextError: true });
});

test('renders are capped at 30 Hz and unchanged reduced-motion poses reuse the cache', async () => rig(({ boss, counts }) => {
  const ctx = recording(); boss.draw(ctx, state(), rect, 0);
  boss.draw(ctx, broken(41), rect, 20); assert.equal(counts.renders, 1);
  boss.draw(ctx, broken(41), rect, 34); assert.equal(counts.renders, 2);
  boss.draw(ctx, broken(41), rect, 1000); assert.equal(counts.renders, 2);
}));

test('collapse reverses exactly on replay seeks and kills emissive light', async () => rig(({ boss, roots }) => {
  const ctx = recording(), leg = roots.mech.getObjectByName('L1'), original = leg.position.clone();
  boss.draw(ctx, broken(41), rect, 0);
  near(leg.position.y, original.y - 0.5);
  near(leg.children[0].material.uniforms.uTint.value.x, 0.45);
  assert.equal(leg.children[0].material.uniforms.uEmit.value, 0);
  boss.draw(ctx, state(), rect, 100);
  assert.deepEqual(leg.position, original); assert.deepEqual(leg.quaternion.toArray(), [0, 0, 0, 1]);
}));

test('King death has a static slumped pose even with idle motion enabled', async () => rig(({ boss, roots, counts }) => {
  const ctx = recording(), dead = state({ phase: 3, king: { max: 2000, hp: 0 } });
  boss.draw(ctx, dead, rect, 100); const body = roots.king.getObjectByName('body');
  near(body.position.y, -0.75); const q = body.quaternion.clone();
  boss.draw(ctx, dead, rect, 1000); assert.equal(counts.renders, 1); assert.deepEqual(body.quaternion.toArray(), q.toArray());
  for (const id of IDS) assert.equal(roots.king.getObjectByName(id).children[0].material.uniforms.uEmit.value, 0);
}, { reducedMotion: false }));

test('draw catches a 2D blit exception, restores the context, and falls back permanently', async () => rig(({ boss }) => {
  let restored = false;
  assert.doesNotThrow(() => boss.draw({ save() {}, restore() { restored = true; }, drawImage() { throw new Error('bad context'); } }, state(), rect, 0));
  assert.equal(restored, true); assert.equal(boss.available(), false); assert.equal(boss.ready(), false);
}));

test('disposing twice frees GPU geometry and canvases; later draws are no-ops', async () => rig(({ boss, counts, caches }) => {
  boss.draw(recording(), state(), rect, 0); boss.dispose(); boss.dispose();
  assert.equal(counts.dispose, 1); assert.equal(counts.lost, 1); assert.equal(counts.freed, 16);
  assert.ok(caches.every(c => c.width === 0 && c.height === 0));
  const ctx = recording(); boss.draw(ctx, state(), rect, 100); assert.deepEqual(ctx.calls, []);
  assert.equal(boss.stations(state(), rect), null); assert.equal(boss.ready(), false);
  assert.equal(boss.debugFeet(), null);
}));

test('disposing during loading safely releases both late model results', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  await rig(async ({ boss, counts }) => {
    boss.dispose(); finish(); await settle();
    assert.equal(boss.available(), false); assert.equal(counts.freed, 16);
  }, { gate });
});

for (const [seconds, angle] of [[0, 0], [11.9, 0], [12, 0], [51, Math.PI], [90, 0],
  [-1, 2 * Math.PI * (77 / 78) ** 2 * (3 - 2 * 77 / 78)]]) {
  test(`spinTheta at ${seconds} seconds follows the 90 second curve`, () => near(spinTheta(seconds), angle));
}
test('reduced motion holds the spin at zero', () => near(spinTheta(51, { reducedMotion: true }), 0));
test('a finite degree override wins over reduced motion; other overrides are ignored', () => {
  near(spinTheta(51, { theta: 90, reducedMotion: true }), Math.PI / 2);
  near(spinTheta(51, { theta: -90 }), -Math.PI / 2);
  for (const theta of [null, '90', NaN, Infinity]) near(spinTheta(51, { theta }), Math.PI);
});
test('feet and arenas equal the four-decimal bake and arenas extend 1.5 from each foot', async () => {
  const bake = JSON.parse(await readFile(new URL('../../assets/blender/spider_mech.feet.json', import.meta.url), 'utf8'));
  assert.deepEqual(FEET, bake.feet); assert.deepEqual(ARENAS, bake.arenas);
  for (const id of IDS) {
    const foot = FEET[id], arena = ARENAS[id], hip = bake.hips[id];
    assert.ok(Math.abs(Math.hypot(arena.cx - foot.x, arena.cz - foot.z) - 1.5) < 0.00015);
    const dx = foot.x - hip.x, dz = foot.z - hip.z, length = Math.hypot(dx, dz);
    assert.ok(Math.abs(arena.cx - foot.x - dx / length * 1.5) < 0.00015);
    assert.ok(Math.abs(arena.cz - foot.z - dz / length * 1.5) < 0.00015);
    assert.equal(arena.r, 1.15);
  }
});
function realCamera() {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 400 / 225, 0.5, 60);
  camera.position.set(...CAMERA.position); camera.lookAt(...CAMERA.target); camera.updateMatrixWorld(true);
  return camera;
}
test('world origin projects identically at any angle and is not in front', () => {
  const p = new THREE.Vector3().project(realCamera());
  for (const angle of [0, 0.4, Math.PI, -4, 27]) {
    const ground = projectGround(0, 0, angle, rect);
    near(ground.x, rect.x + (p.x + 1) * rect.w / 2);
    near(ground.y, rect.y + (1 - p.y) * rect.h / 2);
    assert.equal(ground.front, false);
    assert.deepEqual(ground, projectGround(0, 0, 0, rect));
  }
});
test('ground projection agrees with real camera and parent rotation matrices in letterboxed rects', () => {
  const camera = realCamera(), wide = { x: -33, y: 19, w: 1000, h: 450 }, r = fitRect(wide);
  for (const theta of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const { x, z } of Object.values(FEET)) {
    const world = new THREE.Vector3(x, 0, z).applyMatrix4(new THREE.Matrix4().makeRotationY(theta));
    const view = world.clone().applyMatrix4(camera.matrixWorldInverse), projected = world.project(camera);
    const actual = projectGround(x, z, theta, wide);
    near(actual.x, r.x + (projected.x + 1) * r.w / 2);
    near(actual.y, r.y + (1 - projected.y) * r.h / 2);
    near(actual.depth, -view.z);
  }
});
test('a front foot moves behind the body after half a turn', () => {
  const { x, z } = FEET.L1;
  assert.equal(projectGround(x, z, 0, rect).front, true);
  assert.equal(projectGround(x, z, Math.PI, rect).front, false);
});
test('stations are deterministic across repeated calls and reverse seeks without mutating inputs', () => {
  const boss = state({ t: 40 + 51 / 1800 }), original = structuredClone(boss), r = structuredClone(rect);
  const a = stationsAt(boss, rect); stationsAt(state({ t: 42 }), rect);
  assert.deepEqual(stationsAt(boss, rect), a);
  assert.deepEqual(boss, original); assert.deepEqual(rect, r);
});
test('one second in fractional slots advances the event spin by one second', () => {
  for (const seconds of [0, 12, 13, 51, 89, 90, 141]) {
    near(stationsAt(state({ t: 40 + seconds / (30 * 60) }), rect, { slotMinutes: 30 }).angle, spinTheta(seconds));
  }
  near(stationsAt(state({ t: 51 / 120 }), rect, { slotMinutes: 2 }).angle, Math.PI);
});
test('King stations never spin, including with a degree override', () => {
  near(stationsAt(state({ phase: 3 }), rect, { theta: 90 }).angle, 0);
});
test('invalid boss has no stations', () => {
  for (const boss of [null, {}, state({ phase: 4 }), state({ t: NaN })]) assert.equal(stationsAt(boss, rect), null);
});
// Front arenas sit below the boss image, as in the prototype; the 46x30-tile room around the
// 25x14.0625-tile boss rect must hold every foot and arena centre at every angle.
test('all feet and arena centres fit in a 46 by 30 tile room around the boss rect', () => {
  const r = { x: 0, y: 0, w: 25 * 32, h: 14.0625 * 32 };
  const mx = (46 * 32 - r.w) / 2, my = (30 * 32 - r.h) / 2;
  for (let theta = 0; theta < 360; theta += 15) {
    const stations = stationsAt(state(), r, { theta });
    for (const leg of Object.values(stations.legs)) for (const [x, y] of [leg.foot, leg.arena]) {
      assert.ok(x >= -mx && x <= r.w + mx && y >= -my && y <= r.h + my, `${x}, ${y} outside room at ${theta}`);
    }
  }
});
test('station rings use 32 projected samples and depth belongs to the arena centre', () => {
  const angle = 45, stations = stationsAt(state(), rect, { theta: angle });
  for (const id of IDS) {
    const { cx, cz, r } = ARENAS[id], leg = stations.legs[id];
    const centre = projectGround(cx, cz, stations.angle, rect);
    const pts = Array.from({ length: 32 }, (_, i) => projectGround(cx + r * Math.cos(i * Math.PI / 16), cz + r * Math.sin(i * Math.PI / 16), stations.angle, rect));
    near(leg.ring[0], (Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x))) / 2);
    near(leg.ring[1], (Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y))) / 2);
    assert.deepEqual(leg.arena, [centre.x, centre.y]); near(leg.depth, centre.depth);
    assert.equal(leg.behind, !centre.front);
  }
});
test('king.dead true takes precedence over positive hp and only boolean true counts', () => {
  assert.equal(bossPose(state({ phase: 3, king: { hp: 100, dead: true } })).kingDead, true);
  assert.equal(bossPose(state({ phase: 3, king: { hp: 100, dead: 'true' } })).kingDead, false);
});
test('renderer has literal GLB URLs and exposes stations instead of anchors', async () => {
  const source = await readFile(new URL('../raid-3d.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("new URL('./assets/raid/spider_mech.glb', import.meta.url)"));
  assert.ok(source.includes("new URL('./assets/raid/spider_king.glb', import.meta.url)"));
  const renderer = createBoss3D();
  assert.equal(typeof renderer.stations, 'function'); assert.equal('anchors' in renderer, false);
  assert.equal(renderer.stations(state(), rect), null); renderer.dispose();
});
test('stations work while model loading is still pending', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  await rig(({ boss }) => {
    assert.equal(boss.ready(), false);
    assert.deepEqual(boss.stations(state(), rect), stationsAt(state(), rect, { reducedMotion: true }));
    finish();
  }, { gate });
});
test('angle changes invalidate the render cache and respect the 30 Hz cap', async () => rig(({ boss, roots, counts }) => {
  const ctx = recording(); boss.draw(ctx, state({ t: 0 }), rect, 0);
  boss.draw(ctx, state({ t: 51 / 1800 }), rect, 20); assert.equal(counts.renders, 1);
  boss.draw(ctx, state({ t: 51 / 1800 }), rect, 34); assert.equal(counts.renders, 2);
  near(roots.mech.parent.rotation.y, Math.PI);
}, { reducedMotion: false }));
test('renderer passes degree overrides through and keeps body yaw and idle legs still', async () => rig(({ boss, roots }) => {
  const ctx = recording(); boss.draw(ctx, state(), rect, 1000);
  near(roots.mech.parent.rotation.y, Math.PI / 2);
  near(boss.stations(state(), rect).angle, Math.PI / 2);
  const body = roots.mech.getObjectByName('body');
  assert.deepEqual(body.quaternion.toArray(), [0, 0, 0, 1]);
  assert.notEqual(body.position.y, 0);
  for (const id of IDS) assert.deepEqual(roots.mech.getObjectByName(id).quaternion.toArray(), [0, 0, 0, 1]);
}, { theta: 90, reducedMotion: false }));
test('debugFeet traverses the spun rig and returns ground projections in the last fitted rect', async () => rig(({ boss, roots }) => {
  assert.equal(boss.debugFeet(), null);
  boss.draw(recording(), state(), rect, 0);
  const actual = boss.debugFeet(), camera = realCamera();
  for (const id of IDS) {
    const node = roots.mech.getObjectByName(id), p = new THREE.Vector3(IDS.indexOf(id) < 4 ? -2 : 2, -2, 1);
    p.applyMatrix4(node.matrixWorld).setY(0).project(camera);
    near(actual[id][0], rect.x + (p.x + 1) * rect.w / 2);
    near(actual[id][1], rect.y + (1 - p.y) * rect.h / 2);
  }
  actual.L1[0] = 999; assert.notEqual(boss.debugFeet().L1[0], 999);
}, { theta: 45 }));
test('test assetBase override accepts a directory without trailing slash', async () => rig(({ counts }) => {
  assert.deepEqual(counts.urls, ['https://example.test/models/spider_mech.glb', 'https://example.test/models/spider_king.glb']);
}, { assetBase: 'https://example.test/models' }));
