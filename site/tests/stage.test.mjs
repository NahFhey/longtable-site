import test from "node:test";
import assert from "node:assert/strict";
import { createRoomLayout } from "../model.mjs";
import { stageGeometry, stagePath, stageQueuePeople, stageQueuePosition } from "../stage.mjs";

test("stage routes cross the stairs in both directions", () => {
  const layout = createRoomLayout([]);
  const { foot, landing, speaker, microphone } = stageGeometry(layout);
  const start = { x: 5, y: 10 };
  const hallPath = (_from, to) => [to];
  assert.deepEqual(stagePath(layout, start, speaker, hallPath), [foot, landing, speaker]);
  assert.deepEqual(stagePath(layout, speaker, start, hallPath), [landing, foot, start]);
  assert.ok(microphone.x > speaker.x && microphone.x < layout.stage.x + layout.stage.w);
});

test("waiting speakers keep event order without duplicating characters", () => {
  const events = [
    { kind: "donation", person: "a" }, { kind: "shout", person: "d" },
    { kind: "donation", person: "b" }, { kind: "donation", person: "b" },
    { kind: "donation", person: "removed" }, { kind: "donation", person: "c" },
  ];
  const people = new Map(["a", "b", "c", "d"].map((id) => [id, {}]));
  assert.deepEqual(stageQueuePeople(events, { event: events[0] }, people), ["b", "c"]);
  assert.deepEqual(stageQueuePeople(events, null, people), ["a", "b", "c"]);
});

test("long queues fold within the room and remain below the table grid", () => {
  const layout = createRoomLayout([]);
  const positions = Array.from({ length: 100 }, (_, index) => stageQueuePosition(layout, index, 100));
  assert.equal(new Set(positions.map(({ x, y }) => `${x},${y}`)).size, 100);
  for (const position of positions) {
    assert.ok(position.x > 1 && position.x < layout.stage.x);
    assert.ok(position.y > layout.tableGridBottom && position.y < layout.height - 1);
  }
});
