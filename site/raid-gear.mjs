import { characterAppearance } from "./characters.mjs?v=7e98c9c03b67";

const SHIELDS = [
  [33,0],[34,0],[35,0],[36,0],[37,0],[38,0],[39,0],
  [33,1],[34,1],[35,1],[36,1],[37,1],[38,1],[39,1],
  [33,2],[34,2],[37,2],[38,2],
  [33,3],[34,3],[35,3],[36,3],[37,3],[38,3],[39,3],
  [33,4],[34,4],[35,4],[36,4],[37,4],[38,4],[39,4],
  [33,5],[34,5],[37,5],[38,5],
  [33,6],[34,6],[35,6],[36,6],[37,6],[38,6],[39,6],
  [33,7],[34,7],[35,7],[36,7],[37,7],[38,7],[39,7],
  [33,8],[34,8],[37,8],[38,8],
  [40,0],[40,1],[40,3],[40,4],[40,6],[40,7],
];
const WEAPONS = Array.from({ length: 12 }, (_, i) => i + 42).flatMap(column =>
  Array.from({ length: column < 52 ? 10 : 5 }, (_, row) => [column, row]));

/** Gear belongs to the person's id, independent of event time or table membership. */
export function raidGear(person) {
  if (characterAppearance(person) === null) return null;
  // FNV-1a over the id's UTF-16 code units, with fixed unsigned 32-bit arithmetic.
  const id = String(person.id);
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  const weapon = WEAPONS[hash % WEAPONS.length];
  const shield = weapon[0] < 52 && ((hash >>> 16) & 1) ? SHIELDS[(hash >>> 8) % SHIELDS.length] : null;
  return { weapon: [...weapon], shield: shield ? [...shield] : null };
}
