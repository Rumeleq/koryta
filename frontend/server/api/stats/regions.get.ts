import { getFirestore } from "firebase-admin/firestore";
import { fetchNodes } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import {
  readRegionStats,
  regionStat,
  writeRegionStats,
} from "~~/server/utils/regionStats";

export default authCachedEventHandler(async () => {
  const db = getFirestore("koryta-pl");

  const precomputed = await readRegionStats(db);
  if (precomputed) return precomputed;

  // Nothing has computed them yet - the first deploy, or a database where
  // /api/stats/computeNodes has never run. Build the rows the old way and
  // leave them behind, so this costs the full scan once rather than on every
  // cache miss until the compute job next runs.
  const regions = await fetchNodes("region");
  const rows = Object.entries(regions).map(([id, region]) =>
    regionStat(id, region),
  );
  await writeRegionStats(db, rows, new Date());
  return rows;
});
