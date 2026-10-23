import { worldToScreen } from "./camera.mjs?v=d94bb0d105dc";
import { stageGeometry } from "./stage.mjs?v=d3a077633f77";

// No raid in the timeline (status null/undefined) shows the arrow as "Coming soon" (Devin, 2026-10-22).
export function previewVisible(status, { kiosk = false, curtainPlaying = false, sample = false, archive = false } = {}) {
  return (status == null || status === "upcoming" || status === "ended") && !kiosk && !curtainPlaying && !sample && !archive;
}

/** Absolute opening time, using the hall's short day/date and separate time format.
 * `now` never infers raid status: the selected-time raid model owns that decision.
 */
export function previewLabel(status, windowStart, now, { timeZone, locale } = {}) {
  if (status == null) return "Coming soon";
  if (status === "ended") return "Raid trailer";
  if (status !== "upcoming" || !Number.isFinite(windowStart)) return "";
  const format = options => new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(new Date(windowStart));
  return `Opens ${format({ weekday: "short", month: "short", day: "numeric" })}, ${format({ hour: "numeric", minute: "2-digit" })}`;
}

/** World point the sign's arrow rests on: the stage floor beside the stairs, far below the microphone.
 * Stage speech bubbles grow upward from the speaker, so a sign down here never covers them (Devin, 2026-10-23).
 */
export function previewAnchor(layout) {
  const { stage } = layout;
  // Level with the stairs, centred on the stage floor; the room's bottom edge would pin the sign.
  return { x: stage.x + stage.w / 2, y: stageGeometry(layout).foot.y };
}

/** Canvas-local box centre and glyph rotation, independent of the DOM. */
export function previewPlacement({ point, canvas: { w, h }, box, avoid = null, inset = 8,
  glyphOffset = { x: 0, y: 0 }, tipAbove, tipBelow }) {
  const bw = box?.w || 0, bh = box?.h || 0;
  const cx = w / 2, cy = h / 2;
  const dx = point.x - cx, dy = point.y - cy;
  const pinned = point.x < inset || point.x > w - inset || point.y < inset || point.y > h - inset;
  // The first axis reached by the centre-to-curtain segment determines Q's edge.
  const tx = dx === 0 ? Infinity : Math.max(0, cx - inset) / Math.abs(dx);
  const ty = dy === 0 ? Infinity : Math.max(0, cy - inset) / Math.abs(dy);
  const t = pinned ? Math.min(1, tx, ty) : 1;
  // Collapse an axis to the canvas centre when the box cannot fit inside R.
  const minX = Math.min(cx, inset + bw / 2), maxX = Math.max(cx, w - inset - bw / 2);
  const minY = Math.min(cy, inset + bh / 2), maxY = Math.max(cy, h - inset - bh / 2);
  let x = Math.max(minX, Math.min(maxX, cx + dx * t));
  let y = Math.max(minY, Math.min(maxY, cy + dy * t));
  let flip = false;

  if (!pinned && tipAbove) {
    const fitsAbove = tipAbove.y - bh >= inset;
    flip = !fitsAbove && Boolean(tipBelow) && tipBelow.y + bh <= h - inset;
    const tip = flip ? tipBelow : tipAbove;
    x = Math.max(minX, Math.min(maxX, tip.x));
    y = tip.y + (flip ? bh / 2 : -bh / 2);
    if (!fitsAbove && !flip) y = Math.max(minY, Math.min(maxY, y));
  }

  // avoid is one rect or a list (camera controls, then the stage mic), each slid clear of in turn.
  const avoids = pinned && bw <= w - 2 * inset && bh <= h - 2 * inset ? [avoid].flat().filter(Boolean) : [];
  for (const rect of avoids) {
    const left = rect.x - 8, right = rect.x + rect.w + 8;
    const top = rect.y - 8, bottom = rect.y + rect.h + 8;
    if (x + bw / 2 > left && x - bw / 2 < right && y + bh / 2 > top && y - bh / 2 < bottom) {
      const candidates = [];
      // Equality means an exact corner: consider both axes, shortest move first.
      if (tx <= ty) candidates.push({ x, y: top - bh / 2 }, { x, y: bottom + bh / 2 });
      if (ty <= tx) candidates.push({ x: left - bw / 2, y }, { x: right + bw / 2, y });
      let best = null, distance = Infinity;
      for (const candidate of candidates) {
        if (candidate.x < minX || candidate.x > maxX || candidate.y < minY || candidate.y > maxY) continue;
        const move = Math.abs(candidate.x - x) + Math.abs(candidate.y - y);
        if (move < distance) { best = candidate; distance = move; }
      }
      if (best) { x = best.x; y = best.y; }
    }
  }
  const angle = pinned ? Math.atan2(point.y - y - glyphOffset.y, point.x - x - glyphOffset.x) * 180 / Math.PI - 90 : flip ? 180 : 0;
  // Without tips the result keeps its 9a shape.
  return { x, y, angle: angle <= -180 ? angle + 360 : angle, pinned, ...(tipAbove ? { flip } : {}) };
}

