// Indices are persisted in schema 3. Append choices; do not reorder them.
export const SPRITES = {
  skin: [0, 1, 2, 3],
  shirts: [[6,0],[10,0],[14,0],[6,3],[10,3],[14,3],[6,5],[10,5],[14,5],[8,7],[12,7],[16,7],[6,9],[10,9],[14,9]],
  hair: [[20,0],[21,0],[22,0],[24,0],[25,0],[26,0],[20,4],[21,4],[22,4],[24,4],[25,4],[26,4],[20,8],[21,8],[22,8],[19,2]],
  hats: [[28,8],[29,8],[30,8],[31,8]],
};

export const CHOICE_COUNTS = { skin: SPRITES.skin.length, shirt: SPRITES.shirts.length, hair: SPRITES.hair.length, hat: SPRITES.hats.length };

export function characterAppearance(person) {
  if (!person || person.hidden || person.variant === null) return null;
  return person.appearance ?? {
    skin: person.variant % 4,
    shirt: (person.variant >>> 2) % SPRITES.shirts.length,
    hair: (person.variant >>> 6) % SPRITES.hair.length,
    hat: (person.variant >>> 10) % SPRITES.hats.length,
  };
}

// Seed decorative staff by event and station so replay and refresh retain their looks.
export function staffAppearance(eventStart, station = "caretaker") {
  let variant = 2166136261;
  for (const char of `${eventStart}:${station}`) {
    variant = Math.imul(variant ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return characterAppearance({ variant, hidden: false });
}
