/** The QA changelog: every user visible change, newest first, with what to do
 * to convince yourself it works.
 *
 * Adding a feature means adding an entry here, in the same commit. The list is
 * plain TypeScript rather than data in firestore because it describes the code
 * as it is deployed - an entry is only meaningful next to the build that
 * contains the change, and it should be reviewed with it.
 *
 * What people did with an entry - checked it, found it broken - lives in the
 * `qaChecks` firestore collection instead, because that is per reader and
 * arrives long after the deploy. `id` is what joins the two, so ids are never
 * reused or renamed: doing so would silently move somebody's verdict onto a
 * different feature.
 */

/** Where in the site a change is visible, which decides who can check it. */
export type QaArea = "public" | "contributor" | "admin";

export type QaItem = {
  /** Stable, kebab-case, unique and never reused - it keys the stored checks.
   * Underscore free, so `${id}_${uid}` splits unambiguously. */
  id: string;
  /** ISO date (YYYY-MM-DD) the change landed. */
  date: string;
  /** What changed, in the language of somebody using the site. */
  title: string;
  /** Why it changed, or what it is for. One or two sentences. */
  description: string;
  /** What to click, in order, to see it. Each step stands on its own. */
  steps: string[];
  /** Where to start, if the change lives on one page. */
  link?: string;
  area: QaArea;
};

export const qaAreaConfig: Record<QaArea, { title: string; color: string }> = {
  public: { title: "Strona publiczna", color: "primary" },
  contributor: { title: "Dla zalogowanych", color: "info" },
  admin: { title: "Panel admina", color: "warning" },
};

/** Newest first. Prepend, never insert in the middle. */
export const QA_ITEMS: QaItem[] = [
  {
    id: "qa-changelog",
    date: "2026-08-22",
    title: "Lista zmian do sprawdzenia",
    description:
      "Ta strona. Każda nowa zmiana na stronie dostaje tu wpis z instrukcją, " +
      "co kliknąć, żeby ją zobaczyć. Zalogowany użytkownik oznacza, czy " +
      "działa, i zostawia uwagi.",
    steps: [
      "Otwórz QA z paska na górze - licznik pokazuje, ilu zmian Ty jeszcze nie sprawdziłeś.",
      "Rozwiń wpis i sprawdź, że kroki opisują to, co faktycznie widać.",
      "Kliknij „Działa” albo „Coś nie działa” i dopisz uwagę.",
      "Odśwież stronę - Twój wybór i uwaga mają się utrzymać.",
      "Przełącz filtr na „Wszystkie” - sprawdzony wpis ma zniknąć z listy „Do sprawdzenia”.",
      "Zaloguj się na drugie konto - ten sam wpis ma tam nadal czekać na sprawdzenie.",
    ],
    link: "/qa",
    area: "contributor",
  },
  {
    id: "person-places-map",
    date: "2026-08-22",
    title: "Mapa miejsc osoby w panelu bocznym",
    description:
      "Panel boczny osoby rysuje na mapie Polski województwa, w których " +
      "pracowała, zamiast wyliczać je tekstem.",
    steps: [
      "Wejdź na /eksploruj/tabela i kliknij wiersz z osobą.",
      "W panelu bocznym znajdź mapę i sprawdź, że podświetlone województwa zgadzają się z listą pracodawców.",
      "Kliknij osobę bez znanych miejsc pracy - mapy ma nie być zamiast pustej.",
    ],
    link: "/eksploruj/tabela",
    area: "public",
  },
  {
    id: "vote-label-under-pill",
    date: "2026-08-22",
    title: "Opis oceny pod pigułką, nie obok",
    description:
      "Etykieta oceny („Grube koryto”, „Ciekawe”) trafiła pod przycisk, żeby " +
      "nie rozpychała wiersza na wąskim ekranie.",
    steps: [
      "Otwórz stronę dowolnej osoby i najedź na ocenę.",
      "Sprawdź na telefonie (albo w wąskim oknie), że opis nie ucina sąsiednich elementów.",
    ],
    area: "public",
  },
  {
    id: "my-contributions",
    date: "2026-08-21",
    title: "Co się stało z moimi zgłoszeniami",
    description:
      "Profil pokazuje rewizje zgłoszone przez zalogowanego użytkownika wraz " +
      "z decyzją recenzenta.",
    steps: [
      "Zaloguj się i wejdź na /profil.",
      "Znajdź sekcję z własnymi rewizjami i sprawdź statusy (oczekuje / przyjęta / odrzucona).",
      "Kliknij rewizję - ma prowadzić do tego, czego dotyczy.",
    ],
    link: "/profil",
    area: "contributor",
  },
  {
    id: "reviewer-queue",
    date: "2026-08-21",
    title: "Jeden ekran do przeglądania kolejki rewizji",
    description:
      "Kolejka rewizji pokazuje różnicę, przycisk przyjęcia i odrzucenia w " +
      "jednym miejscu, razem z powodem odrzucenia.",
    steps: [
      "Jako admin wejdź na /admin/rewizje/kolejka.",
      "Sprawdź, że różnica wymienia tylko pola, które faktycznie się zmieniają.",
      "Odrzuć rewizję z powodem i sprawdź, że powód widać przy niej później.",
    ],
    link: "/admin/rewizje/kolejka",
    area: "admin",
  },
  {
    id: "cite-existing-relation",
    date: "2026-08-19",
    title: "Artykuł jako źródło istniejącej relacji",
    description:
      "Można wskazać artykuł jako źródło powiązania, które już jest w bazie, " +
      "bez zakładania go od nowa.",
    steps: [
      "Otwórz stronę artykułu i użyj przycisku dodania źródła do istniejącej relacji.",
      "Wybierz osobę i jej pracodawcę, których powiązanie już istnieje.",
      "Wróć na stronę osoby i sprawdź, że artykuł jest wymieniony przy tym zatrudnieniu.",
    ],
    area: "contributor",
  },
  {
    id: "person-search-by-city",
    date: "2026-08-19",
    title: "Szukanie osoby po mieście, w którym pracowała",
    description:
      "Wyszukiwarka osób dopasowuje też miasta pracodawców, nie tylko imię i " +
      "nazwisko.",
    steps: [
      "W wyszukiwarce na górze wpisz nazwę miasta, np. „Katowice”.",
      "Sprawdź, że wśród wyników są osoby zatrudnione w spółkach z tego miasta.",
      "Sprawdź, że szukanie po nazwisku nadal zwraca to co wcześniej.",
    ],
    area: "public",
  },
];

