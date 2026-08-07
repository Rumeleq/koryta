import { z } from "zod";
import { getAuth } from "firebase-admin/auth";
import { defineEventHandler, getValidatedQuery } from "h3";
import { getUser } from "~~/server/utils/auth";
import { requireAnalysis } from "~~/server/utils/analyses";
import type { AnalysisRole } from "~~/shared/analysis";

const queryValidator = z.object({ id: z.string().min(1) });

export type AnalysisMember = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  role: AnalysisRole;
  isOwner: boolean;
};

/** Who an analysis is shared with, with names to show them by.
 *
 * /api/users/lookup would answer the same question but is admin only, because
 * resolving arbitrary uids to email addresses is not something a reader should
 * be able to do. Here the set of uids is not the caller's choice - it is
 * whoever is already in an analysis they are themselves in - so the same data
 * is safe to hand back.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const { id } = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const { data } = await requireAnalysis(user, id, "read");

  // `requireAnalysis` granted a role, which it can only have read out of
  // `members`, so the map is there.
  const uids = Object.keys(data.members);
  if (uids.length === 0) return { members: [] };

  const looked = await getAuth().getUsers(uids.map((uid) => ({ uid })));
  const profiles = new Map(looked.users.map((u) => [u.uid, u]));

  const members: AnalysisMember[] = uids.map((uid) => {
    const profile = profiles.get(uid);
    return {
      uid,
      displayName: profile?.displayName ?? null,
      email: profile?.email ?? null,
      photoURL: profile?.photoURL ?? null,
      role: data.members[uid] ?? "viewer",
      isOwner: data.ownerUid === uid,
    };
  });

  // The owner first, then editors, then viewers, so the list reads as a
  // hierarchy rather than in whatever order the map happened to serialise in.
  const rank = (m: AnalysisMember) =>
    m.isOwner ? 0 : m.role === "editor" ? 1 : 2;
  members.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.displayName ?? a.email ?? "").localeCompare(
        b.displayName ?? b.email ?? "",
      ),
  );

  return { members };
});
