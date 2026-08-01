import { computed, type MaybeRef } from "vue";
import {
  getFirestore,
  doc,
  setDoc,
  where,
  collection,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useCollection, useFirebaseApp } from "vuefire";
import {
  mdiLinkVariant,
  mdiPencilOutline,
  mdiHelpCircleOutline,
} from "@mdi/js";
import { useAuthState } from "./auth";
import type { Note, NoteEntryKind, NoteSource } from "~~/shared/model";

/** How each note entry kind presents itself: the label on its chip, the button
 * that creates one, and the prompt above the text area. */
export const noteKindConfig: Record<
  NoteEntryKind,
  {
    title: string;
    addLabel: string;
    prompt: string;
    icon: string;
    color: string;
  }
> = {
  source: {
    title: "Źródło",
    addLabel: "Dodaj źródło",
    prompt: "Co ciekawego jest w tym źródle?",
    icon: mdiLinkVariant,
    color: "primary",
  },
  change_request: {
    title: "Do poprawy",
    addLabel: "Zgłoś poprawkę",
    prompt: "Co jest nie tak i jak powinno być?",
    icon: mdiPencilOutline,
    color: "warning",
  },
  missing: {
    title: "Brakuje danych",
    addLabel: "Zgłoś brak",
    prompt: "Czego tu brakuje?",
    icon: mdiHelpCircleOutline,
    color: "info",
  },
};

/** Entries written before kinds existed are all sources. */
export function noteKindOf(source: Pick<NoteSource, "kind">): NoteEntryKind {
  return source.kind ?? "source";
}

export function useNotes(nodeID: MaybeRef<string>) {
  const { user } = useAuthState();
  const firebaseApp = useFirebaseApp();
  const db = getFirestore(firebaseApp, "koryta-pl");

  const nodeRef = computed(() => toValue(nodeID));

  const notesQuery = computed(() => {
    return query(collection(db, "notes"), where("nodeId", "==", nodeRef.value));
  });

  const allNotes = useCollection<Note>(notesQuery, { wait: true });

  const userNote = computed(() => {
    if (!user.value) return null;
    return allNotes.value.find((n) => n.userUid === user.value?.uid) || null;
  });

  const otherNotes = computed(() => {
    if (!user.value) return allNotes.value;
    return allNotes.value.filter((n) => n.userUid !== user.value?.uid);
  });

  const saveNote = async (data: Partial<Note>) => {
    if (!user.value) throw new Error("User must be logged in");
    const docId = `${nodeRef.value}_${user.value.uid}`;
    const dataTyped: Note = {
      ...data,
      userUid: user.value.uid,
      nodeId: nodeRef.value,
      // Stamped by firestore rather than by the browser, so a wrong clock on
      // one contributor's machine cannot pin their note to the top of the
      // admin queue forever. Reads normalise it back to an ISO string.
      updatedAt: serverTimestamp() as unknown as string,
    };
    await setDoc(doc(db, "notes", docId), dataTyped, {
      merge: true,
    });
  };

  return {
    userNote,
    // TODO enable users seeing other users nodes
    otherNotes,
    saveNote,
  };
}
