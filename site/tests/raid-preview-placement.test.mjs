import test from "node:test";
import assert from "node:assert/strict";
import { previewAnchor, previewPlacement } from "../raid-preview.mjs";
import { readFile } from "node:fs/promises";
import { createRoomLayout, validateTimeline } from "../model.mjs";
import { stageGeometry } from "../stage.mjs";
import { worldToScreen } from "../camera.mjs";

const canvas = { w: 400, h: 300 }, box = { w: 80, h: 40 };
// R = [8,392] × [8,292]; legal box centres = [48,352] × [28,272].
const place = (point, options = {}) => previewPlacement({ point, canvas, box, ...options });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
function inside(result) {
  assert.ok(result.x - 40 >= 8 && result.x + 40 <= 392);
  assert.ok(result.y - 20 >= 8 && result.y + 20 <= 292);
}
function clears(result, avoid) {
  inside(result);
  assert.ok(result.x + 40 <= avoid.x - 8 || result.x - 40 >= avoid.x + avoid.w + 8 ||
    result.y + 20 <= avoid.y - 8 || result.y - 20 >= avoid.y + avoid.h + 8);
}

test("on-curtain centre is P with a downward arrow", () => {
  // (160,120) is inside both R and the legal centre range: no clamp or rotation.
  assert.deepEqual(place({ x: 160, y: 120 }), { x: 160, y: 120, angle: 0, pinned: false });
});

test("on-curtain box clamps at the right inset", () => {
  // P.x=390 is in R, but the centre must be 400-8-80/2=352.
  assert.deepEqual(place({ x: 390, y: 150 }), { x: 352, y: 150, angle: 0, pinned: false });
});

test("on-curtain box clamps at the bottom inset", () => {
  // P.y=290 is in R, but the centre must be 300-8-40/2=272.
  assert.deepEqual(place({ x: 200, y: 290 }), { x: 200, y: 272, angle: 0, pinned: false });
});

test("all four borders of R are inclusive", () => {
  // Border anchors clamp by half the box: x=8→48, 392→352; y=8→28, 292→272.
  for (const [point, x, y] of [
    [{ x: 8, y: 150 }, 48, 150], [{ x: 392, y: 150 }, 352, 150],
    [{ x: 200, y: 8 }, 200, 28], [{ x: 200, y: 292 }, 200, 272]
  ]) assert.deepEqual(place(point), { x, y, angle: 0, pinned: false });
});

for (const [side, point, x, y, angle] of [
  // Q=(392,150), centre=(352,150); curtain vector=(248,0): 0°-90°=-90°.
  ["right", { x: 600, y: 150 }, 352, 150, -90],
  // Q=(8,150), centre=(48,150); vector=(-248,0): 180°-90°=90°.
  ["left", { x: -200, y: 150 }, 48, 150, 90],
  // Q=(200,292), centre=(200,272); vector=(0,178): 90°-90°=0°.
  ["below", { x: 200, y: 450 }, 200, 272, 0],
  // Q=(200,8), centre=(200,28); vector=(0,-178): -180° normalises to 180°.
  ["above", { x: 200, y: -150 }, 200, 28, 180]
]) test(`off-${side} curtain pins and points along its axis`, () => {
  const result = place(point);
  assert.deepEqual(result, { x, y, angle, pinned: true });
  inside(result);
});

for (const [corner, point, x, y, angle] of [
  // All four rays hit y's border at t=142/270=71/135, with Q.x=200±1420/9.
  // Clamping Q gives (352/48,272/28); each curtain vector has components ±148.
  // Down-right: atan2(148,148)-90°=-45°.
  ["bottom-right", { x: 500, y: 420 }, 352, 272, -45],
  // Down-left: atan2(148,-148)-90°=45°.
  ["bottom-left", { x: -100, y: 420 }, 48, 272, 45],
  // Up-right: atan2(-148,148)-90°=-135°.
  ["top-right", { x: 500, y: -120 }, 352, 28, -135],
  // Up-left: atan2(-148,-148)-90°=-225°, normalised to 135°.
  ["top-left", { x: -100, y: -120 }, 48, 28, 135]
]) test(`off-${corner} curtain pins inside R and aims at P`, () => {
  const result = place(point);
  assert.deepEqual(result, { x, y, angle, pinned: true });
  inside(result);
});

