import {
  computed,
  inject,
  provide,
  ref,
  toValue,
  type InjectionKey,
  type MaybeRefOrGetter,
} from "vue";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { useCollection, useDocument, useFirebaseApp } from "vuefire";
import type {
  Analysis,
  AnalysisEdge,
  AnalysisEntity,
  AnalysisNote,
  AnalysisRole,
} from "~~/shared/analysis";
import {
  ANALYSIS_MAX_DEPTH,
  LOCAL_ENTITY_PREFIX,
  canEditAnalysis,
  emptyAnalysis,
  isLocalEntityId,
} from "~~/shared/analysis";
import type { EdgeType, NodeType } from "~~/shared/model";
import { useAuthState, authRequest } from "./auth";

/** The named database the app actually stores everything in.
 *
 * Not `useFirestore()`: vuefire's argument is the *app* name, so that helper
 * hands back `(default)`, which in production is a different, empty database.
 * See app/composables/notes.ts and votes.ts, which do the same thing.
 */
function analysisDb() {
  return getFirestore(useFirebaseApp(), "koryta-pl");
}

function analysisCollection() {
  return collection(analysisDb(), "analyses");
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Firestore hands out an id without needing a write, which is a better
  // fallback than a hand rolled random for the environments that predate
  // `crypto.randomUUID` - jsdom in the unit tests among them.
  return doc(analysisCollection()).id;
}

/** A structuredClone that also drops the reactivity vuefire wraps reads in.
 *
 * Whole arrays are written back on every removal, and handing Firestore a Vue
 * proxy makes it serialise the proxy's own keys. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Every analysis the signed in user can open, most recently touched first.
 *
 * Admins get all of them, which is the whole of the moderation surface: the
 * list is the only place that has to know the difference, because the firestore
 * rules let an admin read any single one already.
 */
export function useAnalysisList() {
  const { user, isAdmin } = useAuthState();

  const listQuery = computed(() => {
    if (!user.value) return null;
    const col = analysisCollection();
    if (isAdmin.value) {
      return query(col, orderBy("updatedAt", "desc"));
    }
    return query(
      col,
      where("memberUids", "array-contains", user.value.uid),
      orderBy("updatedAt", "desc"),
    );
  });

  const analyses = useCollection<Analysis>(listQuery, { wait: true });
  const pending = analyses.pending;

  async function createAnalysis(title: string, description?: string) {
    if (!user.value) throw new Error("Trzeba być zalogowanym.");
    const created = await addDoc(analysisCollection(), {
      ...emptyAnalysis(user.value.uid, title.trim(), nowIso()),
      ...(description?.trim() ? { description: description.trim() } : {}),
    });
    return created.id;
  }

  async function deleteAnalysis(id: string) {
    await deleteDoc(doc(analysisCollection(), id));
  }

  return { analyses, pending, createAnalysis, deleteAnalysis };
}

/** What /api/analyses/members hands back per member. Mirrors `AnalysisMember`
 * there; declared here so the browser bundle does not import a server route. */
export type AnalysisMemberProfile = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  role: AnalysisRole;
  isOwner: boolean;
};

/** One analysis, live, with everything the view can do to it.
 *
 * Writes go straight to Firestore from the browser rather than through a server
 * route, so that every collaborator's graph redraws as somebody types. The
 * rules in firestore.rules are what enforce who may do this; `editable` below
 * only decides whether the UI offers it.
 */
