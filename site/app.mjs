import { stageGeometry, stagePath, stageQueuePeople, stageQueuePosition } from "./stage.mjs";
import { setupHallMusic } from "./music.mjs?v=d1142140d771";
import { createViewerClock, followNowClock, seekViewerClock, tickViewerClock, toggleViewerPlayback } from "./clock.mjs?v=804de706146e";
import { VIEW_PROFILES, atMinZoom, constrainCamera, decodeCameraMemory, encodeCameraMemory, fitBounds, insetViewport, mobileTarget, overviewFrame, panCamera, relevantTableIndices, screenToWorld, tableBounds, viewMode, wheelIntent, worldToScreen, zoomAt } from "./camera.mjs?v=d94bb0d105dc";
import { DISCORD_INVITE, INFO_SPEECHES, WALL_PLAQUES, eventActions, setupFundraising, shortUrl } from "./event-config.mjs?v=e5ce603f951c";
import { SPRITES, characterAppearance, staffAppearance } from "./characters.mjs?v=7e98c9c03b67";
import * as foodCorner from "./food-corner.mjs?v=1ee6e05562ff";
import { createLoungeDrawing } from "./lounge.mjs?v=6340aed8fa29";
import { createStageDrawing } from "./stage-drawing.mjs?v=666f156be0b3";
import { loungeGeometry } from "./lounge-layout.mjs?v=57da6155641f";
import { loungeRoute } from "./lounge-routing.mjs?v=282f30660235";
import { cornerRoute } from "./food-routing.mjs?v=e52cc41290de";
import { queueSpot } from "./food-layout.mjs?v=44523bdb9315";
import {
  EVE_MS,
  CARETAKER_TILES_PER_SECOND,
  infoStaffGeometry,
  PALETTE_SIZE,
  activeEvents,
  accessibleEventText,
  countdownText,
  createRoomLayout,
  createLiveState,
  crossedSpeechEvents,
  displayName,
  gatheringAmbience,
  gatheringLocations,
  hallAmbience,
  hallStage,
  foodGeometry,
  loungeActivities,
  diceAt,
  diceText,
  indexAdminEvents,
  jukeboxBounds,
  jukeboxSignBounds,
  personTooltip,
  playbackSpeed,
  practicePlaces,
  receivePracticeSnapshot,
  practiceNow,
  publicActivity,
  reconcileLiveSnapshot,
  resolveLocation,
  seatPositionForPlan,
  shiftSpeechQueue,
  slotToMs,
  stageAnnouncer,
  speechView,
  tableView,
  tableLifecycle,
  tableScenery,
  validateTimeline,
  visibleVariant,
  wallFixtures,
} from "./model.mjs?v=e4a4ef86821a";

const TILE = 16;
const SCALE = 2;
const SURROUND_TILES = 8;
const STRIDE = 17;
const WALK_TILES_PER_SECOND = 3.2;
const SPEECH_SECONDS = { shout: 4, donation: 6 };
const MIN_SPEECH_REAL_SECONDS = 1;   // readable even at 1800×
const EVE_EXODUS_SECONDS = 45;       // departures at T−24 h spread over this many real seconds
const NO_ACTIVE = Object.freeze({ break: null, meal: null, announce: null, spotlight: null });
const ABSENT_PLACE = Object.freeze({ kind: "absent", label: "outside the hall" });

// Display milliseconds keep the opening lead and one-second hold visible in replay.
class HallDoor {
  constructor() { this.reset(); }
  reset() { this.readyAt = 0; this.closeAt = 0; }
  isOpen(now) { return now < this.closeAt; }
  request(now) {
    if (!this.isOpen(now)) this.readyAt = now + 200;
    this.crossed(now);
    return now >= this.readyAt;
  }
  crossed(now) { this.closeAt = Math.max(this.closeAt, now + 1000); }
}

const RPG = {
  floor: { wood: [1,26], food: [6,28], wall: [15,13] },
  table: [[23,4],[24,4],[25,4]],
  chairs: { top: [20,3], bottom: [19,3], left: [21,3], right: [22,3] },
  door: { closed: [36,0], open: [37,0] },
  food: [[54,15],[55,16],[56,17],[54,13],[55,13],[56,13]],
  shelf: [[44,12],[44,13]], plant: [18,9], couch: [[13,2],[13,3]],
  rug: [10,16],
};

const PLAQUE_SENTENCE = "Two plaques on the back wall carry QR codes for the Discord invite and the Extra Life donation page; the links are at the top of the page.";
const JUKEBOX_SENTENCE = "A jukebox stands against the back wall under a sign that offers music when clicked.";
const INFO_STAFF_SENTENCE = "A staff member stands at the north end of the stage under a sign that offers information about Longtable when clicked.";
const JUKEBOX_TOOLTIP = "Jukebox — click for music";
const INFO_CONTINUE_HINT = "▸ click to continue";
const INFO_FINISH_HINT = "▸ click to finish";
const KIOSK_CAMERA_RESET_MS = 45_000;   // a bumped mouse never leaves the projection zoomed into a corner
const KIOSK_CURSOR_HIDE_MS = 3_000;

const $ = (id) => document.getElementById(id);
const canvas = $("hall");
// The static prose describes the live page; scenery sentences are re-added per mode by updateHeader.
const hallDescription = $("canvas-description").textContent.replace(PLAQUE_SENTENCE, "").replace(JUKEBOX_SENTENCE, "").replace(INFO_STAFF_SENTENCE, "").trim();
let ctx = null;
try { ctx = canvas.getContext("2d"); } catch { /* The table list works without canvas. */ }
// Phones in either orientation: a phone turned sideways is wider than 650px but short (landscape phones top out near 932px).
const mobile = matchMedia("(max-width: 650px), (orientation: landscape) and (max-height: 500px) and (max-width: 950px)");
$("hall-explorer").open = true;
function arrangeHall() {
  const main = $("hall-content");
  const explorer = $("hall-explorer");
  const scene = canvas.parentElement;
  const cameraHelp = $("camera-help");
  const timeline = $("timeline-controls");
  if (mobile.matches) {
    // The hall's summary never shows at any width, so the hall stays open; this only re-asserts it.
    // The camera buttons stay in the scene, where styles.css lays them over the bottom of the canvas.
    // Below the canvas, in reading order: status, camera help, timeline, table list.
    // styles.css lifts the explorer above the status; kiosk hides everything moved here.
    explorer.open = true;
    main.append(...(cameraHelp ? [cameraHelp] : []), ...(timeline ? [timeline] : []), $("table-list"));
  } else {
    main.insertBefore($("table-list"), explorer.nextSibling);
    if (cameraHelp && cameraHelp.parentElement !== scene) scene.insertBefore(cameraHelp, $("music-open") ?? canvas);
    if (timeline && timeline.parentElement !== scene) scene.append(timeline);
  }
}
// Null when the player panel is absent: the jukebox still draws with its sign, but a click does nothing.
const music = setupHallMusic();
$("music-open")?.addEventListener("click", () => music?.togglePanel());
$("info-open")?.addEventListener("click", () => clickInfoStaff());
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

foodCorner.bindFoodDrawing({ ctx: () => ctx, rpg: () => state.images?.rpg, reduced: () => reducedMotion.matches });

const loungeDrawing = createLoungeDrawing({ ctx: () => ctx, rpg: () => state.images?.rpg, indoor: () => state.images?.indoor, reduced: () => reducedMotion.matches });
const stageDrawing = createStageDrawing({ ctx: () => ctx, indoor: () => state.images?.indoor, reduced: () => reducedMotion.matches });

const state = {
  data: null,
  clock: null,
  time: 0,
  lastTime: 0,
  tablePhaseNodes: new Map(),
  detailPhaseNode: null,
  tableDiceNodes: new Map(),
  detailDiceNode: null,
  lastUrlWrite: 0,
  view: null,
  camera: null,
  manualCamera: false,
  frameKey: null,
  viewport: null,
  speed: 600,
  selectedId: null,
  drawer: null,
  drawerInset: 0,
  manualSelection: false,   // a visitor picked (or cleared) the table; automatic framing leaves it alone
  hover: null,
  hoverName: null,  // the hovered person's name label, drawn after the plates
  hoverTable: -1,   // index of the table under the mouse; it shows its name plate like the selected one
  layout: null,
  people: new Map(),
  door: new HallDoor(),
  images: { characters: null, rpg: null, plaques: [null, null] },
  assetsFailed: false,
  snap: true,
  lastRefresh: 0,
  refreshing: false,
  lastChecked: null,
  feedDelayed: false,
  live: null,
  adminEvents: [],
  activity: [],
  activityLimit: 100,
  activityKey: null,
  activitySecond: null,
  speechQueue: [],
  speech: null,
  stageQueue: [],
  infoVisit: null,
  infoBubble: null,
  ambience: null,
  leisure: new Map(),
  locations: new Map(),
  diners: [],
  staleMessage: "",
  statusKey: null,
  stage: null,          // "gathering" | "eve" | "day" | "after" | null (not a live-source, live-phase package)
  pollSeconds: 2,
  gatheringPlaces: new Map(),
  practiceData: null,
  practiceSession: null,      // clock offset bounds and legacy first-seen moves
  practicePlaces: new Map(),   // practising people before doors, live feed only
  practiceSeen: new Set(),     // practice speech keys already shown (or present at load)
  gatheredCount: 0,
  nowOffset: 0,
  nowOverride: false,
  archive: document.documentElement?.dataset.source === "archive",
  sample: document.documentElement?.dataset.source !== "archive" && (
    new URLSearchParams(location.search).get("sample") === "1" || new URLSearchParams(location.search).get("sample") === "50"),
  // `?kiosk=1` is a chrome flag for the projector: it never changes the clock mode, source, polling or data path.
  kiosk: new URLSearchParams(location.search).get("kiosk") === "1",
  wakeLock: null,
  lastInputAt: 0,
  lastPointerAt: 0,
};
function setCameraMenu(open, { focusToggle = false } = {}) {
  const controls = $("camera-controls");
  const toggle = $("camera-toggle");
  if ((controls.getAttribute("data-open") !== null) !== open) {
    if (open) controls.setAttribute("data-open", "");
    else controls.removeAttribute("data-open");
  }
  const expanded = String(open);
  if (toggle.getAttribute("aria-expanded") !== expanded) toggle.setAttribute("aria-expanded", expanded);
  if (focusToggle) toggle.focus();
}

function dismissCameraHelp() {
  const help = $("camera-help");
  if (help.getAttribute("data-dismissed") === null) help.setAttribute("data-dismissed", "");
}

function updateView() {
  const view = viewMode({ kiosk: state.kiosk, phone: mobile.matches });
  if (state.view !== view && !state.manualCamera) state.frameKey = null;
  state.view = view;
  document.documentElement.dataset.view = view;
  if (view !== "mobile") setCameraMenu(false);
}
updateView();
arrangeHall();
mobile.addEventListener?.("change", () => { updateView(); arrangeHall(); });
// Kiosk hides the scrubber panel, so its clock lives in the bar.
if (state.kiosk) $("mode-badge").after($("clock"));
if ($("info-open")) $("info-open").hidden = state.kiosk;
if (state.kiosk) {
  if (document.documentElement?.dataset) document.documentElement.dataset.kiosk = "1";
  $("hall-explorer").open = true;
}
// Move the existing live regions with their containers; keep their original insertion points.
function setupKioskColumns() {
  const media = matchMedia("(min-aspect-ratio: 3/2)");
  const info = document.createElement("aside");
  info.id = "kiosk-info";
  info.setAttribute("aria-label", "Event information");
  const codes = document.createElement("aside");
  codes.id = "kiosk-codes";
  codes.setAttribute("aria-label", "Event QR codes");
  const moved = [$("event-name").parentElement, $("mode-badge").parentElement, $("fundraising-strip"), $("status")]
    .map(node => ({ node, parent: node.parentElement, next: node.nextSibling }));
  if (!state.archive) {
    for (const plaque of WALL_PLAQUES) {
      if (!plaque.url) continue;
      const card = document.createElement("div");
      card.className = "kiosk-code";
      const mat = document.createElement("div");
      mat.className = "kiosk-code-mat";
      const image = document.createElement("img");
      image.src = new URL(plaque.qr, import.meta.url).href;
      image.alt = plaque.label;
      mat.append(image);
      const label = document.createElement("p");
      label.className = "kiosk-code-label";
      label.textContent = plaque.label;
      const url = document.createElement("p");
      url.className = "kiosk-code-url";
      url.textContent = shortUrl(plaque.url);
      card.append(mat, label, url);
      codes.append(card);
    }
  }
  document.body.append(info, codes);
  function arrangeKiosk() {
    info.hidden = !media.matches;
    codes.hidden = !media.matches || !codes.children.length;
    for (const { node, parent, next } of moved) {
      if (media.matches) info.append(node);
      else parent.insertBefore(node, next);
    }
  }
  arrangeKiosk();
  media.addEventListener("change", arrangeKiosk);
}
if (state.kiosk) setupKioskColumns();
// The footer's kiosk link keeps the page's other query flags (sample, now, at) so it opens the same view as a kiosk.
{
  const link = $("kiosk-link");
  if (link) {
    const params = new URLSearchParams(location.search);
    params.set("kiosk", "1");
    link.href = `?${params}`;
    link.hidden = state.archive;
  }
}