test("right-border handover is continuous within 0.1px", () => {
  // Inside=(352,225); outside t=192/192.01 gives (352,150+14400/192.01).
  const before = place({ x: 391.99, y: 225 }), after = place({ x: 392.01, y: 225 });
  assert.deepEqual(before, { x: 352, y: 225, angle: 0, pinned: false });
  assert.equal(after.pinned, true);
  assert.equal(after.x, 352);
  near(after.y, 150 + 14400 / 192.01);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.1);
});

test("top-border handover is continuous within 0.1px", () => {
  // Inside=(260,28); outside t=142/142.01 gives (200+8520/142.01,28).
  const before = place({ x: 260, y: 8.01 }), after = place({ x: 260, y: 7.99 });
  assert.deepEqual(before, { x: 260, y: 28, angle: 0, pinned: false });
  assert.equal(after.pinned, true);
  near(after.x, 200 + 8520 / 142.01);
  assert.equal(after.y, 28);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.1);
});

test("left-edge pin slides up above bottom-left camera controls", () => {
  // t=192/400=.48, Q=(8,198), clamped=(48,198). Expanded controls y=[172,288].
  // Up centre=172-20=152; down=288+20=308 exceeds 272. Final vector=(-248,98).
  const avoid = { x: 8, y: 180, w: 44, h: 100 };
  const result = place({ x: -200, y: 250 }, { avoid });
  assert.deepEqual({ ...result, angle: 0 }, { x: 48, y: 152, angle: 0, pinned: true });
  near(result.angle, 90 - Math.atan(49 / 124) * 180 / Math.PI);
  clears(result, avoid);
});

test("left-edge pin slides down when R blocks the upward move", () => {
  // t=.48, Q=(8,102), clamped=(48,102). Expanded controls y=[0,116].
  // Up=-20 is outside R; down=116+20=136. Final vector=(-248,-86).
  const avoid = { x: 8, y: 8, w: 44, h: 100 };
  const result = place({ x: -200, y: 50 }, { avoid });
  assert.deepEqual({ ...result, angle: 0 }, { x: 48, y: 136, angle: 0, pinned: true });
  near(result.angle, 90 + Math.atan(43 / 124) * 180 / Math.PI);
  clears(result, avoid);
});

test("on-curtain mode ignores the same bottom-left controls", () => {
  // P=(48,198) overlaps expanded controls but is a legal on-curtain centre; angle stays 0°.
  const avoid = { x: 8, y: 180, w: 44, h: 100 };
  assert.deepEqual(place({ x: 48, y: 198 }, { avoid }), { x: 48, y: 198, angle: 0, pinned: false });
});

test("avoidance chooses the shorter of two legal slide directions", () => {
  // Q=(8,150) clamps to (48,150); expanded y=[122,198]. Up=102 (48px), down=218 (68px).
  const avoid = { x: 8, y: 130, w: 44, h: 60 };
  const result = place({ x: -200, y: 150 }, { avoid });
  assert.equal(result.pinned, true);
  assert.deepEqual([result.x, result.y], [48, 102]);
  clears(result, avoid);
});

test("avoidance keeps the clamped position when neither direction clears", () => {
  // Expanded y=[-8,308] would require y=-28 or 328, both outside [28,272].
  const point = { x: -200, y: 150 };
  assert.deepEqual(place(point, { avoid: { x: 0, y: 0, w: 400, h: 300 } }),
    { x: 48, y: 150, angle: 90, pinned: true });
});

