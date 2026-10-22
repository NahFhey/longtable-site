// PS1 pipeline adapted from the approved raid prototype and music-video render/retro/retro.js.
// Alpha survives both post passes; per-material tint dims collapsed limbs.
import * as THREE from './vendor/three/three.module.js';

const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
uniform vec2 uRes; uniform float uSnapPx;
uniform vec3 uAmbient; uniform float uBaked; uniform float uUnlit;
uniform vec3 uPLPos[2]; uniform vec3 uPLCol[2]; uniform float uPLK[2];
uniform vec3 uSpotPos; uniform vec3 uSpotDir; uniform vec3 uSpotCol; uniform float uSpotCos; uniform float uSpotK;
uniform vec3 uDirDir; uniform vec3 uDirCol;
uniform float uFogNear; uniform float uFogFar;
varying vec3 vLight; varying float vFog; varying vec2 vUv; varying vec3 vUvAff;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
  vec3 vc = vec3(1.0);
  #if defined(USE_COLOR_ALPHA)
    vc = color.rgb;
  #elif defined(USE_COLOR)
    vc = color;
  #endif
  vec3 lit = uAmbient;
  for (int i = 0; i < 2; i++) {
    vec3 L = uPLPos[i] - wp.xyz; float d = length(L);
    lit += uPLCol[i] * max(dot(wn, L / d), 0.0) / (1.0 + uPLK[i] * d * d);
  }
  vec3 Ls = uSpotPos - wp.xyz; float ds = length(Ls); vec3 ls = Ls / ds;
  lit += uSpotCol * smoothstep(uSpotCos, uSpotCos + 0.06, dot(-ls, uSpotDir)) * max(dot(wn, ls), 0.0) / (1.0 + uSpotK * ds * ds);
  lit += uDirCol * max(dot(wn, -uDirDir), 0.0);
  vLight = uUnlit > 0.5 ? vec3(1.0) : mix(vec3(1.0), vc, uBaked) * (lit + vc * uBaked * 0.6);
  vec4 mv = viewMatrix * wp;
  vec4 clip = projectionMatrix * mv;
  if (uSnapPx > 0.0 && clip.w > 0.0) {            // PS1: no sub-pixel precision -> vertices jitter
    vec2 grid = uRes * 0.5 / uSnapPx;
    clip.xy = floor(clip.xy / clip.w * grid + 0.5) / grid * clip.w;
  }
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  vUv = uv; vUvAff = vec3(uv * clip.w, clip.w);   // uv*w / w interpolates screen-linearly = affine
  gl_Position = clip;
}`;

const FRAG = /* glsl */`
uniform vec3 uTint; uniform sampler2D map; uniform float uHasMap; uniform float uAffine; uniform float uEmit; uniform float uUnlit;
uniform vec3 uFogCol;
varying vec3 vLight; varying float vFog; varying vec2 vUv; varying vec3 vUvAff;
void main() {
  vec2 uv = mix(vUv, vUvAff.xy / vUvAff.z, uAffine);
  vec3 tex = uHasMap > 0.5 ? texture2D(map, uv).rgb : vec3(1.0);
  vec3 c = tex * vLight * uTint * (uUnlit > 0.5 ? uEmit : 1.0);
  c = mix(c, uFogCol, vFog * (uUnlit > 0.5 ? 0.45 : 1.0));
  gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);   // store display-space, like the hardware did
}`;

const POST = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tPrev; uniform vec2 uRes; uniform float uFrame;
uniform float uBloom; uniform float uThresh; uniform float uRadius; uniform float uTrail;
uniform float uExposure; uniform float uContrast; uniform float uSat; uniform vec3 uLift; uniform vec3 uGain;
uniform float uLevels; uniform float uDither; uniform float uGrain; uniform float uLetterbox;
varying vec2 vUv;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
  return 0.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 s0 = texture2D(tScene, vUv); vec3 c = s0.rgb;
  if (uBloom > 0.0) {
    vec3 b = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996, r = uRadius * sqrt((float(i) + 0.5) / 16.0);
      vec3 s = texture2D(tScene, vUv + vec2(cos(a), sin(a)) * r / uRes).rgb;
      b += max(s - uThresh, 0.0) / (1.0 - uThresh);
    }
    c += uBloom * b / 16.0;
  }
  c = mix(c, texture2D(tPrev, vUv).rgb, uTrail);
  c *= uExposure;
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);
  c = uLift + c * (uGain - uLift);
  c += (hash(floor(vUv * uRes) + uFrame * 17.0) - 0.5) * uGrain;
  if (uLevels > 0.0) c = floor(clamp(c, 0.0, 1.0) * uLevels + 0.5 + bayer(gl_FragCoord.xy) * uDither) / uLevels;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), s0.a);
}`;

