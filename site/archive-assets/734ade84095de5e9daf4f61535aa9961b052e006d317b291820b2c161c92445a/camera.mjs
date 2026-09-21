// World coordinates are tiles; viewport coordinates are CSS pixels, independent of DPR.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const worldToScreen = (camera, point) => ({ x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y });
export const screenToWorld = (camera, point) => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });

export function constrainCamera(camera, viewport, world) {
  const minimum = Math.min(viewport.width / world.width, viewport.height / world.height);
  const zoom = clamp(camera.zoom, minimum, Math.max(96, minimum));
  const axis = (offset, size, extent, origin = 0) => (size * zoom <= extent ? (extent - size * zoom) / 2 : clamp(offset + origin * zoom, extent - size * zoom, 0)) - origin * zoom;
  return { zoom, x: axis(camera.x, world.width, viewport.width, world.x), y: axis(camera.y, world.height, viewport.height, world.y) };
}

export function fitBounds(bounds, viewport, world, padding = 40) {
  const zoom = Math.min(72, Math.max(1, viewport.width - padding * 2) / bounds.width, Math.max(1, viewport.height - padding * 2) / bounds.height);
  return constrainCamera({ zoom, x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom }, viewport, world);
}

export function zoomAt(camera, point, factor, viewport, world) {
  const before = screenToWorld(camera, point);
  const { zoom } = constrainCamera({ ...camera, zoom: camera.zoom * factor }, viewport, world);
  return constrainCamera({ zoom, x: point.x - before.x * zoom, y: point.y - before.y * zoom }, viewport, world);
}

export function panCamera(camera, dx, dy, viewport, world) {
  return constrainCamera({ ...camera, x: camera.x + dx, y: camera.y + dy }, viewport, world);
}

export function relevantTableIndices(tables, slot) {
  const active = tables.flatMap((table, index) => slot >= table.start && slot < table.end ? [index] : []);
  if (active.length) return active;
  const next = Math.min(...tables.filter((table) => table.start > slot).map((table) => table.start));
  return tables.flatMap((table, index) => table.start === next ? [index] : []);
}

export function tableBounds(layout, indices) {
  if (!indices.length) return { x: 0, y: layout.door.y - 3, width: 10, height: 8 };
  const points = indices.flatMap((index) => {
    const cell = layout.cells[index];
    return [cell, { x: cell.x + layout.cellWidth, y: cell.y + layout.cellHeight }];
  });
  // Overflow remains part of the selected table's frame.
  for (const seat of layout.overflowSeats) if (indices.includes(seat.tableIndex)) points.push({ x: seat.x - 1, y: seat.y - 1 }, { x: seat.x + 1, y: seat.y + 1 });
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return { x, y, width: Math.max(...points.map((point) => point.x)) - x, height: Math.max(...points.map((point) => point.y)) - y };
}
