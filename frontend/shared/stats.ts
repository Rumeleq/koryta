import type { NodeStats, VoteDocument, Note, Edge } from "./model";
import { pageIsPublic } from "./model";

export function calculateExperience(edges: Edge[]): number {
  const intervals: { start: number; end: number }[] = [];

  for (const edge of edges) {
    if (edge.type === "employed") {
      const startStr =
        edge.start_date && typeof edge.start_date === "string"
          ? edge.start_date.split("T")[0]
          : null;
      const endStr =
        edge.end_date && typeof edge.end_date === "string"
          ? edge.end_date.split("T")[0]
          : null;

      const start = startStr ? new Date(startStr).getTime() : null;
      const end = endStr ? new Date(endStr).getTime() : new Date().getTime();

      if (start && !isNaN(start) && !isNaN(end)) {
        if (start <= end) {
          intervals.push({ start, end });
        }
      }
    }
  }

  if (intervals.length === 0 || intervals[0] === undefined) {
    return 0;
  }
  intervals.sort((a, b) => a.start - b.start);

  const result = intervals.reduce<{
    mergedExperienceMs: number;
    start: number;
    end: number;
  }>(
    (acc, nextInterval) => {
      if (nextInterval.start <= acc.end) {
        acc.end = Math.max(acc.end, nextInterval.end);
      } else {
        acc.mergedExperienceMs += acc.end - acc.start;
        acc.start = nextInterval.start;
        acc.end = nextInterval.end;
      }
      return acc;
    },
    { mergedExperienceMs: 0, start: intervals[0].start, end: intervals[0].end },
  );

  result.mergedExperienceMs += result.end - result.start;

  const experienceMonths =
    result.mergedExperienceMs / (1000 * 60 * 60 * 24 * 30.44);
  return Math.floor((experienceMonths / 12) * 10) / 10;
}

export function calculateCurrentlyEmployed(edges: Edge[]): boolean {
  for (const edge of edges) {
    if (edge.type === "employed") {
      if (!edge.end_date) {
        return true;
      }
      const end = new Date(edge.end_date).getTime();
      if (!isNaN(end) && end >= new Date().getTime()) {
        return true;
      }
    }
  }
  return false;
}

export function calculateLatestEmploymentStart(edges: Edge[]): string | null {
  let latest: string | null = null;
  for (const edge of edges) {
    if (edge.type === "employed") {
      const startStr =
        edge.start_date && typeof edge.start_date === "string"
          ? edge.start_date.split("T")[0]
          : null;

      if (startStr) {
        if (!latest || startStr > latest) {
          latest = startStr;
        }
      }
    }
  }
  return latest;
}

/** Whether a vote was cast by a scoring model rather than by a person.
 *
 * The pipeline runs several models and each votes under its own uid -
 * `pipeline`, `pipeline-pagerank`, `pipeline-turnover` and so on. Matching on
 * the substring rather than on the exact name is safe because a Firebase uid is
 * 28 random alphanumerics and cannot contain a word. Mirrored in Python by
 * `is_pipeline_uid` in `data/pipelines/src/entities/person.py`, which is what
 * keeps the models from being seeded on their own output.
 */
export function isPipelineUid(uid: string | undefined | null): boolean {
  return !!uid && uid.includes("pipeline");
}

/**
 * The vote aggregate stored on a node: what people said, plus the pipeline's
 * best guess.
 *
 * Human votes sum, because each is somebody's independent opinion and two
 * people saying +3 is a stronger claim than one. Pipeline votes do not: the
 * models look at the same data from different angles and largely agree, so
 * summing them would say "five voters" where there is one dataset, and adding
 * a sixth model would silently rescale a number the explore table sorts on and
 * `bucketPublicationCandidates` cuts into 1-5 bands. Instead every model's
 * verdict collapses to the highest of them - a model that spots somebody the
 * others miss still surfaces them, and one that has nothing to say costs
 * nothing.
 *
 * `models` keeps each model's own score so a reader can see which one
 * nominated a person. `lastVotedAt` deliberately ignores the pipeline: it
 * reads as "when did somebody last look at this", and a nightly re-scoring is
 * not somebody looking.
 */
