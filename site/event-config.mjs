// Transitional, trusted per-event configuration. Match both fields when the bot starts a new event.
// QR destinations were decoded from the original event-assets PNGs before copying.
export const EVENT_CONFIG = [{
  name: "Longtable",
  start: "2026-09-17T13:00:00-04:00",
  links: [{ label: "Join us on Discord", url: "https://discord.gg/k6GYjek53", qr: "./assets/events/discord-k6GYjek53-qr.png" }],
}, {
  name: "Longtable",
  start: "2026-09-17T15:00:00-04:00",
  links: [{ label: "Join us on Discord", url: "https://discord.gg/k6GYjek53", qr: "./assets/events/discord-k6GYjek53-qr.png" }],
}];
// For the appropriate fundraiser event, add:
// { label: "Donate to Extra Life", url: "https://dd.extra-life.org/teams/74917", qr: "./assets/events/extra-life-team-74917-qr.png" }

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

export function eventActions(event, configurations = EVENT_CONFIG) {
  return validatedActions(configurations.find((config) => config.name === event.name && config.start === event.start)?.links);
}