export function useAnalysis(analysisId: MaybeRefOrGetter<string>) {
  const { user, isAdmin } = useAuthState();

  const docRef = computed(() => {
    const id = toValue(analysisId);
    return id ? doc(analysisCollection(), id) : null;
  });

  const analysis = useDocument<Analysis>(docRef, { wait: true });

  const editable = computed(() =>
    canEditAnalysis(analysis.value, user.value?.uid, isAdmin.value),
  );

  /** Refuses rather than writing when the user is only a viewer, so a stale tab
   * fails here instead of getting a permission error out of Firestore. */
  function requireEditable() {
    if (!docRef.value) throw new Error("Analiza nie jest wczytana.");
    if (!editable.value) {
      throw new Error("Nie masz uprawnień do edycji tej analizy.");
    }
    if (!user.value) throw new Error("Trzeba być zalogowanym.");
    return { ref: docRef.value, uid: user.value.uid };
  }

  async function patch(fields: Record<string, unknown>) {
    const { ref } = requireEditable();
    await updateDoc(ref, { ...fields, updatedAt: nowIso() });
  }

  const entities = computed<AnalysisEntity[]>(
    () => analysis.value?.entities ?? [],
  );
  const edges = computed<AnalysisEdge[]>(() => analysis.value?.edges ?? []);
  const notes = computed<AnalysisNote[]>(() => analysis.value?.notes ?? []);

  const entityById = computed(() =>
    Object.fromEntries(entities.value.map((e) => [e.id, e])),
  );

  async function setTitle(title: string, description?: string) {
    await patch({
      title: title.trim(),
      description: (description ?? analysis.value?.description ?? "").trim(),
    });
  }

  async function setDepth(depth: number) {
    await patch({
      depth: Math.max(0, Math.min(ANALYSIS_MAX_DEPTH, Math.round(depth))),
    });
  }

  /** Adds a node from the base to the entities of interest. */
  async function addEntity(entity: {
    id: string;
    type: NodeType;
    name: string;
    note?: string;
  }) {
    const { uid } = requireEditable();
    if (entityById.value[entity.id]) return;
    const next: AnalysisEntity = {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      ...(entity.note ? { note: entity.note } : {}),
      addedBy: uid,
      addedAt: nowIso(),
    };
    await patch({ entities: [...plain(entities.value), next] });
  }

  /** Adds somebody the base has never heard of. Returns the id it was given, so
   * the caller can put them straight on one end of a relation. */
  async function addLocalEntity(entity: {
    type: NodeType;
    name: string;
    note?: string;
  }) {
    const { uid } = requireEditable();
    const next: AnalysisEntity = {
      id: LOCAL_ENTITY_PREFIX + newId(),
      type: entity.type,
      name: entity.name.trim(),
      ...(entity.note ? { note: entity.note } : {}),
      addedBy: uid,
      addedAt: nowIso(),
    };
    await patch({ entities: [...plain(entities.value), next] });
    return next.id;
  }

  async function updateEntity(id: string, fields: Partial<AnalysisEntity>) {
    requireEditable();
    await patch({
      entities: plain(entities.value).map((e) =>
        e.id === id ? { ...e, ...fields } : e,
      ),
    });
  }

  /** Drops an entity, and with it every relation and note that hung off it -
   * leaving those behind would draw edges to a node that is no longer there. */
  async function removeEntity(id: string) {
    requireEditable();
    await patch({
      entities: plain(entities.value).filter((e) => e.id !== id),
      edges: plain(edges.value).filter(
        (e) => e.source !== id && e.target !== id,
      ),
      notes: plain(notes.value).filter((n) => n.entityId !== id),
    });
  }

  async function addEdge(edge: {
    source: string;
    target: string;
    type: EdgeType;
    name?: string;
    content?: string;
  }) {
    const { uid } = requireEditable();
    const next: AnalysisEdge = {
      id: newId(),
      source: edge.source,
      target: edge.target,
      type: edge.type,
      ...(edge.name?.trim() ? { name: edge.name.trim() } : {}),
      ...(edge.content?.trim() ? { content: edge.content.trim() } : {}),
      addedBy: uid,
      addedAt: nowIso(),
    };
    await patch({ edges: [...plain(edges.value), next] });
    return next.id;
  }

  async function removeEdge(id: string) {
    requireEditable();
    await patch({ edges: plain(edges.value).filter((e) => e.id !== id) });
  }

  async function addNote(content: string, entityId?: string) {
    const { uid } = requireEditable();
    const next: AnalysisNote = {
      id: newId(),
      ...(entityId ? { entityId } : {}),
      content: content.trim(),
      authorUid: uid,
      createdAt: nowIso(),
    };
    await patch({ notes: [...plain(notes.value), next] });
    return next.id;
  }

  async function updateNote(id: string, content: string) {
    requireEditable();
    await patch({
      notes: plain(notes.value).map((n) =>
        n.id === id
          ? { ...n, content: content.trim(), updatedAt: nowIso() }
          : n,
      ),
    });
  }

  async function removeNote(id: string) {
    requireEditable();
    await patch({ notes: plain(notes.value).filter((n) => n.id !== id) });
  }

  /** Writes an analysis-local relation through to the base as a proposal.
   *
   * Both ends have to exist there first, so a relation between two people one
   * interviewee named cannot be promoted until they have been. The edge stays
   * in the analysis either way - `promotedEdgeId` is what stops it being
   * offered twice.
   */
  async function promoteEdge(id: string) {
    requireEditable();
    const edge = edges.value.find((e) => e.id === id);
    if (!edge) throw new Error("Nie ma takiego powiązania.");
    if (edge.promotedEdgeId) return edge.promotedEdgeId;

    const source = entityById.value[edge.source];
    const target = entityById.value[edge.target];
    for (const end of [source, target]) {
      if (end && isLocalEntityId(end.id) && !end.promotedNodeId) {
        throw new Error(
          `Najpierw dodaj "${end.name}" do bazy - powiązanie musi łączyć dwa istniejące podmioty.`,
        );
      }
    }

    const created = await authRequest<{ id: string }>("/api/edges/create", {
      method: "POST",
      body: {
        source: source?.promotedNodeId ?? edge.source,
        target: target?.promotedNodeId ?? edge.target,
        type: edge.type,
        name: edge.name ?? "",
        content: edge.content ?? "",
      },
    });

    await patch({
      edges: plain(edges.value).map((e) =>
        e.id === id ? { ...e, promotedEdgeId: created.id } : e,
      ),
    });
    return created.id;
  }

  /** Proposes a local entity as a real page. The proposal is unpublished until
   * a reviewer approves it, exactly as one made from anywhere else.
   *
   * /api/revisions/create takes the node's fields at the top level of the body
   * and parses them against the schema for `type`, so only the kinds in
   * `proposableNodeTypes` can be sent - and an article needs a `sourceURL` that
   * a local entity has nowhere to hold. Hence people and companies only, which
   * is also all `addLocalEntity` offers.
   */
  async function promoteEntity(id: string) {
    requireEditable();
    const entity = entityById.value[id];
    if (!entity) throw new Error("Nie ma takiego podmiotu.");
    if (entity.promotedNodeId) return entity.promotedNodeId;
    if (!isLocalEntityId(id)) return id;
    if (entity.type !== "person" && entity.type !== "place") {
      throw new Error("Do bazy można zgłosić tylko osobę albo firmę.");
    }

    const created = await authRequest<{ id: string; node_id: string }>(
      "/api/revisions/create",
      {
        method: "POST",
        body: {
          type: entity.type,
          name: entity.name,
          content: entity.note ?? "",
        },
      },
    );

    await updateEntity(id, { promotedNodeId: created.node_id });
    return created.node_id;
  }

  const members = ref<AnalysisMemberProfile[]>([]);
  const membersPending = ref(false);

  async function refreshMembers() {
    const id = toValue(analysisId);
    if (!id || !user.value) return;
    membersPending.value = true;
    try {
      const result = await authRequest<{ members: AnalysisMemberProfile[] }>(
        "/api/analyses/members",
        { method: "GET", query: { id } },
      );
      members.value = result.members;
    } finally {
      membersPending.value = false;
    }
  }

  /** Sharing goes through the server: turning an email address into a uid needs
   * the admin SDK, and doing the write there too keeps `members` and
   * `memberUids` from drifting apart. */
  async function shareWith(email: string, role: "viewer" | "editor") {
    const id = toValue(analysisId);
    await authRequest("/api/analyses/share", {
      method: "POST",
      body: { id, email: email.trim(), role },
    });
    await refreshMembers();
  }

  async function unshare(uid: string) {
    const id = toValue(analysisId);
    await authRequest("/api/analyses/share", {
      method: "POST",
      body: { id, uid, role: null },
    });
    await refreshMembers();
  }

  return {
    analysis,
    editable,
    entities,
    edges,
    notes,
    entityById,
    members,
    membersPending,
    setTitle,
    setDepth,
    addEntity,
    addLocalEntity,
    updateEntity,
    removeEntity,
    addEdge,
    removeEdge,
    addNote,
    updateNote,
    removeNote,
    promoteEdge,
    promoteEntity,
    refreshMembers,
    shareWith,
    unshare,
  };
}

export type AnalysisContext = ReturnType<typeof useAnalysis>;

const analysisKey = Symbol("analysis") as InjectionKey<AnalysisContext>;

/** Hands the open analysis to the panels below.
 *
 * The right hand side is several components deep and nearly all of them write,
 * so the alternative is threading a dozen callbacks through every level. The
 * page is the only provider, and `useAnalysisContext` throws rather than
 * returning a half-working object if one is ever rendered outside it.
 */
export function provideAnalysis(context: AnalysisContext) {
  provide(analysisKey, context);
  return context;
}

export function useAnalysisContext(): AnalysisContext {
  const context = inject(analysisKey, null);
  if (!context) {
    throw new Error("Ten komponent działa tylko wewnątrz widoku analizy.");
  }
  return context;
}
