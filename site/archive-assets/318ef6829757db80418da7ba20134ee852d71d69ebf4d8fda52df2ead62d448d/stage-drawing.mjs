import { stageGeometry } from "./stage.mjs";

const U = 32, TILE = 16, STRIDE = 17, PX = 1 / 16;

/** Each canvas owns its drawing bindings. */
export function createStageDrawing({ ctx: getCtx, indoor: getIndoor, reduced: isReduced }) {
  function rect(color, x, y, w, h) {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.fillRect(x * U, y * U, w * U, h * U);
  }

  function boards({ x, y, w, h }) {
    const ctx = getCtx(), img = getIndoor();
    if (!ctx) return;
    if (!img) { rect("#6b4a33", x, y, w, h); return; }
    for (let ty = 0; ty < h; ty += 1) for (let tx = 0; tx < w; tx += 1) {
      const cw = Math.min(1, w - tx), ch = Math.min(1, h - ty);
      ctx.drawImage(img, 24 * STRIDE, ((tx + ty) % 2 ? 2 : 0) * STRIDE,
        TILE * cw, TILE * ch, (x + tx) * U, (y + ty) * U, cw * U, ch * U);
    }
  }

  function tint({ x, y, w, h }) {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    rect("#8a6d62", x, y, w, h);
    ctx.restore();
  }

  function wallDrape(stage) {
    const w = .85, x = stage.x + stage.w - w, y = stage.y, h = stage.h;
    const shades = ["#6d1b22", "#8e2630", "#a8343c", "#8e2630"];
    for (let k = 0; k < h * TILE; k += 1) rect(shades[k % 4], x, y + k * PX, w, PX);
    rect("rgba(0,0,0,.25)", x, y, 2 * PX, h);
    rect("#c9a45c", x + w - PX, y, PX, h);
    for (let ty = y + 2.5; ty < y + h - 1; ty += 4) {
      rect("#e0c070", x - PX, ty, w + PX, 2 * PX);
      rect("#6d1b22", x - 2 * PX, ty - 3 * PX, 2 * PX, 8 * PX);
    }
  }

  function lip({ x, y, h }) {
    rect("rgba(10, 8, 14, .38)", x - 5 * PX, y, 5 * PX, h);
    rect("#3a2618", x, y, 2 * PX, h);
    rect("#c9a45c", x, y, PX, h);
  }

  function stairs(s) {
    rect("rgba(10, 8, 14, .4)", s.x - 3 * PX, s.y + 3 * PX, s.w, s.h);
    const tones = ["#5a3d28", "#6e4a30", "#83593a", "#986a45"];
    for (let k = 0; k < 4; k += 1) {
      const sx = s.x + k * s.w / 4;
      rect(tones[k], sx, s.y, s.w / 4, s.h);
      rect("#c9a45c", sx, s.y, PX, s.h);
      rect("#2a1b12", sx, s.y + s.h - PX, s.w / 4, PX);
    }
  }

  function footlight(x, y) {
    rect("#2a2320", x, y - 2 * PX, 3 * PX, 5 * PX);
    rect("#c9a45c", x + PX, y - PX, 2 * PX, 3 * PX);
    rect("#fff1c0", x + 3 * PX, y - PX, PX, 3 * PX);
  }

  function* footlights(stage) {
    let index = 0;
    for (let y = stage.y + 1; y < stage.y + stage.h - 3; y += 1.5) yield { y, seed: index++ * 1.7 };
  }

  function warm(cx, cy, now, seed) {
    const ctx = getCtx();
    if (!ctx?.createRadialGradient || !ctx.save || !ctx.restore || !ctx.translate || !ctx.scale
      || !ctx.beginPath || !ctx.arc || !ctx.fill) return;
    const f = isReduced() ? 0 : .08 * Math.sin(now / 83 + seed) * Math.sin(now / 137 + seed * 2.3) + .04 * Math.sin(now / 41 + seed * 5);
    const rx = 1.2, ry = .7, radius = rx * U * (1 + f * .5);
    const g = ctx.createRadialGradient(cx * U, cy * U, 0, cx * U, cy * U, radius);
    if (!g?.addColorStop) return;
    g.addColorStop(0, `rgba(255, 225, 150, ${.32 + f})`);
    g.addColorStop(1, "rgba(255, 225, 150, 0)");
    ctx.save();
    ctx.fillStyle = g;
    ctx.translate(cx * U, cy * U);
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStageFloor(layout) {
    const { stage } = layout;
    boards(stage);
    tint(stage);
    wallDrape(stage);
    lip(stage);
    stairs(stageGeometry(layout).stairs);
    for (const { y } of footlights(stage)) footlight(stage.x + PX, y);
  }

  function drawStageLights(layout, now) {
    const { stage } = layout;
    for (const { y, seed } of footlights(stage)) warm(stage.x + .5, y + .05, now, seed);
  }

  return { drawStageFloor, drawStageLights };
}
