const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function fuzzyMatch(query: string, text: string): boolean {
  const target = fold(text);
  return fold(query).trim().split(/\s+/).filter(Boolean).every((word) => {
    let offset = 0;
    for (const character of word) {
      const index = target.indexOf(character, offset);
      if (index < 0) return false;
      offset = index + character.length;
    }
    return true;
  });
}
