import { createBossRenderer } from "./raid-boss.mjs?v=e2196281dd83";
import { raidBossState, raidClockText, raidLegAnchors, raidRoomLayout, raidWorldFit, raidScreenLayout, RAID_BOSS_RECT } from "./raid-model.mjs?v=e892f82c32b6";
import { raidEffects, raidLunge, raidFoot, raidShake, drawRaidEffects, drawRaidSlash } from "./raid-fx.mjs?v=b099848c922f";
import { createRaidSubBossRenderer } from "./raid-subboss.mjs?v=b188cdc4f229";

const U = 32;
const defaultCanvas = (width, height) => {
  const canvas = globalThis.document?.createElement("canvas");
  if (canvas) { canvas.width = width; canvas.height = height; }
  return canvas;
};
function paintFloor(ctx, image, world, size) {
  if (image) for (let ty = 0; ty < world.h; ty += 1) for (let tx = 0; tx < world.w; tx += 1) {
    ctx.drawImage(image, 24 * 17, (tx + ty) % 2 ? 2 * 17 : 0, 16, 16, tx * size, ty * size, size, size);
  }
  ctx.fillStyle = "rgba(18,29,25,.88)"; ctx.fillRect(0, 0, world.w * size, world.h * size);
}

/** Canvas bindings belong to this scene. The hall camera never enters this renderer. */
export function createRaidRoom({ ctx: getCtx, sheet, indoor, drawPerson, reducedMotion = false, slotMinutes, theta, createCanvas = defaultCanvas }) {
  theta = reducedMotion ? 0 : theta;
  const bossRenderer = createBossRenderer({ reducedMotion, slotMinutes, theta });
  const subBossRenderer = createRaidSubBossRenderer({ createCanvas, reducedMotion });
  // The floor is static: thousands of tile draws per frame held a 4x-throttled phone near 23 fps.
  // Paint it once at native tile size and blit it, repainting only when the sheet or world changes.
  let floorCache = null;
  const floor = (image, world) => {
    if (!image) return null;
    if (floorCache?.image === image && floorCache.w === world.w && floorCache.h === world.h) return floorCache.canvas;
    const canvas = createCanvas(world.w * 16, world.h * 16), floorCtx = canvas?.getContext?.("2d");
    if (!floorCtx) return null;
    floorCtx.imageSmoothingEnabled = false; paintFloor(floorCtx, image, world, 16);
    floorCache = { image, w: world.w, h: world.h, canvas };
    return canvas;
  };
  function draw(state, timeline, slot, nowMs, viewport) {
    const ctx = getCtx(), boss = raidBossState(state, timeline, slot);
    const frame = bossRenderer.prepare(boss, RAID_BOSS_RECT);
    const layout = raidRoomLayout(state, timeline, slot, { slotMinutes, reducedMotion,
      theta: frame.custom ? theta : theta ?? 0, stations: frame.stations });
    if (!ctx) return layout;
    const effects = raidEffects(timeline, slot), shake = raidShake(effects, reducedMotion);
    const collapse = effects.findLast(effect => effect.kind === "collapse");
    const death = effects.findLast(effect => effect.kind === "death");
    const dpr = globalThis.devicePixelRatio || 1;
    const { x, y, scale: zoom } = raidWorldFit(viewport, layout.world);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#121d19"; ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.setTransform(dpr * zoom / U, 0, 0, dpr * zoom / U,
      x * dpr + shake[0] * dpr * zoom / U, y * dpr + shake[1] * dpr * zoom / U);
    ctx.imageSmoothingEnabled = false;
    const floorCanvas = floor(indoor?.() ?? sheet?.(), layout.world);
    if (floorCanvas) ctx.drawImage(floorCanvas, 0, 0, layout.world.w * U, layout.world.h * U);
    else paintFloor(ctx, indoor?.() ?? sheet?.(), layout.world, U);
    ctx.fillStyle = "#1c2925";
    ctx.fillRect(layout.reserve.x * U, layout.reserve.y * U, layout.reserve.w * U, layout.reserve.h * U);
    const partySizes = new Map(), lunging = new Map(), slashes = new Map();
    for (const person of layout.people) partySizes.set(person.table, (partySizes.get(person.table) ?? 0) + 1);
    const drawPass = behind => {
      const items = [
        ...layout.arenas.map(arena => ({ ...arena, kind: "ring" })),
        ...layout.people.map(person => ({ ...person, kind: "person" })),
      ].filter(item => item.behind === behind).sort((a, b) => b.depth - a.depth || (a.kind === b.kind ? (a.y ?? 0) - (b.y ?? 0) : a.kind === "ring" ? -1 : 1));
      for (const item of items) {
        if (item.kind === "person") {
          const station = state.phase === 1 && !reducedMotion && layout.stations?.legs[item.leg];
          const amount = station && !state.legs.find(leg => leg.id === item.leg)?.destroyed ? raidLunge(item.id, nowMs) : 0;
          const count = lunging.get(item.table) ?? 0;
          if (amount > 0 && count < Math.max(1, Math.floor(partySizes.get(item.table) / 3))) {
            const dx = station.foot[0] - item.x, dy = station.foot[1] - item.y, distance = Math.hypot(dx, dy);
            const step = Math.min(.9, distance) * amount;
            if (distance > 0) {
              item.x = Math.round((item.x + dx / distance * step) * U) / U;
              item.y = Math.round((item.y + dy / distance * step) * U) / U;
            }
            lunging.set(item.table, count + 1); slashes.set(item.leg, amount);
          }
          drawPerson(item, nowMs); continue;
        }
        ctx.save(); ctx.globalAlpha = item.destroyed ? .25 : 1;
        ctx.strokeStyle = item.color; ctx.lineWidth = 2; ctx.beginPath();
        ctx.ellipse(item.arena[0] * U, item.arena[1] * U, item.ring[0] * U, item.ring[1] * U, 0, 0, Math.PI * 2);
        ctx.stroke(); ctx.restore();
      }
    };
    drawPass(true);
    const customDrawn = bossRenderer.draw(ctx, boss, layout.boss, nowMs, {
      collapse: !reducedMotion && collapse ? collapse.progress : undefined,
      crownFall: !reducedMotion && death ? Math.min(1, death.progress * death.duration / 1.2) ** 2 : undefined,
    });
    // A draw failure changes the stations too. Clear and redraw the entire fallback frame.
    if (frame.custom && !customDrawn) return draw(state, timeline, slot, nowMs, viewport);
    for (const subBoss of layout.subBosses) subBossRenderer.draw(ctx, subBoss, nowMs);
    drawPass(false);
    const anchors = { ...raidLegAnchors(), ...bossRenderer.anchors?.() };
    ctx.font = "bold 18px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#f1eadb";
    // Leg labels mark Phase 1 stations; later phases have no leg fights to point at.
    for (const leg of state.phase === 1 ? state.legs : []) {
      const p = layout.stations?.legs[leg.id]?.foot ??
        [layout.boss.x + anchors[leg.id][0] * layout.boss.w, layout.boss.y + anchors[leg.id][1] * layout.boss.h];
      ctx.fillText(`${leg.id}${leg.special ? " ★" : ""}`, p[0] * U, p[1] * U);
    }
    for (const [id, amount] of slashes) drawRaidSlash(ctx, raidFoot(layout, anchors, id), amount);
    drawRaidEffects(ctx, effects, layout, anchors, reducedMotion);
    // Screen-space plates keep table names readable as the world fits a phone or projector.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "700 12px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const plate = (label, name) => {
      const px = x + label.x * zoom, py = y + label.y * zoom;
      const width = label.w * zoom, height = label.h * zoom;
      ctx.fillStyle = "#4a3524"; ctx.fillRect(px - width / 2, py - height / 2, width, height);
      ctx.strokeStyle = "#b89b5c"; ctx.lineWidth = 1; ctx.strokeRect(px - width / 2 + .5, py - height / 2 + .5, width - 1, height - 1);
      ctx.fillStyle = "#e9d9ae"; ctx.fillText(name, px, py, width - 6);
    };
    for (const group of layout.groups) plate(group.label, group.name);
    for (const subBoss of layout.subBosses) if (subBoss.defeated) plate(subBoss.label, subBoss.tableName);
    return layout;
  }
  return { draw, dispose: () => bossRenderer.dispose?.() };
}

