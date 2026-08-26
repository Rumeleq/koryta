<template>
  <!-- Nothing paired, no heading. A section that announces itself over empty
       space reads as a page that failed to load, and on most people the
       register supports nothing here at all. -->
  <section v-if="links.length" class="px-2" data-testid="after-election">
    <div class="sec-head">
      <v-icon :icon="mdiVoteOutline" size="18" class="sec-head__icon" />
      <h3 class="text-h6">Po wyborach</h3>
    </div>

    <p class="k-lead" data-testid="after-election-lead">
      {{ lead }}
    </p>

    <article
      v-for="link in links"
      :key="link.key"
      class="k-card afel"
      :data-testid="`after-election-${link.outcome}`"
    >
      <div class="afel__flow">
        <div class="afel__side">
          <div class="afel__label">Kandydatura</div>
          <div class="afel__name">
            <NuxtLink :to="link.regionUrl" class="link-plain">
              {{ link.regionName }}
            </NuxtLink>
            <PartyChip v-if="link.party" :party="link.party" />
          </div>
          <div class="afel__when">{{ link.candidacyWhen }}</div>
          <div class="afel__outcome">
            <ChipElectionOutcome :elected="link.elected" show-unknown />
          </div>
        </div>

        <div class="afel__mid">
          <v-icon :icon="mdiArrowRight" size="18" class="afel__arrow" />
          <span class="afel__gap">{{ link.timingLabel }}</span>
          <!-- The person stood more than once in this window, so which of
               those candidacies the post followed is this page's choice
               rather than the register's. -->
          <span
            v-if="link.alsoNote"
            class="afel__hedge"
            data-testid="after-election-also-note"
          >
            {{ link.alsoNote }}
          </span>
        </div>

        <div class="afel__side">
          <div class="afel__label">Objęte stanowisko</div>
          <div class="afel__name">
            <NuxtLink :to="link.companyUrl" class="link-plain">
              {{ link.companyName }}
            </NuxtLink>
            <ChipPublicCompany :company="link.company" />
          </div>
          <div class="afel__when">{{ link.postWhen }}</div>
          <div v-if="link.role" class="afel__role">{{ link.role }}</div>
        </div>
      </div>
    </article>
  </section>
</template>

<script lang="ts" setup>
import { mdiArrowRight, mdiVoteOutline } from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import {
  linksAfterElection,
  yearOf,
  type Candidacy,
  type Post,
} from "~~/shared/afterElection";
import type { Company } from "~~/shared/model";
import type { EdgeNode } from "~/composables/edges";

const props = defineProps<{
  /** Every relation the page already holds for this person. The pairing needs
   * both kinds at once - the candidacies and the posts - and the page has
   * fetched them together, so this asks for no request of its own. */
  edges: EdgeNode[];
}>();

/* ---------- what the register holds ---------- */

/** A person's candidacies, off the election edges.
 *
 * A candidacy whose year the ingest never stored is dropped rather than
 * guessed at: the whole pairing is "the same year or the next one", and a
 * candidacy with no year cannot be either. */
const candidacies = computed<Candidacy[]>(() =>
  props.edges.flatMap((edge) => {
    if (edge.type !== "election") return [];
    const year = yearOf(edge.start_date);
    if (year === null || !edge.richNode?.id) return [];
    return [
      {
        id: edge.id,
        regionId: edge.richNode.id,
        regionName: edge.richNode.name,
        year,
        position: edge.position,
        party: edge.party,
        committee: edge.committee,
        elected: edge.elected,
      },
    ];
  }),
);

/** A person's posts, off the employment edges. A post with no start date says
 * nothing about when it followed anything. */
const posts = computed<Post[]>(() =>
  props.edges.flatMap((edge) => {
    if (edge.type !== "employed" || !edge.start_date) return [];
    if (edge.richNode?.type !== "place" || !edge.richNode.id) return [];
    return [
      {
        id: edge.id,
        companyId: edge.richNode.id,
        companyName: edge.richNode.name,
        role: edge.label,
        start: edge.start_date,
        end: edge.end_date ?? null,
      },
    ];
  }),
);

/** The company behind a post, for the public-sector chip. Looked back up on
 * the edge rather than copied into `Post`, because `shared/afterElection.ts`
 * is the rule and has no business carrying rendering data. */
function companyOf(postId: string | undefined): Company | undefined {
  const edge = props.edges.find((candidate) => candidate.id === postId);
  return edge?.richNode?.type === "place"
    ? (edge.richNode as Company)
    : undefined;
}

/* ---------- the cards ---------- */

const DAY = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** An ISO day as a Polish date, or the string itself where it is only a year -
 * which is what a hand-entered start date sometimes is, and printing it as
 * given says exactly as much as the register does. */