// `?now=` (ISO-8601 or epoch milliseconds) shifts the wall clock for review and tests; time keeps flowing from it.
function parseNowOverride(value) {
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim();
  const parsed = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
{
  const override = parseNowOverride(new URLSearchParams(location.search).get("now"));
  state.nowOverride = override !== null;
  state.nowOffset = override === null ? 0 : override - Date.now();
}
function wallNow() { return Date.now() + state.nowOffset; }
const upcoming = () => state.clock?.mode === "upcoming";
const beforeDoors = () => state.stage === "gathering" || state.stage === "eve";
/** A table's schedule-derived status at the selected time; before doors every table is simply scheduled. */
const phaseText = (table) => upcoming() ? "Scheduled" : tableLifecycle(state.data, table, state.time).label;
// The gathering scene: watching the hall as it is now, before doors (the preview keeps the event-day path).
const gatheringScene = () => upcoming() && beforeDoors();

function updateStage(now) {
  const liveSource = state.clock?.source === "live" && state.data?.phase === "live";
  state.stage = liveSource ? hallStage(state.data, now) : null;
  const practising = Object.keys(state.data?.practice?.people ?? {}).length > 0;
  state.pollSeconds = practising ? 5 : beforeDoors() && Date.parse(state.data.event.start) - now > 60 * 60_000 ? 30 : 2;
}

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function setStatus(message, className = "", link = null) {
  const status = $("status");
  const nextClass = `status${className ? ` ${className}` : ""}`;
  const key = `${message}\u0000${link?.text ?? ""}\u0000${link?.href ?? ""}`;
  if (state.statusKey !== key) {
    state.statusKey = key;
    status.replaceChildren();
    status.textContent = message;
    if (link) {
      const anchor = document.createElement("a");
      anchor.textContent = link.text;
      anchor.href = link.href;
      status.append(anchor);
    }
  }
  if (status.className !== nextClass) status.className = nextClass;
}

function append(parent, tag, text, className = "") {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function formatDate(milliseconds, options) {
  try { return new Intl.DateTimeFormat(undefined, { timeZone: state.data.event.tz, ...options }).format(new Date(milliseconds)); }
  catch { return new Date(milliseconds).toISOString(); }
}

function formatSlot(slot, withDay = false) {
  return formatDate(slotToMs(state.data, slot), {
    ...(state.data.event.slots * state.data.event.slot_minutes >= 1440 ? { month: "short", day: "numeric" } : {}),
    ...(withDay ? { weekday: "short" } : {}), hour: "numeric", minute: "2-digit",
  });
}

function buildLayout() {
  return { ...createRoomLayout(state.data.tables, state.data.room_layout), scale: SCALE };
}

function canvasViewport() {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width || 960, height: rect.height || 480 };
}

// All camera callers, including memory, share the uncovered CSS-pixel viewport.
function viewport() {
  return insetViewport(canvasViewport(), state.drawerInset);
}

let drawerTransition = { target: 0, from: 0, start: 0 };
function updateDrawerInset(now) {
  const target = state.view === "desktop" && state.drawer !== null ? $("hall-sidebar").offsetWidth : 0;
  if (target !== drawerTransition.target) drawerTransition = { target, from: state.drawerInset, start: now };
  if (reducedMotion.matches || state.view !== "desktop") {
    state.drawerInset = target;
  } else if (state.drawerInset !== target) {
    const progress = Math.min(1, Math.max(0, (now - drawerTransition.start) / 220));
    if (progress === 1) state.drawerInset = target;
    else {
      // CSS ease-out is cubic-bezier(0, 0, .58, 1). Invert its x component for elapsed time.
      let low = 0, high = 1;
      for (let i = 0; i < 20; i++) {
        const t = (low + high) / 2;
        if (1.74 * t * t - .74 * t * t * t < progress) low = t;
        else high = t;
      }
      const t = (low + high) / 2;
      const eased = progress === 0 ? 0 : 3 * t * t - 2 * t * t * t;
      state.drawerInset = drawerTransition.from + (target - drawerTransition.from) * eased;
    }
  }
}

function hallBounds() {
  return { x: 0, y: state.layout.backWall.y, width: state.layout.width,
    height: state.layout.height - state.layout.backWall.y };
}

function frameTables(indices, manual = false) {
  state.camera = fitBounds(tableBounds(state.layout, indices), viewport(), hallBounds());
  state.manualCamera = manual;
  hideTooltip();
}

function mobileTableIndex() {
  let selected = state.data.tables.findIndex((table) => table.id === state.selectedId);
  // Release an automatic selection when the schedule moves on; explicit selections stay pinned.
  if (!state.manualSelection && selected >= 0) {
    const relevant = relevantTableIndices(state.data.tables, state.time);
    if (relevant.length && !relevant.includes(selected)) selected = -1;
  }
  return mobileTarget(state.data.tables, state.time, selected);
}

function frameMobile(manual = false) {
  const index = mobileTableIndex();
  state.camera = fitBounds(tableBounds(state.layout, index < 0 ? [] : [index]), viewport(), hallBounds(), 16);
  state.manualCamera = manual;
  hideTooltip();
  return index;
}

function updateCamera(announcer) {
  const size = viewport();
  const profile = VIEW_PROFILES[state.view];
  if (state.camera && state.viewport && (size.width !== state.viewport.width || size.height !== state.viewport.height)) {
    const center = screenToWorld(state.camera, { x: state.viewport.width / 2, y: state.viewport.height / 2 });
    state.camera = constrainCamera({ ...state.camera, x: size.width / 2 - center.x * state.camera.zoom, y: size.height / 2 - center.y * state.camera.zoom }, size, hallBounds());
    if (!state.manualCamera) state.frameKey = null;
  }
  state.viewport = size;
  if (state.manualCamera) {
    state.camera = constrainCamera(state.camera, size, hallBounds());
    return;
  }
  const indices = upcoming() ? state.data.tables.map((_, index) => index) : relevantTableIndices(state.data.tables, state.time);
  const target = profile.frame === "table" ? mobileTableIndex() : -1;
  const showStage = state.speech?.event.kind === "donation" || state.stageQueue.length > 0 || announcer != null || infoRunning();
  const wholeRoom = upcoming() || !state.data.tables.some((table) => state.time >= table.start && state.time < table.end);
  const key = profile.frame === "table" ? "m:" + (state.data.tables[target]?.id ?? "door")
    : profile.frame === "overview" ? "kiosk"
    : wholeRoom ? "room" : indices.map((index) => state.data.tables[index].id).join("|") + (showStage ? "|stage" : "");
  const selectedId = profile.frame === "table" ? state.data.tables[target]?.id ?? null
    : indices.length === 1 ? state.data.tables[indices[0]].id : null;
  if (state.frameKey === key && state.camera) {
    // Kiosk keeps following selection changes even though its overview frame is constant.
    if (profile.frame === "overview" && !state.manualSelection && state.selectedId !== selectedId) {
      state.selectedId = selectedId;
      renderDetail();
    }
    return;
  }
  if (profile.frame === "table") {
    frameMobile();
  } else if (profile.frame === "overview" || wholeRoom) {
    state.camera = overviewFrame(size, hallBounds(), profile.overviewCrop);
  } else {
    frameTables(indices);
    // Relevant-table frames retain banner and stage widening; whole-room frames already include the plaques.
    const fixtures = wallFixtures(state.layout, { banner: !!state.data.event.host_name, plaques: 0 });
    const hung = [fixtures.banner, ...fixtures.plaques].filter(Boolean);
    if (hung.length) {
      const tables = tableBounds(state.layout, indices);
      const x = Math.min(tables.x, ...hung.map((rect) => rect.x - 2));
      state.camera = fitBounds({ x, y: -6, width: Math.max(tables.x + tables.width, ...hung.map((rect) => rect.x + rect.w + 2)) - x,
        height: tables.y + tables.height + 6 }, size, hallBounds());
    }
    if (showStage) {
      const tables = tableBounds(state.layout, indices);
      const stage = state.layout.stage;
      const x = Math.min(tables.x, stage.x - 2);
      const y = Math.min(tables.y, stage.y);
      state.camera = fitBounds({ x, y, width: Math.max(tables.x + tables.width, stage.x + stage.w) - x,
        height: Math.max(tables.y + tables.height, state.layout.height - 1) - y }, size, hallBounds());
    }
  }
  state.frameKey = key;
  hideTooltip();
  if (!state.manualSelection) state.selectedId = selectedId;
  renderDetail();
  state.camera = constrainCamera(state.camera, size, hallBounds());
}

const CAMERA_MEMORY_KEY = "longtable.camera.v1";
let cameraMemoryRead = false;
let cameraMemoryPending = null;
let cameraMemoryWritten = null;
let cameraMemoryChangedAt = 0;
function cameraScope() {
  return state.archive ? `archive:${state.data.event.id}`
    : state.sample ? `sample:${new URLSearchParams(location.search).get("sample")}` : `live:${state.data.event.id}`;
}
function restoreCameraMemory() {
  if (cameraMemoryRead) return;
  cameraMemoryRead = true;
  if (!VIEW_PROFILES[state.view].memory) return;
  try {
    const camera = decodeCameraMemory(localStorage.getItem(CAMERA_MEMORY_KEY), cameraScope(), Date.now(), viewport(), hallBounds());
    if (camera) {
      state.camera = camera;
      state.manualCamera = true;
      cameraMemoryWritten = { ...camera };
    }
  } catch { /* Camera memory is optional, including when storage itself is unavailable. */ }
}
function persistCameraMemory(now) {
  if (!VIEW_PROFILES[state.view].memory || !state.manualCamera) {
    cameraMemoryPending = null;
    return;
  }
  const camera = state.camera;
  const same = (other) => other && camera.zoom === other.zoom && camera.x === other.x && camera.y === other.y;
  if (!same(cameraMemoryPending)) {
    cameraMemoryPending = { ...camera };
    cameraMemoryChangedAt = now;
  }
  if (same(cameraMemoryWritten) || now - cameraMemoryChangedAt < 500) return;
  try {
    localStorage.setItem(CAMERA_MEMORY_KEY, encodeCameraMemory(camera, state.viewport, cameraScope(), Date.now()));
  } catch { /* A failed write must never interrupt rendering. */ }
  cameraMemoryWritten = { ...camera };
}

function renderActions() {
  const host = $("event-actions");
  host.replaceChildren();
  for (const action of state.sample || state.archive ? [] : eventActions(state.data.event)) {
    // Header actions are plain links; the QR codes live on the wall plaques.
    const link = append(host, "a", action.label);
    link.href = action.url;
  }
}

function seatPosition(tableIndex, seat) {
  return seatPositionForPlan(state.layout, tableIndex, seat);
}

function destination(runtime, now, active) {
  const custom = state.speech?.event.kind === "donation" && state.speech.event.person === runtime.person.id;
  if (custom) {
    const leaving = state.speech.phase === "leaving";
    return { kind: leaving ? "stage-exit" : "stage-speaker", label: leaving ? "the stage stairs" : "the stage microphone",
      position: leaving ? stageGeometry(state.layout).foot : state.layout.stageFront, present: true };
  }
  const queueIndex = state.stageQueue.indexOf(runtime.person.id);
  if (queueIndex >= 0) return { kind: "stage-queue", label: "the stage queue", position: stageQueuePosition(state.layout, queueIndex, state.stageQueue.length), present: true };
  const place = state.locations.get(runtime.person.id);
  if (place.kind === "absent") return { ...place, label: "the door", position: state.layout.doorPosition, present: false };
  if (place.kind === "spotlight") return { ...place, position: state.layout.stageFront, present: true };
  const wander = place.visitorBeat ?? Math.floor(now / 9000 + runtime.ordinal * 0.37);
  if (place.kind === "visiting") return { ...place, position: {
    x: state.layout.trunkX,
    y: state.layout.aisles[(wander + runtime.ordinal) % state.layout.aisles.length],
  }, present: true };
  if (place.kind === "lounge") {
    const activity = state.leisure.get(runtime.person.id);
    return { ...place, ...activity, present: true };
  }
  if (place.kind === "food") {
    const geometry = foodGeometry(state.layout, state.diners.indexOf(runtime.person.id), Math.max(4, state.diners.length));
    const serving = (place.foodPhase === "waiting" || place.foodPhase === "serving-first") ? "first" : place.foodPhase === "serving-second" ? "second" : null;
    const position = serving ? queueSpot(state.layout, serving,
      state.diners.filter(id => state.locations.get(id)?.foodPhase === place.foodPhase).indexOf(runtime.person.id))
      : place.foodPhase === "trash" ? geometry.binStand : geometry.seat;
    return { ...place, position, present: true };
  }
  return { ...place, position: seatPosition(place.tableIndex, place.seat), present: true };
}

function closestAisle(y) {
  return state.layout.aisles.reduce((best, aisle) => Math.abs(aisle - y) < Math.abs(best - y) ? aisle : best);
}

function outsideTableGrid(point) {
  const rows = state.layout.tableRows;
  return point.x < state.layout.gridX - 0.2 || point.y < state.layout.gridY - 0.2 || point.y > state.layout.gridY + rows * state.layout.cellHeight - 0.2;
}

function pathBetween(from, to, remaining = []) {
  const hallPath = (a, b) => stagePath(state.layout, a, b, hallPathBetween);
  const cornerPath = (a, b) => cornerRoute(state.layout, a, b, hallPath, [], state.diners.length) ?? hallPath(a, b);
  state.loungeGeometry ??= loungeGeometry(state.layout);
  return loungeRoute(state.layout, from, to, cornerPath, remaining, state.loungeGeometry)
    ?? cornerRoute(state.layout, from, to, hallPath, remaining, state.diners.length) ?? hallPath(from, to);
}

function hallPathBetween(from, to) {
  const firstAisle = closestAisle(from.y);
  const secondAisle = closestAisle(to.y);
  if (outsideTableGrid(from) && outsideTableGrid(to)) return [to];
  const points = [{ x: from.x, y: firstAisle }];
  if (firstAisle !== secondAisle) points.push({ x: state.layout.trunkX, y: firstAisle }, { x: state.layout.trunkX, y: secondAisle });
  points.push({ x: to.x, y: secondAisle }, to);
  return points;
}

function samePoint(a, b) { return a && b && Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001; }

function syncPeople() {
  const previous = state.people;
  const next = new Map();
  state.data.people.forEach((person, ordinal) => {
    const runtime = previous.get(person.id) || {
      person, ordinal, position: null, path: [], visible: false, moving: false, facing: 1, phase: (ordinal * 0.61803398875) % 1,
    };
    runtime.person = person;
    runtime.ordinal = ordinal;
    next.set(person.id, runtime);
  });
  state.people = next;
}

function updatePeople(realSeconds, now, active) {
  if (state.snap || reducedMotion.matches) state.door.reset();
  const gathering = gatheringScene();
  if (gathering) {
    state.practicePlaces = state.practiceSession
      ? practicePlaces(state.practiceSession.timeline, practiceNow(state.practiceSession, wallNow()), state.layout) : new Map();
    // Planned placement, not the per-slot resolver. In the eve everyone leaves, staggered by runtime.phase
    // from the moment the eve began, so an open tab and a tab loaded mid-exodus see the same schedule.
    const eveElapsed = state.stage === "eve" ? (wallNow() - (Date.parse(state.data.event.start) - EVE_MS)) / 1000 : -1;
    state.locations = new Map(state.data.people.map(person => {
      // Practising people stand where they practise and stay through the eve.
      const practising = state.practicePlaces.get(person.id);
      if (practising) return [person.id, practising];
      const leaving = state.stage === "eve" && eveElapsed >= (state.people.get(person.id)?.phase ?? 0) * EVE_EXODUS_SECONDS;
      return [person.id, leaving ? ABSENT_PLACE : state.gatheringPlaces.get(person.id) ?? ABSENT_PLACE];
    }));
  } else {
    state.locations = new Map(state.data.people.map(person => [person.id, resolveLocation(state.data, person, state.time, active)]));
  }
  const onStage = new Set(state.stageQueue);
  if (state.speech?.event.kind === "donation") onStage.add(state.speech.event.person);
  state.leisure = loungeActivities(state.layout, state.data.people.filter(person =>
    state.locations.get(person.id).kind === "lounge" && !onStage.has(person.id)));
  state.diners = state.data.people.filter(person => state.locations.get(person.id).kind === "food" && !onStage.has(person.id))
    .map(person => person.id).sort();
  for (const runtime of state.people.values()) {
    const target = destination(runtime, now, active);
    const elapsed = Math.max(0, (state.time - (runtime.lastSlot ?? state.time)) * state.data.event.slot_minutes * 60);
    runtime.lastSlot = state.time;
    runtime.place = target;
    const targetChanged = !runtime.target || !samePoint(runtime.target.position, target.position) || runtime.target.kind !== target.kind;
    if (!runtime.visible && target.present) {
      runtime.position = { ...state.layout.doorPosition };
      runtime.visible = true;
      runtime.entering = true;
      runtime.path = pathBetween(runtime.position, target.position);
    } else if (runtime.visible && targetChanged) {
      runtime.path = pathBetween(runtime.position, target.position, runtime.path);
    }
    runtime.target = target;

    if (state.snap || reducedMotion.matches) {
      runtime.position = { ...target.position };
      runtime.path = [];
      runtime.visible = target.present;
      runtime.moving = false;
      runtime.entering = false;
      continue;
    }
    if (!runtime.visible || !runtime.position) continue;
    // Use the same event-time delta as staff, including accelerated replay and pause.
    // Queued speeches can finish their stage visit while replay is paused for reading.
    // The gathering has no event-time delta; walk-ins and walk-outs there run at wall-clock pace.
    const travelSeconds = gathering ? realSeconds : target.kind.startsWith("stage-") ? Math.max(realSeconds, elapsed) : elapsed;
    let budget = WALK_TILES_PER_SECOND * travelSeconds;
    if (runtime.entering) {
      if (!target.present) {
        runtime.entering = false;
        runtime.visible = false;
        runtime.path = [];
        continue;
      }
      const ready = state.door.request(now);
      if (!ready || budget === 0) { runtime.moving = false; continue; }
      runtime.entering = false;
      state.door.crossed(now);
    }
    // Open before an exiting person reaches the threshold, even in fast replay.
    if (!target.present && budget > 0) {
      let remaining = 0, from = runtime.position;
      for (const point of runtime.path) {
        remaining += Math.hypot(point.x - from.x, point.y - from.y);
        from = point;
      }
      if (remaining <= budget + .8 && !state.door.request(now)) {
        runtime.moving = false;
        continue;
      }
    }
    while (budget > 0 && runtime.path.length) {
      const point = runtime.path[0];
      const dx = point.x - runtime.position.x;
      const dy = point.y - runtime.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        runtime.position = { x: point.x, y: point.y };
        runtime.path.shift();
        budget -= distance;
      } else {
        runtime.position.x += dx / distance * budget;
        runtime.position.y += dy / distance * budget;
        if (Math.abs(dx) > 0.05) runtime.facing = dx < 0 ? -1 : 1;
        budget = 0;
      }
    }
    runtime.moving = runtime.path.length > 0;
    if (!target.present && !runtime.moving) {
      runtime.visible = false;
      state.door.crossed(now);
    }
  }
  state.snap = false;
}

