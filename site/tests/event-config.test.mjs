import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EVENT_CONFIG, eventActions, validatedActions } from "../event-config.mjs";

test("actions fail closed for unsafe URLs and credentials; labels remain literal text", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://example.org", "//example.org", "https://secret@example.org", "broken"]) {
    assert.deepEqual(validatedActions([{ label: "Click", url }]), []);
  }
  assert.deepEqual(validatedActions([{ label: "<img onerror=alert(1)>", url: "https://example.org", qr: "../secret.png" }]), [{ label: "<img onerror=alert(1)>", url: "https://example.org/", qr: null }]);
  assert.deepEqual(validatedActions(null), []);
});

test("static actions match the exact event and copied QR bytes match the decoded originals", async () => {
  const config = EVENT_CONFIG[0];
  assert.equal(eventActions(config)[0].url, "https://discord.gg/k6GYjek53");
  assert.ok(eventActions(config)[0].qr);
  assert.deepEqual(eventActions({ ...config, start: "2027-09-17T13:00:00-04:00" }), []);
  assert.deepEqual(eventActions({ ...config, name: "Another event" }), []);
  const originalHashes = {
    "discord-k6GYjek53-qr.png": "958a737d9d1d40a45083c7c1e6ce4c2afbb42f4fd4f1dc385524645e5e2312fa",
    "extra-life-team-74917-qr.png": "74c40eb6fc61dc3fc8ebb89d9b0a25cc80230704e5faa55fbc1ef603f01e6e72",
  };
  for (const [file, originalHash] of Object.entries(originalHashes)) {
    const bytes = await readFile(new URL(`../assets/events/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), originalHash);
  }
});
