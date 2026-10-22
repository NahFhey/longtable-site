import { worldToScreen } from "./camera.mjs?v=d94bb0d105dc";

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

export function setupRaidPreview({ canvas, music, getState, sample = false }, doc = document) {
  const button = doc.getElementById("raid-preview-open");
  const overlay = doc.getElementById("raid-preview");
  const video = doc.getElementById("raid-preview-video");
  const closeButton = doc.getElementById("raid-preview-close");
  const mute = doc.getElementById("raid-preview-mute");
  const label = button?.querySelector(".raid-preview-label");
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
    const { stage, stageFront } = state.layout;
    // Same opening rect and 1/16-tile snap as drawStageCurtain; anchor at its centre.
    const opening = { x: Math.round((stage.x + stage.w - 3.25) * 16) / 16,
      y: Math.round((stageFront.y - 3) * 16) / 16, w: 3, h: 6 };
    const point = worldToScreen(state.camera, { x: opening.x + opening.w / 2, y: opening.y + opening.h / 2 });
    const rect = canvas.getBoundingClientRect();
    const parent = button.parentElement.getBoundingClientRect();
    // Follow a panned curtain off screen rather than leaving a detached button at the edge.
    button.hidden = point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height;
    button.style.left = `${Math.round(rect.left - parent.left + point.x)}px`;
    button.style.top = `${Math.round(rect.top - parent.top + point.y)}px`;
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
