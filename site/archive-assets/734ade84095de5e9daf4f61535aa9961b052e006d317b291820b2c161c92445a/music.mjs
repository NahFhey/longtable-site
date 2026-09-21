// Hall audio follows the visitor's jukebox choices, independently of the event clock.
export const MUSIC_SETTINGS_KEY = "longtable.music.v1";
export const HALL_PLAYLIST = [
  { title: "The Old Tower Inn", artist: "RandomMind", file: "The_Old_Tower_Inn.mp3" },
  { title: "The Bard’s Tale", artist: "RandomMind", file: "The_Bards_Tale.mp3" },
  { title: "Market Day", artist: "RandomMind", file: "Market_Day.mp3" },
  { title: "Minstrel Dance", artist: "RandomMind", file: "Minstrel_Dance.mp3" },
  { title: "Rejoicing", artist: "RandomMind", file: "Rejoicing.mp3" },
];

export function setupHallMusic(doc = document, options = {}) {
  const ids = ["hall-explorer", "hall-music", "music-panel", "music-toggle", "music-next", "music-close",
    "music-volume", "music-volume-value", "music-track", "music-status"];
  const nodes = ids.map((id) => doc.getElementById(id));
  if (nodes.some((node) => !node)) return null;
  const [hall, audio, panel, toggle, next, close, volume, value, track, status] = nodes;
  let storage;
  // `enabled` is the first-click gate: nothing plays until the visitor has clicked the jukebox in this browser.
  const settings = { volume: 0.5, muted: false, track: 0, enabled: false };
  try {
    storage = options.storage ?? doc.defaultView?.localStorage;
    const saved = JSON.parse(storage?.getItem(MUSIC_SETTINGS_KEY) ?? "null");
    if (saved && typeof saved.volume === "number" && Number.isFinite(saved.volume)
      && saved.volume >= 0 && saved.volume <= 1) settings.volume = saved.volume;
    if (saved && typeof saved.muted === "boolean") settings.muted = saved.muted;
    if (saved && Number.isInteger(saved.track) && saved.track >= 0 && saved.track < HALL_PLAYLIST.length) settings.track = saved.track;
    if (saved && typeof saved.enabled === "boolean") settings.enabled = saved.enabled;
  } catch { /* Preferences are optional when browser storage is unavailable. */ }
  let index = settings.track;
  let sourceLoaded = false;
  let playback = "paused";
  let attempt = 0;
  let pageActive = true;
  let open = false;
  const wanted = () => hall.open && settings.enabled && !settings.muted && pageActive;
  const isPlaying = () => playback === "playing" || playback === "loading";
  const save = () => {
    try { storage?.setItem(MUSIC_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Keep session settings. */ }
  };
  function render() {
    volume.value = String(Math.round(settings.volume * 100));
    value.textContent = `${volume.value}%`;
    const entry = HALL_PLAYLIST[index];
    track.textContent = `${entry.title} — ${entry.artist}`;
    toggle.textContent = playback === "error" ? "Retry music" : isPlaying() ? "Pause music" : "Play music";
    status.textContent = settings.muted ? "Music muted."
      : playback === "blocked" ? "Press Play music to enable audio."
      : playback === "error" ? "Could not play this track. Retry or choose Next track."
      : playback === "playing" ? "Playing" : playback === "loading" ? "Loading music…" : "Music paused.";
  }
  function selectTrack() {
    ++attempt;
    audio.pause();
    audio.src = new URL(`./assets/music/${HALL_PLAYLIST[index].file}`, import.meta.url).href;
    audio.load();
    sourceLoaded = true;
    playback = "paused";
  }
  function sync() {
    audio.volume = settings.volume;
    audio.muted = settings.muted;
    audio.playbackRate = 1;
    audio.defaultPlaybackRate = 1;
    if (!wanted()) {
      ++attempt;
      audio.pause();
      playback = "paused";
      render();
      return;
    }
    if (!sourceLoaded) selectTrack();
    if (isPlaying() && !audio.paused) {
      render();
      return;
    }
    const ticket = ++attempt;
    playback = "loading";
    render();
    const failed = (error) => {
      if (ticket !== attempt || !wanted()) return;
      playback = error?.name === "NotAllowedError" ? "blocked" : "error";
      render();
    };
    try {
      Promise.resolve(audio.play()).then(() => {
        if (!wanted()) { audio.pause(); return; }
        if (ticket !== attempt) return;
        playback = "playing";
        render();
      }, failed);
    } catch (error) { failed(error); }
  }
  function advance() {
    index = (index + 1) % HALL_PLAYLIST.length;
    settings.track = index;
    save();
    selectTrack();
    sync();
  }
  // Turning music on also lifts a mute, so Play always produces sound; a slider at zero returns to the default.
  function enable() {
    settings.enabled = true;
    settings.muted = false;
    if (settings.volume === 0) settings.volume = 0.5;
    if (playback === "error") selectTrack();
    save();
    sync();
  }
  function openPanel() {
    open = true;
    panel.hidden = false;
    toggle.focus?.();
  }
  function closePanel() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    (options.focusTarget ?? doc.getElementById("hall"))?.focus?.();
  }
  // A jukebox click: the first one in this browser starts the music; every one shows or hides the player.
  function togglePanel() {
    if (open) { closePanel(); return; }
    if (!settings.enabled || playback === "blocked") enable();
    openPanel();
  }
  toggle.addEventListener("click", () => {
    if (isPlaying()) {
      settings.enabled = false;
      save();
      sync();
      return;
    }
    enable();
  });
  volume.addEventListener("input", () => {
    const percent = Number(volume.value);
    if (!Number.isFinite(percent)) return;
    settings.volume = Math.max(0, Math.min(100, percent)) / 100;
    settings.muted = settings.volume === 0;
    save();
    sync();
  });
  next.addEventListener("click", advance);
  close.addEventListener("click", closePanel);
  panel.addEventListener("keydown", (event) => { if (event?.key === "Escape") closePanel(); });
  audio.addEventListener("ended", advance);
  audio.addEventListener("error", () => {
    if (!wanted() || !audio.error) return;
    ++attempt;
    playback = "error";
    render();
  });
  hall.addEventListener("toggle", () => { if (!hall.open) closePanel(); sync(); });
  doc.defaultView?.addEventListener("pagehide", () => { pageActive = false; sync(); });
  doc.defaultView?.addEventListener("pageshow", () => { pageActive = true; sync(); });
  sync();
  return { audio, isPlaying, currentTitle: () => HALL_PLAYLIST[index].title, togglePanel, closePanel, panelOpen: () => open };
}