const FINAL = /* glsl */`
uniform sampler2D tCur; uniform sampler2D tPrev; uniform vec2 uRes; uniform float uFrame;
uniform float uScan; uniform float uInterlace; uniform float uVignette; uniform float uBleed; uniform float uSoft;
varying vec2 vUv;
vec4 tap(sampler2D t, vec2 uv) {
  vec2 n = (floor(uv * uRes) + 0.5) / uRes;          // nearest-neighbour upscale
  return texture2D(t, n);
}
void main() {
  vec2 uv = vUv; float row = floor(uv.y * uRes.y);
  bool oldField = uInterlace > 0.5 && mod(row + uFrame, 2.0) > 0.5;   // combing: odd field from previous frame
  vec4 c4 = oldField ? tap(tPrev, uv) : tap(tCur, uv); vec3 c = c4.rgb;
  if (uBleed > 0.0) { c.r = mix(c.r, tap(tCur, uv + vec2(uBleed / uRes.x, 0.0)).r, 0.6); c.b = mix(c.b, tap(tCur, uv - vec2(uBleed / uRes.x, 0.0)).b, 0.6); }
  float sl = fract(uv.y * uRes.y); c *= 1.0 - uScan * smoothstep(0.55, 1.0, abs(sl - 0.5) * 2.0);
  vec2 d = uv - 0.5; c *= 1.0 - uVignette * dot(d, d) * 2.2;
  float a = step(0.5, c4.a);
  gl_FragColor = vec4(c * a, a);                     // binary alpha, premultiplied for the 2D composite
}`;

const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const v3 = a => new THREE.Vector3(...a);

export function retroMaterial(src, unlit) {
  const map = src.map ?? null;
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, vertexColors: true,
    uniforms: {
      uTint: {value: new THREE.Vector3(1, 1, 1)}, map: {value: map}, uHasMap: {value: map ? 1 : 0}, uUnlit: {value: unlit ? 1 : 0}, uEmit: {value: 1.4},
      uRes: {value: new THREE.Vector2(320, 240)}, uSnapPx: {value: 1}, uAffine: {value: 1},
      uAmbient: {value: new THREE.Vector3()}, uBaked: {value: 1},
      uPLPos: {value: [new THREE.Vector3(), new THREE.Vector3()]}, uPLCol: {value: [new THREE.Vector3(), new THREE.Vector3()]}, uPLK: {value: [1, 1]},
      uSpotPos: {value: new THREE.Vector3()}, uSpotDir: {value: new THREE.Vector3(0, 0, -1)}, uSpotCol: {value: new THREE.Vector3()}, uSpotCos: {value: 0.95}, uSpotK: {value: 0.1},
      uDirDir: {value: new THREE.Vector3(0, -1, 0)}, uDirCol: {value: new THREE.Vector3()},
      uFogCol: {value: new THREE.Vector3()}, uFogNear: {value: 4}, uFogFar: {value: 14},
    },
  });
}

