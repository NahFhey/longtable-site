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


// Model textContent's child aggregation and replacement without HTML-string rendering.
function fundraisingNodes() {
  const ownerDocument = { createElement() {
    return { ownerDocument, children: [], style: {}, _text: "",
      get textContent() { return this._text + this.children.map(child => child.textContent).join(""); },
      set textContent(value) { this._text = value; this.children = []; },
      append(child) { this.children.push(child); },
    };
  } };
  return { strip: { hidden: true }, total: ownerDocument.createElement(), fill: { style: {} },
    thermometer: { hidden: false }, donate: {} };
}

test('fundraising refreshes valid totals, retains stale values, and rejects invalid data', async () => {
  const nodes = fundraisingNodes();
  const node = nodes.total;
  let callback;
  let team = { teamID: 74917, sumDonations: 20, fundraisingGoal: 2500 };
  const update = setupFundraising(nodes, { fetchTeam: async () => ({ ok: true, json: async () => team }),
    schedule(fn, ms) { callback = fn; assert.equal(ms, 60000); }, visible: () => true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(node.textContent, '$20 raised of $2,500 · Extra Life');
  assert.deepEqual(node.children.map(child => child.className), ["raised", "goal", "brand"]);
  assert.equal(nodes.fill.style.width, "0.8%");
  assert.equal(nodes.thermometer.hidden, false);
  assert.equal(nodes.strip.hidden, false);
  assert.equal(nodes.donate.href, DONATE_URL);
  assert.match(node.title, /Checks every minute/);
  team.sumDonations = 125.50;
  await callback();
  assert.match(node.textContent, /\$125.50 raised/);
  team = { teamID: 99, sumDonations: 10000, fundraisingGoal: 2500 };
  await update();
  assert.match(node.textContent, /125.50.*last available total/);
  assert.doesNotMatch(node.textContent, /10,000/);
  assert.equal(node.textContent, "$125.50 raised of $2,500 · Extra Life · last available total");
  assert.equal(nodes.fill.style.width, "5%");
  assert.equal(nodes.thermometer.hidden, false);
  assert.match(node.title, /temporarily unavailable/);
});

test('fundraising fetches once at a hidden boot, polls only while visible, and refreshes a stale total on show', async () => {
  const nodes = fundraisingNodes();
  const node = nodes.total;
  let visible = false;
  let clock = 1_000_000;
  let fetches = 0;
  let poll;
  let onShow;
  const team = { teamID: 74917, sumDonations: 20, fundraisingGoal: 2500 };
  setupFundraising(nodes, {
    fetchTeam: async () => { fetches += 1; return { ok: true, json: async () => ({ ...team, sumDonations: 20 + fetches }) }; },
    schedule(fn) { poll = fn; }, visible: () => visible, now: () => clock, onVisibilityChange(fn) { onShow = fn; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 1, 'the boot fetch runs while hidden so the line is ready when the page is shown');
  assert.equal(nodes.strip.hidden, false);
  assert.equal(node.textContent, '$21 raised of $2,500 · Extra Life');
  await poll();
  assert.equal(fetches, 1, 'hidden pages do not poll');
  visible = true;
  clock += 30_000;
  onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 1, 'showing the page within a minute of the last fetch keeps the current total');
  clock += 30_000;
  onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 2, 'showing the page with a stale total refreshes it at once');
  assert.equal(node.textContent, '$22 raised of $2,500 · Extra Life');
  await poll();
  assert.equal(fetches, 3, 'visible pages poll');
  visible = false;
  onShow();
  await poll();
  assert.equal(fetches, 3);
});


test("fundraising caps at the goal, marks it reached, and hides the thermometer for goal zero", async () => {
  const nodes = fundraisingNodes();
  let team = { teamID: 74917, sumDonations: 2600, fundraisingGoal: 2500 };
  const update = setupFundraising(nodes, {
    fetchTeam: async () => ({ ok: true, json: async () => team }), schedule() {}, onVisibilityChange() {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.fill.style.width, "100%");
  assert.equal(nodes.total.textContent, "$2,600 raised of $2,500 · goal reached! · Extra Life");
  assert.deepEqual(nodes.total.children.map(child => child.className), ["raised", "goal", "reached", "brand"]);
  team.sumDonations = 2500;
  await update();
  assert.equal(nodes.total.textContent, "$2,500 raised of $2,500 · goal reached! · Extra Life");
  team.fundraisingGoal = 0;
  await update();
  assert.equal(nodes.thermometer.hidden, true);
  assert.equal(nodes.total.textContent, "$2,500 raised · Extra Life");
  assert.deepEqual(nodes.total.children.map(child => child.className), ["raised", "brand"]);
  team.teamID = 99;
  await update();
  assert.equal(nodes.thermometer.hidden, true);
  assert.equal(nodes.fill.style.width, "100%");
  assert.equal(nodes.total.textContent, "$2,500 raised · Extra Life · last available total");
});

test("first failure shows support text and Donate; recovery restores the spans and thermometer", async () => {
  const failures = [new Error("offline"), { ok: false },
    ...[{ teamID: 99 }, { sumDonations: -1 }, { sumDonations: NaN }, { fundraisingGoal: -1 }, { fundraisingGoal: Infinity }]
      .map(invalid => ({ ok: true, json: async () => ({ teamID: 74917, sumDonations: 20, fundraisingGoal: 2500, ...invalid }) }))];
  for (const failure of failures) {
    const nodes = fundraisingNodes();
    let response = failure;
    const update = setupFundraising(nodes, {
      fetchTeam: async (url, init) => {
        assert.equal(url, "https://dd.extra-life.org/api/teams/74917");
        assert.equal(init.credentials, "omit");
        assert.equal(init.referrerPolicy, "no-referrer");
        assert.equal(init.cache, "no-cache");
        assert.ok(init.signal instanceof AbortSignal);
        if (response instanceof Error) throw response;
        return response;
      }, schedule() {}, onVisibilityChange() {},
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.strip.hidden, false);
    assert.equal(nodes.total.textContent, "Support our Extra Life team");
    assert.equal(nodes.thermometer.hidden, true);
    assert.equal(nodes.donate.href, DONATE_URL);
    response = { ok: true, json: async () => ({ teamID: 74917, sumDonations: 0, fundraisingGoal: 2500 }) };
    await update();
    assert.equal(nodes.thermometer.hidden, false);
    assert.equal(nodes.fill.style.width, "0%");
    assert.equal(nodes.total.textContent, "$0 raised of $2,500 · Extra Life");
    response = failure;
    await update();
    await update();
    assert.equal(nodes.total.textContent, "$0 raised of $2,500 · Extra Life · last available total");
    assert.equal(nodes.fill.style.width, "0%");
    assert.equal(nodes.thermometer.hidden, false);
  }
});


test("the fundraising strip sits before the masthead with one total and an accessible name", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal((html.match(/id="fundraising-total"/g) ?? []).length, 1);
  assert.match(html, /class="skip-link"[^>]*>[^<]*<\/a>\s*<section id="fundraising-strip"/);
  assert.match(html, /id="fundraising-strip"[^>]*aria-label="Extra Life fundraising"[^>]*hidden/);
  assert.match(html, /id="thermometer"[^>]*aria-hidden="true"/);
  assert.match(html, /id="fundraising-donate"[^>]*>Donate<\/a>\s*<\/section>\s*<header class="masthead">/);
});
