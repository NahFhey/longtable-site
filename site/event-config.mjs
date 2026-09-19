// The current community invite is defined once and used by the header.
export const DISCORD_INVITE = "https://discord.gg/tc9NqpjBrb";

// Optional actions for a specific event must match its name and exact start.
export const EVENT_CONFIG = [];
// For the appropriate fundraiser event, configure this additional link:
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
  const extra = configurations.find(config => config.name === event.name && config.start === event.start)?.links;
  return [
    ...validatedActions([{ label: "Discord", url: DISCORD_INVITE }]),
    ...validatedActions(extra).filter(action => action.url !== DISCORD_INVITE),
  ];
}