function drawTile(image, coordinate, x, y, flip = false, alpha = 1) {
  if (!image) return false;
  const size = TILE * SCALE;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (flip) {
    ctx.translate(Math.round(x * size + size), Math.round(y * size));
    ctx.scale(-1, 1);
    ctx.drawImage(image, coordinate[0] * STRIDE, coordinate[1] * STRIDE, TILE, TILE, 0, 0, size, size);
  } else {
    ctx.drawImage(image, coordinate[0] * STRIDE, coordinate[1] * STRIDE, TILE, TILE, Math.round(x * size), Math.round(y * size), size, size);
  }
  ctx.restore();
  return true;
}

function drawNine(rect, base, fallback) {
  for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) {
    const coordinate = [base[0] + (x === 0 ? 0 : x === rect.w - 1 ? 2 : 1), base[1] + (y === 0 ? 0 : y === rect.h - 1 ? 2 : 1)];
    if (!drawTile(state.images.rpg, coordinate, rect.x + x, rect.y + y)) {
      ctx.fillStyle = fallback;
      ctx.fillRect((rect.x + x) * TILE * SCALE, (rect.y + y) * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
  }
}

function drawLabel(value, x, y, options = {}) {
  const size = (options.size || 5) * SCALE;
  ctx.font = `${options.bold ? "700 " : ""}${size}px ui-monospace, monospace`;
  ctx.textAlign = options.align || "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(value).width + 3 * SCALE;
  const height = size + 2 * SCALE;
  const pixelX = x * TILE * SCALE;
  const pixelY = y * TILE * SCALE;
  const boxX = options.align === "left" ? pixelX : pixelX - width / 2;
  if (options.background !== false) {
    ctx.fillStyle = options.background || "rgba(0,0,0,.74)";
    ctx.fillRect(Math.round(boxX), Math.round(pixelY - height / 2), Math.round(width), Math.round(height));
  }
  ctx.fillStyle = options.color || "#fff";
  ctx.fillText(value, options.align === "left" ? pixelX + 1.5 * SCALE : pixelX, pixelY + 0.5);
}

// The banner hangs over the entrance and first tables so it is visible in the opening view.
function bannerBounds() {
  return wallFixtures(state.layout, { plaques: state.archive ? 0 : 2 }).banner;
}

// Fit `text` in `font` at `size` tile units into `available` tiles, shrinking the same way the banner does.
function fitFont(text, size, family, available) {
  ctx.font = `${size}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > available) ctx.font = `${size * available / width}px ${family}`;
}

// Two wooden plaques hang right of the banner: the Discord invite and the Extra Life page, each with its QR.
function drawWallPlaques() {
  if (state.archive) return;
  const { plaques } = wallFixtures(state.layout);
  plaques.forEach(({ x, y, w, h }, index) => {
    const plaque = WALL_PLAQUES[index];
    if (!plaque) return;
    ctx.save();
    ctx.scale(TILE * SCALE, TILE * SCALE);
    ctx.translate(x, y);
    ctx.fillStyle = "#4a3524";
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = .08;
    ctx.strokeStyle = "#b89b5c";
    ctx.strokeRect(.04, .04, w - .08, h - .08);
    ctx.fillStyle = "#d8b86d";
    for (const nail of [.28, w - .28]) { ctx.beginPath(); ctx.arc(nail, .28, .1, 0, Math.PI * 2); ctx.fill(); }
    const mat = { x: (w - 3.6) / 2, y: .35, side: 3.6 };
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(mat.x, mat.y, mat.side, mat.side);
    const image = state.images.plaques[index];
    if (image) {
      // Snap the QR to whole device pixels so its modules stay square at any zoom.
      const m = ctx.getTransform();
      const device = (px, py) => ({ x: Math.round(m.a * px + m.c * py + m.e), y: Math.round(m.b * px + m.d * py + m.f) });
      const from = device(mat.x, mat.y);
      const to = device(mat.x + mat.side, mat.y + mat.side);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, from.x, from.y, to.x - from.x, to.y - from.y);
      ctx.restore();
      ctx.imageSmoothingEnabled = false;
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#e9d9ae";
    fitFont(plaque.label, .42, "Georgia, serif", w - .6);
    ctx.fillText(plaque.label, w / 2, 4.35);
    ctx.fillStyle = "#c9b98a";
    const url = shortUrl(plaque.url);
    fitFont(url, .3, '"Courier New", monospace', w - .6);
    ctx.fillText(url, w / 2, 4.85);
    ctx.restore();
  });
}

function drawHostBanner() {
  const name = state.data.event.host_name;
  if (!name) return;
  const { x, y, w, h } = bannerBounds();
  ctx.save();
  ctx.scale(TILE * SCALE, TILE * SCALE);
  ctx.translate(x, y);
  ctx.lineWidth = .05;
  ctx.strokeStyle = "#b89b5c";
  // Two cords suspend the folded parchment ribbon from brass wall pegs.
  for (const anchor of [2, w - 2]) {
    ctx.beginPath(); ctx.moveTo(anchor, -1); ctx.lineTo(anchor, .2); ctx.stroke();
    ctx.fillStyle = "#d8b86d";
    ctx.beginPath(); ctx.arc(anchor, -.9, .12, 0, Math.PI * 2); ctx.fill();
  }
  for (const right of [false, true]) {
    ctx.save();
    if (right) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.fillStyle = "#bca475";
    ctx.beginPath(); ctx.moveTo(1, .6); ctx.lineTo(-1.7, .9);
    ctx.lineTo(-.9, 1.8); ctx.lineTo(-1.7, 2.9); ctx.lineTo(1.1, 2.6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#75613f";
    ctx.beginPath(); ctx.moveTo(0, 2.8); ctx.lineTo(1.1, 2.6); ctx.lineTo(1.1, h); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#edddb5";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(w / 2, .6, w, 0);
  ctx.lineTo(w, h); ctx.quadraticCurveTo(w / 2, h - .6, 0, h); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#b69a61";
  ctx.beginPath(); ctx.moveTo(.3, .3); ctx.quadraticCurveTo(w / 2, .85, w - .3, .3);
  ctx.moveTo(.3, h - .3); ctx.quadraticCurveTo(w / 2, h - .85, w - .3, h - .3); ctx.stroke();
  const icon = state.hostIcon;
  const iconSpace = icon ? 2.9 : 0;
  if (icon) {
    const ratio = Math.min(2.2 / icon.naturalWidth, 2.2 / icon.naturalHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(icon, 1.1 + (2.2 - icon.naturalWidth * ratio) / 2,
      (h - icon.naturalHeight * ratio) / 2, icon.naturalWidth * ratio, icon.naturalHeight * ratio);
  }
  const center = (w + iconSpace) / 2;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#695531"; ctx.font = ".45px Georgia, serif";
  ctx.fillText("HOSTED BY", center, 1.05);
  ctx.fillStyle = "#302c22";
  let size = 1.05;
  ctx.font = `${size}px Georgia, serif`;
  const available = w - iconSpace - 2;
  if (ctx.measureText(name).width > available) size *= available / ctx.measureText(name).width;
  ctx.font = `${size}px Georgia, serif`;
  ctx.fillText(name, center, 2.12);
  ctx.restore();
}

// A wooden jukebox with an arched top stands against the back wall; its lamps and glass glow while music plays.
// The sign above invites a click and names the track while it plays. Both are drawn in tile space like the plaques.
function drawJukebox() {
  const box = jukeboxBounds(state.layout);
  const sign = jukeboxSignBounds(state.layout);
  const playing = !!music?.isPlaying();
  const beat = (offset) => reducedMotion.matches ? 1 : (Math.sin(state.lastTime / 260 + offset) + 1) / 2;
  ctx.save();
  ctx.scale(TILE * SCALE, TILE * SCALE);
  ctx.translate(sign.x, sign.y);
  ctx.fillStyle = "#4a3524";
  ctx.fillRect(0, 0, sign.w, sign.h);
  ctx.lineWidth = .06;
  ctx.strokeStyle = "#b89b5c";
  ctx.strokeRect(.04, .04, sign.w - .08, sign.h - .08);
  ctx.fillStyle = "#d8b86d";
  for (const nail of [.2, sign.w - .2]) { ctx.beginPath(); ctx.arc(nail, .2, .07, 0, Math.PI * 2); ctx.fill(); }
  const text = playing ? `♪ ${music.currentTitle()}` : "Click here for music";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#e9d9ae";
  fitFont(text, .42, "Georgia, serif", sign.w - .5);
  ctx.fillText(text, sign.w / 2, sign.h / 2 + .03);
  ctx.translate(box.x - sign.x, box.y - sign.y);
  const arch = { x: box.w / 2, y: .95, r: box.w / 2 };
  ctx.fillStyle = "#5a3b22";
  ctx.beginPath(); ctx.moveTo(0, box.h); ctx.lineTo(0, arch.y); ctx.arc(arch.x, arch.y, arch.r, Math.PI, 0); ctx.lineTo(box.w, box.h); ctx.closePath();
  ctx.fill();
  ctx.lineWidth = .06;
  ctx.strokeStyle = "#2c1b10";
  ctx.stroke();
  ctx.strokeStyle = "#d8b86d";
  ctx.lineWidth = .07;
  ctx.beginPath(); ctx.arc(arch.x, arch.y, arch.r - .16, Math.PI, 0); ctx.stroke();
  // The glass front: warm and steady when off, brighter and breathing while a track plays.
  const glow = playing ? .6 + .4 * beat(0) : .35;
  ctx.fillStyle = `rgba(255, 196, 110, ${glow})`;
  ctx.beginPath(); ctx.arc(arch.x, arch.y, arch.r - .38, Math.PI, 0); ctx.lineTo(box.w - .38, 1.7); ctx.lineTo(.38, 1.7); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(.3, 1.85, box.w - .6, .75);
  ctx.fillStyle = "#8a6a45";
  for (const line of [2.0, 2.2, 2.4]) ctx.fillRect(.42, line, box.w - .84, .06);
  const lamps = ["#ff6a6a", "#ffd45f", "#6fdcff", "#9dff6f", "#ff6fd6"];
  lamps.forEach((color, index) => {
    const angle = Math.PI + Math.PI * (index + .5) / lamps.length;
    ctx.globalAlpha = playing ? .5 + .5 * beat(index * 1.3) : .3;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(arch.x + Math.cos(angle) * (arch.r - .16), arch.y + Math.sin(angle) * (arch.r - .16), .1, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#2c1b10";
  ctx.fillRect(.1, box.h - .12, .4, .12);
  ctx.fillRect(box.w - .5, box.h - .12, .4, .12);
  ctx.restore();
}

function overJukebox(point) {
  const inside = ({ x, y, w, h }) => point.x >= x && point.x < x + w && point.y >= y && point.y < y + h;
  return inside(jukeboxBounds(state.layout)) || inside(jukeboxSignBounds(state.layout));
}

// This visit belongs to the viewer, so seeking and replay speed never reset or accelerate it.
function infoRunning() { return state.infoVisit != null && state.infoVisit.phase !== "idle"; }
function infoSpeechKey() {
  if (state.archive || state.data?.phase === "final") return "record";
  if (state.stage === "day") return "during";
  if (state.stage === "after") return "after";
  return "before";
}
function infoSpeech() { return INFO_SPEECHES[infoRunning() ? state.infoVisit.speechKey : infoSpeechKey()]; }
function infoPosition() { return infoRunning() ? state.infoVisit.position : infoStaffGeometry(state.layout).post; }
function infoStageBusy(active = upcoming() ? NO_ACTIVE : activeEvents(state.data, state.time, state.adminEvents), announcer = announcerForFrame()) {
  return !!(state.speech || state.stageQueue.length || announcer || active.spotlight);
}
function overInfoStaff(point) {
  const geometry = state.layout && infoStaffGeometry(state.layout);
  if (state.kiosk || !geometry) return false;
  const inside = ({ x, y, w, h }) => point.x >= x && point.x < x + w && point.y >= y && point.y < y + h;
  if (inside(geometry.hit)) return true;
  const position = infoPosition();
  // The sprite spans .6 above to .4 below the position (drawStaff); the head room covers the STAFF label.
  return infoRunning() && inside({ x: position.x - .5, y: position.y - 1.5, w: 1, h: 1.9 });
}
function overInfoBubble(screen) {
  const box = state.infoBubble;
  return !!box && screen.x >= box.x && screen.x < box.x + box.w && screen.y >= box.y && screen.y < box.y + box.h;
}
function infoLine(line, now) {
  const visit = state.infoVisit;
  visit.phase = "speaking";
  visit.line = line;
  if ($("info-speech")) $("info-speech").textContent = infoSpeech()[line];
}
function leaveInfoStaff(now) {
  const visit = state.infoVisit;
  visit.phase = reducedMotion.matches ? "idle" : "leaving";
  visit.lastAt = now;
  if ($("info-speech")) $("info-speech").textContent = "";
}
function clickInfoStaff() {
  if (!state.layout || state.kiosk || !infoStaffGeometry(state.layout)) return;
  const now = performance.now();
  if (infoStageBusy()) {
    if (infoRunning() && state.infoVisit.phase !== "leaving") leaveInfoStaff(now);
    return;
  }
  if (!infoRunning()) {
    const geometry = infoStaffGeometry(state.layout);
    state.infoVisit = { speechKey: infoSpeechKey(), phase: "approaching", position: { ...geometry.post }, lastAt: now };
    if (reducedMotion.matches) {
      state.infoVisit.position = { ...geometry.speakSpot };
      infoLine(0, now);
    }
  } else if (state.infoVisit.phase === "speaking") {
    if (state.infoVisit.line + 1 < infoSpeech().length) infoLine(state.infoVisit.line + 1, now);
    else leaveInfoStaff(now);
  }
}
function advanceInfoStaff(now, active, announcer) {
  if (state.kiosk || !infoRunning()) return;
  const visit = state.infoVisit;
  if (infoStageBusy(active, announcer) && visit.phase !== "leaving") leaveInfoStaff(now);
  if (!infoRunning()) return;
  // Each line stays up until the viewer clicks to continue.
  if (visit.phase === "speaking") return;
  const { post, speakSpot } = infoStaffGeometry(state.layout);
  const target = visit.phase === "approaching" ? speakSpot : post;
  const dx = target.x - visit.position.x, dy = target.y - visit.position.y;
  const distance = Math.hypot(dx, dy);
  const step = reducedMotion.matches ? distance : Math.max(0, now - visit.lastAt) / 1000 * CARETAKER_TILES_PER_SECOND;
  visit.lastAt = now;
  if (step >= distance) {
    visit.position = { ...target };
    if (visit.phase === "approaching") infoLine(0, now);
    else visit.phase = "idle";
  } else {
    visit.position = { x: visit.position.x + dx * step / distance, y: visit.position.y + dy * step / distance };
  }
}
function drawInfoSign() {
  const sign = infoStaffGeometry(state.layout).label;
  ctx.save();
  ctx.scale(TILE * SCALE, TILE * SCALE);
  ctx.translate(sign.x, sign.y);
  ctx.fillStyle = "#4a3524";
  ctx.fillRect(0, 0, sign.w, sign.h);
  ctx.lineWidth = .06;
  ctx.strokeStyle = "#b89b5c";
  ctx.strokeRect(.04, .04, sign.w - .08, sign.h - .08);
  ctx.fillStyle = "#d8b86d";
  for (const nail of [.2, sign.w - .2]) { ctx.beginPath(); ctx.arc(nail, .2, .07, 0, Math.PI * 2); ctx.fill(); }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#e9d9ae";
  fitFont("Click me for Info", .42, "Georgia, serif", sign.w - .5);
  ctx.fillText("Click me for Info", sign.w / 2, sign.h / 2 + .03);
  ctx.restore();
}

// The player sits just above-right of the jukebox in screen space, to its left when the right side has no room,
// and docks at the bottom-left of the scene when neither side fits (phone widths). Cheap, and only while open.
function placeMusicPanel() {
  if (!music?.panelOpen() || !state.camera || !state.viewport) return;
  const panel = $("music-panel");
  if (!panel) return;
  const box = jukeboxBounds(state.layout);
  const sign = jukeboxSignBounds(state.layout);
  const right = worldToScreen(state.camera, { x: box.x + box.w, y: sign.y });
  const left = worldToScreen(state.camera, { x: box.x, y: sign.y });
  const width = panel.offsetWidth || 0;
  const height = panel.offsetHeight || 0;
  const view = state.viewport;
  const gap = 10;
  let x, y;
  if (right.x >= 0 && right.x + gap + width <= view.width - 4) { x = right.x + gap; y = right.y - gap; }
  else if (left.x <= view.width && left.x - gap - width >= 4) { x = left.x - gap - width; y = left.y - gap; }
  else { x = 8; y = view.height - height - 8; }
  x = clamp(x, 4, Math.max(4, view.width - width - 4));
  y = clamp(y, 4, Math.max(4, view.height - height - 4));
  // The panel's parent is the scene wrap, where the canvas sits below the camera controls.
  const canvasRect = canvas.getBoundingClientRect();
  const sceneRect = panel.parentElement?.getBoundingClientRect?.() ?? canvasRect;
  const styleLeft = `${Math.round(canvasRect.left - sceneRect.left + x)}px`;
  const styleTop = `${Math.round(canvasRect.top - sceneRect.top + y)}px`;
  if (panel.style.left !== styleLeft) panel.style.left = styleLeft;
  if (panel.style.top !== styleTop) panel.style.top = styleTop;
}

function drawSurround() {
  const hall = hallBounds(), unit = TILE * SCALE;
  const size = canvasViewport();
  const visibleStart = screenToWorld(state.camera, { x: 0, y: 0 });
  const visibleEnd = screenToWorld(state.camera, { x: size.width, y: size.height });
  const left = hall.x, top = hall.y, right = left + hall.width, bottom = top + hall.height;
  const outerLeft = left - SURROUND_TILES, outerTop = top - SURROUND_TILES;
  const outerRight = right + SURROUND_TILES, outerBottom = bottom + SURROUND_TILES;
  // Disjoint bands exclude the hall; clip each to the visible world before generating any bricks.
  const bands = [
    [outerLeft, outerTop, left, outerBottom], [right, outerTop, outerRight, outerBottom],
    [left, outerTop, right, top], [left, bottom, right, outerBottom],
  ].map(([x1, y1, x2, y2]) => [Math.max(x1, visibleStart.x), Math.max(y1, visibleStart.y),
    Math.min(x2, visibleEnd.x), Math.min(y2, visibleEnd.y)])
    .filter(([x1, y1, x2, y2]) => x2 > x1 && y2 > y1);
  if (!bands.length) return;
  ctx.save();
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of bands) ctx.rect(x1 * unit, y1 * unit, (x2 - x1) * unit, (y2 - y1) * unit);
  ctx.clip();
  ctx.fillStyle = "#1a211e";
  ctx.strokeStyle = "#232c28";
  ctx.lineWidth = 1;
  for (const [x1, y1, x2, y2] of bands) {
    ctx.fillRect(x1 * unit, y1 * unit, (x2 - x1) * unit, (y2 - y1) * unit);
    for (let y = Math.floor(y1); y < y2; y++) {
      const offset = y % 2 ? -2 : 0;
      const start = offset + Math.floor((x1 - offset) / 4) * 4;
      for (let x = start; x < x2; x += 4) ctx.strokeRect(x * unit, y * unit, 4 * unit, unit);
    }
  }
  const fade = (fromX, fromY, toX, toY, x1, y1, x2, y2) => {
    x1 = Math.max(x1, visibleStart.x); y1 = Math.max(y1, visibleStart.y);
    x2 = Math.min(x2, visibleEnd.x); y2 = Math.min(y2, visibleEnd.y);
    if (x2 <= x1 || y2 <= y1) return;
    const gradient = ctx.createLinearGradient(fromX * unit, fromY * unit, toX * unit, toY * unit);
    gradient.addColorStop(0, "#100f1500");
    gradient.addColorStop(1, "#100f15");
    ctx.fillStyle = gradient;
    ctx.fillRect(x1 * unit, y1 * unit, (x2 - x1) * unit, (y2 - y1) * unit);
  };
  fade(left - 2, 0, outerLeft, 0, outerLeft, outerTop, left, outerBottom);
  fade(right + 2, 0, outerRight, 0, right, outerTop, outerRight, outerBottom);
  fade(0, top - 2, 0, outerTop, outerLeft, outerTop, outerRight, top);
  fade(0, bottom + 2, 0, outerBottom, outerLeft, bottom, outerRight, outerBottom);
  ctx.restore();
}

function drawRoom() {
  const layout = state.layout;
  const unit = TILE * SCALE;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, layout.backWall.y * unit, layout.width * unit, layout.backWall.h * unit);
  ctx.clip();
  ctx.fillStyle = "#28342f";
  ctx.fillRect(0, -6 * unit, layout.width * unit, 6 * unit);
  ctx.strokeStyle = "#3a4640";
  ctx.lineWidth = 1;
  for (let y = -6; y < 0; y++) {
    for (let x = (y % 2 ? -2 : 0); x < layout.width; x += 4) {
      ctx.strokeRect(x * unit, y * unit, 4 * unit, unit);
    }
  }
  ctx.fillStyle = "#6f6145";
  ctx.fillRect(0, -.18 * unit, layout.width * unit, .18 * unit);
  ctx.restore();
  drawHostBanner();
  drawWallPlaques();
  for (let y = 0; y < layout.height; y += 1) for (let x = 0; x < layout.width; x += 1) {
    const wall = x === 0 || y === 0 || x === layout.width - 1 || y === layout.height - 1;
    if (!drawTile(state.images.rpg, wall ? RPG.floor.wall : RPG.floor.wood, x, y)) {
      ctx.fillStyle = wall ? "#34313d" : ((x + y) % 2 ? "#67482f" : "#6d4d33");
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
  }
  stageDrawing.drawStageFloor(layout);
  state.data.tables.forEach((table, index) => {
    const rug = tableScenery(state.data, table, scenerySlot(table), layout, index, reducedMotion.matches).rug;
    if (!rug) return;
    const cell = layout.cells[index];
    const rect = rugRect(cell);
    if (rug < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x * unit, rect.y * unit, rect.w * rug * unit, rect.h * unit);
      ctx.clip();
    }
    drawNine(rect, RPG.rug, "#3d6b45");
    if (rug < 1) {
      ctx.restore();
      const edge = rect.x + rect.w * rug;
      ctx.fillStyle = "#2f5537";
      ctx.fillRect((edge - .225) * unit, rect.y * unit, .45 * unit, rect.h * unit);
      ctx.fillStyle = "#5f8f5f";
      ctx.fillRect((edge - .06) * unit, rect.y * unit, .12 * unit, rect.h * unit);
    }
  });

  const drops = [...state.people.values()].filter(runtime => runtime.trashAt != null)
    .map(runtime => (state.animationNow - runtime.trashAt) / 1000);
  foodCorner.drawFoodArea(layout, state.animationNow ?? 0, drops.length ? Math.min(...drops) : null);

  loungeDrawing.drawLoungeFloor(layout);

  if (layout.overflowSeats.length) {
    drawLabel("OVERFLOW SEATING", layout.width / 2, layout.tableGridBottom + 0.7, { size: 4, color: "#ffe0a0", background: "rgba(0,0,0,.55)" });
  }

  const doorOpen = state.door.isOpen(state.lastTime);
  if (!drawTile(state.images.rpg, doorOpen ? RPG.door.open : RPG.door.closed, layout.door.x, layout.door.y)) {
    ctx.fillStyle = doorOpen ? "#17131b" : "#bd8c55";
    ctx.fillRect(0, layout.door.y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
  }
  drawJukebox();
}

function drawMicrophone() {
  const { microphone } = stageGeometry(state.layout);
  const x = microphone.x * TILE * SCALE;
  const y = microphone.y * TILE * SCALE;
  ctx.fillStyle = "#201e29";
  ctx.fillRect(x - 7, y + 5, 14, 4);
  ctx.fillStyle = "#bbc2cb";
  ctx.fillRect(x - 1, y - 19, 3, 25);
  ctx.fillStyle = "#252936";
  ctx.fillRect(x - 5, y - 24, 10, 8);
  ctx.fillStyle = "#d8dce2";
  ctx.fillRect(x - 4, y - 23, 7, 3);
}

function chairFor(offset) {
  if (offset.overflow) return RPG.chairs.bottom;
  if (offset.y < 0) return RPG.chairs.top;
  if (offset.y > 0) return RPG.chairs.bottom;
  return offset.x < 0 ? RPG.chairs.left : RPG.chairs.right;
}


// Before doors every table is shown ready for its game (furniture and props, no crew): people wait at them.
function scenerySlot(table) { return upcoming() ? table.start : state.time; }

function rugRect(cell) { return { x: cell.x - .5, y: cell.y + .5, w: 6, h: 4 }; }

function drawTables() {
  state.data.tables.forEach((table, index) => {
    const cell = state.layout.cells[index];
    const firstSeat = seatPosition(index, 0);
    const lifecycle = tableLifecycle(state.data, table, scenerySlot(table));
    const scenery = tableScenery(state.data, table, scenerySlot(table), state.layout, index, reducedMotion.matches);
    const open = lifecycle.phase === "active";
    if (state.selectedId === table.id) {
      ctx.fillStyle = "rgba(255,210,122,.25)";
      const rect = rugRect(cell);
      ctx.fillRect(rect.x * TILE * SCALE, rect.y * TILE * SCALE, rect.w * TILE * SCALE, rect.h * TILE * SCALE);
    }
    for (const member of scenery.crew) drawStaff(member, `table-${cell.x}-${cell.y}-${member.member}`);
    const rugCarriers = scenery.crew.filter(member => member.load === "rug");
    const unit = TILE * SCALE;
    if (rugCarriers.length === 2) {
      const [a, b] = rugCarriers;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x * unit, a.y * unit - 8);
      ctx.lineTo(b.x * unit, b.y * unit - 8);
      ctx.lineCap = "round";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#3d6b45";
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#5f8f5f";
      ctx.stroke();
      ctx.restore();
    } else if (rugCarriers.length === 1) {
      const [carrier] = rugCarriers;
      ctx.fillStyle = "#3d6b45";
      ctx.fillRect(carrier.x * unit + 7, carrier.y * unit - 8, 22, 7);
    }
    if (!scenery.furniture) return;
    for (let column = 0; column < 3; column += 1) {
      if (!drawTile(state.images.rpg, RPG.table[column], firstSeat.tableX + column, firstSeat.tableY, false, open ? 1 : 0.45)) {
        ctx.globalAlpha = open ? 1 : 0.45;
        ctx.fillStyle = "#8d633e";
        ctx.fillRect((firstSeat.tableX + column) * TILE * SCALE, firstSeat.tableY * TILE * SCALE, TILE * SCALE, TILE * SCALE);
        ctx.globalAlpha = 1;
      }
    }
    for (const seat of scenery.chairs) {
      const position = seatPosition(index, seat);
      drawTile(state.images.rpg, chairFor(position.offset || position), position.x - 0.5, position.y - 0.5, false, open ? 1 : 0.45);
      if (!state.images.rpg) {
        ctx.fillStyle = open ? "#4c3427" : "#3b312d";
        ctx.fillRect((position.x - 0.28) * TILE * SCALE, (position.y - 0.28) * TILE * SCALE, .56 * TILE * SCALE, .56 * TILE * SCALE);
      }
    }
    if (scenery.props) drawTableProps(firstSeat.tableX, firstSeat.tableY);
    else if (scenery.map && state.camera.zoom >= 12) {
      ctx.fillStyle = "#d8c99f";
      ctx.fillRect(firstSeat.tableX * TILE * SCALE + 25, firstSeat.tableY * TILE * SCALE + 8, 37 * scenery.map, 19);
    }
    for (let chair = 0; chair < scenery.stacked; chair += 1) {
      ctx.fillStyle = "#bd955c";
      ctx.fillRect((firstSeat.tableX + 2.5) * TILE * SCALE, (firstSeat.tableY + 1.2) * TILE * SCALE - chair * 5, 16, 4);
    }
  });
}

function drawDice(index, view) {
  if (!view || state.camera.zoom < 12) return;
  const seat = seatPosition(index, 0);
  const unit = TILE * SCALE;
  for (const die of view.dice) {
    ctx.save();
    ctx.translate((seat.tableX + .55) * unit + die.x * 23, (seat.tableY + .45) * unit + die.y * 17);
    ctx.rotate(die.angle);
    ctx.fillStyle = "#f7efd8"; ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = "#201c27"; ctx.font = "bold 9px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(die.face), 0, 0);
    ctx.restore();
  }
  drawLabel(`${view.event.roll.expression} = ${view.event.roll.total}`, seat.tableX + 1.5, seat.tableY + 2.25,
    { size: 4, color: "#fff2cd" });
}

function drawStaff(staff, station = "caretaker") {
  state.staffFrames ??= new Map();
  const prev = state.staffFrames.get(station);
  const dx = prev ? staff.x - prev.x : 0, dy = prev ? staff.y - prev.y : 0;
  staff = { ...staff, moving: staff.moving ?? Math.hypot(dx, dy) > .002,
    facing: staff.facing ?? (Math.abs(dx) > .002 ? Math.sign(dx) : prev?.facing ?? 1) };
  state.staffFrames.set(station, staff);
  const unit = TILE * SCALE;
  const x = staff.x * unit, y = staff.y * unit;
  const appearance = staffAppearance(state.data.event.start, station);
  const spriteX = staff.x - .5, spriteY = staff.y - .6;
  const phase = [...station].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 997, 0) / 997;
  const motion = foodCorner.bodyMotion(phase, !!staff.moving, state.animationNow ?? 0);
  const staffFlip = (staff.facing ?? 1) < 0 !== !!motion.look;
  ctx.save();
  foodCorner.applyMotion(ctx, motion, spriteX, spriteY);
  const drawn = drawTile(state.images.characters, [0, SPRITES.skin[appearance.skin]], spriteX, spriteY, staffFlip);
  if (drawn) {
    drawTile(state.images.characters, SPRITES.shirts[appearance.shirt], spriteX, spriteY, staffFlip);
    drawTile(state.images.characters, SPRITES.hair[appearance.hair], spriteX, spriteY, staffFlip);
  }
  ctx.restore();
  if (staff.carrying) foodCorner.drawCarried(staff.carrying, staff.x, staff.y, staff.facing ?? 1);
  if (!drawn) {
    // Retain a visible staff figure when the character sheet cannot load.
    ctx.fillStyle = "#d8c7a6"; ctx.fillRect(x - 5, y - 20, 10, 9);
    ctx.fillStyle = "#73afb5"; ctx.fillRect(x - 7, y - 25, 14, 5);
    ctx.fillRect(x - 7, y - 11, 14, 14);
    ctx.fillStyle = "#23232d"; ctx.fillRect(x - 6, y + 3, 5, 7); ctx.fillRect(x + 1, y + 3, 5, 7);
  }
  if (staff.load && staff.load !== "food" && staff.load !== "rug") {
    ctx.fillStyle = staff.load === "map" ? "#d8c99f" : "#bd955c";
    ctx.fillRect(x + 7, y - 8, staff.load === "table" ? 22 : 10, staff.load === "chairs" ? 15 : 7);
  }
  if (state.camera.zoom >= 25) drawLabel("STAFF", staff.x, staff.y - 1.1, { size: 3, color: "#bde8ed" });
}

function drawTableProps(x, y) {
  if (state.camera.zoom < 12) return;
  const unit = TILE * SCALE;
  ctx.save();
  ctx.translate(x * unit, y * unit);
  // Authored geometric props need no external art or new timeline facts.
  ctx.fillStyle = "#eee0b9"; ctx.fillRect(25, 8, 37, 19);
  ctx.strokeStyle = "#a79972"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) { ctx.beginPath(); ctx.moveTo(28 + i * 9, 8); ctx.lineTo(28 + i * 9, 27); ctx.stroke(); }
  ctx.fillStyle = "#443450"; ctx.fillRect(4, 3, 15, 21); // GM screen
  ctx.fillStyle = "#bd955c"; ctx.fillRect(72, 9, 17, 17); // dice tray
  ctx.fillStyle = "#453129"; ctx.fillRect(74, 11, 13, 13);
  if (state.camera.zoom >= 36) {
    ctx.fillStyle = "#fff2d1"; ctx.fillRect(77, 14, 5, 5); ctx.fillRect(58, 3, 9, 5);
    ctx.fillStyle = "#813c35"; ctx.fillRect(3, 25, 11, 5); // book
    ctx.fillStyle = "#84aab4"; ctx.fillRect(39, 15, 4, 4); ctx.fillRect(51, 21, 4, 4);
    ctx.fillStyle = "#ddc492"; ctx.fillRect(65, 23, 5, 6); // mug
  }
  ctx.restore();
}

// Word-wraps text to maxWidth in the current font; the last kept line ends in an ellipsis when cut.
function wrapText(text, maxWidth, maxLines) {
  const lines = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    if (lines.length && ctx.measureText(next).width <= maxWidth) lines[lines.length - 1] = next;
    else lines.push(word);
  }
  if (lines.length <= maxLines) return lines;
  let last = lines[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  return [...lines.slice(0, maxLines - 1), `${last.trimEnd()}…`];
}

function drawTableLabels() {
  const dpr = globalThis.devicePixelRatio || 1;
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const boxes = [];
  // The hovered and selected tables carry a name plate; the projector labels every table. A plate is no
  // wider than its table, so neighbours sit side by side; one that would still overlap an earlier plate
  // is skipped, which keeps the hovered and selected plates when the overview is crowded.
  const selected = state.data.tables.findIndex((table) => table.id === state.selectedId);
  const everyTable = state.kiosk ? state.data.tables.map((_, i) => i) : [];
  const indices = [...new Set([state.hoverTable, selected, ...everyTable])].filter((i) => i >= 0 && state.data.tables[i]);
  const DETAIL = "12px system-ui, sans-serif";
  // A plate stays in the empty floor between its own top seats and the table above: that table's bottom
  // seats and roll label end 1.4 tiles above this cell, so no plate covers another table's seats or players.
  const band = (.6 + 1.35) * state.camera.zoom;
  for (const index of indices) {
    const table = state.data.tables[index];
    const cell = state.layout.cells[index];
    // The plate hangs just above its own table's top row of seats, so it reads as that table's sign.
    const point = worldToScreen(state.camera, { x: seatPosition(index, 0).tableX + 1.5, y: cell.y + .6 });
    if (point.x < 0 || point.x > state.viewport.width || point.y < 18 || point.y > state.viewport.height) continue;
    const lifecycle = tableLifecycle(state.data, table, scenerySlot(table));
    // A game that has ended takes its plate down.
    if (lifecycle.phase === "cleaning" || lifecycle.phase === "inactive") continue;
    const status = lifecycle.phase === "active" ? `${Math.max(0, table.seats - table.signups.length)} seats left` : lifecycle.label;
    const details = [status];
    if (state.camera.zoom >= 25) details.push(`${formatSlot(table.start)}–${formatSlot(table.end)}`);
    // The taller whole-room frame needs the full cell band for projector plates, with
    // a two-pixel gap between neighbours. Elsewhere a lone plate may be wider.
    const maxWidth = Math.min(state.viewport.width - 8, Math.max(state.kiosk ? 60 : 160, Math.min(260, state.layout.cellWidth * state.camera.zoom - (state.kiosk ? 2 : 8))));
    // A plate too tall for the band sheds the times, the third title line, the status, the second title
    // line, then shrinks its lettering; one that still does not fit is left off.
    let lines = 3, size = 13, title, height;
    for (;;) {
      ctx.font = `700 ${size}px Georgia, serif`;
      title = wrapText(table.name, maxWidth - 16, lines);
      height = 6 + title.length * (size + 3) + details.length * 15;
      if (height <= band) break;
      if (details.length > 1) details.pop();
      else if (lines > 2) lines = 2;
      else if (details.length) details.pop();
      else if (lines > 1) lines = 1;
      else if (size > 9) size -= 1;
      else break;
    }
    if (height > band) continue;
    const TITLE = ctx.font;
    const titleWidth = Math.max(...title.map((line) => ctx.measureText(line).width));
    ctx.font = DETAIL;
    const detailWidth = Math.max(...details.map((line) => ctx.measureText(line).width));
    const width = Math.min(maxWidth, Math.max(titleWidth, detailWidth) + 16);
    const left = clamp(point.x - width / 2, 4, state.viewport.width - width - 4);
    const top = Math.max(4, point.y - height);
    if (boxes.some((box) => left < box.x + box.w && left + width > box.x && top < box.y + box.h && top + height > box.y)) continue;
    boxes.push({ x: left, y: top, w: width, h: height, index });
    // Styled like the wall plaques: dark wood, a brass edge, parchment lettering.
    ctx.fillStyle = "#4a3524"; ctx.fillRect(left, top, width, height);
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#b89b5c"; ctx.strokeRect(left + .75, top + .75, width - 1.5, height - 1.5);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = TITLE; ctx.fillStyle = table.id === state.selectedId ? "#ffd27a" : "#e9d9ae";
    title.forEach((line, n) => ctx.fillText(line, left + width / 2, top + 3 + n * (size + 3), width - 8));
    ctx.font = DETAIL;
    details.forEach((line, n) => {
      ctx.fillStyle = n === 0 ? "#c9b98a" : "#d8b86d";
      ctx.fillText(line, left + width / 2, top + 4 + title.length * (size + 3) + n * 15, width - 8);
    });
  }
  state.labelBoxes = boxes;
  ctx.restore();
}

function drawPerson(runtime, now, active) {
  const person = runtime.person;
  const place = runtime.place;
  let x = runtime.position.x - 0.5;
  const loungeSeat = place.kind === "lounge" && !runtime.moving && place.position?.seated;
  let y = runtime.position.y - 0.6 + (loungeSeat ? .1 : 0) + (place.foodPhase === "eating" && !runtime.moving && !place.position?.standing ? .15 : 0);
  const seated = ((place.foodPhase === "eating" || place.foodPhase === "seating") && !runtime.moving) || loungeSeat;
  const motion = foodCorner.bodyMotion(runtime.phase, runtime.moving, now, seated || place.kind === "table");
  const cheering = active.spotlight && place.kind !== "spotlight" && !place.kind.startsWith("stage-") && !reducedMotion.matches;
  const social = place.activity === "chatting" || place.activity === "cards";
  const talkTime = social ? state.time * state.data.event.slot_minutes * 60 : now / 1000;
  const talk = (place.kind === "table" || social) && !runtime.moving && !reducedMotion.matches && ((talkTime + runtime.phase * 6) % 6) < 0.5;
  y -= (cheering ? Math.abs(Math.sin(now / 160 + runtime.phase * 8)) * 0.25 : 0);
  let facing = runtime.facing;
  if ((seated || (place.kind === "lounge" && !runtime.moving)) && place.position?.facing) facing = place.position.facing;
  const plateFacing = facing;
  if (motion.look && !active.announce && !cheering) facing = -facing;
  if (active.announce && !runtime.moving) facing = state.layout.stageFront.x < runtime.position.x ? -1 : 1;
  if (place.kind === "stage-speaker" && !runtime.moving) facing = 1;
  const flip = facing < 0;
  const frame = talk || cheering || (place.kind === "stage-speaker" && state.speech?.phase === "speaking") ? 1 : 0;
  const appearance = characterAppearance(person);
  ctx.save();
  foodCorner.applyMotion(ctx, motion, x, y);
  if (appearance === null) {
    if (!drawTile(state.images.characters, [frame, 1], x, y, flip, 0.85)) {
      ctx.fillStyle = "#292832";
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
    drawTile(state.images.characters, [16, 7], x, y, flip, 0.85);
  } else {
    if (!drawTile(state.images.characters, [frame, SPRITES.skin[appearance.skin]], x, y, flip)) {
      const colors = ["#9e6d50", "#d49b6a", "#6b8fb5", "#9f70ad", "#61a178", "#b06d6d", "#cfaa4d", "#578d98", "#866fbd", "#b37f53", "#6a9b62", "#a85c86", "#6981bd", "#c27c55", "#7d9562"];
      ctx.fillStyle = colors[visibleVariant(person, PALETTE_SIZE)];
      ctx.fillRect(x * TILE * SCALE, y * TILE * SCALE, TILE * SCALE, TILE * SCALE);
    }
    drawTile(state.images.characters, SPRITES.shirts[appearance.shirt], x, y, flip);
    drawTile(state.images.characters, SPRITES.hair[appearance.hair], x, y, flip);
    if (person.dm) drawTile(state.images.characters, SPRITES.hats[appearance.hat], x, y - 0.15, flip);
  }
  ctx.restore();
  if (loungeSeat) loungeDrawing.drawSeatFront(place.position.front);
  if (place.plate) {
    const plate = foodCorner.realPlate(place, runtime.ordinal, runtime.moving);
    runtime.dishPops ??= [];
    plate.items.forEach((item, i) => {
      runtime.dishPops[i] ??= now;
      item.pop = (now - runtime.dishPops[i]) / 1000;
    });
    runtime.dishPops.length = plate.items.length;
    if (place.foodPhase === "trash" && !runtime.moving && !reducedMotion.matches) {
      plate.toward = foodGeometry(state.layout).bin;
      plate.drop = Math.min(1, (now - runtime.trashAt) / 650);
    }
    if (plate && place.foodPhase === "eating" && !runtime.moving && !reducedMotion.matches && (now / 1000 + runtime.phase * 5) % 5 < .6) { plate.mode = "held"; plate.lift = true; }
    const drawPlate = () => foodCorner.drawPlate(plate, runtime.position.x, runtime.position.y, plateFacing, now);
    if (plate.mode === "table") state.foodPlates.push(drawPlate);
    else drawPlate();
  } else runtime.dishPops = [];
  if (place.activity === "reading" && !runtime.moving) loungeDrawing.drawBook(runtime.position.x, y + .6, plateFacing, now, runtime.phase);
  if (place.kind === "spotlight" && !runtime.moving) drawLabel("★", x + 0.5, y - 0.55, { size: 6, color: "#ffd84a", background: false });
  if (cheering && ((now / 400 + runtime.phase * 3) % 3) < 1) drawLabel("♥", x + 0.5 + runtime.phase * 0.4, y - 0.6, { size: 4, color: "#ff7a9a", background: false });
  if (active.announce && !runtime.moving && ((runtime.phase * 7) % 1) < 0.35) drawLabel("!", x + 0.9, y - 0.35, { size: 4, color: "#ffe066", background: false });
  // The hovered name is drawn after the table plates (drawHoverName), so a plate never covers it.
  if (state.hover === runtime && !person.hidden) state.hoverName = { person, x: x + 0.5, y: y - 0.55 };
}

function drawHoverName() {
  if (!state.hoverName) return;
  const { person, x, y } = state.hoverName;
  drawLabel(`${person.dm ? "DM " : ""}${person.name}`, x, y, { size: 3.6, bold: person.dm, color: person.dm ? "#ffd27a" : "#fff", background: person.dm ? "rgba(60,30,0,.86)" : "rgba(0,0,0,.76)" });
}

function drawBubble(value, x, y, color, label = "", hint = "") {
  const anchor = worldToScreen(state.camera, { x, y });
  ctx.save();
  const dpr = globalThis.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const size = 13;
  ctx.font = `${size}px ui-monospace, monospace`;
  const text = label ? `${label}: ${value}` : value;
  const words = text.split(/\s+/u);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > Math.min(360, state.viewport.width - 30)) { lines.push(current); current = word; }
    else current = next;
  }
  if (current || lines.length === 0) lines.push(current);
  if (hint) lines.push(hint);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 20) + 4 * SCALE;
  const height = lines.length * (size + SCALE) + 3 * SCALE;
  let left = anchor.x - width / 2;
  left = clamp(left, 2 * SCALE, state.viewport.width - width - 2 * SCALE);
  const top = clamp(anchor.y - height, 2 * SCALE, state.viewport.height - height - 4 * SCALE);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#222";
  ctx.lineWidth = SCALE;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 3 * SCALE);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(clamp(anchor.x, left + 8, left + width - 8) - 2 * SCALE, top + height);
  ctx.lineTo(clamp(anchor.x, left + 8, left + width - 8), top + height + 3 * SCALE);
  ctx.lineTo(clamp(anchor.x, left + 8, left + width - 8) + 2 * SCALE, top + height);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    if (hint && index === lines.length - 1) ctx.fillStyle = "#6b6b6b";
    ctx.fillText(line, left + 2 * SCALE, top + 1.5 * SCALE + index * (size + SCALE));
  });
  ctx.restore();
  return { x: left, y: top, w: width, h: height };
}

function drawEvents(active, now, announcer) {
  const front = state.layout.stageFront;
  // Staff speech shares the speech layer, above the table plates.
  if (announcer?.speaking && announcer.event.kind === "break") {
    const item = announcer.event;
    drawBubble(`Break time! Back at ${formatSlot(item.at + item.duration)}.`,
      announcer.x, announcer.y - 1.3, "#b6e0df", "Staff");
  }
  if (active.spotlight) {
    ctx.save();
    ctx.globalAlpha = .28;
    ctx.fillStyle = "#fff4b0";
    ctx.beginPath();
    ctx.moveTo(front.x * TILE * SCALE, (front.y - 6) * TILE * SCALE);
    ctx.lineTo((front.x - 2.2) * TILE * SCALE, (front.y + .9) * TILE * SCALE);
    ctx.lineTo((front.x + 2.2) * TILE * SCALE, (front.y + .9) * TILE * SCALE);
    ctx.closePath(); ctx.fill(); ctx.restore();
    const person = state.data.people.find((candidate) => candidate.id === active.spotlight.person);
    const reason = active.spotlight.text ? ` ${active.spotlight.text}` : "";
    drawBubble(`${displayName(person)} in the spotlight!${reason}`, front.x, front.y - 2.2, "#fff3c4");
  }
  if (announcer?.speaking && announcer.event.kind === "announce") {
    drawBubble(announcer.event.text, announcer.x, announcer.y - 2.2, "#fff", "Staff");
  }
  if (announcer?.speaking && announcer.event.kind === "meal") {
    drawBubble(announcer.event.text || "Food is served in the food corner!", announcer.x, announcer.y - 1.3, "#d6f5c9", "Staff");
  }
  if (active.break) drawLabel("BREAK — everyone to the lounge", state.layout.width / 2, state.layout.height - .5, { size: 4.5, bold: true, color: "#1b1a22", background: "#ffd27a" });
  if (active.meal) drawLabel(`${active.meal.text || "MEAL"} — food service`, state.layout.width / 2, state.layout.height - .5, { size: 4.5, bold: true, color: "#1b1a22", background: "#9fe08a" });

  if (state.speech?.phase === "speaking") {
    const view = speechView(state.data, state.speech.event, state.time, active,
      state.speech.event.practice ? state.locations.get(state.speech.event.person) ?? null : null);
    let position = state.layout.stageFront;
    const custom = view.kind === "donation";
    if (!custom && !view.stageSide) {
      const runtime = state.people.get(state.speech.event.person);
      if (runtime?.visible) position = runtime.position;
    }
    const color = view.kind === "donation" ? "#ffdd72" : "#eef3d5";
    drawBubble(view.text, position.x, position.y - 1.2, color, custom ? displayName(view.person) : view.stageSide ? view.label : "");
    if (view.kind === "donation" && !reducedMotion.matches) {
      for (let index = 0; index < 5; index += 1) {
        const angle = now / 380 + index * Math.PI * 2 / 5;
        drawLabel("★", position.x + Math.cos(angle) * (1.2 + index * .08), position.y - 1.5 + Math.sin(angle) * .8, { size: 4, color: "#fff0a2", background: false });
      }
    }
  }
}

function updateFoodScene(now) {
  state.animationNow = now;
  for (const runtime of state.people.values()) {
    if (runtime.visible && runtime.place?.foodPhase === "trash" && !runtime.moving) runtime.trashAt ??= now;
    else runtime.trashAt = null;
  }
  state.foodScene = { count: state.ambience.foodCount };
}

function caretakerForFrame() {
  let staff = state.ambience.staff;
  if (!staff) { state.staffPrevious = null; return null; }
  const prev = state.staffPrevious;
  const dx = prev ? staff.x - prev.x : 0, dy = prev ? staff.y - prev.y : 0;
  staff = { ...staff, moving: Math.hypot(dx, dy) > .002,
    facing: Math.abs(dx) > .002 ? Math.sign(dx) : prev?.facing ?? 1,
    carrying: staff.carrying != null ? foodCorner.DISHES[staff.carrying]
      : staff.load === "food" ? foodCorner.DISHES[0] : null };
  state.staffPrevious = staff;
  return staff;
}

function announcerForFrame() {
  return upcoming() ? null : stageAnnouncer(state.data, state.time, state.layout, reducedMotion.matches);
}

function render(now, active) {
  const announcer = announcerForFrame();
  advanceInfoStaff(now, active, announcer);
  const gathering = gatheringScene();
  if (gathering) {
    state.ambience = gatheringAmbience(state.practiceData, state.layout,
      practiceNow(state.practiceSession, wallNow()), reducedMotion.matches);
  } else {
    const ambienceSlot = state.clock.mode === "follow-now" ? Math.max(state.time,
      (wallNow() - Date.parse(state.data.event.start)) / (state.data.event.slot_minutes * 60000)) : state.time;
    state.ambience = hallAmbience(state.data, ambienceSlot, state.layout, reducedMotion.matches);
  }
  updateFoodScene(now);
  updateDrawerInset(now);
  updateCamera(announcer);
  if (!ctx) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const fullSize = canvasViewport();
  const width = Math.round(fullSize.width * dpr);
  const height = Math.round(fullSize.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const scale = dpr * state.camera.zoom / (TILE * SCALE);
  ctx.setTransform(scale, 0, 0, scale, state.camera.x * dpr, state.camera.y * dpr);
  drawSurround();
  ctx.imageSmoothingEnabled = false;
  drawRoom();
  drawTables();
  state.hoverName = null;
  state.foodPlates = [];
  const drawables = [...state.people.values()].filter(person => person.visible && !person.entering)
    .map(person => ({ y: !person.moving && person.place.kind === "lounge" ? person.place.position?.depth ?? person.position.y : person.position.y, draw: () => drawPerson(person, now, active) }));
  drawables.push(...loungeDrawing.loungeDepthItems(state.layout, now, state.leisure));
  drawables.push(...foodCorner.foodDepthItems(state.layout, now, state.foodScene.count, state.clock.mode === "replay" || state.clock.mode === "follow-now"));
  const caretaker = caretakerForFrame();
  const food = state.layout.food;
  const caretakerInFood = caretaker && caretaker.x >= food.x && caretaker.x < food.x + food.w
    && caretaker.y >= food.y - 1 && caretaker.y < food.y + food.h + .5;
  if (caretakerInFood) drawables.push({ y: caretaker.y, draw: () => drawStaff(caretaker) });
  if (announcer) drawables.push({ y: announcer.y, draw: () => drawStaff(announcer, "announcer") });
  if (!state.kiosk && infoStaffGeometry(state.layout)) {
    const position = infoPosition();
    drawables.push({ y: position.y, draw: () => drawStaff(position, "info") });
  }
  drawables.sort((a, b) => a.y - b.y).forEach(item => item.draw());
  state.foodPlates.forEach(draw => draw());
  if (!gathering) state.data.tables.forEach((table, index) => {
    if (tableLifecycle(state.data, table, state.time).phase === "active") {
      drawDice(index, diceAt(state.data, table.id, state.time, reducedMotion.matches));
    }
  });
  stageDrawing.drawStageLights(state.layout, now);
  drawMicrophone();
  // Dim only the room artwork; controls, table details and speech remain readable.
  const lights = [...state.people.values()].some(person => person.visible) && state.ambience.foodCount === 6
    ? Math.max(.85, state.ambience.lights) : state.ambience.lights;
  ctx.fillStyle = `rgba(4, 7, 20, ${(1 - lights) * .76})`;
  ctx.fillRect(0, 0, state.layout.width * TILE * SCALE, state.layout.height * TILE * SCALE);
  if (caretaker && !caretakerInFood) drawStaff(caretaker);
  const lightSwitch = state.ambience.lightSwitch;
  ctx.fillStyle = lights > .5 ? "#fff3ac" : "#697a9d";
  ctx.fillRect((lightSwitch.x - .8) * TILE * SCALE, (lightSwitch.y - .7) * TILE * SCALE, 6, 10);
  drawTableLabels();
  drawHoverName();
  drawEvents(active, now, announcer);
  state.infoBubble = null;
  if (!state.kiosk && infoStaffGeometry(state.layout)) {
    if (!infoRunning()) drawInfoSign();
    else if (state.infoVisit.phase === "speaking") {
      const { x, y } = infoPosition();
      const last = state.infoVisit.line === infoSpeech().length - 1;
      state.infoBubble = drawBubble(infoSpeech()[state.infoVisit.line], x, y - 2.2, "#fff", "Staff", last ? INFO_FINISH_HINT : INFO_CONTINUE_HINT);
    }
  }
  placeMusicPanel();
}

function actualText(actual) {
  if (!actual) return "not recorded";
  return `${actual[0] === null ? "?" : formatSlot(actual[0])}–${actual[1] === null ? "?" : formatSlot(actual[1])}`;
}

function renderDetail(focus = false) {
  const panel = $("detail");
  panel.replaceChildren();
  state.detailPhaseNode = null;
  state.detailDiceNode = null;
  const table = state.data.tables.find((candidate) => candidate.id === state.selectedId);
  if (!table) {
    append(panel, "h2", "Table details");
    append(panel, "p", "Select a table in the hall or in the table list.", "muted");
    return;
  }
  const view = tableView(state.data, table);
  const heading = append(panel, "h2", view.name);
  heading.tabIndex = -1;
  append(panel, "p", view.system, "system");
  append(panel, "p", view.pitch);
  state.detailPhaseNode = append(panel, "p", phaseText(table), "table-phase");
  state.detailDiceNode = append(panel, "p", diceText(state.data, diceAt(state.data, table.id, state.time)?.event), "dice-result");
  append(panel, "p", `DM ${view.dm}`);
  append(panel, "p", `${formatSlot(view.start, true)}–${formatSlot(view.end, true)} · ${view.signupCount}/${view.seats} signups${view.walkIns ? " · walk-ins welcome" : ""}`, "muted");
  if (state.archive) append(panel, "p", "Saved roster for this event.", "muted");
  append(panel, "h3", "Roster");
  const list = append(panel, "ul");
  if (view.roster.length === 0) append(list, "li", "No signups yet.", "muted");
  for (const person of view.roster) append(list, "li", `${person.name}: planned ${formatSlot(person.planned[0])}–${formatSlot(person.planned[1])}; actual ${actualText(person.actual)}`);
  if (focus) heading.focus();
}

function setDrawer(view) {
  if (state.kiosk) return;
  if (state.drawer !== view) state.drawer = view;
  const drawer = $("hall-sidebar");
  if (drawer.getAttribute("data-view") !== view) {
    if (view === null) drawer.removeAttribute("data-view");
    else drawer.setAttribute("data-view", view);
  }
  const expanded = String(view === "activity");
  if ($("activity-toggle").getAttribute("aria-expanded") !== expanded) $("activity-toggle").setAttribute("aria-expanded", expanded);
  const label = view === "activity" ? "Close activity" : "Close table details";
  if ($("drawer-close").getAttribute("aria-label") !== label) $("drawer-close").setAttribute("aria-label", label);
}

function closeDrawer() {
  const view = state.drawer;
  if (!view) return;
  const restoreFocus = $("hall-sidebar").contains(document.activeElement);
  if (view === "detail") selectTable(null);
  else setDrawer(null);
  const activityReturn = state.view === "mobile" && $("camera-controls").getAttribute("data-open") === null
    ? $("camera-toggle") : $("activity-toggle");
  if (restoreFocus) (view === "detail" ? canvas : activityReturn).focus();
}

function drawerKeydown(event) {
  if (event.key !== "Escape" || !state.drawer) return;
  closeDrawer();
  event.preventDefault();
}

// Selecting shows the details; only a double click in the hall (or the table list) also zooms to the table.
function selectTable(id, focus = false, zoom = false) {
  state.selectedId = id;
  state.manualSelection = true;
  const index = state.data.tables.findIndex((table) => table.id === id);
  if (zoom && index >= 0) frameTables([index], true);
  // Reveal the heading before renderDetail tries to focus it from the table list.
  setDrawer(id === null ? null : "detail");
  renderDetail(focus && state.selectedId !== null);
}

function renderAttendees() {
  const list = $("attendees");
  if (!list) return;
  list.replaceChildren();
  const dms = new Set(state.data.tables.map(table => table.dm));
  const players = new Set(state.data.tables.flatMap(table => table.signups.map(signup => signup.person)));
  const visitors = new Set(state.data.visitors.people);
  // The validated people collection has one record per person, even across roles.
  const people = [...state.data.people].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  $("attendees-heading").textContent = `Attendees (${people.length})`;
  for (const person of people) {
    const row = append(list, "li");
    append(row, "span", displayName(person));
    if (person.hidden) continue;
    const role = person.dm || dms.has(person.id) ? "DM"
      : players.has(person.id) ? "Player"
      : visitors.has(person.id) ? "Visitor" : "Attendee";
    append(row, "span", role, "attendee-role");
  }
  if (!people.length) append(list, "li", "No attendees yet.", "muted");
}

function renderTableList() {
  const host = $("tables");
  host.replaceChildren();
  state.tablePhaseNodes.clear();
  state.tableDiceNodes.clear();
  renderAttendees();
  if (state.data.tables.length === 0) { append(host, "p", "No tables have been posted.", "muted"); return; }
  const grid = append(host, "div", undefined, "table-grid");
  for (const table of state.data.tables) {
    const view = tableView(state.data, table);
    const article = append(grid, "article", undefined, "table-card");
    const heading = append(article, "h3");
    const button = append(heading, "button", view.name);
    button.type = "button";
    button.setAttribute("aria-label", `Show details for ${view.name}`);
    button.addEventListener("click", () => selectTable(table.id, true, true));
    append(article, "p", `${view.system} — ${view.pitch}`);
    state.tablePhaseNodes.set(table.id, append(article, "p", phaseText(table), "table-phase"));
    const diceNode = append(article, "p", diceText(state.data, diceAt(state.data, table.id, state.time)?.event), "dice-result");
    diceNode.setAttribute("aria-live", "polite");
    diceNode.setAttribute("aria-atomic", "true");
    state.tableDiceNodes.set(table.id, diceNode);
    const details = append(article, "dl");
    append(details, "dt", "DM"); append(details, "dd", view.dm);
    append(details, "dt", "Window"); append(details, "dd", `${formatSlot(view.start, true)}–${formatSlot(view.end, true)}`);
    append(details, "dt", "Signups"); append(details, "dd", `${view.signupCount}/${view.seats}${view.walkIns ? "; walk-ins welcome" : ""}`);
    if (state.archive) append(article, "p", "Saved roster for this event.", "muted");
    append(article, "p", "Roster", "muted");
    const roster = append(article, "ul", undefined, "roster");
    if (view.roster.length === 0) append(roster, "li", "No signups yet.");
    for (const person of view.roster) append(roster, "li", `${person.name}: planned ${formatSlot(person.planned[0])}–${formatSlot(person.planned[1])}; actual ${actualText(person.actual)}`);
  }
}

function updateHeader(active) {
  const activityCounts = { reading: 0, chatting: 0, cards: 0 };
  for (const person of state.leisure.values()) activityCounts[person.activity] += 1;
  const seatedCount = [...state.leisure.values()].filter(a => a.position.seated).length;
  const standingCount = state.leisure.size - seatedCount;
  const loungeDescription = `Lounge: ${activityCounts.reading} reading, ${activityCounts.chatting} chatting, ${activityCounts.cards} playing cards; ${seatedCount} seated, ${standingCount} standing. Food: ${state.diners.length} collecting, eating or clearing plates.`;
  const staffAction = active.break ? "Staff are announcing the break from the stage." : state.ambience?.action ?? "";
  const hostSuffix = state.data.event.host_name ? ` Hosted by ${state.data.event.host_name}.` : "";
  const upcomingNow = upcoming();
  const start = Date.parse(state.data.event.start);
  const gathered = state.gatheredCount;
  const gatheredSentence = gathered === 0 ? "Nobody has arrived yet." : `${gathered} ${gathered === 1 ? "person has" : "people have"} gathered so far.`;
  const plaqueSentence = state.archive ? "" : ` ${PLAQUE_SENTENCE}`;
  const description = (upcomingNow ? `${staffAction} ${gatheredSentence}` : `${hallDescription} ${staffAction} ${loungeDescription}`).trim() + plaqueSentence + ` ${JUKEBOX_SENTENCE}` + (state.kiosk ? "" : ` ${INFO_STAFF_SENTENCE}`) + hostSuffix;
  if ($("canvas-description").textContent !== description) $("canvas-description").textContent = description;
  // Two parts joined here, so the wording does not depend on the ICU version's date-time connector.
  const doorsText = `${formatDate(start, { weekday: "long", month: "long", day: "numeric" })}, ${formatDate(start, { hour: "numeric", minute: "2-digit" })}`;
  // The visible doors clock uses the short date in every layout.
  const doorsClockText = `${formatDate(start, { weekday: "short", month: "short", day: "numeric" })}, ${formatDate(start, { hour: "numeric", minute: "2-digit" })}`;
  const clockText = upcomingNow ? doorsClockText : formatSlot(state.time, true);
  if ($("clock").textContent !== clockText) $("clock").textContent = clockText;
  const clockStamp = upcomingNow ? state.data.event.start : "";
  if ($("clock").dateTime !== clockStamp) $("clock").dateTime = clockStamp;
  const countdown = upcomingNow ? countdownText(start - wallNow()) : "";
  const eventLabel = upcomingNow ? countdown : active.spotlight ? "SPOTLIGHT" : active.announce ? "ANNOUNCEMENT" : active.break ? "BREAK" : active.meal ? (active.meal.text || "MEAL").toUpperCase() : "";
  if ($("scene-event").textContent !== eventLabel) $("scene-event").textContent = eventLabel;
  let eventText = accessibleEventText(state.data, active, state.speech?.phase === "speaking" ? state.speech.event : null);
  if (state.speech?.event.kind === "donation" && state.speech.phase === "approaching") {
    eventText += ` ${displayName(state.people.get(state.speech.event.person)?.person)} is walking to the stage microphone.`;
  }
  if (state.stageQueue.length) eventText += ` ${state.stageQueue.length} waiting to speak at the stage.`;
  if (upcomingNow) eventText = `Doors open ${doorsText}. ${countdown}.`;
  eventText = eventText.trim();
  if ($("current-event").textContent !== eventText) $("current-event").textContent = eventText;
  $("scrubber").value = String(state.time);
  const following = state.clock.mode === "follow-now";
  $("play").textContent = state.clock.mode === "paused" || upcomingNow ? "Play" : "Pause";
  $("play").disabled = false;
  $("scrubber").disabled = false;
  $("speed").disabled = following;
  const canFollow = state.clock.source === "live" && state.data.phase === "live";
  $("return-now").hidden = !canFollow || following || upcomingNow;
  // Before doors, now lies outside the scrubber's range, so the marker would mislead.
  const nowInRange = canFollow && !upcomingNow && !beforeDoors();
  $("now-marker").hidden = !nowInRange;
  if (nowInRange) $("now-marker").textContent = `Now: ${formatDate(wallNow(), { hour: "numeric", minute: "2-digit" })}`;
  const badge = $("mode-badge");
  badge.textContent = upcomingNow ? "UPCOMING" : following ? (state.time >= state.data.event.slots ? "EVENT ENDED" : "LIVE") : state.clock.mode === "paused" ? "PAUSED" : "REPLAY";
  badge.className = `badge${following ? " live" : ""}`;
  if (badge.hidden !== upcomingNow) badge.hidden = upcomingNow;
  for (const table of state.data.tables) {
    const text = phaseText(table);
    const result = diceText(state.data, diceAt(state.data, table.id, state.time)?.event);
    const diceNode = state.tableDiceNodes.get(table.id);
    if (diceNode && diceNode.textContent !== result) diceNode.textContent = result;
    if (state.selectedId === table.id && state.detailDiceNode && state.detailDiceNode.textContent !== result) state.detailDiceNode.textContent = result;
    const node = state.tablePhaseNodes.get(table.id);
    if (node && node.textContent !== text) node.textContent = text;
    if (state.selectedId === table.id && state.detailPhaseNode && state.detailPhaseNode.textContent !== text) state.detailPhaseNode.textContent = text;
  }
  const beforeEvent = wallNow() < start;
  const available = state.data.tables.filter((table) => table.signups.length < table.seats && (beforeEvent || state.time < table.end)).length;
  const count = state.data.tables.length;
  const note = !ctx ? " · Hall graphics unavailable; use the table list." : state.assetsFailed ? " · Sprite art unavailable; simplified graphics are in use." : "";
  const statusClass = !ctx || state.assetsFailed ? "stale" : "";
  if (state.staleMessage) return;
  const hostName = state.data.event.host_name?.trim();
  const hostPrefix = state.view === "mobile" && hostName ? `Hosted by ${hostName} · ` : "";
  if (beforeDoors()) {
    // The sign-up window: who has gathered, what has space, and the invitation (a link outside sample/archive views).
    const games = count ? ` · ${available} ${available === 1 ? "game" : "games"} with signup space` : "";
    const lead = gathered === 0 ? "Nobody has arrived yet" : `${gathered} gathered so far`;
    const invite = state.sample || state.archive ? null : { text: "Sign up on Discord", href: DISCORD_INVITE };
    setStatus(`${hostPrefix}${lead}${games}${note} · ${invite ? "" : "Sign up on Discord"}`, statusClass, invite);
    return;
  }
  const base = state.archive ? `${count} ${count === 1 ? "game" : "games"} in the saved schedule · Figures follow planned and recorded attendance` : beforeEvent ? `${available} ${available === 1 ? "game" : "games"} with signup space · Event starts ${formatSlot(0, true)}` : `${count} ${count === 1 ? "game" : "games"} on the schedule · Figures follow planned and recorded attendance`;
  setStatus(hostPrefix + base + note, statusClass);
}

function clearSpeech() {
  state.speechQueue = [];
  state.speech = null;
  state.stageQueue = [];
  if (state.live) state.live = { ...state.live, speechQueue: [] };
}

function setClock(clock, persistNow = true, snap = true) {
  state.clock = clock;
  state.time = clock.slot;
  state.snap = snap;
  if (snap) foodCorner.resetDishes();
  clearSpeech();
  persistClockSelection(performance.now(), persistNow);
}

function persistClockSelection(now, force = false) {
  if (!globalThis.history?.replaceState || !location.href || (!force && now - state.lastUrlWrite < 1000)) return;
  const url = new URL(location.href);
  // Following now and waiting for doors are not time choices; `now` is never written here.
  if (state.clock.mode === "follow-now" || state.clock.mode === "upcoming") url.searchParams.delete("at");
  else url.searchParams.set("at", String(state.time));
  if (url.href !== location.href) {
    try { history.replaceState(null, "", url.href); }
    catch { /* A restricted History API must not stop the viewer. */ }
  }
  state.lastUrlWrite = now;
}

function queueSpeech(events) {
  const queue = [...state.speechQueue, ...events];
  let shouts = queue.filter((event) => event.kind === "shout").length;
  state.speechQueue = queue.filter((event) => event.kind !== "shout" || shouts-- <= 20);
}

// Speech holds the stage for its scripted seconds at 1× and while paused; faster replay shortens it to a one-second floor.
function speechDurationMs(kind, active) {
  const factor = state.clock.mode === "replay" ? playbackSpeed(state.speed, active, announcerForFrame()) : 1;
  return Math.max(MIN_SPEECH_REAL_SECONDS, SPEECH_SECONDS[kind] / factor) * 1000;
}

function advanceSpeech(now, active) {
  const speech = state.speech;
  if (speech && !state.people.has(speech.event.person)) state.speech = null;
  else if (speech?.phase === "speaking" && now >= speech.until) {
    if (speech.event.kind === "donation") speech.phase = "leaving";
    else state.speech = null;
  }
  if (!state.speech) {
    let event = null;
    do {
      if (state.clock.mode === "follow-now" && state.live) {
        const shifted = shiftSpeechQueue(state.live);
        state.live = shifted.state;
        event = shifted.event;
      } else event = state.speechQueue.shift();
    } while (event && !state.people.has(event.person));
    if (event) state.speech = { event, phase: event.kind === "donation" ? "approaching" : "speaking",
      until: event.kind === "donation" ? null : now + speechDurationMs(event.kind, active) };
  }
  const queue = state.clock.mode === "follow-now" && state.live ? state.live.speechQueue : state.speechQueue;
  state.stageQueue = stageQueuePeople(queue, state.speech, state.people);
}

function settleStageSpeech(now, active) {
  const speech = state.speech;
  if (speech?.event.kind !== "donation") return;
  const runtime = state.people.get(speech.event.person);
  if (!runtime?.visible || runtime.moving) return;
  if (speech.phase === "approaching" && samePoint(runtime.position, state.layout.stageFront)) {
    speech.phase = "speaking";
    speech.until = now + speechDurationMs("donation", active);
  } else if (speech.phase === "leaving" && samePoint(runtime.position, stageGeometry(state.layout).foot)) {
    state.speech = null;
  }
}

const timelineArrivals = new WeakMap();
let previousLivePoll = null;

async function readTimeline(url, livePoll = false) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("fetch");
  let input;
  try { input = await response.json(); }
  catch { throw new Error("json"); }
  const data = validateTimeline(input);
  const receivedAt = wallNow();
  const previousPollAt = livePoll && previousLivePoll && Date.parse(data.generated_at) > previousLivePoll.generatedAt
    ? previousLivePoll.receivedAt : null;
  timelineArrivals.set(data, { receivedAt, previousPollAt });
  // Every successful live poll counts, even when reconciliation keeps the installed snapshot.
  if (livePoll) previousLivePoll = { receivedAt, generatedAt: Date.parse(data.generated_at) };
  return data;
}

async function fetchTimeline() {
  if (state.archive || state.sample) {
    if (!state.archive && new URLSearchParams(location.search).get("sample") === "50") return readTimeline("./data/timeline.demo-50.json");
    return readTimeline(state.archive ? "./timeline.json" : "./data/timeline.sample.json");
  }
  const liveFeed = $("live-feed")?.getAttribute("content");
  state.feedDelayed = false;
  if (!liveFeed) return readTimeline("./data/timeline.json", true);
  const freshUrl = (value) => {
    const url = new URL(value, location.href);
    url.searchParams.set("check", String(Date.now()));
    return url.href;
  };
  // The live service reads the primary database and forbids intermediary caching.
  try { return await readTimeline(freshUrl(liveFeed), true); }
  catch { state.feedDelayed = true; }
  const backups = ["./data/timeline.json", $("backup-feed")?.getAttribute("content")].filter(Boolean);
  const results = await Promise.allSettled(backups.map(url => readTimeline(freshUrl(url))));
  const snapshots = results.filter(result => result.status === "fulfilled").map(result => result.value);
  if (!snapshots.length) throw results[0].reason;
  return snapshots.sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at))[0];
}

function updateSyncStatus() {
  const controls = $("sync-controls");
  if (!controls) return;
  controls.hidden = state.archive || state.sample;
  if (controls.hidden) return;
  const final = state.data?.phase === "final";
  $("refresh-now").disabled = state.refreshing;
  $("refresh-now").textContent = state.refreshing ? "Checking…" : "Check for updates";
  controls.className = `sync-controls${state.staleMessage || state.feedDelayed ? " delayed" : ""}`;
  const checked = state.lastChecked ? formatDate(state.lastChecked, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
  let message = state.refreshing ? "Checking for updates…"
    : state.staleMessage ? "Updates unavailable. Your last loaded view is still shown; we’ll retry."
    : state.feedDelayed ? "Live feed delayed. Showing the newest backup; retrying the live connection."
    : final ? "Final event record. Automatic updates have stopped."
    : `Checked at ${checked}. Checking every ${state.pollSeconds} seconds.`;
  if (state.data) {
    const published = Date.parse(state.data.generated_at);
    const today = { year: "numeric", month: "numeric", day: "numeric" };
    const withDate = formatDate(published, today) !== formatDate(wallNow(), today);
    message += ` Data published at ${formatDate(published, withDate ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit", second: "2-digit" })}.`;
  }
  if (!final && state.clock && state.clock.mode !== "follow-now" && state.clock.mode !== "upcoming") {
    message += beforeDoors() ? " Previewing the planned day. Choose Return to Now to see the hall as it is."
      : " Viewing an earlier time — choose Return to Now to see current actions.";
  }
  if ($("sync-status").textContent !== message) $("sync-status").textContent = message;
}

function installTimeline(data, initial = false) {
  state.data = data;
  if (initial && !state.sample && !state.archive) setupFundraising({
    strip: $("fundraising-strip"), total: $("fundraising-total"), fill: $("thermometer-fill"),
    thermometer: $("thermometer"),
  });
  if (state.hostIconUrl !== data.event.host_icon_url) {
    const url = data.event.host_icon_url;
    state.hostIconUrl = url;
    state.hostIcon = null;
    if (url) {
      const icon = new Image();
      icon.referrerPolicy = "no-referrer";
      icon.addEventListener("load", () => { if (state.hostIconUrl === url) state.hostIcon = icon; }, { once: true });
      icon.addEventListener("error", () => {}, { once: true });
      icon.src = url;
    }
  }
  document.title = `${data.event.name} — Longtable`;
  $("event-name").textContent = data.event.name;
  $("record-note").hidden = !state.sample && !state.archive && data.phase !== "final";
  $("record-note").textContent = state.sample ? "Demo event — all attendees and activity are fictional. Use Play and the timeline to explore the full event."
    : state.archive ? "Archived event replay. This shows the final saved schedule." : "This is the final event record.";
  $("updated").textContent = formatDate(Date.parse(data.generated_at), { dateStyle: "medium", timeStyle: "medium" });
  $("scrubber").max = String(data.event.slots);
  $("start-label").textContent = formatSlot(0, true);
  $("end-label").textContent = formatSlot(data.event.slots, true);
  state.layout = buildLayout();
  restoreCameraMemory();
  state.loungeGeometry = null;
  // Desktop aspect and kiosk column width both include the back wall.
  canvas.style.setProperty("--hall-aspect", `${state.layout.width} / ${state.layout.height - state.layout.backWall.y}`);
  document.documentElement.style.setProperty("--hall-ratio", state.layout.width / (state.layout.height - state.layout.backWall.y));
  state.frameKey = null;
  renderActions();
  state.adminEvents = indexAdminEvents(data);
  state.gatheringPlaces = gatheringLocations(data);
  // Practice reaches the page through the live feed alone; archive and sample pages ignore the key.
  const practiceShown = !state.sample && !state.archive;
  const arrival = timelineArrivals.get(data);
  state.practiceSession = practiceShown ? receivePracticeSnapshot(data, state.practiceSession,
    arrival?.receivedAt ?? wallNow(), arrival?.previousPollAt ?? null) : null;
  state.practiceData = state.practiceSession?.timeline ?? { ...data, practice: null };
  state.gatheredCount = [...state.gatheringPlaces.values()].filter((place) => place.kind !== "absent").length;
  syncPeople();
  // Each practice speech entry becomes one bubble the first time a poll carries it; a load only records what is there.
  const practiceSpeech = practiceShown ? data.practice?.speech ?? [] : [];
  const keys = practiceSpeech.map((entry) => `${entry.person}|${entry.at}`);
  if (!initial && upcoming()) {
    queueSpeech(practiceSpeech.filter((entry, index) => !state.practiceSeen.has(keys[index]))
      .map((entry, index) => ({ id: keys[index], kind: "shout", person: entry.person, text: entry.text, at: state.time, practice: true })));
  }
  state.practiceSeen = new Set(keys);
  state.activity = publicActivity(data);
  state.activityKey = null;
  state.activitySecond = null;
  if (state.selectedId && !data.tables.some((table) => table.id === state.selectedId)) {
    state.selectedId = null;
    if (state.drawer === "detail") setDrawer(null);
  }
  renderTableList();
  renderDetail();
  if (initial) state.time = 0;
  if (initial) state.snap = true;
}

async function refresh() {
  if (state.refreshing || state.archive || state.sample) return;
  state.refreshing = true;
  state.lastRefresh = performance.now();
  updateSyncStatus();
  try {
    const next = await fetchTimeline();
    if (!state.live) state.live = createLiveState(state.data);
    const result = reconcileLiveSnapshot(state.live, next);
    state.live = state.clock.mode === "follow-now" ? result : { ...result, speechQueue: [] };
    if (result.changed) {
      installTimeline(result.snapshot);
    } else if (state.practiceSession) {
      const arrival = timelineArrivals.get(next);
      const { offset, lo, hi } = receivePracticeSnapshot(next, state.practiceSession,
        arrival.receivedAt, arrival.previousPollAt);
      state.practiceSession = { ...state.practiceSession, offset, lo, hi };
    }
    state.staleMessage = "";
    state.lastChecked = Date.now();
  } catch (error) {
    state.staleMessage = error?.name === "TimelineError" ? `Update rejected: ${error.message} Showing the last good snapshot.` : "Update failed. Showing the last good snapshot.";
    setStatus(state.staleMessage, "stale");
  } finally {
    state.refreshing = false;
    updateSyncStatus();
    renderActivity();
  }
}

$("refresh-now")?.addEventListener("click", () => { void refresh(); });
// Cadence: 30 s during the sign-up window, 2 s from an hour before doors; nothing while the tab is hidden.
function checkLiveUpdates() {
  if (document.hidden) return;
  if (state.data?.phase === "live" && state.clock?.source === "live"
      && performance.now() - state.lastRefresh >= state.pollSeconds * 1000) void refresh();
}
// Polling must survive suspended animation frames and catch up on returning from Discord.
setInterval(checkLiveUpdates, 2_000);
document.addEventListener?.("visibilitychange", () => {
  if (document.hidden) return;
  if (state.data?.phase === "live") void refresh();
  requestWakeLock();
});

// Kiosk only: keep the projector awake. The sentinel is released by the browser when the tab hides.
function requestWakeLock() {
  if (!state.kiosk || typeof globalThis.navigator?.wakeLock?.request !== "function") return;
  try {
    Promise.resolve(navigator.wakeLock.request("screen"))
      .then((sentinel) => { state.wakeLock = sentinel; }, () => { /* Denied wake locks are not an error on a projector. */ });
  } catch { /* Same rule for a synchronous throw. */ }
}

function toggleFullscreen() {
  try {
    const root = document.documentElement;
    const request = document.fullscreenElement ? document.exitFullscreen?.() : root?.requestFullscreen?.();
    Promise.resolve(request).catch(() => {});
  } catch { /* No fullscreen API: F11 still works. */ }
}

function inputFocused() {
  const active = document.activeElement;
  return !!active && (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(active.tagName) || active.isContentEditable === true);
}

// Kiosk idle rules run on the animation clock: a manual camera returns to automatic framing after
// 45 s without input, and the cursor hides after 3 s without pointer movement.
function applyKioskIdle(now) {
  if (!state.kiosk) return;
  if (state.manualCamera && now - state.lastInputAt >= KIOSK_CAMERA_RESET_MS) {
    state.manualCamera = false;
    state.manualSelection = false;
    state.frameKey = null;
  }
  const dataset = document.documentElement?.dataset;
  if (!dataset) return;
  if (now - state.lastPointerAt >= KIOSK_CURSOR_HIDE_MS) { if (dataset.idle !== "1") dataset.idle = "1"; }
  else if ("idle" in dataset) delete dataset.idle;
}

if (state.kiosk) {
  const noteInput = () => { state.lastInputAt = performance.now(); };
  document.addEventListener?.("pointermove", () => { state.lastPointerAt = state.lastInputAt = performance.now(); }, { passive: true });
  document.addEventListener?.("pointerdown", noteInput, { passive: true });
  document.addEventListener?.("wheel", noteInput, { passive: true });
  document.addEventListener?.("keydown", (event) => {
    noteInput();
    if ((event.key === "f" || event.key === "F") && !event.ctrlKey && !event.metaKey && !event.altKey && !inputFocused()) toggleFullscreen();
  });
}

function renderActivity() {
  if (!state.data || !state.clock) return;
  const anchoredToNow = state.clock.mode === "follow-now" || state.clock.mode === "upcoming";
  const cutoff = anchoredToNow ? wallNow() : slotToMs(state.data, state.time);
  const second = Math.floor(cutoff / 1000);
  if (second === state.activitySecond) return;
  state.activitySecond = second;
  const visible = state.activity.filter((entry) => entry.at <= cutoff);
  const entries = visible.slice(0, state.activityLimit);
  const key = `${state.activityLimit}:${entries.map((entry) => entry.id).join(",")}:${visible.length}`;
  $("activity-note").textContent = `Newest first · ${state.clock.mode === "follow-now" ? "Live · " : state.clock.mode === "upcoming" ? "" : "Selected time · "}${state.data.event.tz}`;
  if (key === state.activityKey) return;
  state.activityKey = key;
  const list = $("activity-log");
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("li");
    const time = document.createElement("time");
    time.dateTime = new Date(entry.at).toISOString();
    time.textContent = formatDate(entry.at, { dateStyle: "medium", timeStyle: "medium" });
    row.append(time);
    append(row, "span", entry.text);
    list.append(row);
  }
  list.scrollTop = scrollTop;
  $("activity-empty").hidden = entries.length !== 0;
  $("activity-more").hidden = visible.length <= state.activityLimit;
}

$("activity-more").addEventListener("click", () => {
  state.activityLimit += 100;
  state.activitySecond = null;
  renderActivity();
});

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function canvasPoint(event) { return screenToWorld(state.camera, pointerPoint(event)); }
function tableAt(point) {
  return state.layout.cells.findIndex((cell) => {
    const rect = rugRect(cell);
    return point.x >= rect.x && point.x < rect.x + rect.w && point.y >= cell.y && point.y < cell.y + 6;
  });
}
function hideTooltip() { state.hover = null; $("tooltip").hidden = true; }
function setCursor(value) { if (canvas.style.cursor !== value) canvas.style.cursor = value; }
const pointers = new Map();
let gesture = null;
let suppressClick = false;
let lastWheel = null;  // { intent, at } of the last hall wheel event, so one burst of wheel clicks keeps one intent
let lastTap = null;   // { id, at } of the last table click, so a second quick click on it zooms
const DOUBLE_TAP_MS = 400;
function gesturePosition() {
  const points = [...pointers.values()];
  return { center: { x: points.reduce((n, p) => n + p.x, 0) / points.length, y: points.reduce((n, p) => n + p.y, 0) / points.length }, distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0 };
}
function moveCamera(dx, dy) {
  if (!state.camera) return;
  state.camera = panCamera(state.camera, dx, dy, viewport(), hallBounds());
  state.manualCamera = true;
  hideTooltip();
}
function zoomCamera(factor, point = { x: viewport().width / 2, y: viewport().height / 2 }) {
  if (!state.camera) return;
  state.camera = zoomAt(state.camera, point, factor, viewport(), hallBounds());
  state.manualCamera = true;
  hideTooltip();
}
canvas.addEventListener("pointerdown", (event) => {
  if (!state.camera || (event.button !== undefined && event.button !== 0)) return;
  if (!pointers.size) suppressClick = false;
  pointers.set(event.pointerId, pointerPoint(event));
  canvas.setPointerCapture(event.pointerId);
  gesture = gesturePosition();
  if (pointers.size > 1) suppressClick = true;
  hideTooltip();
});
canvas.addEventListener("pointermove", (event) => {
  if (!state.camera) return;
  if (pointers.has(event.pointerId)) {
    pointers.set(event.pointerId, pointerPoint(event));
    const next = gesturePosition();
    const dx = next.center.x - gesture.center.x, dy = next.center.y - gesture.center.y;
    if (pointers.size > 1 || suppressClick || Math.hypot(dx, dy) > 5) {
      suppressClick = true;
      dismissCameraHelp();
      if (next.distance && gesture.distance) zoomCamera(next.distance / gesture.distance, gesture.center);
      moveCamera(dx, dy);
      gesture = next;
    }
    return;
  }
  const point = canvasPoint(event);
  let best = null;
  let distance = .72;
  for (const runtime of state.people.values()) {
    if (!runtime.visible) continue;
    const candidate = Math.hypot(runtime.position.x - point.x, runtime.position.y - point.y + .1);
    if (candidate < distance) { best = runtime; distance = candidate; }
  }
  state.hover = best;
  state.hoverTable = tableAt(point);
  const onJukebox = overJukebox(point);
  const onInfo = !infoRunning() && overInfoStaff(point);
  const onSpeech = overInfoBubble(pointerPoint(event)) || (state.infoVisit?.phase === "speaking" && overInfoStaff(point));
  setCursor(onJukebox || onInfo || onSpeech || state.hoverTable >= 0 ? "pointer" : "");
  const tooltip = $("tooltip");
  if (!best && !onJukebox && !onInfo) { tooltip.hidden = true; return; }
  // A person walking in front of the jukebox keeps their tooltip; the jukebox tip stays visible in kiosk mode.
  tooltip.textContent = best ? personTooltip(best.person, best.place, best.moving) : onJukebox ? JUKEBOX_TOOLTIP : infoStageBusy() ? "Staff: busy on stage, try again shortly" : "Staff: click for info about Longtable";
  tooltip.className = best ? "tooltip" : "tooltip jukebox-tip";
  const sceneRect = canvas.parentElement.getBoundingClientRect();
  tooltip.style.left = `${clamp(event.clientX - sceneRect.left + 12, 0, Math.max(0, sceneRect.width - 280))}px`;
  tooltip.style.top = `${Math.max(0, event.clientY - sceneRect.top - 30)}px`;
  tooltip.hidden = false;
});
function finishPointer(event) {
  pointers.delete(event.pointerId);
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  gesture = pointers.size ? gesturePosition() : null;
}
canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", (event) => { suppressClick = true; finishPointer(event); });
canvas.addEventListener("lostpointercapture", finishPointer);
canvas.addEventListener("pointerleave", () => { hideTooltip(); state.hoverTable = -1; setCursor(""); });
canvas.addEventListener("click", (event) => {
  if (!state.camera || suppressClick) return;
  const point = canvasPoint(event);
  const screen = pointerPoint(event);
  if (overInfoBubble(screen)) { clickInfoStaff(); return; }
  if (overJukebox(point)) { music?.togglePanel(); return; }
  if (overInfoStaff(point)) { clickInfoStaff(); return; }
  const label = state.labelBoxes?.findLast((box) => screen.x >= box.x && screen.x < box.x + box.w && screen.y >= box.y && screen.y < box.y + box.h);
  const index = label?.index ?? tableAt(point);
  const table = index >= 0 ? state.data.tables[index] : null;
  // Timed here rather than with dblclick so a double tap on a phone zooms too.
  const now = performance.now();
  const double = !!table && lastTap?.id === table.id && now - lastTap.at < DOUBLE_TAP_MS;
  lastTap = table && !double ? { id: table.id, at: now } : null;
  // One click selects, a click on the selected table or the empty floor clears it, a double click zooms.
  if (double) selectTable(table.id, false, true);
  else selectTable(table && table.id !== state.selectedId ? table.id : null);
});
canvas.addEventListener("wheel", (event) => {
  if (!state.camera) return;
  const at = event.timeStamp ?? performance.now();
  const intent = wheelIntent({ deltaY: event.deltaY, ctrlKey: event.ctrlKey, atMinimum: atMinZoom(state.camera, viewport(), hallBounds()),
    scrollY: globalThis.scrollY || 0, previous: lastWheel?.intent, sincePrevious: at - (lastWheel?.at ?? -Infinity) });
  lastWheel = { intent, at };
  if (intent === "scroll") return;
  dismissCameraHelp();
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport().height : 1;
  zoomCamera(Math.exp(-clamp(event.deltaY * unit, -300, 300) * .002), pointerPoint(event));
}, { passive: false });
function recenter() {
  if (!state.layout) return;
  state.camera = fitBounds(hallBounds(), viewport(), hallBounds(), 0);
  state.manualCamera = true;
  hideTooltip();
}
$("zoom-in").addEventListener("click", () => zoomCamera(1.25));
$("zoom-out").addEventListener("click", () => zoomCamera(.8));
$("recenter").addEventListener("click", recenter);
$("fit-active").addEventListener("click", () => {
  if (!state.data) return;
  if (VIEW_PROFILES[state.view].frame === "table") frameMobile(true);
  else frameTables(relevantTableIndices(state.data.tables, state.time), true);
});
$("activity-toggle").addEventListener("click", () => setDrawer(state.drawer === "activity" ? null : "activity"));
// Register after each action so any focus it moves into a panel stays there.
for (const id of ["zoom-in", "zoom-out", "recenter", "fit-active", "activity-toggle"]) {
  const button = $(id);
  button.addEventListener("click", () => {
    const wasOpen = $("camera-controls").getAttribute("data-open") !== null;
    setCameraMenu(false, { focusToggle: wasOpen && document.activeElement === button });
  });
}
$("camera-toggle").addEventListener("click", () => {
  setCameraMenu($("camera-controls").getAttribute("data-open") === null);
});
document.addEventListener("pointerdown", (event) => {
  const controls = $("camera-controls");
  if (controls.getAttribute("data-open") === null) return;
  if (!controls.contains(event.target)) setCameraMenu(false);
}, { passive: true });
$("camera-controls").addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !$("camera-controls").contains(document.activeElement)) return;
  setCameraMenu(false, { focusToggle: true });
  event.preventDefault();
});
$("drawer-close").addEventListener("click", closeDrawer);
$("hall-sidebar").addEventListener("keydown", drawerKeydown);
canvas.addEventListener("keydown", (event) => {
  drawerKeydown(event);
  const keys = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
  if (keys[event.key]) { dismissCameraHelp(); event.preventDefault(); moveCamera(...keys[event.key]); }
  else if (["+", "=", "-", "Home"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "Home") recenter();
    else { dismissCameraHelp(); zoomCamera(event.key === "-" ? .8 : 1.25); }
  }
});