/** What a reader concluded about one entry. */
export type QaCheckStatus = "ok" | "issue";

/** One reader's verdict on one changelog entry.
 *
 * Stored in `qaChecks` under the id `${itemId}_${userUid}`, so a person has at
 * most one verdict per entry and the firestore rule can check ownership from
 * the document id alone - the same shape `votes` uses.
 */
export type QaCheck = {
  itemId: string;
  userUid: string;
  status: QaCheckStatus;
  /** What was wrong, or anything worth saying about a change that works. */
  feedback?: string;
  createdAt?: string;
  updatedAt?: string;
};

export function qaCheckId(itemId: string, userUid: string): string {
  return `${itemId}_${userUid}`;
}

/** Where an entry stands for one person.
 *
 * Verification is per reader, not per entry: an entry somebody else has been
 * through is still unchecked for everybody who has not looked at it, because
 * what QA is worth is a second pair of eyes. A verdict says only what its
 * author found; it never settles the entry for anyone else.
 */
export type QaItemState = "unchecked" | "ok" | "issue";

export function qaItemState(
  itemId: string,
  checks: readonly QaCheck[],
  userUid: string | undefined,
): QaItemState {
  if (!userUid) return "unchecked";
  const mine = checks.find(
    (check) => check.itemId === itemId && check.userUid === userUid,
  );
  return mine?.status ?? "unchecked";
}

export const qaStateConfig: Record<
  QaItemState,
  { title: string; color: string }
> = {
  unchecked: { title: "Do sprawdzenia", color: "grey" },
  ok: { title: "Sprawdzone", color: "success" },
  issue: { title: "Zgłoszony problem", color: "error" },
};

/** How many entries are in each state for this reader, for the badge on the
 * toolbar. */
export function qaStateCounts(
  items: readonly QaItem[],
  checks: readonly QaCheck[],
  userUid: string | undefined,
): Record<QaItemState, number> {
  const counts: Record<QaItemState, number> = {
    unchecked: 0,
    ok: 0,
    issue: 0,
  };
  for (const item of items) counts[qaItemState(item.id, checks, userUid)] += 1;
  return counts;
}

/** Whether anybody other than `userUid` reported a problem with an entry.
 *
 * Someone else's report does not decide this reader's verdict, but it is worth
 * knowing before they start: it says what to look for. */
export function qaReportedByOthers(
  itemId: string,
  checks: readonly QaCheck[],
  userUid: string | undefined,
): boolean {
  return checks.some(
    (check) =>
      check.itemId === itemId &&
      check.status === "issue" &&
      check.userUid !== userUid,
  );
}
