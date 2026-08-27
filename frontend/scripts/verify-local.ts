import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * What the categories and ownership work actually put on a local stack.
 *
 * Read-only. Run it against the emulator after the seat migration, the region
 * nodes and the company ingest, to check the three things that are easy to get
 * silently wrong: the seat split left every company exactly one seat, the
 * register's owners landed as `owns` edges, and the categories moved.
 *
 *   npx tsx scripts/verify-local.ts
 */

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "koryta-pl";

const app = initializeApp({ projectId: "koryta-pl" });

/** Companies whose ownership the register states plainly, so a wrong answer
 * here is a wrong answer and not a judgement call. */
const CHECKS: { krs: string; name: string; expect: string }[] = [
  {
    krs: "0000076705",
    name: "PKP SKM w Trójmieście",
    expect: "PKP S.A. + Gmina Miasta Gdańsk + Woj. Pomorskie; seat Gdynia",
  },
  { krs: "0000109022", name: "Sądeckie Wodociągi", expect: "4 owner gminy" },
  { krs: "0000094136", name: "Żywiec water company", expect: "16 owner gminy" },
];

async function main() {
  const db = getFirestore(app, "koryta-pl");

  const nodes = await db.collection("nodes").get();
  const byId = new Map(nodes.docs.map((d) => [d.id, d.data()]));
  const places = nodes.docs.filter((d) => d.data().type === "place");
  const regions = nodes.docs.filter((d) => d.data().type === "region");
  console.info(`nodes: ${places.length} places, ${regions.length} regions`);

  const edges = await db.collection("edges").get();
  const seats = new Map<string, string[]>();
  const owners = new Map<string, string[]>();
  let regionToRegion = 0;
  for (const doc of edges.docs) {
    const e = doc.data();
    const s = byId.get(e.source)?.type;
    const t = byId.get(e.target)?.type;
    if (e.type === "seat" && t === "place") {
      seats.set(e.target, [...(seats.get(e.target) ?? []), e.source]);
    } else if (e.type === "owns" && t === "place") {
      owners.set(e.target, [...(owners.get(e.target) ?? []), e.source]);
    } else if (e.type === "owns" && s === "region" && t === "region") {
      regionToRegion += 1;
    }
  }

  const strayOwnsSeat = edges.docs.filter((d) => {
    const e = d.data();
    return (
      e.type === "owns" &&
      byId.get(e.source)?.type === "region" &&
      byId.get(e.target)?.type === "place"
    );
  }).length;

  console.info(`\nedges`);
  console.info(`  seat  region->place : ${[...seats.values()].flat().length}`);
  console.info(`  owns  ->place       : ${[...owners.values()].flat().length}`);
  console.info(`    of which region-> : ${strayOwnsSeat}   (JST shareholders)`);
  console.info(
    `  owns  region->region: ${regionToRegion}   (hierarchy, untouched)`,
  );
  // 66 companies arrive with two seat documents already - 65 exact duplicate
  // pairs from before edge ids were derived from (source, target, type), plus
  // Koleje Śląskie claimed by both teryt24 and teryt2469. Anything past that is
  // the ingest resolving a seat to a region the stored one did not come from,
  // which is worth naming rather than counting.
  const multiSeat = [...seats.entries()].filter(([, v]) => v.length > 1);
  const twoDistinct = multiSeat.filter(([, v]) => new Set(v).size > 1);
  console.info(`  companies with >1 seat: ${multiSeat.length}`);
  console.info(`    of which two DIFFERENT regions: ${twoDistinct.length}`);
  for (const [placeId, regionIds] of twoDistinct.slice(0, 20)) {
    const place = byId.get(placeId);
    console.info(
      `      ${place?.krsNumber ?? placeId} ${String(place?.name).slice(0, 40)}: ` +
        `${[...new Set(regionIds)].map((r) => byId.get(r)?.name ?? r).join(" + ")}`,
    );
  }
  console.info(`  companies with an owner: ${owners.size}`);

  const cats = new Map<string, number>();
  for (const d of places) {
    const raw = d.data().categories;
    const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
    for (const c of list as string[]) cats.set(c, (cats.get(c) ?? 0) + 1);
  }
  console.info(`\ncategories`);
  for (const [c, n] of [...cats].sort((a, b) => b[1] - a[1])) {
    console.info(`  ${c.padEnd(22)} ${n}`);
  }
  const uncategorised = places.filter((d) => {
    const raw = d.data().categories;
    const list = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
    return list.length === 0;
  }).length;
  console.info(`  ${"(none)".padEnd(22)} ${uncategorised}`);

  console.info(`\nnamed companies`);
  for (const check of CHECKS) {
    const node = places.find((d) => d.data().krsNumber === check.krs);
    if (!node) {
      console.info(`  ${check.krs} ${check.name}: NOT ON THE SITE`);
      continue;
    }
    const seatIds = seats.get(node.id) ?? [];
    const ownerIds = owners.get(node.id) ?? [];
    const nameOf = (id: string) => byId.get(id)?.name ?? id;
    console.info(`  ${check.krs} ${check.name}`);
    console.info(`    expected : ${check.expect}`);
    console.info(
      `    seat     : ${seatIds.map(nameOf).join(", ") || "(none)"}`,
    );
    console.info(
      `    owners   : ${ownerIds.map(nameOf).join(", ") || "(none)"}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
