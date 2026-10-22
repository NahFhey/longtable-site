import { bossPose, fitRect, stationsAt, LOOK_C, RESOLUTION, CAMERA } from './raid-3d-pose.mjs';

const LEG_IDS = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'];
const FRAME_MS = 1000 / 30;
const imports = async () => {
  const [THREE, { GLTFLoader }, retro] = await Promise.all([
    import('./vendor/three/three.module.js'),
    import('./vendor/three/addons/loaders/GLTFLoader.js'),
    import('./raid-3d-retro.mjs'),
  ]);
  return { THREE, GLTFLoader, retro };
};

// No GPU, DOM or model work happens until this optional renderer is constructed.
export function createBoss3D(options = {}) {
  let usable = typeof document !== 'undefined', disposed = false;
  let THREE, renderer, pipeline, camera, glCanvas, scene;
  let current = 'mech', lastRender = -Infinity, lastRect = null, lastModel = null;
  const models = new Map(), roots = new Set(), canvases = new Set();
  const textures = new Set(), geometries = new Set();
  const reducedMotion = !!options.reducedMotion;
  const urls = { mech: new URL('./assets/raid/spider_mech.glb', import.meta.url),
    king: new URL('./assets/raid/spider_king.glb', import.meta.url) };
  if (options.assetBase != null) {
    const base = new URL(options.assetBase, import.meta.url);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    for (const name of ['mech', 'king']) urls[name] = new URL(`spider_${name}.glb`, base);
  }
  const ready = () => usable && !disposed && !!models.get(current)?.hasFrame;
  const available = () => usable && !disposed;
  const attempt = fn => { try { fn(); } catch { /* Finish freeing the other resources. */ } };

  function ownRoot(root) {
    roots.add(root);
    root.traverse(o => {
      if (!o.isMesh) return;
      geometries.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
      }
    });
  }
  function discardLate(root) {
    const mats = new Set(), gs = new Set(), ts = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      gs.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        mats.add(mat);
        for (const value of Object.values(mat)) if (value?.isTexture) ts.add(value);
      }
    });
    for (const g of gs) attempt(() => g.dispose());
    for (const m of mats) attempt(() => m.dispose());
    for (const t of ts) { attempt(() => t.dispose()); attempt(() => t.source?.data?.close?.()); }
  }
  function release() {
    glCanvas?.removeEventListener('webglcontextlost', fail);
    // Adopted materials (including their originals) belong to the pipeline.
    attempt(() => pipeline?.dispose());
    for (const g of geometries) attempt(() => g.dispose());
    const images = new Set();
    for (const t of textures) {
      attempt(() => t.dispose());
      const data = t.source?.data;
      if (data && !images.has(data)) { images.add(data); attempt(() => data.close?.()); }
    }
    attempt(() => renderer?.dispose());
    attempt(() => renderer?.forceContextLoss());
    for (const c of canvases) { attempt(() => { c.width = c.height = 0; }); attempt(() => c.remove()); }
    models.clear(); roots.clear(); textures.clear(); geometries.clear(); canvases.clear();
    renderer = pipeline = camera = glCanvas = scene = null;
    lastRect = lastModel = null;
  }
  function fail() { if (!usable || disposed) return; usable = false; release(); }
  function dispose() { if (disposed) return; disposed = true; usable = false; release(); }

  function prepare(name, root) {
    if (!available()) { discardLate(root); return; }
    ownRoot(root);
    // Adopt before validation so the pipeline owns source materials even on a bad rig.
    pipeline.adopt(root);
    const body = root.getObjectByName('body');
    if (!body) throw new Error(`${name}: missing body`);
    root.updateMatrixWorld(true);
    const legs = {}, up = new THREE.Vector3(0, 1, 0);
    for (const id of LEG_IDS) {
      const node = root.getObjectByName(id);
      let parent = node?.parent;
      while (parent && parent !== body) parent = parent.parent;
      if (!node || !parent) throw new Error(`${name}: missing leg under body: ${id}`);
      let foot = null;
      const v = new THREE.Vector3(), mats = new Set();
      node.traverse(o => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        const positions = o.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          v.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
          if (!foot || v.y < foot.y) foot = v.clone();
        }
      });
      if (!foot) throw new Error(`${name}: leg without vertices: ${id}`);
      const hip = node.getWorldPosition(new THREE.Vector3());
      const worldAxis = up.clone().cross(foot.clone().sub(hip).setY(0).normalize()).normalize();
      // Rotation is local to the hip's parent, even if a future rig has a transformed body.
      const parentQ = node.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      legs[id] = { node, mats, axis: worldAxis.applyQuaternion(parentQ),
        position: node.position.clone(), rotation: node.quaternion.clone() };
    }
    const cache = document.createElement('canvas'); canvases.add(cache);
    [cache.width, cache.height] = RESOLUTION;
    const ctx = cache.getContext('2d');
    if (!ctx) throw new Error('No 2D cache context');
    ctx.imageSmoothingEnabled = false;
    const spin = new THREE.Group(); spin.add(root); scene.add(spin);
    models.set(name, { root, spin, body, legs, cache, ctx, hasFrame: false, key: null,
      bodyPosition: body.position.clone(), bodyRotation: body.quaternion.clone() });
    root.visible = false;
    pipeline.apply({ ...LOOK_C, res: RESOLUTION });
    pipeline.setLights({ lamp: [0, 8, 9], lampScale: 1, window: [-9, 4, 2],
      spotPos: new THREE.Vector3(0, 11, 1), spotDir: new THREE.Vector3(0, -1, -0.1).normalize() });
  }

  async function load() {
    try {
      const deps = await (options.loader ?? imports)();
      if (!available()) return;
      THREE = deps.THREE;
      glCanvas = document.createElement('canvas'); canvases.add(glCanvas);
      renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(1); renderer.setSize(...RESOLUTION, false);
      glCanvas.addEventListener('webglcontextlost', fail);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(CAMERA.fov, RESOLUTION[0] / RESOLUTION[1], 0.5, 60);
      camera.position.set(...CAMERA.position); camera.lookAt(...CAMERA.target); camera.updateMatrixWorld(true);
      pipeline = new deps.retro.RetroPipeline(renderer, ...RESOLUTION);
      const loader = new deps.GLTFLoader();
      // Start both fetches now. Each task handles its own rejection, including disposal races.
      await Promise.all(['mech', 'king'].map(async name => {
        try {
          const gltf = await loader.loadAsync(urls[name].href);
          prepare(name, gltf.scene);
        } catch (error) {
          // A missing optional King does not poison a successfully loaded mech.
          if (name === 'king' && [404, 410].includes(error?.response?.status)) return;
          fail();
        }
      }));
    } catch { fail(); }
  }

  function render(model, pose, sway, spinAngle) {
    for (const m of models.values()) m.root.visible = m === model;
    model.spin.rotation.y = spinAngle;
    const { body } = model;
    body.position.copy(model.bodyPosition); body.quaternion.copy(model.bodyRotation);
    const dead = pose.kingDead;
    if (dead) {
      body.position.y -= 0.75;
      body.rotateX(-0.18);
    } else {
      body.position.y += 0.05 * Math.sin(sway * 1.3);
    }
    for (let i = 0; i < LEG_IDS.length; i++) {
      const id = LEG_IDS[i], leg = model.legs[id], c = dead ? 1 : pose.legs[id];
      const angle = dead ? 1.05 : 0.62 * c;
      leg.node.position.copy(leg.position); leg.node.position.y -= 0.5 * c;
      leg.node.quaternion.copy(leg.rotation).multiply(new THREE.Quaternion().setFromAxisAngle(leg.axis, angle));
      for (const mat of leg.mats) {
        const k = 1 - 0.55 * c;
        mat.uniforms.uTint.value.set(k, k * (1 - 0.1 * c), k);
        mat.uniforms.uEmit.value = LOOK_C.emit * (1 - c);
      }
    }
    // Body materials are separate from limb materials after adopt().
    body.traverse(o => {
      if (!o.isMesh || LEG_IDS.some(id => model.legs[id].mats.has(o.material))) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        // Skip descendant leg primitives; their tint is already set above.
        if (LEG_IDS.some(id => model.legs[id].mats.has(mat))) continue;
        mat.uniforms.uTint.value.setScalar(dead ? 0.4 : 1);
        mat.uniforms.uEmit.value = dead ? 0 : LOOK_C.emit;
      }
    });
    // A fixed grain seed keeps an identical pose visually stable, including replay seeks.
    model.spin.updateMatrixWorld(true);
    pipeline.frame = 0;
    pipeline.render(scene, camera);
    model.ctx.clearRect(0, 0, ...RESOLUTION); model.ctx.drawImage(glCanvas, 0, 0);
    model.hasFrame = true;
  }

  function draw(ctx, boss, rect, nowMs) {
    if (!available()) return;
    try {
      const pose = bossPose(boss, options); current = pose.model;
      const model = models.get(current);
      if (!model) return;
      const now = Number.isFinite(nowMs) ? nowMs : 0;
      const sway = reducedMotion || pose.kingDead || boss.phase === 2 ? 0 : Math.floor(now / FRAME_MS) * FRAME_MS / 1000;
      const angle = stations(boss, rect).angle;
      const key = JSON.stringify([pose, sway, angle]);
      if (model.key !== key && now - lastRender >= FRAME_MS) {
        render(model, pose, sway, angle); model.key = key; lastRender = now;
      }
      if (!ready()) return;
      const r = fitRect(rect);
      lastRect = r; lastModel = model;
      ctx.save();
      try { ctx.imageSmoothingEnabled = false; ctx.drawImage(model.cache, r.x, r.y, r.w, r.h); }
      finally { ctx.restore(); }
    } catch { fail(); }
  }
  const stations = (boss, rect) => available() ? stationsAt(boss, rect, options) : null;
  function debugFeet() {
    if (!available() || !lastRect || !lastModel) return null;
    const result = {}, v = new THREE.Vector3(), r = lastRect;
    lastModel.spin.updateMatrixWorld(true);
    for (const id of LEG_IDS) {
      let foot = null;
      lastModel.legs[id].node.traverse(o => {
        if (!o.isMesh) return;
        const positions = o.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          v.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
          if (!foot || v.y < foot.y) foot = v.clone();
        }
      });
      // Stations mark ground contact: choose the actual lowest vertex, then drop Y.
      foot.setY(0).project(camera);
      result[id] = [r.x + (foot.x + 1) * r.w / 2, r.y + (1 - foot.y) * r.h / 2];
    }
    return result;
  }
  if (usable) void load();
  return { draw, available, ready, stations, debugFeet, dispose };
}
