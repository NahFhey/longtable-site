import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DISCORD_INVITE, DONATE_URL, WALL_PLAQUES, setupFundraising, eventActions, shortUrl, validatedActions } from "../event-config.mjs";

test("actions fail closed for unsafe URLs and credentials; labels remain literal text", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://example.org", "//example.org", "https://secret@example.org", "broken"]) {
    assert.deepEqual(validatedActions([{ label: "Click", url }]), []);
  }
  assert.deepEqual(validatedActions([{ label: "<img onerror=alert(1)>", url: "https://example.org", qr: "../secret.png" }]), [{ label: "<img onerror=alert(1)>", url: "https://example.org/", qr: null }]);
  assert.deepEqual(validatedActions(null), []);
});

test("the community invite is shared across events and both header actions carry the current QR", () => {
  for (const event of [{name: "Longtable", start: "2026-09-19T10:30:00-04:00"}, {name: "Next event", start: "2027-01-01T10:00:00Z"}]) {
    assert.deepEqual(eventActions(event), [
      { label: "Discord", url: DISCORD_INVITE, qr: "./assets/events/discord-tc9NqpjBrb-qr.png" },
      { label: "Donate", url: DONATE_URL, qr: "./assets/events/extra-life-team-74917-qr.png" },
    ]);
  }
});

test("the wall plaques are two validated entries in hanging order sharing the header's constants", () => {
  assert.deepEqual(WALL_PLAQUES, [
    { label: "Join the Discord", url: DISCORD_INVITE, qr: "./assets/events/discord-tc9NqpjBrb-qr.png" },
    { label: "Donate · Extra Life", url: DONATE_URL, qr: "./assets/events/extra-life-team-74917-qr.png" },
  ]);
  assert.deepEqual(WALL_PLAQUES.map((plaque) => plaque.qr), eventActions({ name: "Any", start: "2027-01-01T10:00:00Z" }).map((action) => action.qr));
  assert.doesNotMatch(DISCORD_INVITE, /k6GYjek53/, "the stale invite must never be the current one");
});

test("shortUrl strips the scheme, www. and a trailing slash", () => {
  assert.equal(shortUrl(DISCORD_INVITE), "discord.gg/tc9NqpjBrb");
  assert.equal(shortUrl(DONATE_URL), "dd.extra-life.org/teams/74917");
  assert.equal(shortUrl("https://www.example.org/"), "example.org");
  assert.equal(shortUrl("https://www.example.org/path/"), "example.org/path");
  assert.equal(shortUrl("http://example.org/a/b"), "example.org/a/b");
});

test("additional actions match the exact event without duplicating the invite", () => {
  const config = { name: "Fundraiser", start: "2026-11-07T10:00:00-04:00", links: [
    { label: "Discord again", url: DISCORD_INVITE },
    { label: "Donate", url: "https://dd.extra-life.org/teams/74917", qr: "./assets/events/extra-life-team-74917-qr.png" },
  ] };
  const actions = eventActions(config, [config]);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].url, DISCORD_INVITE);
  assert.equal(actions[1].url, DONATE_URL);
  assert.ok(actions.every((action) => action.qr), "the built-in actions keep their QR while duplicates from extra are dropped");
  assert.equal(eventActions({ ...config, name: "Another event" }, [config]).length, 2);
  assert.equal(eventActions({ ...config, start: "2027-01-01T10:00:00Z" }, [config]).length, 2);
});

test("preserved QR asset bytes match the decoded originals", async () => {
  const originalHashes = {
    "discord-k6GYjek53-qr.png": "958a737d9d1d40a45083c7c1e6ce4c2afbb42f4fd4f1dc385524645e5e2312fa",
    "extra-life-team-74917-qr.png": "74c40eb6fc61dc3fc8ebb89d9b0a25cc80230704e5faa55fbc1ef603f01e6e72",
    "discord-tc9NqpjBrb-qr.png": "95d08cf16c7347866ddf8aa53393223f7008159496cde1049d20828b11e27ada",
  };
  for (const [file, originalHash] of Object.entries(originalHashes)) {
    const bytes = await readFile(new URL(`../assets/events/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), originalHash);
  }
});


test('fundraising refreshes valid totals, retains stale values, and rejects invalid data', async () => {
  const node = { hidden: true };
  let callback;
  let team = { teamID: 74917, sumDonations: 20, fundraisingGoal: 2500 };
  const update = setupFundraising(node, { fetchTeam: async () => ({ ok: true, json: async () => team }),
    schedule(fn, ms) { callback = fn; assert.equal(ms, 60000); }, visible: () => true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(node.textContent, '$20 raised of $2,500 · Extra Life');
  team.sumDonations = 125.50;
  await callback();
  assert.match(node.textContent, /\$125.50 raised/);
  team = { teamID: 99, sumDonations: 10000, fundraisingGoal: 2500 };
  await update();
  assert.match(node.textContent, /125.50.*last available total/);
  assert.doesNotMatch(node.textContent, /10,000/);
});
