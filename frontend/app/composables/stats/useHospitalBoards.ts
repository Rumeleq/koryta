import { computed, ref } from "vue";
import { useCurrentUser } from "vuefire";
import type { Ref } from "vue";
import type {
  HospitalStats,
  HospitalRow,
  SupervisoryGroup,
} from "~~/server/api/stats/hospitals.get";
import { supervisoryOrganLabel } from "~~/shared/companyOrgans";
import { partyColors } from "~~/shared/misc";
import { categorical, ink } from "~/utils/chartTheme";
import { generateEntityUrl } from "~/composables/slugs";

/** Who sits on the supervisory boards of publicly owned hospitals, shaped for
 * /eksploruj/szpitale.
 *
 * The endpoint already did the counting; everything here is presentation. What
 * it does add is the one rule the page is about: the seats it shows by party
 * are the ones on a **rada nadzorcza**, which KSH art. 222(1) § 1 allows a
 * spółka to pay, and never the ones on a **rada społeczna**, which the ustawa o
 * działalności leczniczej pays nothing for. The response keeps the two groups
 * apart so the exclusion can be shown rather than performed quietly - hence
 * `group`, a switch between them, rather than a filter that drops the unpaid
 * half on the way in.
 *
 * Party colours come from `partyColors`, which is the site's canonical set and
 * deliberately small: anything else is stored on a person and has no chip. A
 * party outside it, and the "no party" sentinel, are given a grey and a label
 * here rather than being handed to `PartyChip`, which emits no background at
 * all for a key it does not know.
 */

/** The sentinel /eksploruj/tabela filters on, and what the endpoint returns for
 * a seat whose holder carries no party. Repeated rather than imported: the
 * value lives in `server/utils/hospitalStats`, which the browser bundle cannot
 * reach. */
export const NO_PARTY = "__NONE__";

/** Which of the response's groups the page is showing. `other` is deliberately
 * not offered: it is the hospitals KRS names no organ for, where there is no
 * evidence either way and so nothing to break down. */
export type BoardGroup = "paid" | "unpaid";

export type PartyDisplay = {
  /** As stored on the person node, or `NO_PARTY`. */
  party: string;
  label: string;
  color: string;
  /** Whether `partyColors` knows it - i.e. whether it may go to `PartyChip`. */
  known: boolean;
};

export type PartyRow = PartyDisplay & {
  seats: number;
  people: number;
  hospitals: number;
  /** Share of the seats that could be attributed to a party at all, or null for
   * the unattributed bucket itself - a share of the group it is the remainder
   * of would be read as a party's result. */
  share: number | null;
  /** The same seats in the explore table. */
  to: string;
};

export type HospitalTableRow = {
  id: string;
  name: string;
  /** The institution's own page. */
  to: string;
  /** The people on its board, in the explore table. */
  peopleTo: string;
  organ: string;
  legalForm: string | null;
  seats: number;
  parties: PartyDisplay[];
};

export type CompositionSpec = {
  key: string;
  label: string;
  value: number;
  color: string;
  labelColor?: string;
};

/** What each group is called on the page.
 *
 * The wording is the careful part. A rada nadzorcza seat is not automatically
 * paid - KSH says a wynagrodzenie "może zostać przyznane" and the uchwała
 * wspólników decides - so it is "co do zasady odpłatna", never "płatna". A rada
 * społeczna member can be reimbursed for wages actually lost by attending
 * (art. 48 ust. 10), so it is "bez wynagrodzenia", never "nic nie dostają".
 */
export const boardGroupLabels: Record<BoardGroup, string> = {
  paid: "Rada nadzorcza — funkcja co do zasady odpłatna",
  unpaid: "Rada społeczna — funkcja pełniona bez wynagrodzenia",
};

/** Short forms, for a toggle that has to fit on a phone. */
export const boardGroupShortLabels: Record<BoardGroup, string> = {
  paid: "Rady nadzorcze",
  unpaid: "Rady społeczne",
};

/** How a party is drawn: its own colour if the site has one for it, a grey and
 * an explicit label otherwise.
 *
 * Two different greys, because "this person has no party in our database" and
 * "this party is not one the site tracks" are different answers and both end up
 * next to each other in the same bar. Neither is `ink.track`: that is the
 * colour of the remainder of a part-to-whole bar, and a slice somebody actually
 * holds must not be drawn as the space nobody holds.
 */
export function partyDisplay(party: string): PartyDisplay {
  if (party === NO_PARTY) {
    return {
      party,
      label: "Bez partii w bazie",
      color: ink.muted,
      known: false,
    };
  }
  const color = partyColors[party];
  return {
    party,
    label: party,
    color: color ?? ink.axis,
    known: !!color,
  };
}

/** A link to the same seats in the explore table: the party, narrowed to the
 * institutions this page counts. */
