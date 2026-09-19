/** Stage landmarks use the existing room bounds, including saved room layouts. */
export function stageGeometry(layout) {
  const { stage, stageFront } = layout;
  const y = stage.y + stage.h - 2;
  return {
    stairs: { x: stage.x - 1, y: y - .7, w: 1.6, h: 1.4 },
    foot: { x: stage.x - .8, y },
    landing: { x: stage.x + .8, y },
    microphone: { x: stageFront.x + .55, y: stageFront.y + .25 },
    speaker: stageFront,
  };
}

/** One place per person, even when that person has several pending messages. */
export function stageQueuePeople(events, current, people) {
  return [...new Set(events.filter((event) => event.kind === "donation"
    && !(current?.event.kind === "donation" && event.person === current.event.person)
    && people.has(event.person)).map((event) => event.person))];
}

export function stageQueuePosition(layout, index, count = index + 1) {
  const { foot } = stageGeometry(layout);
  // Fold long queues along the bottom aisle; never place waiting people on stage.
  const columns = Math.max(1, Math.floor((foot.x - 2) / 1.2));
  const rows = Math.ceil(count / columns);
  const row = Math.floor(index / columns);
  const column = row % 2 ? columns - 1 - index % columns : index % columns;
  return { x: foot.x - column * 1.2, y: foot.y + 1.5 - row * Math.min(.9, 2 / Math.max(1, rows - 1)) };
}

/** Enter and leave through the side stairs, using the ordinary hall route outside. */
export function stagePath(layout, from, to, hallPath) {
  const { foot, landing } = stageGeometry(layout);
  const fromStage = from.x >= layout.stage.x;
  const toStage = to.x >= layout.stage.x;
  if (fromStage && toStage) return [to];
  if (toStage) return [...hallPath(from, foot), landing, to];
  if (fromStage) return [landing, foot, ...hallPath(foot, to)];
  return hallPath(from, to);
}
