import test from "node:test";
import assert from "node:assert/strict";
import { createStageDrawing } from "../stage-drawing.mjs";
import { stageGeometry } from "../stage.mjs";

const layout = { stage: { x: 20, y: 2, w: 6, h: 10 }, stageFront: { x: 22, y: 6 } };

function canvas() {
  const calls = [], stack = [];
  const ctx = {
    globalCompositeOperation: "source-over",
    save() { stack.push({ fillStyle: this.fillStyle, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop()); },
    drawImage(...args) { calls.push({ op: "image", args }); },
    fillRect(...args) { calls.push({ op: "rect", color: this.fillStyle, mode: this.globalCompositeOperation, args }); },
    createRadialGradient(...args) {
      return { args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
    },
    translate(...args) { calls.push({ op: "translate", args }); },
    scale(...args) { calls.push({ op: "scale", args }); },
    beginPath() {},
    arc(...args) { calls.push({ op: "arc", args }); },
    fill() { calls.push({ op: "fill", gradient: structuredClone({ args: this.fillStyle.args, stops: this.fillStyle.stops }) }); },
  };
  return { ctx, calls };
}

test("reduced-motion stage glows keep identical fills and ellipse geometry across times", () => {
  const { ctx, calls } = canvas();
  const drawing = createStageDrawing({ ctx: () => ctx, indoor: () => null, reduced: () => true });
  drawing.drawStageLights(layout, 400);
  const first = structuredClone(calls);
  const fills = first.filter(call => call.op === "fill");
  assert.equal(fills.length, 4);
  fills.forEach((fill, index) => {
    assert.deepEqual(fill.gradient.args, [20.5 * 32, (3.05 + index * 1.5) * 32, 0, 20.5 * 32, (3.05 + index * 1.5) * 32, 1.2 * 32]);
    assert.deepEqual(fill.gradient.stops, [[0, "rgba(255, 225, 150, 0.32)"], [1, "rgba(255, 225, 150, 0)"]]);
  });
  assert.ok(first.filter(call => call.op === "scale").every(call => call.args[1] === .7 / 1.2));
  calls.length = 0;
  drawing.drawStageLights(layout, 8900);
  assert.deepEqual(calls, first);
});

test("live stage glows vary with now and repeat deterministically", () => {
  const { ctx, calls } = canvas();
  const drawing = createStageDrawing({ ctx: () => ctx, indoor: () => null, reduced: () => false });
  const frame = now => {
    calls.length = 0;
    drawing.drawStageLights(layout, now);
    return structuredClone(calls.filter(call => call.op === "fill"));
  };
  const first = frame(400);
  assert.equal(first.length, 4);
  assert.notDeepEqual(frame(8900), first);
  assert.deepEqual(frame(400), first);
});

test("stage fallback keeps curtain, geometry stairs and hoods after restoring the walnut tint", () => {
  const { ctx, calls } = canvas();
  const drawing = createStageDrawing({ ctx: () => ctx, indoor: () => null, reduced: () => true });
  drawing.drawStageFloor(layout);
  assert.deepEqual(calls[0], { op: "rect", color: "#6b4a33", mode: "source-over", args: [640, 64, 192, 320] });
  assert.deepEqual(calls[1], { op: "rect", color: "#8a6d62", mode: "multiply", args: [640, 64, 192, 320] });
  assert.ok(calls.slice(2).every(call => call.mode === "source-over"));
  assert.equal(ctx.globalCompositeOperation, "source-over");
  const curtain = calls.findIndex(call => call.color === "#a8343c");
  const edge = calls.findIndex(call => call.color === "#3a2618");
  const steps = calls.findIndex(call => call.color === "#5a3d28");
  const hood = calls.findIndex(call => call.color === "#2a2320");
  assert.ok(curtain > 1 && edge > curtain && steps > edge && hood > steps);
  const { stairs } = stageGeometry(layout);
  assert.deepEqual(calls[steps].args, [stairs.x * 32, stairs.y * 32, stairs.w / 4 * 32, stairs.h * 32]);
  assert.equal(calls.filter(call => call.color === "#2a2320").length, 4);
});

test("short stages omit both footlight hoods and glows", () => {
  const { ctx, calls } = canvas();
  const drawing = createStageDrawing({ ctx: () => ctx, indoor: () => null, reduced: () => false });
  for (const h of [3, 4]) {
    calls.length = 0;
    const short = { ...layout, stage: { ...layout.stage, h } };
    drawing.drawStageFloor(short);
    drawing.drawStageLights(short, 400);
    assert.equal(calls.filter(call => call.color === "#2a2320" || call.op === "fill").length, 0);
  }
});

test("stage glows tolerate missing optional canvas methods and gradient stops", () => {
  for (const ctx of [null, {}, { createRadialGradient() {} }, { ...canvas().ctx, createRadialGradient() { return {}; } },
    ...["save", "restore", "translate", "scale", "beginPath", "arc", "fill"].map(method => ({ ...canvas().ctx, [method]: undefined }))]) {
    const drawing = createStageDrawing({ ctx: () => ctx, indoor: () => null, reduced: () => false });
    assert.doesNotThrow(() => drawing.drawStageLights(layout, 400));
  }
});