export function setupRaidPreview({ canvas, music, getState, sample = false }, doc = document) {
  const button = doc.getElementById("raid-preview-open");
  const overlay = doc.getElementById("raid-preview");
  const video = doc.getElementById("raid-preview-video");
  const closeButton = doc.getElementById("raid-preview-close");
  const mute = doc.getElementById("raid-preview-mute");
  const label = button?.querySelector(".raid-preview-label");
  const arrow = button?.querySelector(".raid-preview-arrow");
  const status = doc.getElementById("raid-preview-status");
  if (!button || !overlay || !video || !closeButton || !mute || !label) return null;
  const audio = music?.audio;
  let resumeMusic = false;
  let labelKey;
  let playAttempt = 0;

  function renderMute() {
    mute.textContent = video.muted ? "Unmute" : "Mute";
    mute.setAttribute("aria-pressed", String(video.muted));
  }

  function close() {
    if (overlay.hidden) return;
    ++playAttempt;
    video.pause();
    overlay.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (resumeMusic && music.isPlaying()) {
      try { Promise.resolve(audio.play()).catch(() => {}); } catch { /* The jukebox remains available for retry. */ }
    }
    resumeMusic = false;
    button.focus();
  }

  button.addEventListener("click", () => {
    if (button.hidden || !overlay.hidden) return;
    resumeMusic = Boolean(audio && !audio.paused && !audio.ended);
    if (resumeMusic) audio.pause();
    overlay.hidden = false;
    button.setAttribute("aria-expanded", "true");
    video.muted = false;
    renderMute();
    if (status) status.textContent = "";
    // No source exists before the first click, even if a browser ignores preload.
    if (!video.getAttribute("src")) video.src = new URL("./assets/raid/preview.mp4", import.meta.url).href;
    video.currentTime = 0;
    const ticket = ++playAttempt;
    const failed = () => {
      if (ticket === playAttempt && status) status.textContent = "Could not play the trailer. Close and try again.";
    };
    try { Promise.resolve(video.play()).catch(failed); } catch { failed(); }
    closeButton.focus();
  });
  closeButton.addEventListener("click", close);
  video.addEventListener("ended", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  mute.addEventListener("click", () => { video.muted = !video.muted; renderMute(); });
  doc.addEventListener("keydown", event => {
    if (overlay.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      event.preventDefault();
      (doc.activeElement === closeButton ? mute : doc.activeElement === mute ? closeButton : event.shiftKey ? mute : closeButton).focus();
    }
  });
  // Keep page-show or an already pending jukebox play from sounding over the trailer.
  audio?.addEventListener("play", () => { if (!overlay.hidden) audio.pause(); });

  function update() {
    const state = getState();
    const visible = previewVisible(state.raid?.status, { kiosk: state.kiosk,
      curtainPlaying: Boolean(state.raidCurtain), sample, archive: state.archive }) && state.scene === "hall";
    button.hidden = !visible || !state.layout || !state.camera || !state.data;
    if (button.hidden) { close(); return; }
    // The arrow rests on the anchor; with no room above it, the sign flips below with the arrow up.
    const point = worldToScreen(state.camera, previewAnchor(state.layout));
    const tipAbove = point, tipBelow = point;
    const rect = canvas.getBoundingClientRect();
    const parent = button.parentElement.getBoundingClientRect();
    const box = { w: button.offsetWidth || 0, h: button.offsetHeight || 0 };
    const glyphOffset = [arrow?.offsetLeft, arrow?.offsetTop, arrow?.offsetWidth, arrow?.offsetHeight,
      button.offsetWidth, button.offsetHeight].every(Number.isFinite)
      ? { x: arrow.offsetLeft + arrow.offsetWidth / 2 - box.w / 2,
        y: arrow.offsetTop + arrow.offsetHeight / 2 - box.h / 2 } : { x: 0, y: 0 };
    const controls = doc.getElementById("camera-controls");
    const controlsRect = controls && !controls.hidden ? controls.getBoundingClientRect() : null;
    const avoid = controlsRect?.width && controlsRect?.height
      ? [{ x: controlsRect.left - rect.left, y: controlsRect.top - rect.top,
        w: controlsRect.width, h: controlsRect.height }] : [];
    // A sign pinned at the edge can still land on an on-screen mic: −7…+7 by −24…+9 drawing px at TILE * SCALE = 32.
    const mic = worldToScreen(state.camera, stageGeometry(state.layout).microphone);
    const micScale = state.camera.zoom / 32;
    avoid.push({ x: mic.x - 7 * micScale, y: mic.y - 24 * micScale, w: 14 * micScale, h: 33 * micScale });
    const { x, y, angle, pinned, flip } = previewPlacement({ point, canvas: { w: rect.width, h: rect.height },
      box, avoid, glyphOffset, tipAbove, tipBelow });
    button.style.left = `${Math.round(rect.left - parent.left + x)}px`;
    button.style.top = `${Math.round(rect.top - parent.top + y)}px`;
    if (arrow) {
      if (arrow.style.setProperty) arrow.style.setProperty("--raid-preview-angle", `${angle}deg`);
      else arrow.style["--raid-preview-angle"] = `${angle}deg`;
    }
    if (pinned) button.setAttribute("data-pinned", "true");
    else button.removeAttribute?.("data-pinned");
    if (flip) button.setAttribute("data-flip", "true");
    else button.removeAttribute?.("data-flip");
    const { event, raid } = state.data;
    const raidStatus = state.raid?.status;
    const start = raid?.window ? Date.parse(event.start) + raid.window.start * event.slot_minutes * 60000 : NaN;
    const key = `${raidStatus}/${start}/${event.tz}`;
    if (labelKey !== key) {
      label.textContent = previewLabel(raidStatus, start, state.time, { timeZone: event.tz });
      labelKey = key;
    }
  }
  return { update };
}