export function computeVoteStats(
  nodeVotes: VoteDocument[],
): Record<string, unknown> {
  const aggregatedVotes: Record<string, unknown> = {
    interesting: 0,
    quality: 0,
    humanVoted: false,
  };

  let latestDate: Date | null = null;
  const pipelineBest: Record<string, number> = {};
  const models: Record<string, number> = {};

  for (const v of nodeVotes) {
    const fromPipeline = isPipelineUid(v.userUid);
    if (!fromPipeline) {
      aggregatedVotes.humanVoted = true;
      if (v.updatedAt) {
        const d = new Date(v.updatedAt);
        if (!latestDate || d > latestDate) {
          latestDate = d;
        }
      }
    }

    for (const [category, value] of Object.entries(v.categoryVotes)) {
      if (fromPipeline) {
        const best = pipelineBest[category];
        pipelineBest[category] =
          best === undefined
            ? (value as number)
            : Math.max(best, value as number);
      } else {
        aggregatedVotes[category] =
          ((aggregatedVotes[category] as number) || 0) + (value as number);
      }
    }

    const interesting = v.categoryVotes.interesting;
    if (fromPipeline && typeof interesting === "number") {
      models[v.userUid] = interesting;
    }
  }

  for (const [category, best] of Object.entries(pipelineBest)) {
    aggregatedVotes[category] =
      ((aggregatedVotes[category] as number) || 0) + best;
  }

  if (Object.keys(models).length > 0) {
    aggregatedVotes.models = models;
  }

  if (latestDate) {
    aggregatedVotes.lastVotedAt = latestDate.toISOString();
  }

  return aggregatedVotes;
}

/** Keeps only employment in a place the public sector is known to own.
 *
 * The explore table reports experience and the latest employment date for
 * public institutions only — time spent in a private company is not what the
 * site tracks. Known is the operative word: a place whose ownership nobody
 * could establish is left out too, so these numbers are a floor rather than a
 * count. See `Company.isPublic` for why that gap exists.
 */
function publicEmployment(
  edges: Edge[],
  publicPlaceIds: ReadonlySet<string>,
): Edge[] {
  return edges.filter(
    (e) => e.type === "employed" && publicPlaceIds.has(e.target),
  );
}

export function computeEdgeStats(
  nodeEdges: Edge[],
  publicPlaceIds: ReadonlySet<string>,
  transitiveTargets: Record<string, string[]> = {},
) {
  const approvedEdges = nodeEdges.filter((e) => pageIsPublic(e));
  const publicEdges = publicEmployment(nodeEdges, publicPlaceIds);
  const publicApprovedEdges = publicEmployment(approvedEdges, publicPlaceIds);

  const allTargetNodeIds = [
    ...new Set(
      nodeEdges.flatMap((e) => [
        e.target,
        ...(transitiveTargets[e.target] || []),
      ]),
    ),
  ].filter(Boolean);

  const approvedTargetNodeIds = [
    ...new Set(
      approvedEdges.flatMap((e) => [
        e.target,
        ...(transitiveTargets[e.target] || []),
      ]),
    ),
  ].filter(Boolean);

  // Which companies this node is the registered seat of, kept apart from
  // `targetNodeIds` because that list is type-blind and now mixes two claims: a
  // region's targets are the companies seated in it *and* the companies it
  // holds shares in. `regionsByPlaceId` reads this one, so a gmina that owns a
  // company in the next town cannot move it there.
  //
  // No transitive fold: a seat is asserted about one region, and rolling the
  // wojewodztwo in would put every company in Poland's largest region into a
  // tie with its own powiat.
  const seatTargets = (edges: Edge[]) =>
    [
      ...new Set(edges.filter((e) => e.type === "seat").map((e) => e.target)),
    ].filter(Boolean);

  return {
    all: {
      experienceMonths: calculateExperience(publicEdges),
      latestEmploymentStart: calculateLatestEmploymentStart(publicEdges),
      targetNodeIds: allTargetNodeIds,
      seatNodeIds: seatTargets(nodeEdges),
      currentlyEmployed: calculateCurrentlyEmployed(publicEdges),
      currentlyEmployedTargetNodeIds: [
        ...new Set(
          publicEdges
            .filter((e) => calculateCurrentlyEmployed([e]))
            .flatMap((e) => [e.target, ...(transitiveTargets[e.target] || [])]),
        ),
      ].filter(Boolean),
    },
    approved: {
      experienceMonths: calculateExperience(publicApprovedEdges),
      latestEmploymentStart:
        calculateLatestEmploymentStart(publicApprovedEdges),
      targetNodeIds: approvedTargetNodeIds,
      seatNodeIds: seatTargets(approvedEdges),
      currentlyEmployed: calculateCurrentlyEmployed(publicApprovedEdges),
      currentlyEmployedTargetNodeIds: [
        ...new Set(
          publicApprovedEdges
            .filter((e) => calculateCurrentlyEmployed([e]))
            .flatMap((e) => [e.target, ...(transitiveTargets[e.target] || [])]),
        ),
      ].filter(Boolean),
    },
  };
}

export function computeNodeStats(
  nodeIsApproved: boolean,
  nodeEdges: Edge[],
  nodeNotes: Note[],
  nodeVotes: VoteDocument[],
  publicPlaceIds: ReadonlySet<string>,
  transitiveTargets: Record<string, string[]> = {},
): NodeStats {
  return {
    isApproved: nodeIsApproved,
    // We're interested in the total number of sources
    notesCount: nodeNotes
      .map((n) => n.sources?.length || 0)
      .reduce((a, b) => a + b, 0),
    votes: computeVoteStats(nodeVotes),
    edges: computeEdgeStats(nodeEdges, publicPlaceIds, transitiveTargets),
  };
}
