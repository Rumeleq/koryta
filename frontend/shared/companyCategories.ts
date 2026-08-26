/** Company categories derived from KRS PKD activity codes.
 *
 * The scrapers send the raw PKD codes (e.g. "86.10.Z") in the company ingest
 * payload; the ingest endpoint maps them to categories with
 * `categoriesFromActivity` and stores both on the place node, so the
 * category filter does not need to know about PKD at query time.
 *
 * Note: companies in the associations register (e.g. SPZOZ hospitals) have no
 * PKD codes in KRS, so they cannot be categorized this way yet.
 */

export type CompanyCategory = "szpitale" | "wodociagi" | "koleje";

export const companyCategories: {
  value: CompanyCategory;
  title: string;
  pkdPrefixes: string[];
}[] = [
  {
    value: "szpitale",
    title: "Szpitale",
    // 86.10 Działalność szpitali
    pkdPrefixes: ["86.10"],
  },
  {
    value: "wodociagi",
    title: "Wodociągi i kanalizacja",
    // 36.00 Pobór, uzdatnianie i dostarczanie wody
    // 37.00 Odprowadzanie i oczyszczanie ścieków
    pkdPrefixes: ["36.00", "37.00"],
  },
  {
    value: "koleje",
    title: "Koleje",
    // 49.10 Transport kolejowy pasażerski międzymiastowy
    // 49.20 Transport kolejowy towarów
    // 42.12 Roboty związane z budową dróg szynowych i kolei podziemnej
    //
    // The first two are the operators. 42.12 is there for the infrastructure
    // side: PKP PLK declares 52.21 (usługi wspomagające transport lądowy) as
    // its main activity, and that code also covers roads, parking and bus
    // terminals, so it is too broad to filter on - 42.12 catches PLK and the
    // regional infrastructure companies instead, at the cost of also catching
    // track-laying contractors. 49.31 (transport miejski i podmiejski) is left
    // out for the same reason: it is trams and metro together with buses.
    pkdPrefixes: ["49.10", "49.20", "42.12"],
  },
];

export function categoryTitle(value: string): string {
  return companyCategories.find((c) => c.value === value)?.title ?? value;
}

export function categoriesFromActivity(
  activity: string[] | undefined,
): CompanyCategory[] {
  if (!activity || activity.length === 0) return [];
  return companyCategories
    .filter((category) =>
      activity.some((code) =>
        category.pkdPrefixes.some((prefix) => code.startsWith(prefix)),
      ),
    )
    .map((category) => category.value);
}
