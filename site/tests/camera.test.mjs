import test from "node:test";
import assert from "node:assert/strict";
import { VIEW_PROFILES, viewMode, overviewFrame, mobileTarget, encodeCameraMemory, decodeCameraMemory, atMinZoom, constrainCamera, fitBounds, minZoom, panCamera, relevantTableIndices, screenToWorld, tableBounds, WHEEL_REST_MS, wheelIntent, worldToScreen, zoomAt } from "../camera.mjs";
import { createSeatingPlan } from "../model.mjs";
const world = { width: 72, height: 30 };
const viewport = { width: 960, height: 480 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("drawer inset clamps the available viewport width", async () => {
  const { insetViewport } = await import("../camera.mjs");
  assert.equal(typeof insetViewport, "function", "camera exports insetViewport");
  assert.deepEqual(insetViewport(viewport, 320), { width: 640, height: 480 });
  assert.deepEqual(insetViewport(viewport, 960), { width: 1, height: 480 });
  assert.deepEqual(insetViewport(viewport, 2000), { width: 1, height: 480 });
  assert.deepEqual(insetViewport(viewport, 0), viewport);
});

test("drawer inset centres an under-filled hall in the uncovered width", async () => {
  const { insetViewport } = await import("../camera.mjs");
  assert.equal(typeof insetViewport, "function", "camera exports insetViewport");
  const hall = { x: 0, y: -6, width: 42, height: 46 };
  const camera = { zoom: 12, x: 0, y: 72 };
  const full = constrainCamera(camera, viewport, hall);
  const inset = constrainCamera(camera, insetViewport(viewport, 320), hall);
  near(inset.x, full.x - 160);
  near(worldToScreen(inset, { x: 21, y: 0 }).x, 320);
  near(inset.zoom, full.zoom);
});

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

test("viewMode gives kiosk precedence and profiles are frozen", () => {
  assert.equal(viewMode({ kiosk: true, phone: true }), "kiosk");
  assert.equal(viewMode({ kiosk: false, phone: true }), "mobile");
  assert.equal(viewMode({ kiosk: false, phone: false }), "desktop");
  assert.ok(Object.isFrozen(VIEW_PROFILES));
  assert.deepEqual(VIEW_PROFILES.desktop, { overviewCrop: .2, memory: true, frame: "relevant" });
  assert.deepEqual(VIEW_PROFILES.kiosk, { overviewCrop: 0, memory: false, frame: "overview" });
  assert.deepEqual(VIEW_PROFILES.mobile, { overviewCrop: 0, memory: false, frame: "table" });
  for (const profile of Object.values(VIEW_PROFILES)) assert.ok(Object.isFrozen(profile));
});

test("overviewFrame crops twenty percent vertically and anchors the world top", () => {
  const hall = { x: 0, y: -6, width: 42, height: 46 };
  const camera = overviewFrame(viewport, hall, .2);
  near(camera.zoom, 480 / (.8 * 46));
  near(worldToScreen(camera, { x: 0, y: -6 }).y, 0);
  near(camera.x, (960 - 42 * camera.zoom) / 2);
});

test("overviewFrame never exceeds cover on a nearly matching aspect", () => {
  const hall = { x: 0, y: -6, width: 42, height: 46 };
  const camera = overviewFrame({ width: 430, height: 460 }, hall, .2);
  near(camera.zoom, 430 / 42);
});

test("overviewFrame crop zero equals contain and leaves minZoom unchanged", () => {
  const hall = { x: 0, y: -6, width: 42, height: 46 };
  for (const size of [viewport, { width: 375, height: 812 }]) {
    assert.deepEqual(overviewFrame(size, hall, 0), fitBounds(hall, size, hall, 0));
    near(minZoom(size, hall), Math.min(size.width / 42, size.height / 46));
  }
});

test("overviewFrame centers horizontal overflow in portrait", () => {
  const hall = { x: 3, y: -6, width: 42, height: 46 };
  const size = { width: 375, height: 812 };
  const camera = overviewFrame(size, hall, .2);
  near(camera.zoom, 375 / (.8 * 42));
  near(worldToScreen(camera, { x: 24, y: 17 }).x, size.width / 2);
  near(worldToScreen(camera, { x: 24, y: 17 }).y, size.height / 2);
});

test("mobileTarget prefers selection then lowest relevant index then the door", () => {
  const tables = [{ start: 4, end: 6 }, { start: 2, end: 4 }, { start: 2, end: 3 }];
  assert.equal(mobileTarget(tables, 0, 2), 2);
  assert.equal(mobileTarget(tables, 0, -1), 1);
  assert.equal(mobileTarget(tables, 3, -1), 1);
  assert.equal(mobileTarget(tables, 4, -1), 0);
  assert.equal(mobileTarget(tables, 8, -1), 0);
  assert.equal(mobileTarget([], 0, 0), -1);
});

test("decodeCameraMemory validates scope age version and finite numbers", () => {
  const entry = { v: 1, scope: "live:event", zoom: 24, cx: 30, cy: 15, savedAt: 1000 };
  const decode = (value, now = 2000) => decodeCameraMemory(JSON.stringify(value), "live:event", now, viewport, world);
  assert.deepEqual(decode(entry), { zoom: 24, x: -240, y: -120 });
  assert.equal(decode({ ...entry, scope: "archive:event" }), null);
  assert.equal(decode(entry, 1000 + 12 * 60 * 60 * 1000), null);
  assert.equal(decode(entry, 999), null);
  assert.equal(decodeCameraMemory("not JSON", entry.scope, 2000, viewport, world), null);
  assert.equal(decode({ ...entry, v: 2 }), null);
  for (const field of ["zoom", "cx", "cy", "savedAt"]) {
    for (const value of [Infinity, NaN, null, "24"]) assert.equal(decode({ ...entry, [field]: value }), null);
  }
  assert.equal(decode({ ...entry, zoom: 0 }), null);
  assert.equal(decodeCameraMemory('{"v":1,"scope":"live:event","zoom":1e400,"cx":30,"cy":15,"savedAt":1000}', entry.scope, 2000, viewport, world), null);
});

test("camera memory round trip preserves the world center across viewport sizes", () => {
  const camera = { zoom: 32, x: -480, y: -240 };
  const raw = encodeCameraMemory(camera, viewport, "sample:50", 1000);
  const center = screenToWorld(camera, { x: 480, y: 240 });
  const size = { width: 640, height: 400 };
  const decoded = decodeCameraMemory(raw, "sample:50", 1100, size, world);
  assert.deepEqual(screenToWorld(decoded, { x: 320, y: 200 }), center);
  assert.equal(decoded.zoom, camera.zoom);
});