test("an exact corner considers both axes and chooses a shorter horizontal move", () => {
  // P-C=(384,284)=2*(192,142), so Q=(392,292), clamped=(352,272).
  // Expanded rect=[342,388]×[192,288]: left x=302 (50px), up y=172 (100px).
  const avoid = { x: 350, y: 200, w: 30, h: 80 };
  const result = place({ x: 584, y: 434 }, { avoid });
  assert.equal(result.pinned, true);
  assert.deepEqual([result.x, result.y], [302, 272]);
  near(result.angle, Math.atan(27 / 47) * 180 / Math.PI - 90); // Final vector=(282,162).
  clears(result, avoid);
});

test("an exact corner also permits the shorter vertical move", () => {
  // Same Q and clamped centre. Expanded rect=[312,378]×[242,288].
  // Up y=222 (50px) beats left x=272 (80px); final vector=(232,212).
  const avoid = { x: 320, y: 250, w: 50, h: 30 };
  const result = place({ x: 584, y: 434 }, { avoid });
  assert.equal(result.pinned, true);
  assert.deepEqual([result.x, result.y], [352, 222]);
  near(result.angle, Math.atan(53 / 58) * 180 / Math.PI - 90);
  clears(result, avoid);
});

test("bottom-edge avoidance slides horizontally when left is blocked", () => {
  // Q=(200,292) clamps to (200,272). Expanded x=[0,236]: left=-40, right=276.
  const avoid = { x: 8, y: 250, w: 220, h: 42 };
  const result = place({ x: 200, y: 450 }, { avoid });
  assert.equal(result.pinned, true);
  assert.deepEqual([result.x, result.y], [276, 272]);
  clears(result, avoid);
});

test("glyph offset determines the aiming vector without moving the box", () => {
  // P=(600,328) gives Q=(392,235.44), clamped centre=(352,235.44).
  // Glyph offset=(70,-85.44) gives G=(422,150); P-G=(178,178), hence -45°.
  const result = place({ x: 600, y: 328 }, { glyphOffset: { x: 70, y: -85.44 } });
  assert.equal(result.pinned, true);
  assert.equal(result.x, 352);
  near(result.y, 235.44);
  near(result.angle, -45);
});

test("a box larger than both canvas axes is centred with finite output", () => {
  // Canvas 60×40 has centre (30,20); box 80×60 cannot fit either inset axis.
  const result = previewPlacement({ point: { x: 500, y: 500 }, canvas: { w: 60, h: 40 }, box: { w: 80, h: 60 },
    avoid: { x: 0, y: 0, w: 60, h: 40 } });
  assert.deepEqual([result.x, result.y, result.pinned], [30, 20, true]);
  for (const value of [result.x, result.y, result.angle]) assert.ok(Number.isFinite(value));
});

test("an oversized box centres only the axis that cannot fit", () => {
  // Box width 500 exceeds R's 384, so x=200; height 40 fits, so y=100 remains.
  assert.deepEqual(place({ x: 50, y: 100 }, { box: { w: 500, h: 40 } }),
    { x: 200, y: 100, angle: 0, pinned: false });
});

test("missing and zero boxes use the point-size inset border", () => {
  // A 0×0 box on a rightward ray can centre exactly at Q=(392,150), with -90° rotation.
  for (const box of [undefined, 0, { w: 0, h: 0 }]) {
    assert.deepEqual(place({ x: 600, y: 150 }, { box }), { x: 392, y: 150, angle: -90, pinned: true });
  }
});

test("a canvas smaller than both insets never produces NaN", () => {
  // Canvas 10×10 collapses both inset axes to (5,5), including a zero-length ray.
  for (const point of [{ x: 5, y: 5 }, { x: -50, y: -50 }]) {
    const result = previewPlacement({ point, canvas: { w: 10, h: 10 }, box });
    assert.deepEqual([result.x, result.y, result.pinned], [5, 5, true]);
    assert.ok(Number.isFinite(result.angle));
  }
});

