import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Analysis } from "~~/shared/analysis";
import { analysisRole } from "~~/shared/analysis";

export function analysesCollection() {
  return getFirestore(getApp(), "koryta-pl").collection("analyses");
}

/** The analysis, refused unless `user` is in it.
 *
 * The admin SDK bypasses firestore.rules, so every route that touches an
 * analysis has to make the same check the rules make. A caller who is not a
 * member is told the analysis does not exist rather than that they may not see
 * it: an id is guessable, and "no such analysis" is the honest answer to
 * someone who cannot see it.
 */
export async function requireAnalysis(
  user: DecodedIdToken,
  analysisId: string,
  need: "read" | "write",
): Promise<{ id: string; data: Analysis }> {
  const snap = await analysesCollection().doc(analysisId).get();
  const data = snap.data() as Analysis | undefined;
  if (!snap.exists || !data) {
    throw createError({ statusCode: 404, message: "Nie ma takiej analizy." });
  }

  const role = analysisRole(data, user.uid, user.admin === true);
  if (!role) {
    throw createError({ statusCode: 404, message: "Nie ma takiej analizy." });
  }
  if (need === "write" && role !== "editor") {
    throw createError({
      statusCode: 403,
      message: "Masz dostęp tylko do odczytu tej analizy.",
    });
  }

  return { id: snap.id, data };
}
