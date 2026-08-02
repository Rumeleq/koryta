import { publicSectorKnown } from "~~/shared/model";
import type { NoteEntryKind, NoteSource, VoteDocument } from "~~/shared/model";

/** The four buckets a tracked person can be in, and what else is known about
 * them. `approved + reviewed + toCheck` is `total` - every person is in exactly
 * one of the three. */
export type PeopleBreakdown = {
  total: number;
  /** Published: an admin approved the latest revision. */
  approved: number;
  /** Not published, but somebody has looked: voted on or annotated. */
  reviewed: number;
  /** Not published and untouched. */
  toCheck: number;
  withVotes: number;
  withNotes: number;
  /** Has at least one employment in a place known to be public sector. */
  withPublicEmployment: number;
  /** Still holds such a post. */
  currentlyEmployed: number;
};

export type PersonStatsRow = {
  isApproved?: boolean;
  humanVoted?: boolean;
  notesCount?: number;
  experienceMonths?: number;
  currentlyEmployed?: boolean;
  /** `stats.votes.interesting`: the sum of every voter's -5..5 verdict on this
   * person, so it is not bounded by the scale one of them can cast. */
  interesting?: number;
};

export function bucketPeople(rows: PersonStatsRow[]): PeopleBreakdown {
  const breakdown: PeopleBreakdown = {
    total: rows.length,
    approved: 0,
    reviewed: 0,
    toCheck: 0,
    withVotes: 0,
    withNotes: 0,
    withPublicEmployment: 0,
    currentlyEmployed: 0,
  };

  for (const row of rows) {
    const hasVotes = row.humanVoted === true;
    const hasNotes = (row.notesCount ?? 0) > 0;

    if (row.isApproved === true) breakdown.approved++;
    else if (hasVotes || hasNotes) breakdown.reviewed++;
    else breakdown.toCheck++;

    if (hasVotes) breakdown.withVotes++;
    if (hasNotes) breakdown.withNotes++;
    if ((row.experienceMonths ?? 0) > 0) breakdown.withPublicEmployment++;
    if (row.currentlyEmployed === true) breakdown.currentlyEmployed++;
  }

  return breakdown;
}

/** Where the open-ended top bucket starts. Below it every score gets its own
 * bucket; at and above it they are pooled, because the aggregate is a sum over
 * voters and its tail is long and thin. */
const CANDIDATE_TOP_BUCKET = 5;

export type PublicationBucket = {
  /** Lowest aggregate "Dobre znalezisko" score in this bucket. */
  floor: number;
  /** True for the top bucket, which has no upper end. */
  open: boolean;
  /** Rated this well and already published. */
  approved: number;
  /** Rated this well and still not published - the work queue. */
  pending: number;
};

/**
 * People the community rated positively, split by whether their page is public
 * yet. This is the "who should we publish next" view: a tall unpublished
 * segment at a high score is a backlog of things worth showing.
 *
 * The unit is a person, not a vote. Two people rating the same person +5 is one
 * candidate, not two, and it is the person who does or does not have a public
 * page — so counting vote documents here would answer a question nobody asked.
 * That also means the buckets are aggregate scores, which run past +5.
 *
 * People at zero or below are left out: they are not candidates.
 */
export function bucketPublicationCandidates(
  rows: PersonStatsRow[],
): PublicationBucket[] {
  const buckets: PublicationBucket[] = [];
  for (let floor = 1; floor <= CANDIDATE_TOP_BUCKET; floor++) {
    buckets.push({
      floor,
      open: floor === CANDIDATE_TOP_BUCKET,
      approved: 0,
      pending: 0,
    });
  }

  for (const row of rows) {
    const score = row.interesting ?? 0;
    if (score < 1) continue;
    const index = Math.min(Math.trunc(score), CANDIDATE_TOP_BUCKET) - 1;
    const bucket = buckets[index]!;
    if (row.isApproved === true) bucket.approved++;
    else bucket.pending++;
  }

  return buckets;
}

/** Places, split by what is actually known about their ownership.
 *
 * `isPublic: false` is not evidence of private ownership - KRS simply has
 * nothing to say about most joint-stock companies - so it collapses into
 * "unknown" unless a human wrote it. See `publicSectorKnown`. */
export type PlacesBreakdown = {
  total: number;
  publicSector: number;
  /** A human confirmed the place is *not* public sector. */
  confirmedPrivate: number;
  unknown: number;
};