test("a custom inset changes both the ray border and the box clamp", () => {
  // Inset=20 gives right border 380; half-width=40 gives centre x=340, y=150, angle=-90°.
  assert.deepEqual(place({ x: 600, y: 150 }, { inset: 20 }), { x: 340, y: 150, angle: -90, pinned: true });
});

test("an upper curtain tip meets the box bottom without flipping", () => {
  const tipAbove = { x: 170, y: 110 };
  const result = place({ x: 160, y: 150 }, { tipAbove, tipBelow: { x: 170, y: 190 } });
  assert.equal(result.x, tipAbove.x);
  assert.equal(result.y + box.h / 2, tipAbove.y);
  assert.equal(result.angle, 0);
  assert.equal(result.flip, false);
  assert.equal(result.pinned, false);
});

test("insufficient space above flips the box below the lower curtain tip", () => {
  const tipBelow = { x: 180, y: 100 };
  const result = place({ x: 160, y: 60 }, { tipAbove: { x: 170, y: 20 }, tipBelow });
  assert.equal(result.x, tipBelow.x);
  assert.equal(result.y - box.h / 2, tipBelow.y);
  assert.equal(result.angle, 180);
  assert.equal(result.flip, true);
  assert.equal(result.pinned, false);
});

test("when neither tip fits the upper position clamps without flipping", () => {
  const result = place({ x: 160, y: 150 }, {
    tipAbove: { x: 170, y: 20 }, tipBelow: { x: 170, y: 280 }
  });
  assert.equal(result.flip, false);
  assert.equal(result.angle, 0);
  assert.ok(result.y >= 8 + box.h / 2 && result.y <= canvas.h - 8 - box.h / 2);
  assert.equal(result.y, 28);
});

test("tips clamp horizontally at both insets in above and flip modes", () => {
  for (const [tipX, expectedX] of [[4, 48], [396, 352]]) {
    for (const flip of [false, true]) {
      const result = place({ x: 200, y: 150 }, {
        tipAbove: { x: tipX, y: flip ? 20 : 110 }, tipBelow: { x: tipX, y: 190 }
      });
      assert.equal(result.x, expectedX);
      assert.equal(result.flip, flip);
      inside(result);
    }
  }
});

test("pinned placement ignores both tips, including glyph offsets and control avoidance", () => {
  const options = { avoid: { x: 8, y: 130, w: 44, h: 60 }, glyphOffset: { x: 5, y: -3 } };
  for (const point of [{ x: -200, y: 150 }, { x: 600, y: 150 }, { x: 500, y: -120 }]) {
    const before = place(point, options);
    const after = place(point, { ...options, tipAbove: { x: 100, y: 20 }, tipBelow: { x: 100, y: 100 } });
    const { flip, ...rest } = after;
    assert.equal(rest.pinned, true);
    assert.equal(flip, false);
    assert.deepEqual(rest, before);
  }
});

test("upper-fit and lower-fit boundaries are inclusive; a missing lower tip clamps above", () => {
  const point = { x: 160, y: 150 };
  const above = place(point, { tipAbove: { x: 160, y: 48 }, tipBelow: { x: 160, y: 100 } });
  assert.equal(above.flip, false);
  assert.equal(above.y + box.h / 2, 48);
  const below = place(point, { tipAbove: { x: 160, y: 47 }, tipBelow: { x: 160, y: 252 } });
  assert.equal(below.flip, true);
  assert.equal(below.y - box.h / 2, 252);
  const missing = place(point, { tipAbove: { x: 160, y: 20 } });
  assert.equal(missing.flip, false);
  assert.equal(missing.y, 28);
});

