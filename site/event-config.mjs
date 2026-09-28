export const INFO_SPEECHES = Object.freeze({
  before: Object.freeze([
    "Hey, welcome to Longtable! Glad you stopped by.",
    "On November 7 we're playing D&D for 24 hours straight, in person, 10 AM to 10 AM.",
    "See all these tables? Each one is a game we'll play during the event. A DM posted it, and players are grabbing seats.",
    "Come back to this page during the event and you'll see the action live: who's at which table and what's happening in the hall.",
    "We're doing it all for Extra Life. Donations go to Corewell Health Helen DeVos Children's Hospital in Grand Rapids.",
    "That thermometer at the top of the page is our running total. Scan the Donate plaque on the wall to help fill it.",
    "Want a seat at a table? Join our Discord: scan the Discord plaque or use the link up top.",
    "That's all from me. See you on November 7!",
  ]),
  during: Object.freeze([
    "Hey, welcome to Longtable! You picked a good time to drop in.",
    "We're in the middle of 24 hours of D&D, live and in person, running until 10 AM on November 8.",
    "Every table in this hall is a game on today's schedule, some playing right now and some starting later. Click one to see what it is.",
    "The hall updates live, so keep the page open or check back through the night to see what's going on.",
    "We're doing it all for Extra Life. Donations go to Corewell Health Helen DeVos Children's Hospital in Grand Rapids.",
    "Watch the thermometer at the top of the page climb. Scan the Donate plaque on the wall to add to it.",
    "Want to come play? Ask about open seats on our Discord: scan the Discord plaque or use the link up top.",
    "That's all from me. Enjoy the show!",
  ]),
  after: Object.freeze([
    "Hey, welcome to Longtable!",
    "The marathon is over: 24 hours of D&D, 10 AM November 7 to 10 AM November 8. Thanks to everyone who played.",
    "Every table in this hall is a game we played. Press Play under the map to watch the day back.",
    "It was all for Extra Life, raising money for Corewell Health Helen DeVos Children's Hospital in Grand Rapids.",
    "The thermometer at the top of the page shows where our total stands. The Donate plaque on the wall still works.",
    "Keep an eye on our Discord for the next Longtable. Thanks for stopping by!",
  ]),
  record: Object.freeze([
    "Welcome to the Longtable record!",
    "This hall is a saved copy of a past Longtable. Every table here was a game played that day.",
    "Press Play under the map to watch it back. Thanks for stopping by!",
  ]),
});

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
export function setupFundraising({ strip, total, fill, thermometer } = {}, { fetchTeam = globalThis.fetch, schedule = globalThis.setInterval,
  visible = () => document.visibilityState !== "hidden", now = Date.now,
  onVisibilityChange = (listener) => globalThis.document?.addEventListener?.("visibilitychange", listener) } = {}) {
  if (!strip) return;
  thermometer.hidden = true;
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
      const span = (className, text) => {
        const child = total.ownerDocument.createElement("span");
        child.className = className;
        child.textContent = text;
        total.append(child);
      };
      total.textContent = "";
      span("raised", `${money(team.sumDonations)} raised`);
      if (team.fundraisingGoal > 0) {
        span("goal", ` of ${money(team.fundraisingGoal)}`);
        if (team.sumDonations >= team.fundraisingGoal) span("reached", " · goal reached!");
        fill.style.width = `${Math.round(Math.min(team.sumDonations / team.fundraisingGoal, 1) * 1000) / 10}%`;
      }
      span("brand", " · Extra Life");
      thermometer.hidden = team.fundraisingGoal === 0;
      lastText = total.textContent;
      total.title = "Team total reported by Extra Life. Checks every minute; Extra Life may cache updates.";
    } catch {
      total.textContent = lastText ? `${lastText} · last available total` : "Support our Extra Life team";
      total.title = "The latest team total is temporarily unavailable. Donate in the header still opens Extra Life.";
    } finally {
      strip.hidden = false;
      pending = false;
    }
  };
  // The boot fetch runs even while the page is hidden (a background tab, a hidden pane) so the strip is
  // ready the first time the page is shown. Later polls run only while the page is visible, and showing
  // the page again refreshes a total at least a minute old instead of waiting for the next poll.
  void update();
  schedule(() => visible() ? update() : undefined, 60000);
  onVisibilityChange(() => { if (visible() && now() - lastAt >= 60000) void update(); });
  return update;
}
