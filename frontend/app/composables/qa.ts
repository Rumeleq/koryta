import { computed } from "vue";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useFirebaseApp } from "vuefire";
import { useAuthState } from "./auth";
import { normalizeUpdateTime } from "~~/shared/revisions";
import {
  QA_ITEMS,
  qaCheckId,
  qaItemState,
  qaReportedByOthers,
  qaStateCounts,
  type QaCheck,
  type QaCheckStatus,
  type QaItemState,
} from "~~/shared/qa";

/** Verdicts on the QA changelog, shared by the page and the toolbar badge.
 *
 * Everybody's verdicts are read, but only this reader's decides what an entry
 * counts as - see `qaItemState`. The rest are what the page shows under "Co
 * napisali inni", so a second checker knows what to look for.
 *
 * Read once per session with `getDocs` rather than a live listener: the badge
 * hangs off the toolbar, so a listener here would be one open subscription per
 * logged in user on every page of the site, for data that changes when somebody
 * clicks a button on /qa. `saveCheck` patches the local copy, so the page the
 * click happened on updates without a re-read; `load(true)` is the way to see
 * what other people wrote since.
 */
export function useQaChecks() {
  const { user } = useAuthState();
  // Named explicitly - `useFirestore()` would hand back `(default)`, a
  // database this project does not use. See composables/auth.ts.
  const db = getFirestore(useFirebaseApp(), "koryta-pl");

  // Shared across every caller in the page, so the toolbar and the page below
  // it read the same list and only one of them pays for it.
  const checks = useState<QaCheck[]>("qa-checks", () => []);
  const loadedFor = useState<string | null>("qa-checks-loaded-for", () => null);
  const pending = useState<boolean>("qa-checks-pending", () => false);

  /** Fetches the verdicts unless this user's are already in hand. */
  async function load(force = false) {
    // Client only. The firestore handle the server renders with is not signed
    // in and does not point at the emulator, so a read there can only fail -
    // and fail unobserved, since callers do not await this.
    if (import.meta.server) return;

    const uid = user.value?.uid;
    if (!uid) {
      // Signing out has to drop the previous user's verdicts, or the badge
      // keeps counting against somebody who is no longer here.
      checks.value = [];
      loadedFor.value = null;
      return;
    }
    if (!force && loadedFor.value === uid) return;
    if (pending.value) return;

    pending.value = true;
    try {
      const snapshot = await getDocs(collection(db, "qaChecks"));
      checks.value = snapshot.docs.map((entry) => {
        const data = entry.data() as QaCheck;
        return {
          ...data,
          createdAt: normalizeUpdateTime(data.createdAt) ?? undefined,
          updatedAt: normalizeUpdateTime(data.updatedAt) ?? undefined,
        };
      });
      loadedFor.value = uid;
    } catch (error) {
      // Nothing awaits this - it runs from a watcher and from onMounted - so a
      // rejection here would go unhandled. Leaving `loadedFor` unset keeps the
      // page on its loading state and lets a later call try again, which is
      // the honest outcome: rendering every entry as unchecked would be a
      // claim about this reader that the data does not support.
      console.error("Nie udało się wczytać ocen QA", error);
    } finally {
      pending.value = false;
    }
  }

  /** Whether the verdicts in hand are this user's. Until they are, every entry
   * would read as unchecked, which is the one thing the page must not claim
   * wrongly - callers render the list only once this is true. */
  const loaded = computed(
    () => !!user.value && loadedFor.value === user.value.uid,
  );

  /** This reader's own verdict on an entry - somebody else having been through
   * it leaves it unchecked here, on purpose. */
  const stateOf = (itemId: string): QaItemState =>
    qaItemState(itemId, checks.value, user.value?.uid);

  const counts = computed(() =>
    qaStateCounts(QA_ITEMS, checks.value, user.value?.uid),
  );

  /** Whether somebody else has already reported a problem with an entry. */
  const reportedByOthers = (itemId: string): boolean =>
    qaReportedByOthers(itemId, checks.value, user.value?.uid);

  /** Every verdict on one entry, newest first. */
  const checksFor = (itemId: string): QaCheck[] =>
    checks.value
      .filter((check) => check.itemId === itemId)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const myCheck = (itemId: string): QaCheck | null =>
    checks.value.find(
      (check) => check.itemId === itemId && check.userUid === user.value?.uid,
    ) ?? null;

  async function saveCheck(
    itemId: string,
    status: QaCheckStatus,
    feedback?: string,
  ) {
    const uid = user.value?.uid;
    if (!uid) throw new Error("Trzeba być zalogowanym");

    const existing = myCheck(itemId);
    const text = feedback?.trim() ?? "";
    const stored: QaCheck = {
      itemId,
      userUid: uid,
      status,
      feedback: text,
      // Stamped by firestore, like notes: a wrong clock on one machine should
      // not reorder everybody else's feedback.
      updatedAt: serverTimestamp() as unknown as string,
    };
    if (!existing) {
      stored.createdAt = serverTimestamp() as unknown as string;
    }
    await setDoc(doc(db, "qaChecks", qaCheckId(itemId, uid)), stored, {
      merge: true,
    });

    // The stored value is a sentinel until firestore resolves it, so the local
    // copy carries this machine's clock instead - it is only used for ordering
    // and display, and is replaced by the server's value on the next load.
    const local: QaCheck = {
      ...stored,
      feedback: text,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    checks.value = [
      ...checks.value.filter(
        (check) => !(check.itemId === itemId && check.userUid === uid),
      ),
      local,
    ];
  }

  return {
    items: QA_ITEMS,
    checks,
    pending,
    loaded,
    load,
    stateOf,
    counts,
    reportedByOthers,
    checksFor,
    myCheck,
    saveCheck,
  };
}
