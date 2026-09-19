import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DISCORD_INVITE, eventActions, validatedActions } from "../event-config.mjs";

test("actions fail closed for unsafe URLs and credentials; labels remain literal text", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://example.org", "//example.org", "https://secret@example.org", "broken"]) {
    assert.deepEqual(validatedActions([{ label: "Click", url }]), []);
  }
  assert.deepEqual(validatedActions([{ label: "<img onerror=alert(1)>", url: "https://example.org", qr: "../secret.png" }]), [{ label: "<img onerror=alert(1)>", url: "https://example.org/", qr: null }]);
  assert.deepEqual(validatedActions(null), []);
});

test("the community invite is shared across events and has no stale QR", () => {
  for (const event of [{name: "Longtable", start: "2026-09-19T10:30:00-04:00"}, {name: "Next event", start: "2027-01-01T10:00:00Z"}]) {
    assert.deepEqual(eventActions(event), [{ label: "Discord", url: DISCORD_INVITE, qr: null }]);
  }
});

test("additional actions match the exact event without duplicating the invite", () => {
  const config = { name: "Fundraiser", start: "2026-11-07T10:00:00-04:00", links: [
    { label: "Discord again", url: DISCORD_INVITE },
    { label: "Donate", url: "https://dd.extra-life.org/teams/74917", qr: "./assets/events/extra-life-team-74917-qr.png" },
  ] };
  const actions = eventActions(config, [config]);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].url, DISCORD_INVITE);
  assert.ok(actions[1].qr);
  assert.equal(eventActions({ ...config, name: "Another event" }, [config]).length, 1);
  assert.equal(eventActions({ ...config, start: "2027-01-01T10:00:00Z" }, [config]).length, 1);
});

test("preserved QR asset bytes match the decoded originals", async () => {
  const originalHashes = {
    "discord-k6GYjek53-qr.png": "958a737d9d1d40a45083c7c1e6ce4c2afbb42f4fd4f1dc385524645e5e2312fa",
    "extra-life-team-74917-qr.png": "74c40eb6fc61dc3fc8ebb89d9b0a25cc80230704e5faa55fbc1ef603f01e6e72",
  };
  for (const [file, originalHash] of Object.entries(originalHashes)) {
    const bytes = await readFile(new URL(`../assets/events/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), originalHash);
  }
});
