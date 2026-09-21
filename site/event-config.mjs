// The current community invite is defined once and used by the header.
export const DISCORD_INVITE = "https://discord.gg/tc9NqpjBrb";

export const DONATE_URL = "https://dd.extra-life.org/teams/74917";
export const TEAM_API = "https://dd.extra-life.org/api/teams/74917";

// Optional actions for a specific event must match its name and exact start.
export const EVENT_CONFIG = [];

export function validatedActions(links) {
  if (!Array.isArray(links)) return [];
  return links.flatMap((link) => {
    if (!link || typeof link.label !== "string" || !link.label.trim() || typeof link.url !== "string") return [];
    try {
      const url = new URL(link.url);
      if (url.protocol !== "https:" || url.username || url.password) return [];
      const qr = typeof link.qr === "string" && /^\.\/assets\/events\/[A-Za-z0-9-]+\.png$/.test(link.qr) ? link.qr : null;
      return [{ label: link.label, url: url.href, qr }];
    } catch { return []; }
  });
}

// QR files must be decode-verified against their URL (see event-assets/README.md) before they are listed here.
const DISCORD_QR = "./assets/events/discord-tc9NqpjBrb-qr.png";
const DONATE_QR = "./assets/events/extra-life-team-74917-qr.png";

// The two plaques on the back wall of the hall and the kiosk rail, in hanging order.
export const WALL_PLAQUES = validatedActions([
  { label: "Join the Discord", url: DISCORD_INVITE, qr: DISCORD_QR },
  { label: "Donate · Extra Life", url: DONATE_URL, qr: DONATE_QR },
]);

// The display form of a plaque URL: host and path without the scheme, `www.` or a trailing slash.
export function shortUrl(url) {
  return String(url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

export function eventActions(event, configurations = EVENT_CONFIG) {
  const extra = configurations.find(config => config.name === event.name && config.start === event.start)?.links;
  return [
    ...validatedActions([{ label: "Discord", url: DISCORD_INVITE, qr: DISCORD_QR }, { label: "Donate", url: DONATE_URL, qr: DONATE_QR }]),
    ...validatedActions(extra).filter(action => action.url !== DISCORD_INVITE && action.url !== DONATE_URL),
  ];
}

// Extra Life's public API allows browser requests. Poll quietly; never animate totals.
export function setupFundraising(node, { fetchTeam = globalThis.fetch, schedule = globalThis.setInterval,
  visible = () => document.visibilityState !== "hidden", now = Date.now,
  onVisibilityChange = (listener) => globalThis.document?.addEventListener?.("visibilitychange", listener) } = {}) {
  if (!node) return;
  let pending = false;
  let lastText = "";
  let lastAt = -Infinity;
  const update = async () => {
    if (pending) return;
    pending = true;
    lastAt = now();
    try {
      const response = await fetchTeam(TEAM_API, { credentials: "omit", referrerPolicy: "no-referrer",
        cache: "no-cache", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Team total unavailable");
      const team = await response.json();
      if (team.teamID !== 74917 || !Number.isFinite(team.sumDonations) || team.sumDonations < 0 ||
          !Number.isFinite(team.fundraisingGoal) || team.fundraisingGoal < 0) throw new Error("Invalid team total");
      const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
      lastText = `${money(team.sumDonations)} raised` + (team.fundraisingGoal > 0 ? ` of ${money(team.fundraisingGoal)}` : "") + " · Extra Life";
      node.textContent = lastText;
      node.title = "Team total reported by Extra Life. Checks every minute; Extra Life may cache updates.";
    } catch {
      node.textContent = lastText ? `${lastText} · last available total` : "Support our Extra Life team";
      node.title = "The latest team total is temporarily unavailable. Donate still opens Extra Life.";
    } finally {
      node.hidden = false;
      pending = false;
    }
  };
  // The boot fetch runs even while the page is hidden (a background tab, a hidden pane) so the line is
  // ready the first time the page is shown. Later polls run only while the page is visible, and showing
  // the page again refreshes a total at least a minute old instead of waiting for the next poll.
  void update();
  schedule(() => visible() ? update() : undefined, 60000);
  onVisibilityChange(() => { if (visible() && now() - lastAt >= 60000) void update(); });
  return update;
}
