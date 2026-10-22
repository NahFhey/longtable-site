import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateTimeline } from "../model.mjs";
import * as raid from "../raid-model.mjs";

const timeline = validateTimeline(JSON.parse(await readFile(new URL("../data/timeline.raid.sample.json", import.meta.url), "utf8")));
const screens = [
  { width: 1440, height: 900, minimum: 900 },
  { width: 1280, height: 720, minimum: 700 },
  { width: 1920, height: 1080, kiosk: true, minimum: 1150 },
];
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const plateBox = p => ({ x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h });
const ringBox = a => ({ x: a.arena[0] - a.ring[0], y: a.arena[1] - a.ring[1], w: 2 * a.ring[0], h: 2 * a.ring[1] });
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

test("desktop screen fit draws the minimum room widths without blank canvas bands", () => {
  assert.equal(typeof raid.raidScreenLayout, "function");
  for (const view of screens) for (const fundStrip of [0, 41.25]) for (const t of [40.5, 43.45]) {
    const layout = raid.raidRoomLayout(raid.raidStateAt(timeline, t), timeline, t, { theta: 0 });
    const screen = raid.raidScreenLayout({ ...view, fundStrip });
    const drawn = raid.raidWorldFit({ width: screen.canvas.w, height: screen.canvas.h }, layout.world);
    assert.ok(drawn.w >= view.minimum, `${view.width}: ${drawn.w}`);
    assert.ok(drawn.x <= 24 && drawn.y <= 24);
    assert.ok(inside(screen.canvas, { x: 0, y: 0, w: view.width, h: view.height }));
    for (const key of ["legs", "checklist", "board", "center"]) assert.ok(inside(screen[key], screen.frame), key);
    // CSS: four 44px leg rows + 3*4 gap + 18 padding/border; nine 20px
    // checklist lines + 26 heading + 18 padding/border; ten 24px board
    // rows + 40 header + 26 heading + 18 padding/border (44 header on kiosk).
    assert.ok(screen.legs.h >= (view.kiosk ? 236 : 206));
    if (view.height >= 900) {
      assert.ok(screen.checklist.h >= 224);
      assert.ok(screen.board.h >= (view.kiosk ? 328 : 324));
    }
  }
  assert.equal(raid.raidScreenLayout({ width: 390, height: 844 }), null);
});

test("front-view rings and plates are pairwise disjoint and every plate fits the world", () => {
  const layout = raid.raidRoomLayout(raid.raidStateAt(timeline, 40.5), timeline, 40.5, { theta: 0 });
  const rings = layout.arenas.map(ringBox);
  // Disjoint bounding boxes are stronger than disjoint ellipses. Include the
  // plates of empty legs as well as the two reserve parties' actual plates.
  const plates = [...layout.groups.map(g => g.label), ...layout.arenas
    .filter(a => a.label && !layout.groups.some(g => g.leg === a.id)).map(a => a.label)].map(plateBox);
  for (let i = 0; i < rings.length; i++) for (const other of rings.slice(i + 1)) assert.equal(overlaps(rings[i], other), false);
  for (let i = 0; i < plates.length; i++) {
    assert.ok(inside(plates[i], layout.world));
    for (const ring of rings) assert.equal(overlaps(plates[i], ring), false, `plate ${i} against ring`);
    for (const other of plates.slice(i + 1)) assert.equal(overlaps(plates[i], other), false, `plate ${i} against plate`);
  }
});

test("desktop header and replay overlays avoid the boss, parties, rings and plates in every phase", () => {
  assert.equal(typeof raid.raidScreenLayout, "function");
  for (const view of screens) for (const fundStrip of [0, 41.25]) for (const t of [40.5, 42, 43.45]) for (let theta = 0; theta < 360; theta += 5) {
    const layout = raid.raidRoomLayout(raid.raidStateAt(timeline, t), timeline, t, { theta });
    const screen = raid.raidScreenLayout({ ...view, fundStrip });
    const scale = screen.canvas.w / layout.world.w;
    const protect = [layout.boss, ...layout.arenas.map(ringBox), ...layout.groups.map(g => plateBox(g.label)),
      // Full sprite, DM hat and idle movement allowance, not merely its centre.
      ...layout.people.map(p => ({ x: p.x - .7, y: p.y - 1, w: 1.4, h: 1.7 }))];
    for (const box of protect) {
      const pixels = { x: screen.canvas.x + box.x * scale, y: screen.canvas.y + box.y * scale, w: box.w * scale, h: box.h * scale };
      for (const key of ["center", "timeline", "legs", "checklist", "board"]) if (screen[key])
        assert.equal(overlaps(pixels, screen[key]), false, `${view.width} t=${t} theta=${theta}: ${key}`);
    }
  }
});
