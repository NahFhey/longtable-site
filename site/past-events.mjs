/** Only opaque archive IDs form links; manifest strings are rendered as text. */
export function validateCatalog(data) {
  if (data?.format !== 1 || !Array.isArray(data.events)) throw new Error("Unsupported archive index");
  const ids = new Set();
  const entries = data.events.map((entry) => {
    if (!entry || typeof entry.event_id !== "string" || !/^[0-9a-f]{32}$/.test(entry.event_id)
      || ids.has(entry.event_id) || typeof entry.name !== "string" || !entry.name.trim()
      || typeof entry.start !== "string" || !Number.isFinite(Date.parse(entry.start))
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(entry.start) || typeof entry.tz !== "string"
      || !Number.isSafeInteger(entry.tables) || entry.tables < 0) throw new Error("Invalid archive entry");
    new Intl.DateTimeFormat("en", { timeZone: entry.tz });
    ids.add(entry.event_id);
    return { event_id: entry.event_id, name: entry.name, start: entry.start, tz: entry.tz, tables: entry.tables };
  });
  return entries.sort((a, b) => Date.parse(b.start) - Date.parse(a.start) || b.event_id.localeCompare(a.event_id));
}

export function renderCatalog(document, entries) {
  const list = document.getElementById("archive-list");
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `./events/${entry.event_id}/`;
    link.textContent = entry.name;
    const summary = document.createElement("p");
    const date = new Intl.DateTimeFormat(undefined, { timeZone: entry.tz, dateStyle: "long" }).format(new Date(entry.start));
    summary.textContent = `${date} · ${entry.tables} saved ${entry.tables === 1 ? "table" : "tables"}`;
    item.append(link, summary);
    list.append(item);
  }
  document.getElementById("archive-status").textContent = entries.length
    ? `${entries.length} archived ${entries.length === 1 ? "event" : "events"}`
    : "No past events have been published yet.";
}

export async function loadCatalog(document, fetcher = fetch) {
  const status = document.getElementById("archive-status");
  const retry = document.getElementById("archive-retry");
  retry.hidden = true;
  status.textContent = "Loading past events…";
  try {
    const response = await fetcher("./data/events.json", { cache: "no-store" });
    // The first archive publication creates the manifest.
    if (response.status === 404) return renderCatalog(document, []);
    if (!response.ok) throw new Error("Archive index unavailable");
    renderCatalog(document, validateCatalog(await response.json()));
  } catch {
    document.getElementById("archive-list").replaceChildren();
    status.textContent = "Past events could not be loaded. Please try again.";
    retry.hidden = false;
  }
}

if (typeof document !== "undefined") {
  document.getElementById("archive-retry").addEventListener("click", () => loadCatalog(document));
  loadCatalog(document);
}
