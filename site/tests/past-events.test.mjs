import test from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, validateCatalog } from "../past-events.mjs";

const entry = { event_id: "a".repeat(32), name: "<img src=x onerror=bad()>", start: "2026-09-17T20:00:00-04:00", tz: "America/New_York", tables: 2 };
function dom() {
  const node = () => ({ children: [], textContent: "", hidden: false,
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); } });
  const nodes = new Map(["archive-list", "archive-status", "archive-retry"].map((id) => [id, node()]));
  return { getElementById: (id) => nodes.get(id), createElement: node };
}

test("catalog sorting and links only accept unique opaque identities", () => {
  const newest = { ...entry, event_id: "b".repeat(32), start: "2026-09-18T20:00:00-04:00" };
  assert.deepEqual(validateCatalog({ format: 1, events: [entry, newest] }), [newest, entry]);
  for (const patch of [{ event_id: "../live" }, { event_id: "javascript:alert(1)" }, { tables: -1 }, { start: "yesterday" }, { tz: "invalid" }]) {
    assert.throws(() => validateCatalog({ format: 1, events: [{ ...entry, ...patch }] }));
  }
  assert.throws(() => validateCatalog({ format: 1, events: [entry, entry] }));
});

test("index renders text and nested-safe links, distinguishes empty from error, and retries", async () => {
  const document = dom();
  const calls = [];
  const success = async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => ({ format: 1, events: [entry] }) }; };
  await loadCatalog(document, success);
  assert.deepEqual(calls, [["./data/events.json", { cache: "no-store" }]]);
  const link = document.getElementById("archive-list").children[0].children[0];
  assert.equal(link.textContent, entry.name);
  assert.equal(new URL(link.href, "https://example.test/project/past-events.html").pathname, `/project/events/${entry.event_id}/`);
  await loadCatalog(document, async () => ({ status: 404 }));
  assert.match(document.getElementById("archive-status").textContent, /No past events/);
  assert.equal(document.getElementById("archive-list").children.length, 0);
  await loadCatalog(document, async () => ({ status: 500, ok: false }));
  assert.equal(document.getElementById("archive-retry").hidden, false);
  assert.match(document.getElementById("archive-status").textContent, /could not be loaded/);
  await loadCatalog(document, success);
  assert.equal(document.getElementById("archive-retry").hidden, true);
  assert.equal(document.getElementById("archive-list").children.length, 1);
});
