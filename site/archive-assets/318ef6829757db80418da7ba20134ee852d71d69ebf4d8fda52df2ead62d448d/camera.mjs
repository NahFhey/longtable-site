// World coordinates are tiles; viewport coordinates are CSS pixels, independent of DPR.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const VIEW_PROFILES = Object.freeze({
  desktop: Object.freeze({ overviewCrop: .2, memory: true, frame: "relevant" }),
  kiosk: Object.freeze({ overviewCrop: 0, memory: false, frame: "overview" }),
  mobile: Object.freeze({ overviewCrop: 0, memory: false, frame: "table" }),
});
export const viewMode = ({ kiosk, phone }) => kiosk ? "kiosk" : phone ? "mobile" : "desktop";
export const worldToScreen = (camera, point) => ({ x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y });
export const screenToWorld = (camera, point) => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });

// The right drawer reduces camera space without changing canvas or pointer coordinates.
export const insetViewport = (viewport, inset) => ({ width: Math.max(1, viewport.width - inset), height: viewport.height });

export const minZoom = (viewport, world) => Math.min(viewport.width / world.width, viewport.height / world.height);
export const atMinZoom = (camera, viewport, world, epsilon = 1e-6) => camera.zoom <= minZoom(viewport, world) * (1 + epsilon);

// A plain wheel at minimum zoom hands off to the page: down scrolls it, and up scrolls it back to the top before zooming in.
// A burst of wheel events keeps the intent it started with until the wheel rests for WHEEL_REST_MS, so backing out
// to the minimum never scrolls the page in the same burst, and scrolling back to the top never starts a zoom. Pinch (ctrl) always zooms.
export const WHEEL_REST_MS = 700;
export function wheelIntent({ deltaY, ctrlKey = false, atMinimum, scrollY = 0, previous = null, sincePrevious = Infinity }) {
  if (ctrlKey) return "zoom";
  if (previous && sincePrevious < WHEEL_REST_MS) return previous;
  if (!atMinimum) return "zoom";
  return deltaY > 0 || (deltaY < 0 && scrollY > 0) ? "scroll" : "zoom";
}

export function constrainCamera(camera, viewport, world) {
  const minimum = minZoom(viewport, world);
  const zoom = clamp(camera.zoom, minimum, Math.max(96, minimum));
  const axis = (offset, size, extent, origin = 0) => (size * zoom <= extent ? (extent - size * zoom) / 2 : clamp(offset + origin * zoom, extent - size * zoom, 0)) - origin * zoom;
  return { zoom, x: axis(camera.x, world.width, viewport.width, world.x), y: axis(camera.y, world.height, viewport.height, world.y) };
}

export function fitBounds(bounds, viewport, world, padding = 40) {
  const zoom = Math.min(72, Math.max(1, viewport.width - padding * 2) / bounds.width, Math.max(1, viewport.height - padding * 2) / bounds.height);
  return constrainCamera({ zoom, x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom }, viewport, world);
}

export function overviewFrame(viewport, world, crop) {
  const horizontal = viewport.width / world.width;
  const vertical = viewport.height / world.height;
  const contain = minZoom(viewport, world);
  const zoom = Math.max(contain, Math.min(Math.max(horizontal, vertical), contain / (1 - crop)));
  return constrainCamera({ zoom,
    x: viewport.width / 2 - ((world.x ?? 0) + world.width / 2) * zoom,
    y: horizontal > vertical ? -(world.y ?? 0) * zoom
      : viewport.height / 2 - ((world.y ?? 0) + world.height / 2) * zoom,
  }, viewport, world);
}

export function encodeCameraMemory(camera, viewport, scope, now) {
  const center = screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
  return JSON.stringify({ v: 1, scope, zoom: camera.zoom, cx: center.x, cy: center.y, savedAt: now });
}

export function decodeCameraMemory(raw, scope, now, viewport, world) {
  try {
    const entry = JSON.parse(raw);
    if (!entry || entry.v !== 1 || entry.scope !== scope ||
        ![entry.zoom, entry.cx, entry.cy, entry.savedAt].every(Number.isFinite) || entry.zoom <= 0 ||
        now - entry.savedAt < 0 || now - entry.savedAt >= 12 * 60 * 60 * 1000) return null;
    return constrainCamera({ zoom: entry.zoom, x: viewport.width / 2 - entry.cx * entry.zoom,
      y: viewport.height / 2 - entry.cy * entry.zoom }, viewport, world);
  } catch { return null; }
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

export function mobileTarget(tables, slot, selectedIndex) {
  if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < tables.length) return selectedIndex;
  // After the last game, keep a table in view even when none is relevant anymore.
  return relevantTableIndices(tables, slot)[0] ?? (tables.length ? 0 : -1);
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