function partyTableLink(party: string): string {
  return `/eksploruj/tabela?party=${encodeURIComponent(party)}&category=szpitale`;
}

/** The by-party rows of one group, drawable as they stand.
 *
 * Order comes from the endpoint - most seats first, the unattributed bucket
 * always last - and is kept, so a chart drawn straight off this opens with
 * parties.
 *
 * A person with two parties holds one seat and is counted under both, so these
 * sum to more than the group's `seats`. The share is therefore taken against
 * `seatsWithParty`, the seats that carry any party at all, which is the only
 * denominator that cannot exceed 100%.
 */
export function partySeatRows(group: SupervisoryGroup | undefined): PartyRow[] {
  if (!group) return [];
  return group.byParty.map((entry) => ({
    ...partyDisplay(entry.party),
    seats: entry.seats,
    people: entry.people,
    hospitals: entry.hospitals,
    share:
      entry.party === NO_PARTY || group.seatsWithParty === 0
        ? null
        : entry.seats / group.seatsWithParty,
    to: partyTableLink(entry.party),
  }));
}

/** The hospitals of one group, with the seats they were counted for.
 *
 * Rows with no seat on record are dropped: an institution nobody has been
 * ingested for says nothing about a party, and leaving hundreds of empty rows
 * in the table buries the ones that do. `hospitalsWithSeats` on the group is
 * what states how many were left out.
 */
export function hospitalTableRows(
  group: SupervisoryGroup | undefined,
): HospitalTableRow[] {
  if (!group) return [];
  return group.rows
    .filter((row: HospitalRow) => row.seats > 0)
    .map((row: HospitalRow) => ({
      id: row.id,
      name: row.name,
      to: generateEntityUrl("place", row.id, row.name),
      peopleTo: `/eksploruj/tabela?place=${encodeURIComponent(row.id)}`,
      organ: supervisoryOrganLabel(row.supervisoryOrgan),
      legalForm: row.legalForm,
      seats: row.seats,
      parties: row.parties.map(partyDisplay),
    }));
}

/** Every publicly owned hospital, split by what supervises it.
 *
 * This is the exclusion, drawn: the blue band is what the breakdown counts,
 * the orange one is what it leaves out and why, and the grey one is the
 * hospitals
 * KRS records no organ for - most of them SPZOZ, whose rada społeczna is
 * created by statute and often never filed, so absence is not evidence of a
 * paid board.
 */
export function supervisionSegments(
  stats: HospitalStats | null | undefined,
): CompositionSpec[] {
  if (!stats) return [];
  return [
    {
      key: "paid",
      label: "Rada nadzorcza",
      value: stats.paid.hospitals,
      color: categorical[0],
    },
    {
      key: "unpaid",
      label: "Rada społeczna (nieuwzględnione)",
      value: stats.unpaid.hospitals,
      color: categorical[1],
    },
    {
      key: "other",
      label: "Bez organu w KRS lub inny organ",
      value: stats.other.hospitals,
      color: ink.track,
      labelColor: ink.secondary,
    },
  ];
}

/** Supervisory boards of publicly owned hospitals, by party.
 *
 * Awaited by the page the way /eksploruj/statystyki awaits its own fetch: the
 * numbers do not depend on who is asking, the endpoint holds them for six
 * hours, and the page is meant to be indexable, so it is server-rendered rather
 * than fetched from the browser.
 */
export async function useHospitalBoards() {
  const user = useCurrentUser();

  // Anonymous readers ask for the plain URL, which is the one the six-hour
  // cache - ours and Cloud CDN's - is holding, and the one that gets indexed.
  // A signed-in reader is the person who might have just published a board
  // member, so they ask for `latest`, which the endpoint answers `no-store`.
  // Reactive rather than read once: vuefire resolves the user after hydration,
  // so at the time of the server render there is nobody to know about yet, and
  // `useFetch` refetches when the query changes.
  const { data, pending, error, refresh } = await useFetch<HospitalStats>(
    "/api/stats/hospitals",
    { query: computed(() => (user.value ? { latest: "true" } : {})) },
  );

  /** Which group the breakdown below is showing. Paid by default: it is the
   * question the page asks. */
  const group: Ref<BoardGroup> = ref("paid");

  const selected = computed<SupervisoryGroup | undefined>(() =>
    data.value ? data.value[group.value] : undefined,
  );

  return {
    stats: data,
    pending,
    error,
    refresh,
    group,
    selected,
    partyRows: computed(() => partySeatRows(selected.value)),
    hospitalRows: computed(() => hospitalTableRows(selected.value)),
    segments: computed(() => supervisionSegments(data.value)),
    /** True once the response is in and there is not a single seat to show -
     * which is what the page looks like until the pipeline has re-submitted the
     * hospitals with their supervisory organ. */
    empty: computed(
      () =>
        !!data.value &&
        data.value.paid.seats === 0 &&
        data.value.unpaid.seats === 0,
    ),
  };
}
