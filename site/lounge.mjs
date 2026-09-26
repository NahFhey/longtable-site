import { tileB, tileTL, nine, glow } from "./food-corner.mjs?v=1ee6e05562ff";
import { K, LOUNGE_FURNITURE, loungeGeometry } from "./lounge-layout.mjs?v=57da6155641f";

const U = 32, TILE = 16, STRIDE = 17, PX = 1 / 16;

/** Each canvas owns its drawing bindings. No shared mutable rendering state. */
export function createLoungeDrawing(options) {
  const getCtx = options.ctx, getRpg = options.rpg, getIndoor = options.indoor, isReduced = options.reduced;
  const geometry = loungeGeometry;
  const SHEETS = { rpg: getRpg, indoor: getIndoor };
  function drawParts(sheet, parts, x, y) {
    const img = SHEETS[sheet]?.();
    if (!img) { const ctx=getCtx(); if(ctx) { ctx.fillStyle="#765437"; for(const [, , dx,dy] of parts)ctx.fillRect((x+dx)*U,(y+dy)*U,U,U); } return; }
    for (const [c, r, dx, dy, fromRow = 0] of parts) subImg(img, [c, r], 0, fromRow, 16, 16 - fromRow, x + dx, y + dy + fromRow * PX, 1, (16 - fromRow) * PX);
  }
  /** Draw a furniture piece with its top-left at (x, y); `fromRow` (row-built pieces) draws only the rows from it on. */
  function drawFurniture(kind, x, y, fromRow = 0) {
    const f = LOUNGE_FURNITURE[kind];
    if (!f.rows) { drawParts(f.sheet, f.parts, x, y); return; }
    const img = SHEETS[f.sheet]?.();
    if (!img) { const ctx=getCtx(); if(ctx) { ctx.fillStyle="#826244"; ctx.fillRect(x*U,(y+fromRow*PX)*U,2*U,(.875-fromRow*PX)*U); } return; }
    f.rows.order.forEach((src, i) => {
      if (i < fromRow) return;
      subImg(img, f.rows.left, 0, src, 16, 1, x, y + i * PX, 1, PX);
      subImg(img, f.rows.right, 0, src, 16, 1, x + 1, y + i * PX, 1, PX);
    });
  }
  // ---------- drawing ----------
  function subImg(img, coord, sx, sy, sw, sh, dx, dy, dw, dh) {
    const ctx = getCtx();
    if (!ctx || !img || sw <= 0 || sh <= 0) return;
    ctx.drawImage(img, coord[0] * STRIDE + sx, coord[1] * STRIDE + sy, sw, sh, dx * U, dy * U, dw * U, dh * U);
  }
  function sub(coord, sx, sy, sw, sh, dx, dy, dw, dh) { subImg(getRpg(), coord, sx, sy, sw, sh, dx, dy, dw, dh); }
  /** Stretch the mantel from one tile: five-pixel ends and a repeated middle. */
  function slice3(coord, x, y, w, fromRow = 0, img = getRpg()) {
    const h = 16 - fromRow;
    subImg(img, coord, 0, fromRow, 5, h, x, y + fromRow * PX, 5 * PX, h * PX);
    subImg(img, coord, 5, fromRow, 6, h, x + 5 * PX, y + fromRow * PX, w - 10 * PX, h * PX);
    subImg(img, coord, 11, fromRow, 5, h, x + w - 5 * PX, y + fromRow * PX, 5 * PX, h * PX);
  }
  /** Redraw the front arm of a seat over its sitter's legs, so they sit in it rather than on it. */
  function drawSeatFront(front) {
    const f = front && LOUNGE_FURNITURE[front.kind];
    if (f?.rows) drawFurniture(front.kind, front.x, front.y, f.frontRow);
    else if (f?.front) drawParts(f.sheet, f.front, front.x, front.y);
  }

  /** Stone chimney breast: sheet stone tiles clipped to the rect, a capstone ledge and a shaded right edge. */
  function drawChimney(x, y, w, h) {
    const ctx = getCtx();
    for (let ty = 0; ty < h; ty += 1) for (let tx = 0; tx < w; tx += 1) {
      const cw = Math.min(1, w - tx), ch = Math.min(1, h - ty);
      sub((tx + ty) % 2 ? K.stone : K.stoneDark, 0, 0, 16 * cw, 16 * ch, x + tx, y + ty, cw, ch);
    }
    if (!ctx) return;
    ctx.fillStyle = "rgba(20, 18, 26, .28)"; ctx.fillRect((x + w - 3 * PX) * U, y * U, 3 * PX * U, h * U);
    ctx.fillStyle = "#4a4854"; ctx.fillRect((x - PX) * U, y * U, PX * U, h * U); ctx.fillRect((x + w) * U, y * U, PX * U, h * U);
    // Capstone: a slightly wider ledge of the darker stone.
    sub(K.stoneDark, 0, 0, 16, 5, x - 2 * PX, y, w + 4 * PX, 5 * PX);
    ctx.fillStyle = "#3d3b46"; ctx.fillRect((x - 2 * PX) * U, (y + 3 * PX) * U, (w + 4 * PX) * U, PX * U);
  }
  /** Mantel: the sheet's thin wall shelf, stretched, with two candles. */
  function drawMantel(x, y, w, now) {
    slice3(K.mantel, x, y, w);
    tileB(K.candle, x + .45, y + 2.5 * PX, .6); tileB(K.candle, x + w - .45, y + 2.5 * PX, .6);
    glow(x + .45, y - .1, .55, now, x); glow(x + w - .45, y - .1, .55, now, x + 3);
  }
  /** Low back wall (wainscot) behind the nook shelves: the sheet's banded wall panel, squashed. */
  function drawWainscot(x, y, w, h) {
    for (let tx = 0; tx < w; tx += 1) {
      const cw = Math.min(1, w - tx);
      sub(K.wainscot, 0, 0, 16 * cw, 16, x + tx, y, cw, h);
    }
    const ctx = getCtx();
    if (ctx) { ctx.fillStyle = "#6f6145"; ctx.fillRect(x * U, (y + h - PX) * U, w * U, PX * U); }
  }

  function hearthGlow(cx, cy, now, seed) {
    const ctx = getCtx();
    if (!ctx?.createRadialGradient) return;
    const live = !isReduced();
    const f = live ? .1 * Math.sin(now / 71 + seed) * Math.sin(now / 113 + seed * 1.7) + .05 * Math.sin(now / 37) : 0;
    const r = 3.2 * (1 + f * .6);
    const g = ctx.createRadialGradient(cx * U, cy * U, 0, cx * U, cy * U, r * U);
    if (!g?.addColorStop) return;
    g.addColorStop(0, `rgba(255, 170, 70, ${.34 + f})`);
    g.addColorStop(.55, `rgba(255, 140, 50, ${.12 + f * .5})`);
    g.addColorStop(1, "rgba(255, 120, 40, 0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx * U, cy * U, r * U, r * .7 * U, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawHearth(x, y, s, now) {
    tileTL(K.hearthTop, x, y, s);
    const live = !isReduced();
    const frame = live ? Math.floor(now / 170 + 1.4 * Math.sin(now / 530)) & 1 : 0;
    tileTL(K.hearthFire[frame], x, y + s, s);
    // Sparks: two embers rising off the fire, time-derived.
    const ctx = getCtx();
    if (ctx && live) for (let k = 0; k < 2; k += 1) {
      const t = ((now / 1000) * .8 + k * .5) % 1;
      ctx.fillStyle = `rgba(255, ${190 - 80 * t | 0}, 80, ${1 - t})`;
      ctx.fillRect((x + s / 2 + Math.sin(t * 9 + k * 3) * .15) * U, (y + s * 1.45 - t * .7) * U, 2, 2);
    }
  }

  function drawOp(o, ox, oy, now, players) {
    const x = ox + o.x, y = oy + o.y;
    switch (o.op) {
      case "tile": tileTL(o.coord, x, y, o.s ?? 1); break;
      case "furn": {
        // Chairs at a card table nobody sits at are tucked in toward it.
        const tuck = o.table != null && !players.get(o.table)?.size ? o.tuck : null;
        drawFurniture(o.kind, x + (tuck?.[0] ?? 0), y + (tuck?.[1] ?? 0));
        break;
      }
      case "items": o.items.forEach((item, i) => tileB(item, x + (i + .5) * o.w / o.items.length, y + .62, .6)); break;
      case "glow": glow(x, y, o.r, now, x * 1.3 + y); break;
      case "chimney": drawChimney(x, y, o.w, o.h); break;
      case "mantel": drawMantel(x, y, o.w, now); break;
      case "wainscot": drawWainscot(x, y, o.w, o.h); break;
      case "hearth": drawHearth(x, y, o.s, now); hearthGlow(x + o.s / 2, y + o.s * 1.7, now, x); break;
      case "cards": drawCardTable(o, ox, oy, now, players); break;
      default: break;
    }
  }

  /** Flat things under everyone (rugs), drawn with the room floor. */
  function drawLoungeFloor(layout) {
    const g = geometry(layout);
    const ox = layout.lounge.x, oy = layout.lounge.y;
    const { w, h } = layout.lounge;
    {
      // Indoor-pack reddish planks [24,0] / [24,2], alternating rows so the boards do not read as a grid.
      const img = getIndoor();
      if (!img && getCtx()) { getCtx().fillStyle="#4b4656"; getCtx().fillRect(ox*U,oy*U,w*U,h*U); }
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) subImg(img, [24, y % 2 ? 2 : 0], 0, 0, 16, 16, ox + x, oy + y, 1, 1);
      // Desaturate and darken the planks in canvas (still Kenney art) so the orange rug and sofas
      // stand out against them and the hall's lighter wood.
      const ctx = getCtx();
      if (ctx && img) {
        ctx.save();
        ctx.globalCompositeOperation = "saturation"; ctx.fillStyle = "hsl(20, 34%, 50%)"; ctx.fillRect(ox * U, oy * U, w * U, h * U);
        ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "#9c948c"; ctx.fillRect(ox * U, oy * U, w * U, h * U);
        ctx.restore();
      }
    }
    {
      // Threshold: a dark skirting line and a brass strip along the lounge's open top edge, dark sides.
      const ctx = getCtx();
      if (ctx) {
        ctx.fillStyle = "#2e1d12"; ctx.fillRect(ox * U, oy * U, w * U, 3 * PX * U);
        ctx.fillStyle = "#c9a45c"; ctx.fillRect(ox * U, (oy + 1 * PX) * U, w * U, PX * U);
        ctx.fillStyle = "rgba(30, 18, 10, .55)"; ctx.fillRect(ox * U, oy * U, 2 * PX * U, h * U); ctx.fillRect((ox + w - 2 * PX) * U, oy * U, 2 * PX * U, h * U);
      }
    }
    for (const o of g.ops) if (o.flat) nine({ x: ox + o.x, y: oy + o.y, w: o.w, h: o.h }, o.base);
  }

  /** Furniture and props that sort with people by their front edge. */
  function loungeDepthItems(layout, now, leisure) {
    const g = geometry(layout);
    const ox = layout.lounge.x, oy = layout.lounge.y;
    const players = new Map();
    for (const a of leisure.values()) {
      if (a.activity !== "cards" || a.position?.standing || a.position?.table == null) continue;
      if (!players.has(a.position.table)) players.set(a.position.table, new Set());
      players.get(a.position.table).add(a.position.hand);
    }
    return g.ops.filter(o => !o.flat).map(o => ({ y: oy + o.depth, draw: () => drawOp(o, ox, oy, now, players) }));
  }

  // Playing cards: the sheet has none, so they are drawn in its pixel style (1 sheet px = 2 canvas px):
  // 3×4-px white faces with a red or black pip and a dark edge, fanned in each player's hand, a face-up spread in
  // the middle, a navy-backed deck, and two little chip stacks.
  const INK = { edge: "#2b2733", face: "#fbf8ef", back: "#27407a", backLine: "#dfe6f5", red: "#d0302f", black: "#18181d" };
  const CHIPS = ["#c8372f", "#f2f0ea", "#3558b8", "#2f8a4f"];
  function card(x, y, face, pip = 0, { sx = 1, rot = 0 } = {}) {
    const ctx = getCtx();
    if (!ctx) return;
    const p = PX * U, w = 3 * p, h = 4 * p;
    ctx.save();
    ctx.translate(x * U + w / 2, y * U + h);       // pivot at the bottom centre for fanning
    if (rot) ctx.rotate(rot);
    ctx.scale(sx || .001, 1);
    ctx.translate(-w / 2, -h);
    ctx.fillStyle = INK.edge; ctx.fillRect(-p * .5, -p * .5, w + p, h + p);
    ctx.fillStyle = face ? INK.face : INK.back; ctx.fillRect(0, 0, w, h);
    if (face) {
      ctx.fillStyle = pip % 2 ? INK.red : INK.black;
      ctx.fillRect(p, p * 1.5, p, p);                  // centre pip
      ctx.fillRect(0, 0, p * .5, p * .5);              // corner index
    } else { ctx.fillStyle = INK.backLine; ctx.fillRect(p * .5, p * .5, w - p, h - p); ctx.fillStyle = INK.back; ctx.fillRect(p, p, w - 2 * p, h - 2 * p); }
    ctx.restore();
  }
  function chipStack(x, y, n, seed) {
    const ctx = getCtx();
    if (!ctx) return;
    const p = PX * U;
    for (let i = 0; i < n; i += 1) {
      ctx.fillStyle = INK.edge; ctx.fillRect(x * U - p * .5, y * U - (i + 1) * p - p * .5, 3 * p + p, p + p * .5);
      ctx.fillStyle = CHIPS[(i + seed) % CHIPS.length]; ctx.fillRect(x * U, y * U - (i + 1) * p, 3 * p, p);
    }
  }
  // Each hand's anchor (top-left of the middle card) relative to the table centre, and its fan direction.
  const HANDS = { left: [-.78, -.12, 1], right: [.58, -.12, -1], top: [-.1, -.46, 1], bottom: [-.1, .14, -1] };
  const FAN = [-.38, 0, .38];

  function drawCardTable(o, ox, oy, now, players) {
    const cx = ox + o.cx, cy = oy + o.cy;
    const ctx = getCtx();
    drawFurniture("cardTable", cx - 1, cy - .5);
    const seated = players.get(o.index) ?? new Set();
    if (!ctx || !seated.size) return;
    // One small central fan and one chip stack per table, however many play.
    const live = !isReduced() && seated.size >= 2;
    const period = 7, t = live ? ((now / 1000 + o.index * 1.37) % period) : period - .1;
    const round = (isReduced() ? 0 : Math.floor(now / (period * 1000))) + o.index;
    chipStack(cx + .42, cy + .22, 3 + (round % 2), round);
    const flipT = t - 2.6;
    const flipScale = flipT < 0 ? 1 : flipT < .5 ? Math.abs(Math.cos(Math.PI * flipT / .5)) : 1;
    for (let c = 0; c < 3; c += 1) {
      card(cx - .1 + (c - 1) * .07, cy - .12, c !== 1 || (flipT >= .25 && t < period - .4), round * 3 + c, { rot: FAN[c], sx: c === 1 ? flipScale : 1 });
    }
    // A card in flight from the fan to the player it is dealt to.
    const hands = ["left", "right", "top", "bottom"].filter(k => seated.has(k));
    if (live && t < hands.length * .6) {
      const i = Math.floor(t / .6) % hands.length;
      const k = (t % .6) / .45;
      if (k <= 1) {
        const [hx, hy] = HANDS[hands[i]];
        card(cx - .1 + (hx + .1) * k, cy - .12 + (hy + .12) * k - Math.sin(Math.PI * k) * .15, false);
      }
    }
  }

  /** An open book held in front of a seated reader, with a page turning every few seconds. */
  function drawBook(px, py, facing, now, phase) {
    const ctx = getCtx();
    const bx = px + facing * .16, by = py + .18;
    tileB(K.book, bx, by, .55);
    if (!ctx || isReduced()) return;
    const period = 5 + phase * 3, t = ((now / 1000 + phase * 11) % period) / .5;
    if (t > 1) return;
    const spine = bx * U, half = .2 * U, top = (by - .38) * U, h = .2 * U;
    const edge = spine + half * Math.cos(Math.PI * t);
    ctx.fillStyle = "#f7f1e1";
    ctx.fillRect(Math.min(spine, edge), top, Math.abs(edge - spine) || 1, h);
    ctx.fillStyle = "#b8a98c";
    ctx.fillRect(edge - 1, top, 2, h);
  }


  return { drawLoungeFloor, loungeDepthItems, drawSeatFront, drawBook };
}