test("default hall preview stays below stage speech and clears the microphone and speaker across pans", async t => {
  const raw = JSON.parse(await readFile(new URL("../data/timeline.raid.sample.json", import.meta.url), "utf8"));
  const timeline = validateTimeline(raw);
  const layout = createRoomLayout(timeline.tables, timeline.room_layout);
  const { stageFront } = layout;
  const { microphone } = stageGeometry(layout);
  const anchor = previewAnchor(layout);
  const previewBox = { w: 194, h: 70 };
  const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let checked = 0, flips = 0;
  try {
    for (const canvas of [{ w: 1440, h: 800 }, { w: 375, h: 600 }]) {
      let canvasChecked = 0, canvasFlips = 0;
      for (const zoom of [.5, .75, 1, 1.5, 2, 2.5, 3]) {
        // drawHall scales drawing pixels by camera.zoom / (TILE * SCALE), where 16 * 2 = 32.
        const pixelsPerTile = 32 * zoom;
        for (const screenX of [16, canvas.w / 4, canvas.w / 2, canvas.w * .75, canvas.w - 16]) {
          // A 16px anchor forces the flip below it at every tested zoom.
          for (const screenY of [16, 40, 64, canvas.h / 4, canvas.h / 2, canvas.h * .75, canvas.h - 16]) {
            const camera = { x: screenX - anchor.x * pixelsPerTile,
              y: screenY - anchor.y * pixelsPerTile, zoom: pixelsPerTile };
            // Match update(): the arrow rests on the anchor, above or (flipped) below.
            const point = worldToScreen(camera, anchor);
            const result = previewPlacement({ point, canvas, box: previewBox, tipAbove: point, tipBelow: point });
            if (result.pinned) continue;
            checked++; canvasChecked++;
            if (result.flip) { flips++; canvasFlips++; }
            const button = { x: result.x - previewBox.w / 2, y: result.y - previewBox.h / 2, ...previewBox };
            const mic = worldToScreen(camera, microphone);
            const micScale = camera.zoom / 32;
            const micRect = { x: mic.x - 7 * micScale, y: mic.y - 24 * micScale,
              w: 14 * micScale, h: 33 * micScale };
            const speaker = worldToScreen(camera, { x: stageFront.x - .5, y: stageFront.y - 1.5 });
            const speakerRect = { ...speaker, w: camera.zoom, h: 1.5 * camera.zoom };
            const context = `zoom=${zoom}, pan=(${camera.x},${camera.y}), canvas=${canvas.w}x${canvas.h}`;
            assert.equal(intersects(button, micRect), false, `BLOCKED: mic overlap at ${context}`);
            assert.equal(intersects(button, speakerRect), false, `BLOCKED: mic overlap at ${context} (speaker)`);
            // The lowest stage bubble (a speaker at the mic) ends 1.2 tiles above them, plus its 6px tail.
            const bubbleBottom = worldToScreen(camera, { x: stageFront.x, y: stageFront.y - 1.2 }).y + 6;
            assert.ok(button.y >= bubbleBottom, `BLOCKED: stage speech overlap at ${context}`);
          }
        }
      }
      t.diagnostic(`${canvas.w}x${canvas.h}: placements=${canvasChecked}, flips=${canvasFlips}`);
      assert.ok(canvasChecked > 50);
      assert.ok(canvasFlips > 0);
    }
  } finally {
    t.diagnostic(`mic geometry: placements=${checked}, flips=${flips}`);
  }
  assert.ok(checked > 50);
  assert.ok(flips > 0);
});

test("a list of avoid rects: a right-edge pin slides up off the stage mic and ignores far controls", () => {
  const controls = { x: 8, y: 250, w: 60, h: 40 }, mic = { x: 340, y: 145, w: 10, h: 20 };
  const plain = place({ x: 600, y: 150 });
  assert.deepEqual([plain.x, plain.y], [352, 150]);
  const result = place({ x: 600, y: 150 }, { avoid: [controls, mic] });
  assert.equal(result.pinned, true);
  // Mic band with margin is [137,173]; up to 137-20=117 moves 33px, down to 173+20=193 moves 43px.
  assert.deepEqual([result.x, result.y], [352, 117]);
  clears(result, mic);
  assert.deepEqual(place({ x: 600, y: 150 }, { avoid: [mic] }), result);
});
