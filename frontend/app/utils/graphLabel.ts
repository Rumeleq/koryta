/** How wide a label line may get before it is broken, in characters.
 *
 * Not a measurement - the graph draws at whatever zoom the reader has - but a
 * width that keeps an institution's name from reaching across the canvas and
 * over the nodes on either side of it. Roughly two words of Polish. */
const MAX_CHARS = 18;

/** How many lines one label may take.
 *
 * The names that need breaking at all are the long institutional ones, and
 * those run to a hundred characters - "Wojewódzki Fundusz Ochrony Środowiska i
 * Gospodarki Wodnej w ...". Four lines is enough to reach the part that tells
 * two of them apart, which is usually the town at the end, and past that a
 * label is a paragraph sitting on top of the graph. */
const MAX_LINES = 4;

/** Break a node's name into lines the canvas can hold.
 *
 * v-network-graph splits label text on newlines and draws a `tspan` per line,
 * so wrapping is a matter of putting them in. Words are kept whole where they
 * fit; one longer than a whole line - a run-together name, an address - is cut
 * rather than allowed to set the width on its own.
 *
 * A label that runs past `maxLines` ends in an ellipsis: the node is still
 * there to click through to, and the alternative is a caption that covers what
 * it is a caption for.
 */
export function wrapLabel(
  text: string,
  { maxChars = MAX_CHARS, maxLines = MAX_LINES } = {},
): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];

  for (const word of words) {
    let rest = word;
    // A word wider than the line gets broken where the line ends, since no
    // amount of wrapping will make it fit.
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }

    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + rest.length <= maxChars) {
      lines[lines.length - 1] = `${last} ${rest}`;
    } else if (rest) {
      lines.push(rest);
    }
  }

  if (lines.length <= maxLines) return lines.join("\n");

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/\s+$/, "")}…`;
  return kept.join("\n");
}