function whenPost(post: Post): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(post.start);
  const from = iso
    ? DAY.format(
        new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))),
      )
    : post.start;
  return post.end ? `od ${from} do ${whenEnd(post.end)}` : `od ${from} · nadal`;
}

function whenEnd(end: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  return iso
    ? DAY.format(
        new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))),
      )
    : end;
}

const links = computed(() =>
  linksAfterElection(candidacies.value, posts.value).map((link) => ({
    key: `${link.post.id ?? link.post.companyId}-${link.candidacy.id ?? link.candidacy.regionId}`,
    outcome: link.outcome,
    elected: link.candidacy.elected,
    regionName: link.candidacy.regionName,
    regionUrl: generateEntityUrl(
      "region",
      link.candidacy.regionId,
      link.candidacy.regionName,
    ),
    party: link.candidacy.party,
    // The office and the committee on one line: PKW's own two-line answer to
    // "what did they stand for", and the only thing that tells two candidacies
    // in one town in one year apart.
    candidacyWhen: [
      `wybory ${link.candidacy.year}`,
      link.candidacy.position,
      link.candidacy.committee,
    ]
      .filter(Boolean)
      .join(" · "),
    timingLabel:
      link.timing === "same-year" ? "w tym samym roku" : "w następnym roku",
    alsoNote:
      link.alsoMatching > 0
        ? `W tym oknie mieści się jeszcze ${link.alsoMatching} ` +
          `${link.alsoMatching === 1 ? "inna kandydatura" : "innych kandydatur"} - ` +
          "rejestr nie mówi, po której z nich objęto stanowisko."
        : null,
    companyName: link.post.companyName,
    companyUrl: generateEntityUrl(
      "place",
      link.post.companyId,
      link.post.companyName,
    ),
    company: companyOf(link.post.id),
    role: link.post.role,
    postWhen: whenPost(link.post),
  })),
);

/** What the section covers, in the reader's terms.
 *
 * The second sentence is the one that matters. Two dated facts next to each
 * other are not a cause, and PKW files a candidacy under a year rather than a
 * day - so "w tym samym roku" can mean an appointment two months before
 * polling day as easily as four months after it.
 */
const lead = computed(
  () =>
    "Stanowiska objęte w roku wyborów, w których ta osoba kandydowała, albo " +
    "w roku następnym. To zestawienie dwóch dat, a nie twierdzenie o " +
    "przyczynie: PKW podaje rok kandydatury, nie dzień, więc „w tym samym " +
    "roku” obejmuje też miesiące przed głosowaniem.",
);
</script>

<style scoped>
/* `succession/PersonChanges.vue`'s idiom, which is the site's card: a white
   surface, a hairline and one sage edge. Sage is a fill and a border here and
   never ink - `text-primary` on this theme is 1.85:1. */
.k-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  position: relative;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.k-card::before {
  background: rgb(var(--v-theme-primary));
  border-radius: 99px;
  bottom: 11px;
  content: "";
  left: 0;
  position: absolute;
  top: 11px;
  width: 3px;
}

.k-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.9);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.07);
}

.sec-head {
  align-items: center;
  display: flex;
  gap: 8px;
}

.sec-head__icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.k-lead {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  line-height: 1.5;
  margin: 4px 0 12px;
  max-width: 78ch;
}

/* ---- one pairing ---- */

.afel {
  margin-bottom: 8px;
  padding: 11px 12px 12px 14px;
}

.afel__flow {
  align-items: stretch;
  display: flex;
  gap: 10px;
}

.afel__side {
  flex: 1 1 0;
  min-width: 0;
}

.afel__label {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.625rem;
  letter-spacing: 0.07em;
  line-height: 1.6;
  text-transform: uppercase;
}

.afel__name {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.87);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  font-weight: 600;
  gap: 5px;
  line-height: 1.4;
  margin-top: 2px;
}

.afel__when,
.afel__role {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.6875rem;
  margin-top: 3px;
}

.afel__outcome {
  margin-top: 5px;
}

.afel__mid {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
  max-width: 15ch;
}

.afel__arrow {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.afel__gap {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.6875rem;
  line-height: 1.5;
  padding: 1px 6px;
  text-align: center;
}

/* Deliberately plain: it is a caveat, not a warning. */
.afel__hedge {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.7rem;
  line-height: 1.35;
  max-width: 22ch;
  text-align: center;
}

/* ---- phone: the two sides stack and the arrow turns with them ---- */
@media (max-width: 600px) {
  .afel__flow {
    flex-direction: column;
    gap: 6px;
  }

  .afel__mid {
    align-items: center;
    flex-direction: row;
    gap: 8px;
    justify-content: flex-start;
    max-width: none;
    padding-left: 2px;
  }

  .afel__arrow {
    transform: rotate(90deg);
  }
}
</style>
