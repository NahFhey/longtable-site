import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRoomLayout, infoStaffGeometry, wallFixtures } from "../model.mjs";
import { stageGeometry } from "../stage.mjs";
import { INFO_SPEECHES } from "../event-config.mjs";

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

test("all four welcome speeches have the exact lines and are frozen", () => {
  assert.ok(Object.isFrozen(INFO_SPEECHES));
  for (const lines of Object.values(INFO_SPEECHES)) assert.ok(Object.isFrozen(lines));
  assert.deepEqual(INFO_SPEECHES, {
    before: [
      "Hey, welcome to Longtable! Glad you stopped by.",
      "On November 7 we're playing D&D for 24 hours straight, in person, 10 AM to 10 AM.",
      "See all these tables? Each one is a game we'll play during the event. A DM posted it, and players are grabbing seats.",
      "Come back to this page during the event and you'll see the action live: who's at which table and what's happening in the hall.",
      "We're doing it all for Extra Life. Donations go to Corewell Health Helen DeVos Children's Hospital in Grand Rapids.",
      "That thermometer at the top of the page is our running total. Scan the Donate plaque on the wall to help fill it.",
      "Want a seat at a table? Join our Discord: scan the Discord plaque or use the link up top.",
      "That's all from me. See you on November 7!",
    ],
    during: [
      "Hey, welcome to Longtable! You picked a good time to drop in.",
      "We're in the middle of 24 hours of D&D, live and in person, running until 10 AM on November 8.",
      "Every table in this hall is a game on today's schedule, some playing right now and some starting later. Click one to see what it is.",
      "The hall updates live, so keep the page open or check back through the night to see what's going on.",
      "We're doing it all for Extra Life. Donations go to Corewell Health Helen DeVos Children's Hospital in Grand Rapids.",
      "Watch the thermometer at the top of the page climb. Scan the Donate plaque on the wall to add to it.",
      "Want to come play? Ask about open seats on our Discord: scan the Discord plaque or use the link up top.",
      "That's all from me. Enjoy the show!",
    ],
    after: [
      "Hey, welcome to Longtable!",
      "The marathon is over: 24 hours of D&D, 10 AM November 7 to 10 AM November 8. Thanks to everyone who played.",
      "Every table in this hall is a game we played. Press Play at the top of the page to watch the day back.",
      "It was all for Extra Life, raising money for Corewell Health Helen DeVos Children's Hospital in Grand Rapids.",
      "The thermometer at the top of the page shows where our total stands. The Donate plaque on the wall still works.",
      "Keep an eye on our Discord for the next Longtable. Thanks for stopping by!",
    ],
    record: [
      "Welcome to the Longtable record!",
      "This hall is a saved copy of a past Longtable. Every table here was a game played that day.",
      "Press Play at the top of the page to watch it back. Thanks for stopping by!",
    ],
  });
});
