import { logger } from "firebase-functions/logger";

// Firestore access used to be logged by hand, from the two helpers in
// server/utils/fetch.ts. Every endpoint written since then talks to the SDK
// directly, so most of the reads the bill is made of were invisible. Rather
// than adding a call to every one of them - and to every one written after
// this - the operations are counted where they all end up: on the SDK's own
// methods.
//
// The choke points, from @google-cloud/firestore's internals:
//
//   Query.get                 collection().get(), any where()/limit() query,
//                             and collection group queries
//   Firestore.getAll          db.getAll(), and DocumentReference.get(), which
//                             is implemented in terms of it
//   AggregateQuery.get        the .count().get() calls
//   Transaction.get/getAll    transactional reads, which take their own path
//                             and reach none of the above
//   WriteBatch._commit        every write there is: batch.commit(), the
//                             doc.set/update/delete/create helpers (each
//                             builds a one-op batch) and Transaction.commit()
//
// Every prototype is reached through a live Firestore instance rather than
// through the classes firebase-admin exports. The exports are re-exported
// twice over before they arrive, and a bundler that resolves them through the
// ESM shim hands back undefined for each one - which would leave the patch
// silently doing nothing, the exact failure this code exists to end.
//
// Not covered: Query.stream(), BulkWriter and listDocuments/listCollections.
// Nothing on the server uses them; add them here if that changes.
//
// scripts/check-firestore-logging.ts exercises all of it against the emulator.

const INSTRUMENTED = Symbol.for("koryta.firestore.instrumented");

type Kind = "read" | "write";

interface OpLog {
  /** Which SDK entry point ran - "query.get", "doc.get", "batch.commit", ... */
  func: string;
  kind: Kind;
  collection: string;
  /** Documents the operation handed back (read) or wrote. */
  size: number;
  /**
   * Reads Firestore charges for, where that differs from `size`: a query with
   * an offset is billed for the documents it skips as well as the ones it
   * returns, and an aggregation is billed per 1000 index entries scanned.
   */
  billed: number;
  args?: string;
  limit?: number;
  offset?: number;
  /** Documents an aggregation matched, as opposed to the reads it cost. */
  matched?: number;
  collectionGroup?: boolean;
  durationMs: number;
}

/** The parts of the SDK internals this file reads. None of them are public. */
interface QueryOptions {
  collectionId?: string;
  allDescendants?: boolean;
  filters?: InternalFilter[];
  limit?: number;
  offset?: number;
}

interface InternalFilter {
  field?: { segments?: string[] };
  filters?: InternalFilter[];
}

type AnyMethod = (...args: unknown[]) => unknown;
type Proto = Record<string, AnyMethod> & { [INSTRUMENTED]?: boolean };

interface DocRefLike {
  path: string;
  parent: { id: string };
}

function filterFields(
  filters: InternalFilter[] | undefined,
  out: string[] = [],
): string[] {
  for (const filter of filters ?? []) {
    if (filter.filters) filterFields(filter.filters, out);
    else if (filter.field?.segments) out.push(filter.field.segments.join("."));
  }
  return out;
}

/** Field names and bounds, so a route's queries can be told apart. No values. */
function describeQuery(query: unknown) {
  const options = ((query as { _queryOptions?: QueryOptions } | undefined)
    ?._queryOptions ?? {}) as QueryOptions;
  const fields = Array.from(new Set(filterFields(options.filters)));
  return {
    collection: options.collectionId ?? "unknown",
    collectionGroup: options.allDescendants || undefined,
    args: fields.join(",") || undefined,
    limit: options.limit,
    offset: options.offset,
  };
}