$("play").addEventListener("click", () => {
  if (!state.data) return;
  const next = toggleViewerPlayback(state.clock, state.data);
  // Leaving the gathering for the preview snaps, so nobody watches the hall re-seat itself.
  setClock(next, true, next.slot !== state.clock.slot || state.clock.mode === "upcoming");
  state.lastTime = performance.now();
});
$("return-now").addEventListener("click", () => {
  if (!state.data) return;
  setClock(followNowClock(state.clock, state.data, wallNow()));
});
$("speed").addEventListener("change", (event) => {
  const speed = Number(event.target.value);
  if ([1, 30, 120, 600, 1800].includes(speed)) state.speed = speed;
});
$("scrubber").addEventListener("input", (event) => {
  if (!state.data) return;
  setClock(seekViewerClock(state.clock, state.data, Number(event.target.value)), false);
});

$("scrubber").addEventListener("change", () => {
  if (state.data) persistClockSelection(performance.now(), true);
});
globalThis.addEventListener?.("pagehide", () => {
  if (state.clock) persistClockSelection(performance.now(), true);
});

reducedMotion.addEventListener?.("change", () => {
  if (state.clock?.mode === "replay" && reducedMotion.matches) setClock(seekViewerClock(state.clock, state.data, state.time));
  state.snap = true;
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = url;
  });
}

