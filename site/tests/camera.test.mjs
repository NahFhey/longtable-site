import test from "node:test";
import assert from "node:assert/strict";
import { atMinZoom, constrainCamera, fitBounds, minZoom, panCamera, relevantTableIndices, screenToWorld, tableBounds, WHEEL_REST_MS, wheelIntent, worldToScreen, zoomAt } from "../camera.mjs";
import { createSeatingPlan } from "../model.mjs";
const world = { width: 72, height: 30 };
const viewport = { width: 960, height: 480 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("camera transforms invert independently of display density and preserve the pointer during zoom", () => {
  const camera = { zoom: 32, x: -200, y: -180 };
  const point = { x: 12.75, y: 10.5 };
  assert.deepEqual(screenToWorld(camera, worldToScreen(camera, point)), point);
  const pointer = { x: 470, y: 210 };
  const before = screenToWorld(camera, pointer);
  const after = screenToWorld(zoomAt(camera, pointer, 1.5, viewport, world), pointer);
  near(before.x, after.x); near(before.y, after.y);
});

test("bounds prevent losing the hall during extreme zoom and pan", () => {
  const tiny = constrainCamera({ zoom: .001, x: 999999, y: -999999 }, viewport, world);
  near(tiny.zoom, 960 / 72);
  assert.ok(tiny.x >= 0 && tiny.y >= 0);
  const zoomed = zoomAt(tiny, { x: 480, y: 240 }, 1e6, viewport, world);
  assert.equal(zoomed.zoom, 96);
  const moved = panCamera(zoomed, -1e6, 1e6, viewport, world);
  assert.equal(moved.x, viewport.width - world.width * 96);
  assert.equal(moved.y, 0);
});

test("one and two tables fit with readable scale, while a large room stays reachable", () => {
  const one = fitBounds({ x: 4, y: 8, width: 6, height: 6 }, viewport, world);
  const two = fitBounds({ x: 4, y: 8, width: 12, height: 6 }, viewport, world);
  assert.ok(one.zoom >= 60 && two.zoom >= 60);
  const room = fitBounds({ x: 0, y: 0, ...world }, viewport, world, 0);
  near(room.zoom, 960 / 72);
  for (const size of [{ width: 320, height: 320 }, viewport]) {
    const camera = fitBounds({ x: 4, y: 8, width: 12, height: 6 }, size, world);
    const start = worldToScreen(camera, { x: 4, y: 8 });
    const end = worldToScreen(camera, { x: 16, y: 14 });
    assert.ok(start.x >= 0 && start.y >= 0 && end.x <= size.width && end.y <= size.height);
  }
});

test("relevant frames follow half-open windows and next games without inventing attendance", () => {
  const tables = [{ start: 2, end: 4 }, { start: 2, end: 5 }, { start: 6, end: 8 }];
  assert.deepEqual(relevantTableIndices(tables, 0), [0, 1]);
  assert.deepEqual(relevantTableIndices(tables, 4), [1]);
  assert.deepEqual(relevantTableIndices(tables, 5), [2]);
  assert.deepEqual(relevantTableIndices(tables, 8), []);
  assert.deepEqual(relevantTableIndices([], 0), []);
});

test("framing includes large-roster overflow and uses the doorway for an empty hall", () => {
  const layout = { ...createSeatingPlan([{ signups: Array(22).fill({}) }]), door: { y: 9 } };
  const bounds = tableBounds(layout, [0]);
  for (const seat of layout.overflowSeats) {
    assert.ok(seat.x >= bounds.x && seat.x <= bounds.x + bounds.width);
    assert.ok(seat.y >= bounds.y && seat.y <= bounds.y + bounds.height);
  }
  assert.deepEqual(tableBounds(layout, []), { x: 0, y: 6, width: 10, height: 8 });
});

test('the taller back wall remains reachable without moving floor coordinates', () => {
  const bounds = { x: 0, y: -6, width: 72, height: 36 };
  const camera = fitBounds(bounds, viewport, bounds, 0);
  const top = worldToScreen(camera, { x: 0, y: -6 });
  assert.ok(top.y >= 0);
  const bottom = worldToScreen(camera, { x: 72, y: 30 });
  assert.ok(bottom.y <= viewport.height);
  const zoomed = constrainCamera({ zoom: 96, x: 0, y: 99999 }, viewport, bounds);
  near(worldToScreen(zoomed, { x: 0, y: -6 }).y, 0);
});

test("minimum zoom is detected after zooming all the way out, and not a step before", () => {
  near(minZoom(viewport, world), 960 / 72);
  let camera = { zoom: 32, x: -200, y: -180 };
  for (let i = 0; i < 20; i += 1) camera = zoomAt(camera, { x: 300, y: 200 }, .8, viewport, world);
  assert.equal(atMinZoom(camera, viewport, world), true);
  assert.equal(atMinZoom({ ...camera, zoom: camera.zoom * (1 + 1e-9) }, viewport, world), true);
  assert.equal(atMinZoom(zoomAt(camera, { x: 300, y: 200 }, 1.01, viewport, world), viewport, world), false);
  assert.equal(atMinZoom(fitBounds({ x: 30, y: 10, width: 4, height: 3 }, viewport, world), viewport, world), false);
});

test("the wheel hands off to the page only at minimum zoom", () => {
  // Wheel down at the minimum scrolls the page; above it, the wheel zooms even if the next step would reach the minimum.
  assert.equal(wheelIntent({ deltaY: 100, atMinimum: true, scrollY: 0 }), "scroll");
  assert.equal(wheelIntent({ deltaY: 100, atMinimum: false, scrollY: 0 }), "zoom");
  assert.equal(wheelIntent({ deltaY: 100, atMinimum: false, scrollY: 400 }), "zoom");
  // Wheel up at the minimum scrolls back to the top first, then zooms in.
  assert.equal(wheelIntent({ deltaY: -100, atMinimum: true, scrollY: 400 }), "scroll");
  assert.equal(wheelIntent({ deltaY: -100, atMinimum: true, scrollY: 0 }), "zoom");
  assert.equal(wheelIntent({ deltaY: -100, atMinimum: false, scrollY: 400 }), "zoom");
  // A burst keeps its intent: backing out to the minimum does not scroll the page until the wheel rests.
  assert.equal(wheelIntent({ deltaY: 100, atMinimum: true, previous: "zoom", sincePrevious: 80 }), "zoom");
  assert.equal(wheelIntent({ deltaY: 100, atMinimum: true, previous: "zoom", sincePrevious: WHEEL_REST_MS - 1 }), "zoom");
  assert.equal(wheelIntent({ deltaY: 100, atMinimum: true, previous: "zoom", sincePrevious: WHEEL_REST_MS }), "scroll");
  // Scrolling back to the top does not start a zoom in the same burst either.
  assert.equal(wheelIntent({ deltaY: -100, atMinimum: true, scrollY: 0, previous: "scroll", sincePrevious: 80 }), "scroll");
  assert.equal(wheelIntent({ deltaY: -100, atMinimum: true, scrollY: 0, previous: "scroll", sincePrevious: WHEEL_REST_MS }), "zoom");
  // Pinch arrives as ctrl+wheel and always zooms.
  assert.equal(wheelIntent({ deltaY: 100, ctrlKey: true, atMinimum: true, scrollY: 0 }), "zoom");
  assert.equal(wheelIntent({ deltaY: -100, ctrlKey: true, atMinimum: true, scrollY: 400 }), "zoom");
  assert.equal(wheelIntent({ deltaY: 100, ctrlKey: true, atMinimum: true, previous: "scroll", sincePrevious: 10 }), "zoom");
});
