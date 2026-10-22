// Sprite bounds and plates are in world tiles; grids are 16 × 16 hard pixels.
export const RAID_SUBBOSS_SIZE = 3;
export const RAID_SUBBOSS_PALETTE = Object.freeze({
  g: "#dfba76", r: "#d9604c", t: "#9cdbcd", s: "#b1b5a8",
  p: "#f1eadb", d: "#55685b", a: "#b5da54", v: "#9a79c7",
});
const grids = {
  prototype_prime: [
    "................", "....gg....gg....", "....dg....gd....", "..gggggggggggg..",
    "..gdggggggggdg..", "..gdgppggppgdg..", "...ggddggddgg...", ".gggggggggggggg.",
    ".gd..gggggg..dg.", ".gd..ggrrgg..dg.", "..d..gggggg..d..", "..dgggddddgggd..",
    ".gg..d....d..gg.", ".d...d....d...d.", "gg..gg....gg..gg", "................",
  ],
  phase_matriarch: [
    "......vvvv......", "....vvttttvv....", "...vvttttttvv...", "...vtttpptttv...",
    "...vvttttttvv...", ".tt.vvttttvv.tt.", "..tt.vvvvvv.tt..", "...tttttttttt...",
    ".tt..ttvvtt..tt.", "t..tttvppvttt..t", "..tt..tvvt..tt..", ".tt...tttt...tt.",
    "tt...t....t...tt", "....tt....tt....", "...tt......tt...", "................",
  ],
  acid_titan: [
    "......aaaa......", "....aaddddaa....", "...aadassadaa...", "..aaddaaaaddaa..",
    "..addaaaaaadda..", ".dddaaappaaaddd.", ".daaddaaaaddaad.", "ddaaddddddddaadd",
    "daa..aaaaaa..aad", "dda..aarraa..add", ".dd..aaaaaa..dd.", "..ddaaaaaaaadd..",
    ".aaddd....dddaa.", ".dd..d....d..dd.", "aaa.aa....aa.aaa", "................",
  ],
  web_prophet: [
    "...p...pp...p...", "....p.p..p.p....", ".p..pp....pp..p.", "..pp..p..p..pp..",
    ".p..p..pp..p..p.", "p....pppppp....p", "p.p..pssssp..p.p", ".pppppsppsppppp.",
    ".p...pssssp...p.", "p..pp.pssp.pp..p", "..p...pppp...p..", ".p..pp....pp..p.",
    "p..p........p..p", "..p..........p..", ".p............p.", "................",
  ],
  generic: [
    "................", "......dddd......", ".....dssssd.....", "....dssssssd....",
    "..d.dssssssd.d..", "...ddssssssdd...", ".dd..dssssd..dd.", "d..dddsppsddd..d",
    "..d..dssssd..d..", ".d.dd.dssd.dd.d.", "d.d...dddd...d.d", "..d..d....d..d..",
    ".d..d......d..d.", "d..d........d..d", "................", "................",
  ],
};
function idleGrid(grid) {
  return grid.map((row, y) => y < 8 ? row : [...row].map((pixel, x) => {
    if (x < 4) return row[x + (y % 2 ? 1 : -1)] ?? ".";
    if (x > 11) return row[x + (y % 2 ? -1 : 1)] ?? ".";
    return pixel;
  }).join(""));
}
function collapsedGrid(grid) {
  const rows = Array.from({ length: 16 }, () => Array(16).fill("."));
  grid.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel !== ".") rows[9 + Math.floor(y / 3)][x] = pixel;
  }));
  return rows.map(row => row.join(""));
}
const sprites = Object.fromEntries(Object.entries(grids).map(([id, grid]) =>
  [id, Object.freeze([Object.freeze(grid), Object.freeze(idleGrid(grid)), Object.freeze(collapsedGrid(grid))])]));
export function raidSubBossSprite(id) { return Object.hasOwn(sprites, id) ? sprites[id] : sprites.generic; }

/** Stable banks leave the centre party and all Hollow plates clear, even with eight bosses. */
export function raidSubBosses(state, timeline) {
  if (!state || (state.phase !== 2 && state.phase !== 3)) return [];
  const items = state.checklist.filter(item => item.kind === "boss"), left = Math.ceil(items.length / 2);
  return items.map((item, index) => {
    const side = index < left ? 0 : 1, count = side ? items.length - left : left;
    const i = side ? index - left : index;
    const x = (side ? 40 : 7) + (count === 1 ? 8.5 : i * 17 / (count - 1)), y = 29.5;
    const plateWidth = count > 1 ? Math.min(9.5, 17 / (count - 1) - .5) : 9.5;
    return { id: item.id, name: item.name, x, y, defeated: item.done, table: item.table,
      tableName: item.table === null ? "Organizer" : timeline.tables.find(table => table.id === item.table)?.name ?? "Organizer",
      label: { x, y: 32, w: plateWidth, h: 1.2 } };
  });
}
function phaseOffset(id) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 840;
}
function paint(ctx, grid, x = 0, y = 0) {
  ctx.imageSmoothingEnabled = false;
  grid.forEach((row, gy) => [...row].forEach((pixel, gx) => {
    if (pixel === ".") return;
    ctx.fillStyle = RAID_SUBBOSS_PALETTE[pixel]; ctx.fillRect(x + gx * 6, y + gy * 6, 6, 6);
  }));
}
/** Each design's two idle frames and collapsed pose are rasterised once per room. */
export function createRaidSubBossRenderer({ createCanvas, reducedMotion = false }) {
  const cache = new Map();
  return {
    draw(ctx, boss, nowMs) {
      const sprite = raidSubBossSprite(boss.id);
      if (!cache.has(sprite)) cache.set(sprite, sprite.map(grid => {
        const canvas = createCanvas(96, 96), target = canvas?.getContext?.("2d");
        if (!target) return null;
        paint(target, grid); return canvas;
      }));
      const frame = boss.defeated ? 2 : reducedMotion ? 0 : Math.floor((nowMs + phaseOffset(boss.id)) / 420) % 2;
      const x = Math.round((boss.x - RAID_SUBBOSS_SIZE / 2) * 32);
      const y = Math.round((boss.y - RAID_SUBBOSS_SIZE / 2) * 32) + (frame === 1 ? 1 : 0);
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = boss.defeated ? .35 : 1;
      const canvas = cache.get(sprite)[frame];
      if (canvas) ctx.drawImage(canvas, x, y);
      else paint(ctx, sprite[frame], x, y);
      ctx.restore();
    },
  };
}
