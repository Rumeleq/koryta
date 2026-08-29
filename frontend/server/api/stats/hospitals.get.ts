import { getFirestore } from "firebase-admin/firestore";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import {
  buildHospitalStats,
  isPublicHospital,
  type BoardEdgeRow,
  type BoardPersonRow,
  type HospitalPlaceRow,
  type HospitalStats,
} from "~~/server/utils/hospitalStats";

/** Re-exported so a page can name the response without reaching into
 * `server/utils` - the same way /eksploruj/statystyki imports `DatabaseStats`
 * from stats/database.get. Types only: `server/` is not bundled for the
 * browser, so a page importing a *value* from here would not build. The
 * no-party sentinel is the literal `"__NONE__"` that /eksploruj/tabela already
 * filters on. */
export type {
  HospitalStats,
  HospitalRow,
  PartySeats,
  SupervisoryGroup,
} from "~~/server/utils/hospitalStats";

/** Firestore's ceiling on the values of an `in` clause. */
const IN_CHUNK = 30;
/** `getAll` reads as many documents as it is handed; batching keeps one request
 * from carrying every board member in the country. */
const GET_ALL_CHUNK = 100;

function chunked<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

/** Supervisory boards of publicly owned hospitals, broken down by party.
 *
 * Three reads, narrowing at each step, and every one of them projected: the
 * page needs a handful of fields and this collection holds the whole site's
 * text.
 *
 * 1. every place node, projected - the hospital filter cannot be a query. A
 *    category is stored as an array, which `sanitizeFirestoreData` turns into a
 *    numbered-key object, and `array-contains` does not match those; the same
 *    reason /api/nodes resolves its category filter in memory. It is one
 *    equality on `type`, which Firestore serves from a single-field index.
 * 2. the `employed` edges pointing at those hospitals, thirty ids at a time.
 *    `target` + `type` is the composite index already declared in
 *    firestore.indexes.json for /api/graph, so nothing new is needed. Not
 *    `fetchEdges()`, which reads the entire edges collection and is one of the
 *    known cost sinks.
 * 3. the people on the far end of those edges, by id.
 *
 * Nothing here depends on who is asking, and behind the six-hour cache the
 * whole thing runs a few dozen times a day at most.
 *
 * `editorFresh` rather than the plain cached wrapper, because the six hours are
 * held in two places and only one of them is ours: the wrapper emits
 * `s-maxage=21600`, so Cloud CDN keeps its own copy and no amount of
 * `useStorage("cache").clear()` on publication reaches it. An admin who has
 * just published a board member and reloads /eksploruj/szpitale was being shown
 * an edge-cached answer from before they did it, with nothing on the page
 * admitting it. On the `latest` path the response goes out `no-store`, which is
 * the only thing the CDN honours.
 */
export default editorFreshCachedEventHandler(
  async (): Promise<HospitalStats> => {
    const db = getFirestore("koryta-pl");

    const placesSnap = await db
      .collection("nodes")
      .where("type", "==", "place")
      .select(
        "name",
        "categories",
        "legalForm",
        "supervisoryOrgan",
        "isPublic",
        "published",
        "deleted",
      )
      .get();
    const places: HospitalPlaceRow[] = placesSnap.docs.map((doc) => ({
      ...(doc.data() as Omit<HospitalPlaceRow, "id">),
      id: doc.id,
    }));

    // Narrowed before the edge reads: this filter is what decides how many `in`
    // queries the next step costs, and it is far cheaper to apply it here than to
    // fetch the edges of every institution in the database.
    const hospitalIds = places
      .filter(isPublicHospital)
      .map((place) => place.id);

    const edges: BoardEdgeRow[] = [];
    for (const chunk of chunked(hospitalIds, IN_CHUNK)) {
      const snap = await db
        .collection("edges")
        .where("target", "in", chunk)
        .where("type", "==", "employed")
        .select("source", "target", "name", "end_date", "published", "deleted")
        .get();
      for (const doc of snap.docs) edges.push(doc.data() as BoardEdgeRow);
    }

    const personIds = [...new Set(edges.map((edge) => edge.source))].filter(
      (id): id is string => !!id,
    );
    const people: BoardPersonRow[] = [];
    for (const chunk of chunked(personIds, GET_ALL_CHUNK)) {
      const snaps = await db.getAll(
        ...chunk.map((id) => db.collection("nodes").doc(id)),
        // A person node carries their whole biography; all this needs is the
        // party, so `fetchNodesByIds` - which reads the documents whole - is
        // deliberately not reused here.
        { fieldMask: ["name", "parties", "published", "deleted"] },
      );
      for (const snap of snaps) {
        if (!snap.exists) continue;
        people.push({ ...(snap.data() as BoardPersonRow), id: snap.id });
      }
    }

    const now = new Date();
    return buildHospitalStats({
      places,
      edges,
      people,
      generatedAt: now.toISOString(),
      today: now.toISOString().slice(0, 10),
    });
  },
);