export class RetroPipeline {
  constructor(renderer, width, height) {
    this.renderer = renderer; this.width = width; this.height = height; this.frame = 0;
    this.materials = []; this.sources = new Set();
    const quad = new THREE.PlaneGeometry(2, 2); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.post = new THREE.ShaderMaterial({vertexShader: QUAD_VERT, fragmentShader: POST, depthTest: false, uniforms: Object.fromEntries(
      ['tScene', 'tPrev', 'uRes', 'uFrame', 'uBloom', 'uThresh', 'uRadius', 'uTrail', 'uExposure', 'uContrast', 'uSat', 'uLift', 'uGain', 'uLevels', 'uDither', 'uGrain', 'uLetterbox'].map(k => [k, {value: null}]))});
    this.final = new THREE.ShaderMaterial({vertexShader: QUAD_VERT, fragmentShader: FINAL, depthTest: false, uniforms: Object.fromEntries(
      ['tCur', 'tPrev', 'uRes', 'uFrame', 'uScan', 'uInterlace', 'uVignette', 'uBleed', 'uSoft'].map(k => [k, {value: null}]))});
    this.postScene = new THREE.Scene(); this.postScene.add(new THREE.Mesh(quad, this.post));
    this.finalScene = new THREE.Scene(); this.finalScene.add(new THREE.Mesh(quad, this.final));
  }
  // Swap every mesh's material for the retro one; emissive glTF materials become unlit.
  adopt(root) {
    root.traverse(o => {
      if (!o.isMesh) return;
      const convert = src => {
        this.sources.add(src);
        const unlit = src.emissive && src.emissive.r + src.emissive.g + src.emissive.b > 0.1;
        const mat = retroMaterial(src, unlit); this.materials.push(mat); return mat;
      };
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
      o.frustumCulled = false;
    });
  }
  apply(p) {
    this.p = p;
    const [w, h] = p.res, mk = filter => new THREE.WebGLRenderTarget(w, h, {minFilter: filter, magFilter: filter, depthBuffer: true});
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt?.dispose();
    this.rtScene = mk(THREE.NearestFilter); this.rtA = mk(THREE.LinearFilter); this.rtB = mk(THREE.LinearFilter);
    const filt = p.texFilter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter;
    for (const m of this.materials) {
      const u = m.uniforms;
      if (u.map.value) { u.map.value.magFilter = filt; u.map.value.minFilter = p.texFilter === 'linear' ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter; u.map.value.needsUpdate = true; }
      u.uRes.value.set(w, h); u.uSnapPx.value = p.snapPx; u.uAffine.value = p.affine; u.uBaked.value = p.baked; u.uEmit.value = p.emit;
      u.uAmbient.value.set(...p.ambient); u.uFogCol.value.set(...p.fog.color); u.uFogNear.value = p.fog.near; u.uFogFar.value = p.fog.far;
      u.uDirDir.value.copy(v3(p.dir.dir).normalize()); u.uDirCol.value.set(...p.dir.color);
      u.uSpotCos.value = p.spot ? p.spot.cos : 1; u.uSpotK.value = p.spot ? p.spot.k : 1;
    }
    const pu = this.post.uniforms, q = p.post;
    pu.uRes.value = new THREE.Vector2(w, h); pu.uBloom.value = q.bloom; pu.uThresh.value = q.thresh; pu.uRadius.value = q.radius; pu.uTrail.value = q.trail;
    pu.uExposure.value = q.exposure; pu.uContrast.value = q.contrast; pu.uSat.value = q.saturation; pu.uLift.value = v3(q.lift); pu.uGain.value = v3(q.gain);
    pu.uLevels.value = q.levels; pu.uDither.value = q.dither; pu.uGrain.value = q.grain; pu.uLetterbox.value = q.letterbox;
    const fu = this.final.uniforms, f = p.final;
    fu.uRes.value = new THREE.Vector2(w, h); fu.uScan.value = f.scanlines; fu.uInterlace.value = f.interlace; fu.uVignette.value = f.vignette; fu.uBleed.value = f.bleed; fu.uSoft.value = f.soft;
  }
  // lights: {lamp:[x,y,z], lampScale, window:[x,y,z], spotPos, spotDir}
  setLights(l) {
    const p = this.p;
    for (const m of this.materials) {
      const u = m.uniforms;
      u.uPLPos.value[0].set(...l.lamp); u.uPLCol.value[0].set(...p.lamp.slice(0, 3)).multiplyScalar(l.lampScale); u.uPLK.value[0] = p.lamp[3];
      u.uPLPos.value[1].set(...l.window); u.uPLCol.value[1].set(...p.window.slice(0, 3)); u.uPLK.value[1] = p.window[3];
      if (p.spot) { u.uSpotPos.value.copy(l.spotPos); u.uSpotDir.value.copy(l.spotDir); u.uSpotCol.value.set(...p.spot.color); }
      else u.uSpotCol.value.set(0, 0, 0);
    }
  }
  dispose() {
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt?.dispose();
    this.postScene.children[0].geometry.dispose();
    this.post.dispose(); this.final.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const mat of this.sources) mat.dispose();
    this.materials.length = 0; this.sources.clear();
  }
  render(scene, camera) {
    const r = this.renderer, cur = this.frame % 2 ? this.rtA : this.rtB, prev = this.frame % 2 ? this.rtB : this.rtA;
    scene.background = null; r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtScene); r.render(scene, camera);
    const pu = this.post.uniforms; pu.tScene.value = this.rtScene.texture; pu.tPrev.value = prev.texture; pu.uFrame.value = this.frame;
    if (this.frame === 0) {   // seed the previous-frame buffer so trails/interlace don't read an empty target
      const trail = pu.uTrail.value; pu.uTrail.value = 0; pu.tPrev.value = this.rtScene.texture;
      r.setRenderTarget(prev); r.render(this.postScene, this.cam); pu.uTrail.value = trail; pu.tPrev.value = prev.texture;
    }
    r.setRenderTarget(cur); r.render(this.postScene, this.cam);
    const fu = this.final.uniforms; fu.tCur.value = cur.texture; fu.tPrev.value = prev.texture; fu.uFrame.value = this.frame;
    r.setRenderTarget(null); r.render(this.finalScene, this.cam);
    this.frame++;
  }
}

