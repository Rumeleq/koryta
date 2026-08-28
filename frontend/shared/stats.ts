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
 * nominated a person, and `humanCount` how many people voted at all. Between
 * them they are what makes the total legible: summing and taking a maximum
 * produce the same 4, and a reader deciding where to spend the next click
 * wants to know whether it came from four models agreeing or one person
 * insisting. `VoteBreakdown` is what renders them.
 *
 * `lastVotedAt` deliberately ignores the pipeline: it reads as "when did
 * somebody last look at this", and a nightly re-scoring is not somebody
 * looking.
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
  // By uid rather than by document, because the two are not the same thing:
  // one person voting in two categories on the same node is one voter, and the
  // count is meant to answer "how many people looked at this".
  const humans = new Set<string>();

  for (const v of nodeVotes) {
    const fromPipeline = isPipelineUid(v.userUid);
    if (!fromPipeline) {
      aggregatedVotes.humanVoted = true;
      if (v.userUid) humans.add(v.userUid);
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

  if (humans.size > 0) {
    aggregatedVotes.humanCount = humans.size;
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

  return {
    all: {
      experienceMonths: calculateExperience(publicEdges),
      latestEmploymentStart: calculateLatestEmploymentStart(publicEdges),
      targetNodeIds: allTargetNodeIds,
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
