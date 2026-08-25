/** A person's name reduced to what two spellings of the same person share.
 *
 * The extraction pipeline writes the name as the article spelled it, and the
 * graph stores whatever the register did. Joining a fact to the person node the
 * mention matcher confirmed means comparing those two strings, and comparing
 * them verbatim fails on the things that carry no meaning: case, the diacritics
 * a newsroom CMS sometimes drops, and whether a double surname was hyphenated.
 *
 * Deliberately looser than `createSlug`, which has to stay a url segment: this
 * only has to be stable enough that "Rafał Trzaskowski" and "Rafal
 * Trzaskowski" land on the same key. It does not try to be clever about
 * initials, middle names or declension - a fact naming somebody differently
 * from the graph is left unmatched rather than matched to a guess.
 */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // ą ć ę ń ó ś ź ż lose their marks
    .replace(/[łŁ]/g, "l") // ł is its own codepoint, so NFD leaves it alone
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // hyphens, dots and quotes are word breaks
    .trim();
}