function getEventSafe() {
  try {
    const event = useEvent();
    const result = {
      path: event?.path,
      route: event?.context?.matchedRoute?.path,
    };
    if (result.path && result.route) {
      const queryStr = event.path.split("?", 2)[1];
      if (queryStr) {
        let safeQueryStr = queryStr;
        const paramsToSanitize = ["place", "center", "nodeId", "teryt", "id"];
        for (const param of paramsToSanitize) {
          const regex = new RegExp(`(^|&)(${param}=)[^&]*`, "g");
          safeQueryStr = safeQueryStr.replace(regex, "$1$2id");
        }
        result.route = result.route + "?" + safeQueryStr;
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

function emit(entry: OpLog) {
  try {
    const event = getEventSafe();
    const label = entry.kind === "read" ? "Firestore Read" : "Firestore Write";
    const where = entry.args
      ? `${entry.collection} ${entry.args}`
      : entry.collection;
    logger.info(
      `[${label}][${entry.func}(${where})] ${entry.size} docs, triggered by: ${event?.path ?? "unknown path"}`,
      { ...entry, ...event, eventPath: event?.route },
    );
  } catch {
    // Never let accounting break the request it is accounting for.
  }
}

/** Emits one line per collection touched, so `size` stays summable. */
function emitByCollection(
  base: Omit<OpLog, "collection" | "size" | "billed">,
  counts: Map<string, number>,
) {
  for (const [collection, size] of counts) {
    emit({ ...base, collection, size, billed: size });
  }
}

function timer() {
  const started = Date.now();
  return () => Date.now() - started;
}

/** Replaces `proto[name]`, once, with a version that logs what it returned. */
function patch(
  proto: Proto | undefined,
  name: string,
  wrap: (original: AnyMethod) => AnyMethod,
): boolean {
  if (typeof proto?.[name] !== "function") return false;
  const original = proto[name]!;
  if ((original as { [INSTRUMENTED]?: boolean })[INSTRUMENTED]) return true;
  const replacement = wrap(original);
  (replacement as { [INSTRUMENTED]?: boolean })[INSTRUMENTED] = true;
  proto[name] = replacement as AnyMethod;
  return true;
}

function countByCollection(refs: DocRefLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref.parent.id, (counts.get(ref.parent.id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Patches the Firestore SDK so every read and write is logged with the route
 * that caused it. Safe to call more than once. Returns the names of the
 * methods it took over, so the caller can see the patch land - or not.
 */
export function instrumentFirestore(db: FirebaseFirestore.Firestore): string[] {
  const globals = globalThis as { [INSTRUMENTED]?: boolean };
  if (globals[INSTRUMENTED]) return [];
  if (process.env.KORYTA_FIRESTORE_LOGGING === "off") return [];
  globals[INSTRUMENTED] = true;

  // A collection that is never read or written; it exists only as a handle on
  // the prototypes.
  const sample = db.collection("__instrumentation__");
  const docProto = Object.getPrototypeOf(sample.doc("_")) as object;
  const isDocRef = (value: unknown): value is DocRefLike =>
    value != null && Object.prototype.isPrototypeOf.call(docProto, value);

  const firestoreProto = Object.getPrototypeOf(db) as Proto;
  // CollectionReference extends Query, so Query.prototype is one link further.
  const queryProto = Object.getPrototypeOf(
    Object.getPrototypeOf(sample),
  ) as Proto;
  const aggregateProto = Object.getPrototypeOf(sample.count()) as Proto;
  const batchProto = Object.getPrototypeOf(db.batch()) as Proto;

  const patched: string[] = [];
  const record = (name: string, ok: boolean) => {
    if (ok) patched.push(name);
  };

  record(
    "query.get",
    patch(
      queryProto,
      "get",
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const elapsed = timer();
          return (original.apply(this, args) as Promise<{ size: number }>).then(
            (snapshot) => {
              const described = describeQuery(this);
              emit({
                func: "query.get",
                kind: "read",
                size: snapshot.size,
                // An offset does not save a read: the skipped documents are
                // billed, and they are not in `size`.
                billed: snapshot.size + (described.offset ?? 0),
                durationMs: elapsed(),
                ...described,
              });
              return snapshot;
            },
          );
        },
    ),
  );

  record(
    "aggregate.get",
    patch(
      aggregateProto,
      "get",
      (original) =>
        function (this: { query?: unknown }, ...args: unknown[]) {
          const elapsed = timer();
          return (
            original.apply(this, args) as Promise<{
              data: () => { count?: number };
            }>
          ).then((snapshot) => {
            const matched = snapshot.data().count;
            emit({
              func: "aggregate.get",
              kind: "read",
              size: 1,
              // An aggregation reads the index, not the documents: one read per
              // 1000 entries scanned, and never fewer than one.
              billed:
                typeof matched === "number"
                  ? Math.max(1, Math.ceil(matched / 1000))
                  : 1,
              matched,
              durationMs: elapsed(),
              ...describeQuery(this.query),
            });
            return snapshot;
          });
        },
    ),
  );

  // Covers db.getAll() and DocumentReference.get(), which is built on it.
  record(
    "firestore.getAll",
    patch(
      firestoreProto,
      "getAll",
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          // A missing document is still a read, so what is counted is the
          // references asked for, not the snapshots that came back existing.
          const refs = args.filter(isDocRef);
          const elapsed = timer();
          return (original.apply(this, args) as Promise<unknown>).then(
            (snapshots) => {
              emitByCollection(
                {
                  func: refs.length === 1 ? "doc.get" : "getAll",
                  kind: "read",
                  durationMs: elapsed(),
                },
                countByCollection(refs),
              );
              return snapshots;
            },
          );
        },
    ),
  );

  // Transactional reads bypass everything above, and Transaction is only
  // reachable once one is running - so patch its prototype off the first
  // transaction the app opens.
  record(
    "firestore.runTransaction",
    patch(
      firestoreProto,
      "runTransaction",
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const updateFunction = args[0] as (tx: unknown) => Promise<unknown>;
          const wrapped = (tx: unknown) => {
            instrumentTransaction(Object.getPrototypeOf(tx) as Proto, isDocRef);
            return updateFunction(tx);
          };
          return original.apply(this, [
            wrapped,
            ...args.slice(1),
          ]) as Promise<unknown>;
        },
    ),
  );

  // Every write in the SDK is a WriteBatch commit underneath - doc.set() and
  // friends each build a one-operation batch, and a transaction commits the
  // batch it has been accumulating. `_commit` is what both public paths call;
  // `commit` is the fallback if a future SDK drops the underscore method.
  const commitMethod =
    typeof batchProto._commit === "function" ? "_commit" : "commit";
  record(
    `batch.${commitMethod}`,
    patch(
      batchProto,
      commitMethod,
      (original) =>
        function (this: { _ops?: { docPath: string }[] }, ...args: unknown[]) {
          // _commit empties _ops once it has built the request, so read the
          // paths now rather than in the continuation.
          const counts = new Map<string, number>();
          for (const op of this._ops ?? []) {
            const segments = op.docPath.split("/");
            const collection = segments[segments.length - 2] ?? "unknown";
            counts.set(collection, (counts.get(collection) ?? 0) + 1);
          }
          const elapsed = timer();
          return (original.apply(this, args) as Promise<unknown>).then(
            (result) => {
              emitByCollection(
                { func: "batch.commit", kind: "write", durationMs: elapsed() },
                counts,
              );
              return result;
            },
          );
        },
    ),
  );

  return patched;
}

function instrumentTransaction(
  proto: Proto,
  isDocRef: (value: unknown) => value is DocRefLike,
) {
  patch(
    proto,
    "get",
    (original) =>
      function (this: unknown, refOrQuery: unknown, ...rest: unknown[]) {
        const elapsed = timer();
        return (
          original.apply(this, [refOrQuery, ...rest] as unknown[]) as Promise<{
            size?: number;
          }>
        ).then((snapshot) => {
          const doc = isDocRef(refOrQuery) ? refOrQuery : undefined;
          // A query snapshot counts its documents; a document snapshot is one
          // read whether or not the document turned out to exist.
          const size = doc ? 1 : (snapshot.size ?? 1);
          emit({
            func: doc ? "tx.doc.get" : "tx.query.get",
            kind: "read",
            size,
            billed: size,
            durationMs: elapsed(),
            ...(doc
              ? { collection: doc.parent.id }
              : describeQuery(
                  (refOrQuery as { query?: unknown }).query ?? refOrQuery,
                )),
          });
          return snapshot;
        });
      },
  );

  patch(
    proto,
    "getAll",
    (original) =>
      function (this: unknown, ...args: unknown[]) {
        const refs = args.filter(isDocRef);
        const elapsed = timer();
        return (original.apply(this, args) as Promise<unknown>).then(
          (snapshots) => {
            emitByCollection(
              { func: "tx.getAll", kind: "read", durationMs: elapsed() },
              countByCollection(refs),
            );
            return snapshots;
          },
        );
      },
  );
}
