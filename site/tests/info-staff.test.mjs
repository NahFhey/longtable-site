import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRoomLayout, infoStaffGeometry, wallFixtures } from "../model.mjs";
import { stageGeometry } from "../stage.mjs";
import { INFO_SPEECH } from "../event-config.mjs";

const sample = JSON.parse(await readFile(new URL("../data/timeline.sample.json", import.meta.url), "utf8"));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
for (const [name, layout] of [
  ["sample", createRoomLayout(sample.tables, sample.room_layout)],
  ["small", createRoomLayout(sample.tables.slice(0, 1))],
  ["large", createRoomLayout(Array.from({ length: 60 }, (_, i) => ({ ...sample.tables[i % 12], id: `table-${i}`, pad: i })))],
]) {
  test(`info post clears plaques and decorations at the first quarter step: ${name}`, () => {
    const { post, label, hit, speakSpot } = infoStaffGeometry(layout);
    const { stage } = layout;
    assert.equal(post.x, stage.x + stage.w / 2);
    assert.ok(post.y >= stage.y && post.y <= stage.y + stage.h / 2);
    assert.ok(post.y <= layout.stageFront.y - 3);
    assert.equal((post.y - stage.y - .5) % .25, 0);
    assert.equal(label.w, 4.4);
    assert.equal(label.h, .9);
    assert.ok(Math.abs(label.y + label.h - (post.y - 1.5)) < 1e-9);
    const margin = { x: label.x - .2, y: label.y - .2, w: label.w + .4, h: label.h + .4 };
    const clearsWall = rect => rect.y >= layout.backWall.y + layout.backWall.h && !wallFixtures(layout).plaques.some(p => overlaps(rect, p));
    assert.ok(clearsWall(margin));
    assert.ok(!clearsWall({ ...margin, y: margin.y - .25 }), "the next step north fails");
    const figure = { x: post.x - .5, y: post.y - 1.5, w: 1, h: 1.5 };
    assert.ok(figure.x > stage.x + 5 / 16, "clear of lip and footlights at every y");
    assert.ok(figure.x + figure.w < stage.x + stage.w - .85 - 2 / 16, "clear of drape and ties");
    assert.ok(!overlaps(figure, stageGeometry(layout).stairs));
    assert.deepEqual(hit, { x: label.x, y: label.y, w: label.w, h: post.y + .4 - label.y }, "the sign and the whole sprite");
    assert.deepEqual(speakSpot, layout.stageFront);
  });
}

test("info geometry reports a blocked post when the north stage is too short", () => {
  const layout = createRoomLayout([]);
  assert.equal(infoStaffGeometry({ ...layout, stageFront: { ...layout.stageFront, y: 5 } }), null);
});

test("the frozen welcome has the seven exact event, charity and Discord lines", () => {
  assert.ok(Object.isFrozen(INFO_SPEECH));
  assert.deepEqual(INFO_SPEECH, [
    "Welcome to Longtable!",
    "Longtable is a 24-hour, in-person D&D marathon: 10 AM November 7 to 10 AM November 8.",
    "DMs post tables, players claim seats, and this hall shows every table live all night.",
    "We play for Extra Life, which raises money for kids' hospitals through Children's Miracle Network.",
    "If you choose to donate, the money goes to Corewell Health Helen DeVos Children's Hospital in Grand Rapids. The Donate plaque's QR code takes you there.",
    "To play, sign up on our Discord: scan the Discord plaque or use the link at the top of the page.",
    "Hope to see you at the table on November 7!",
  ]);
});