/** Static nodes per installed snapshot; ticks change only text, attributes and row order. */
export function createRaidOverlay(host, timeline) {
  host.replaceChildren();
  const node = (parent, tag, className, text) => {
    const element = host.ownerDocument.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    parent.append(element); return element;
  };
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const name = id => timeline.tables.find(table => table.id === id)?.name ?? "Organizer";
  const bars = node(host, "div", "raid-legs");
  const legNodes = new Map(timeline.raid.legs.map(leg => {
    const bar = node(bars, "div", "raid-leg"); bar.setAttribute("data-leg", leg.id);
    node(bar, "strong", "", `${leg.id} · ${leg.name}${leg.special ? leg.name === leg.special.name ? " ★" : ` ★ ${leg.special.name}` : ""}`);
    const hp = node(bar, "span", "raid-hp");
    const meter = node(bar, "progress"); meter.setAttribute("aria-label", `${leg.id} HP`);
    const party = node(bar, "span", "raid-holder");
    return [leg.id, { bar, hp, meter, party }];
  }));
  const center = node(host, "div", "raid-center");
  const title = node(center, "h2", "raid-title", `${timeline.raid.name} raid`);
  const result = node(center, "p", "raid-result"); result.setAttribute("role", "status");
  const king = node(center, "div", "raid-king"), kingText = node(king, "strong");
  const kingMeter = node(king, "progress"); kingMeter.setAttribute("aria-label", "King HP");
  const clock = node(center, "div", "raid-timer");
  const clockLabel = node(clock, "span", "raid-timer-label");
  const countdown = node(clock, "strong", "raid-countdown");
  const pushes = node(clock, "span", "raid-pushes");
  const banner = node(center, "p", "raid-banner");
  const checklist = node(host, "section", "raid-checklist");
  node(checklist, "h3", "", "The Hollow");
  const list = node(checklist, "ul");
  const checkNodes = new Map(timeline.raid.checklist.map(item => [item.id, node(list, "li")]));
  const board = node(host, "section", "raid-board"); node(board, "h3", "", "Leaderboard");
  const table = node(board, "table"), head = node(table, "thead"), tr = node(head, "tr");
  for (const label of ["Table", "Legs", "Leg damage", "Rooms", "King damage", "Coins spent"]) node(tr, "th", "", label).setAttribute("scope", "col");
  const body = node(table, "tbody");
  const rowNodes = new Map();
  const participants = new Set(timeline.raid.log.flatMap(entry => entry.kind === "open"
    ? entry.members.map(member => member.table) : entry.kind === "member" && entry.change === "add" ? [entry.table] : []));
  for (const id of participants) {
    const element = node(body, "tr"); element.setAttribute("data-table", id); element.hidden = true;
    const cells = [node(element, "th"), ...Array.from({ length: 5 }, () => node(element, "td"))];
    cells[0].setAttribute("scope", "row"); rowNodes.set(id, { element, cells });
  }
  const setMeter = (meter, hp, max) => { meter.max = max ?? 1; meter.value = hp ?? 0; };
  let screenKey;
  return {
    fitScreen(viewport, { wrap, canvas, controls }) {
      const key = JSON.stringify(viewport);
      if (key === screenKey) return;
      screenKey = key;
      const screen = raidScreenLayout(viewport);
      const elements = { canvas, legs: bars, center, checklist, board, timeline: controls };
      // Variables are scoped to raid selectors; returning to the hall restores its CSS.
      const setBox = (element, box, origin = { x: 0, y: 0 }) => {
        for (const [name, value] of Object.entries({ x: box.x - origin.x, y: box.y - origin.y, w: box.w, h: box.h }))
          element.style.setProperty(`--raid-${name}`, `${value}px`);
      };
      if (screen) {
        setBox(wrap, screen.frame);
        for (const [name, element] of Object.entries(elements)) if (screen[name]) setBox(element, screen[name], screen.frame);
      }
    },
    update(state) {
      text(title, `${timeline.raid.name} raid · ${state.phase ? `Phase ${state.phase}` : "Upcoming"}`);
      result.hidden = state.status !== "ended";
      text(result, state.result === "won" ? "Victory" : "The raid is over");
      for (const leg of state.legs) {
        const { bar, hp, meter, party } = legNodes.get(leg.id);
        text(hp, `${leg.hp ?? "—"}/${leg.max ?? "—"} HP${leg.destroyed ? " · Broken" : ""}`);
        bar.setAttribute("data-broken", String(leg.destroyed)); setMeter(meter, leg.hp, leg.max);
        text(party, leg.table ? name(leg.table) : "Unassigned");
      }
      king.hidden = state.phase < 3 || !state.king;
      if (state.king) { text(kingText, `Spider King · ${state.king.hp}/${state.king.max} HP`); setMeter(kingMeter, state.king.hp, state.king.max); }
      clock.hidden = !state.timer;
      if (state.timer) {
        text(clockLabel, state.timer.kind === "lair" ? "Lair strike in" : "Core pulse in");
        text(countdown, `${raidClockText(state.timer.seconds)}${state.timer.paused ? " · Paused" : ""}`);
        text(pushes, `Pushes left this cycle: ${state.timer.pushesLeftSeconds / 60} min`);
      }
      checklist.hidden = state.phase < 2;
      for (const item of state.checklist) {
        const itemNode = checkNodes.get(item.id);
        text(itemNode, `${item.done ? "✓" : "○"} ${item.name}${item.done ? ` · ${name(item.table)}` : ""}`);
        itemNode.setAttribute("data-done", String(item.done));
      }
      text(banner, state.lastAction?.text ?? "Waiting for the raid to begin");
      const present = new Set(state.leaderboard.map(row => row.table));
      for (const [id, nodes] of rowNodes) nodes.element.hidden = !present.has(id);
      for (const row of state.leaderboard) {
        const nodes = rowNodes.get(row.table);
        nodes.cells[0].setAttribute("title", row.name);
        [row.name, row.legs, row.legDamage, row.rooms, row.kingDamage, row.coinsSpent].forEach((value, i) => text(nodes.cells[i], String(value)));
      }
      const desired = state.leaderboard.map(row => rowNodes.get(row.table).element);
      if (desired.some((row, i) => body.children[i] !== row)) for (const row of desired) body.append(row);
    },
  };
}