async function loadAssets() {
  const results = await Promise.allSettled([
    loadImage(new URL("./assets/roguelikeChar_transparent.png", import.meta.url).href),
    loadImage(new URL("./assets/roguelikeSheet_transparent.png", import.meta.url).href),
    loadImage(new URL("./assets/roguelikeIndoor_transparent.png", import.meta.url).href),
    // Archives hang no plaques, so they never request the QR images (frozen bundles do not carry them).
    ...(state.archive ? [] : WALL_PLAQUES.map((plaque) => loadImage(new URL(plaque.qr, import.meta.url).href))),
  ]);
  const loaded = (result) => result.status === "fulfilled" ? result.value : null;
  state.images.characters = loaded(results[0]);
  state.images.rpg = loaded(results[1]);
  // A missing QR leaves its plaque as wood and text; only the sprite atlases count as failed assets.
  state.images.plaques = WALL_PLAQUES.map((_, index) => state.archive ? null : loaded(results[3 + index]));
  state.assetsFailed = results.slice(0, 2).some((result) => result.status === "rejected");
  state.images.indoor = loaded(results[2]);
}

function loop(now) {
  if (!state.data) return;
  const realSeconds = Math.max(0, Math.min(.1, (now - state.lastTime) / 1000 || 0));
  state.lastTime = now;
  const wall = wallNow();
  const previous = state.clock;
  state.clock = tickViewerClock(previous, state.data, wall, realSeconds, state.speed, announcerForFrame());
  state.time = state.clock.slot;
  updateStage(wall);
  if (previous.mode === "replay" && state.clock.mode !== "follow-now") queueSpeech(crossedSpeechEvents(state.data, previous.slot, state.time));
  const anchored = (mode) => mode === "follow-now" || mode === "upcoming";
  if (previous.mode !== state.clock.mode && (anchored(previous.mode) || anchored(state.clock.mode))) { clearSpeech(); state.snap = true; }
  // Nothing is happening yet in the gathering: no announcements, breaks, meals, spotlights, speech or dice.
  const active = upcoming() ? NO_ACTIVE : activeEvents(state.data, state.time, state.adminEvents);
  if (state.clock.source === "live" && state.data.phase === "live" && !document.hidden && now - state.lastRefresh >= state.pollSeconds * 1000) {
    state.lastRefresh = now;
    void refresh();
  }
  persistClockSelection(now);
  applyKioskIdle(now);
  advanceSpeech(now, active);
  updatePeople(realSeconds, now, active);
  settleStageSpeech(now, active);
  render(now, active);
  persistCameraMemory(now);
  updateHeader(active);
  updateSyncStatus();
  renderActivity();
  requestAnimationFrame(loop);
}