export function bucketPlaces(
  rows: { isPublic?: boolean; isPublicSource?: "manual" }[],
): PlacesBreakdown {
  const breakdown: PlacesBreakdown = {
    total: rows.length,
    publicSector: 0,
    confirmedPrivate: 0,
    unknown: 0,
  };

  for (const row of rows) {
    if (row.isPublic === true) breakdown.publicSector++;
    else if (publicSectorKnown(row)) breakdown.confirmedPrivate++;
    else breakdown.unknown++;
  }

  return breakdown;
}

/** Note entries, which are what an admin triages - one row per source inside a
 * note, not one per note. */
export type NotesBreakdown = {
  /** Documents: one per (author, node). */
  notes: number;
  /** Entries across all of them. */
  sources: number;
  byKind: Record<NoteEntryKind, number>;
  unresolved: number;
  resolved: number;
  /** Entries nobody has triaged yet. */
  untriaged: number;
  /** Distinct nodes somebody annotated. */
  annotatedNodes: number;
};

export function bucketNotes(
  notes: { nodeId?: string; sources?: NoteSource[] }[],
): NotesBreakdown {
  const breakdown: NotesBreakdown = {
    notes: notes.length,
    sources: 0,
    byKind: { source: 0, change_request: 0, missing: 0 },
    unresolved: 0,
    resolved: 0,
    untriaged: 0,
    annotatedNodes: 0,
  };

  const nodes = new Set<string>();
  for (const note of notes) {
    if (note.nodeId) nodes.add(note.nodeId);
    for (const source of note.sources ?? []) {
      breakdown.sources++;
      // An entry written before kinds existed is a source; see `NoteEntryKind`.
      breakdown.byKind[source.kind ?? "source"]++;
      if (source.adminStatus === "unresolved") breakdown.unresolved++;
      else if (source.adminStatus === "resolved") breakdown.resolved++;
      else breakdown.untriaged++;
    }
  }
  breakdown.annotatedNodes = nodes.size;

  return breakdown;
}

/** The scale a vote is cast on, clamped. Values outside it exist in older data
 * and are pulled to the nearest end rather than dropped. */
export const VOTE_SCALE = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5] as const;

export type VotesBreakdown = {
  /** Documents: one per (target, voter). */
  total: number;
  onNodes: number;
  onExtractions: number;
  /** Distinct people who have voted, pipeline excluded. */
  voters: number;
  /** With a free-text comment attached. */
  withComment: number;
  /** Counts per step of the -5..5 scale, per category, zeros omitted from the
   * scale itself because "no opinion" is not a vote. */
  distribution: Record<string, Record<string, number>>;
};

/** Categories worth charting. `interesting` and `quality` are the two the
 * explore table collects; the extraction reviewer's own categories are counted
 * in the totals but not broken down, because their scale is a yes/no. */
const CHARTED_CATEGORIES = ["interesting", "quality"] as const;

/** What a vote document looks like once Firestore hands it back.
 *
 * `categoryVotes` is optional here where `VoteDocument` requires it: the
 * collection predates the field being written unconditionally, and a document
 * that only carries a reviewer's comment has none. */
export type VoteRow = Pick<VoteDocument, "userUid" | "comment"> & {
  categoryVotes?: Record<string, number>;
  nodeId?: string;
  extractionId?: string;
};

export function bucketVotes(
  votes: VoteRow[],
  isPipeline: (uid: string) => boolean,
): VotesBreakdown {
  const distribution: Record<string, Record<string, number>> = {};
  for (const category of CHARTED_CATEGORIES) {
    distribution[category] = Object.fromEntries(
      VOTE_SCALE.map((step) => [String(step), 0]),
    );
  }

  const voters = new Set<string>();
  const breakdown: VotesBreakdown = {
    total: 0,
    onNodes: 0,
    onExtractions: 0,
    voters: 0,
    withComment: 0,
    distribution,
  };

  for (const vote of votes) {
    if (isPipeline(vote.userUid)) continue;

    breakdown.total++;
    if (vote.extractionId) breakdown.onExtractions++;
    else breakdown.onNodes++;
    if (vote.comment) breakdown.withComment++;
    voters.add(vote.userUid);

    for (const category of CHARTED_CATEGORIES) {
      const raw = vote.categoryVotes?.[category];
      if (typeof raw !== "number" || raw === 0) continue;
      const step = Math.max(-5, Math.min(5, Math.trunc(raw)));
      if (step === 0) continue;
      distribution[category]![String(step)]!++;
    }
  }

  breakdown.voters = voters.size;
  return breakdown;
}
