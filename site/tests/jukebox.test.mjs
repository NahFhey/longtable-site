import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRoomLayout, foodGeometry, jukeboxBounds, jukeboxSignBounds, wallFixtures } from "../model.mjs";
import { stageGeometry } from "../stage.mjs";

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

async function sampleLayouts() {
  const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
  const bare = (count) => Array.from({ length: count }, () => ({ signups: [] }));
  return [
    ["sample room", createRoomLayout(sample.tables, sample.room_layout)],
    ["two legacy tables", createRoomLayout(bare(2))],
    ["thirty legacy tables", createRoomLayout(bare(30))],
  ];
}

test("the jukebox stands inside the room against the back wall with its sign directly above", async () => {
  for (const [name, layout] of await sampleLayouts()) {
    const box = jukeboxBounds(layout);
    const sign = jukeboxSignBounds(layout);
    assert.ok(box.x >= 1 && box.x + box.w <= layout.width - 1, `${name}: inside the side walls`);
    assert.ok(box.y < 0 && box.y > layout.backWall.y, `${name}: the top overlaps the wall's lower rows`);
    assert.ok(box.y + box.h > 0 && box.y + box.h <= layout.gridY, `${name}: the feet stand on the floor above the table grid`);
    assert.ok(Math.abs(box.w - 2) < 1e-9 && Math.abs(box.h - 3) < 1e-9, `${name}: about 2 by 3 tiles`);
    assert.ok(sign.y >= layout.backWall.y && sign.y + sign.h <= box.y, `${name}: the sign hangs on the wall above`);
    assert.ok(sign.x <= box.x && sign.x + sign.w >= box.x + box.w, `${name}: the sign spans the jukebox`);
    assert.ok(Math.abs(sign.w - 4) < 1e-9 && Math.abs(sign.h - 1) < 1e-9, `${name}: about 4 by 1 tiles`);
  }
});

test("neither the jukebox nor its sign overlaps a table, the lounge, stage, food, trash, door, switch or wall fixture", async () => {
  for (const [name, layout] of await sampleLayouts()) {
    const box = jukeboxBounds(layout);
    const sign = jukeboxSignBounds(layout);
    const fixtures = wallFixtures(layout);
    const food = foodGeometry(layout);
    const stage = stageGeometry(layout);
    const rects = {
      banner: fixtures.banner, lounge: layout.lounge, stage: layout.stage, food: layout.food, stairs: stage.stairs,
      trash: { x: food.bin.x - .5, y: food.bin.y - 1.2, w: 1, h: 1.6 },
      door: { x: layout.door.x, y: layout.door.y - 1, w: 2.5, h: 2.5 },
      "light switch": { x: .3, y: layout.door.y - 1.8, w: 2, h: 2 },
    };
    fixtures.plaques.forEach((rect, index) => { rects[`plaque ${index}`] = rect; });
    layout.cells.forEach((cell, index) => { rects[`table ${index}`] = { ...cell, w: layout.cellWidth, h: layout.cellHeight }; });
    layout.overflowSeats.forEach((seat, index) => { rects[`overflow seat ${index}`] = { x: seat.x - .5, y: seat.y - .5, w: 1, h: 1 }; });
    for (const [label, rect] of Object.entries(rects)) {
      assert.ok(!overlaps(box, rect), `${name}: the jukebox overlaps the ${label}`);
      assert.ok(!overlaps(sign, rect), `${name}: the sign overlaps the ${label}`);
    }
    assert.ok(box.x >= fixtures.banner.x + fixtures.banner.w + 2, `${name}: two clear tiles right of the banner`);
    assert.ok(box.x + box.w + 2 <= fixtures.plaques[0].x, `${name}: well left of the plaques`);
  }
});
