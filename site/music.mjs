// Hall audio follows the visitor's controls, independently of the event clock.
export const MUSIC_SETTINGS_KEY = "longtable.music.v1";
export const HALL_PLAYLIST = [
  { title: "The Old Tower Inn", file: "The_Old_Tower_Inn.mp3" },
  { title: "The Bard’s Tale", file: "The_Bards_Tale.mp3" },
];

export function setupHallMusic(doc = document, options = {}) {
  const ids = ["hall-explorer", "hall-music", "music-controls", "music-toggle",
    "music-next", "music-volume", "music-volume-value", "music-track", "music-status"];
  const nodes = ids.map((id) => doc.getElementById(id));
  if (nodes.some((node) => !node)) return null;
  const [hall, audio, controls, toggle, next, volume, value, track, status] = nodes;
  let storage;
  let settings = { volume: 0.5, muted: false };
  try {
    storage = options.storage ?? doc.defaultView?.localStorage;
    const saved = JSON.parse(storage?.getItem(MUSIC_SETTINGS_KEY) ?? "null");
    if (saved && typeof saved.volume === "number" && Number.isFinite(saved.volume)
      && saved.volume >= 0 && saved.volume <= 1) settings.volume = saved.volume;
    if (saved && typeof saved.muted === "boolean") settings.muted = saved.muted;
  } catch { /* Preferences are optional when browser storage is unavailable. */ }
  let index = 0;
  let sourceLoaded = false;
  let playback = "paused";
  let attempt = 0;
  let pageActive = true;
  const wanted = () => hall.open && !settings.muted && pageActive;
  const save = () => {
    try { storage?.setItem(MUSIC_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Keep session settings. */ }
  };
  function render() {
    volume.value = String(Math.round(settings.volume * 100));
    value.textContent = `${volume.value}%`;
    track.textContent = `${HALL_PLAYLIST[index].title} — RandomMind`;
    toggle.textContent = settings.muted ? "Unmute music"
      : playback === "blocked" ? "Play music" : playback === "error" ? "Retry music" : "Mute music";
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
    if ((playback === "playing" || playback === "loading") && !audio.paused) {
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
    selectTrack();
    sync();
  }
  toggle.addEventListener("click", () => {
    if (settings.muted) settings.muted = false;
    else if (playback !== "blocked" && playback !== "error") settings.muted = true;
    if (playback === "error") selectTrack();
    save();
    sync();
  });
  volume.addEventListener("input", () => {
    const percent = Number(volume.value);
    if (!Number.isFinite(percent)) return;
    settings.volume = Math.max(0, Math.min(100, percent)) / 100;
    audio.volume = settings.volume;
    save();
    render();
  });
  next.addEventListener("click", advance);
  audio.addEventListener("ended", advance);
  audio.addEventListener("error", () => {
    if (!wanted() || !audio.error) return;
    ++attempt;
    playback = "error";
    render();
  });
  hall.addEventListener("toggle", sync);
  doc.defaultView?.addEventListener("pagehide", () => { pageActive = false; sync(); });
  doc.defaultView?.addEventListener("pageshow", () => { pageActive = true; sync(); });
  controls.hidden = false;
  sync();
  return { audio };
}
