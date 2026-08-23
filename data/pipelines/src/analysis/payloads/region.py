import json
from typing import Any

import pandas as pd

from scrapers.map.teryt import Regions
from scrapers.stores import Context, Pipeline


class RegionPayloads(Pipeline):
    filename = None

    regions: Regions

    def process(self, ctx: Context) -> pd.DataFrame:
        regions_df = self.regions.read_or_process(ctx)
        # TODO type this correctly
        payloads: list[dict[str, Any]] = []
        regions_df["id_str"] = regions_df["id"].astype(str)
        regions_df["id_len"] = regions_df["id"].astype(str).str.len()
        regions_df = regions_df.sort_values("id_len")
        for _, row in regions_df.iterrows():
            r_payload = map_region_payload(row)
            if r_payload:
                payloads.append(
                    {
                        "entity_id": str(row.id),
                        "krs": None,
                        "teryt_powiat": [],
                        "payload": json.dumps(r_payload),
                    }
                )

        df = pd.DataFrame(payloads)
        # Ensure 'payload' is always a valid JSON string for DuckDB
        if not df.empty and "payload" in df.columns:
            df["payload"] = df["payload"].apply(
                lambda x: json.dumps(x) if isinstance(x, (dict, list)) else x
            )
        return df


def map_region_payload(row: pd.Series) -> dict[str, Any] | None:
    if len(str(row["id"])) > 4:
        return None

    name = str(row["name"])
    id_str = str(row["id"])
    if len(id_str) == 2:
        name = f"Województwo {name}"
    elif len(id_str) == 4 and name.lower() == name:
        name = f"Powiat {name}"
    elif len(id_str) == 7:
        name = f"Gmina {name}"

    node_id = f"teryt{id_str}"

    # No `revision_id`: it is a pointer to a revision document, so only whatever
    # writes the region can know it. This payload used to carry the node's own id
    # (`teryt02`) and `rev_<edge_id>` for the edge, as a way of saying "publish
    # this" - which reads as published, but leaves 405 regions and 375 edges
    # pointing at revisions that do not exist. `computeRevisionsObj` then marks
    # every one of them as having an unapproved change, forever, and
    # /api/revisions/byNode reports an approved revision nobody can fetch.
    # Publishing is `createRevisionTransaction(..., approve=True)`'s job; see
    # frontend/scripts/migrate/repair-revision-pointers.ts for the repair.
    payload: dict[str, Any] = {
        "node_id": node_id,
        "type": "region",
        "name": name,
        "teryt": id_str,
    }

    parent_id = row.get("parent_id")
    if parent_id and str(parent_id) != "nan" and str(parent_id) != "None":
        parent_id_str = str(parent_id)
        parent_node_id = f"teryt{parent_id_str}"
        edge_id = f"edge_{parent_node_id}_{node_id}_owns"

        payload["edge"] = {
            "edge_id": edge_id,
            "source": parent_node_id,
            "target": node_id,
            "type": "owns",
        }

    return payload
