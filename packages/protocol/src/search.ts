const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const words = (query: string) => fold(query).trim().split(/\s+/).filter(Boolean);

/** Every query word must appear verbatim (case- and accent-insensitive); suited to long labels such as paths, where subsequences over-match. */
export function wordMatch(query: string, text: string): boolean {
  const target = fold(text);
  return words(query).every((word) => target.includes(word));
}

export function fuzzyMatch(query: string, text: string): boolean {
  const target = fold(text);
  return words(query).every((word) => {
    let offset = 0;
    for (const character of word) {
      const index = target.indexOf(character, offset);
      if (index < 0) return false;
      offset = index + character.length;
    }
    return true;
  });
}
