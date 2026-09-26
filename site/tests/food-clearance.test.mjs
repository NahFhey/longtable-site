import test from "node:test";
import assert from "node:assert/strict";
import { createRoomLayout, jukeboxBounds, wallFixtures } from "../model.mjs";

const gap = (a, b) => Math.hypot(
  Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w),
  Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h),
);

test("food corner clearance holds across table counts and banner widths", t => {
  // There is no application table-count limit: legacy arrays are unrestricted and
  // schema 4 pad_capacity accepts 1..Number.MAX_SAFE_INTEGER. Counts change only
  // the number of rows, never the width or grid origin. Enumerate every column
  // occupancy and the minimum-row / added-row cases; subsequent rows extend away
  // from the corner. The produced banner width has one value, 20.8, even though
  // wallFixtures also accepts arbitrary widths and clamps its result to 8..25.
  const results = [];
  for (let count = 0; count <= 20; count += 1) {
    const tables = Array.from({ length: count }, (_, pad) => ({ pad, seats: 9, signups: [] }));
    for (const room of [null, { version: 1, pad_capacity: Number.MAX_SAFE_INTEGER, overflow_capacity: 0 }]) {
      const layout = createRoomLayout(tables, room);
      assert.equal(layout.width, 42, "table counts add rows, not columns");
      assert.deepEqual(layout.food, { x: 1, y: 1, w: 23, h: 6 });
      const banner = wallFixtures(layout).banner;
      assert.equal(banner.w, 20.8, "shortest and longest banner produced by the room model");
      const grid = { x: layout.gridX, y: layout.gridY,
        w: layout.columns * layout.cellWidth, h: layout.tableRows * layout.cellHeight };
      results.push({ count, schema: room ? "pads" : "legacy", banner: banner.w,
        jukebox: Number(gap(layout.food, jukeboxBounds(layout)).toFixed(6)),
        grid: Number(gap(layout.food, grid).toFixed(6)) });
    }
  }
  t.diagnostic(JSON.stringify(results));
  assert.ok(results.every(row => row.jukebox >= 1 && row.grid >= 1), JSON.stringify(results));
});
