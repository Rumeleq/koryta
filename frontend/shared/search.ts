/** The name index `/api/search` matches against.
 *
 * Firestore has no substring search, so a node carries every prefix of its own
 * name as an array and the query is one `array-contains` against whatever was
 * typed. Prefixes of the whole name are what let "anna n" find Anna Nowak;
 * prefixes of each word are what let "nowak" find her too.
 *
 * Lives here rather than beside the trigger that writes it because the emulator
 * seed has to produce the same index. It did not: the fixture carried a
 * hand-written list of *suffixes* from some earlier scheme, so searching a full
 * name found nobody, and every e2e spec that typed one had been failing on main
 * for as long as anyone had looked. Computed in one place, the two cannot drift
 * again.
 */
export function generateChunksLower(name: string): string[] {
  const chunks: string[] = [""];
  const lowerName = name.toLowerCase();

  for (let i = 1; i <= lowerName.length; i++) {
    chunks.push(lowerName.substring(0, i));
  }

  const words = lowerName.split(" ");
  if (words.length > 1) {
    for (const word of words) {
      if (word.length > 0) {
        for (let i = 1; i <= word.length; i++) {
          chunks.push(word.substring(0, i));
        }
      }
    }
  }

  return Array.from(new Set(chunks));
}
