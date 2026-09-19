import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("runtime rendering does not use HTML-string injection sinks", async () => {
  const source = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML\s*\(/);
  assert.doesNotMatch(source, /document\.write\s*\(/);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /document\.createElement\s*\(/);
});

test("production loader is explicit, no-store, and never falls back to sample data", async () => {
  const source = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  assert.match(source, /get\("sample"\) === "1"/);
  assert.match(source, /state\.archive \|\| state\.sample/);
  assert.match(source, /state\.archive \? "\.\/timeline\.json" : "\.\/data\/timeline\.sample\.json"/);
  assert.match(source, /fetch\(url, \{ cache: "no-store", signal: AbortSignal\.timeout\(8000\) \}\)/);
  assert.doesNotMatch(source, /catch\s*\{[^}]*timeline\.sample\.json/);
});

test("current canvas events have an atomic live region populated through textContent", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="current-event"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(source, /\$\("current-event"\)\.textContent !== eventText/);
  assert.match(source, /\$\("current-event"\)\.textContent = eventText/);
});

test("LIVE badge colors meet WCAG AA contrast", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const ink = styles.match(/--ink:\s*(#[0-9a-f]{6})/i)?.[1];
  const live = styles.match(/--live:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(ink && live);
  assert.match(styles, /\.badge\.live\s*\{[^}]*background:\s*var\(--live\)/s);

  const luminance = (hex) => hex.match(/[0-9a-f]{2}/gi).map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const first = luminance(ink);
  const second = luminance(live);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  assert.ok(ratio >= 4.5, `LIVE badge contrast is only ${ratio.toFixed(2)}:1`);
});