async function boot() {
  try {
    const [data] = await Promise.all([fetchTimeline(), loadAssets()]);
    installTimeline(data, true);
    state.lastChecked = Date.now();
    state.lastRefresh = performance.now();
    // A `?now=` override lets the sample package show the gathering, the eve and the doors-open handover on demand.
    const wall = wallNow();
    const source = state.archive ? "archive" : state.sample && !state.nowOverride ? "sample" : "live";
    state.clock = createViewerClock(data, wall, { source, mobile: mobile.matches, reducedMotion: reducedMotion.matches });
    const at = new URLSearchParams(location.search).get("at");
    if (at !== null && at.trim() !== "" && Number.isFinite(Number(at))) state.clock = seekViewerClock(state.clock, data, Number(at));
    state.time = state.clock.slot;
    updateStage(wall);
    if (state.clock.source === "live") state.live = createLiveState(data);
    state.lastTime = performance.now();
    state.lastRefresh = state.lastTime;
    state.lastInputAt = state.lastPointerAt = state.lastTime;
    const active = upcoming() ? NO_ACTIVE : activeEvents(state.data, state.time, state.adminEvents);
    updatePeople(0, state.lastTime, active);
    render(state.lastTime, active);
    updateHeader(active);
    requestWakeLock();
    requestAnimationFrame(loop);
  } catch (error) {
    const message = error?.name === "TimelineError" ? `Timeline could not be loaded: ${error.message}` : "Timeline could not be loaded. Check that the published data file is available.";
    setStatus(message, "error");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = "#24222c";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f5efe4";
    ctx.font = "20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("The hall is unavailable.", width / 2, height / 2);
  }
}

void boot();
