# -*- coding: utf-8 -*-
"""Rebuild school_locations.json for the current data.json."""

from __future__ import annotations

import json
import concurrent.futures
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data.json"
LOC_PATH = ROOT / "school_locations.json"
ARCGIS = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"


def score_value(record: dict) -> float | None:
    try:
        return float(record.get("投档线"))
    except (TypeError, ValueError):
        return None


def stats(school: dict) -> dict:
    scores = [score_value(r) for r in school.get("records") or []]
    scores = [s for s in scores if s is not None]
    return {
        "record_count": len(school.get("records") or []),
        "max_score": max(scores) if scores else None,
        "min_score": min(scores) if scores else None,
    }


def base_row(school: dict) -> dict:
    row = {
        "id": str(school.get("id")),
        "name": school.get("name") or "",
        "level": school.get("level") or "",
        "region": school.get("region") or "",
        "nature": school.get("nature") or "",
        "year": school.get("year") or "",
        "record_count": stats(school)["record_count"],
        "max_score": stats(school)["max_score"],
        "min_score": stats(school)["min_score"],
        "special": school.get("special") or [],
    }
    if school.get("source_school_id"):
        row["source_school_id"] = str(school["source_school_id"])
    return row


def geocode(query: str) -> dict | None:
    params = {
        "f": "json",
        "singleLine": query,
        "outFields": "Match_addr,Addr_type,Score",
        "maxLocations": 1,
        "countryCode": "CHN",
    }
    response = requests.get(ARCGIS, params=params, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
    response.raise_for_status()
    candidates = response.json().get("candidates") or []
    if not candidates:
        return None
    candidate = candidates[0]
    location = candidate.get("location") or {}
    score = float(candidate.get("score") or 0)
    if not location.get("x") or not location.get("y") or score < 70:
        return None
    addr_type = candidate.get("attributes", {}).get("Addr_type") or ""
    source = "arcgis_poi" if addr_type in {"POI", "PointAddress", "StreetAddress"} else "arcgis_locality"
    return {
        "lon": round(float(location["x"]), 6),
        "lat": round(float(location["y"]), 6),
        "coord_source": source,
        "coord_score": score,
        "matched_address": candidate.get("address") or candidate.get("attributes", {}).get("Match_addr") or "",
        "query": query,
    }


def main() -> None:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    old = json.loads(LOC_PATH.read_text(encoding="utf-8")) if LOC_PATH.exists() else {"schools": []}
    old_by_id = {str(row.get("id")): row for row in old.get("schools", [])}

    rows = [None] * len(data["schools"])
    pending = []
    for index, school in enumerate(data["schools"], 1):
        row = base_row(school)
        sid = row["id"]
        source_sid = row.get("source_school_id")
        old_row = old_by_id.get(sid) or (old_by_id.get(source_sid) if source_sid else None)
        if old_row and old_row.get("lon") and old_row.get("lat"):
            row.update(
                {
                    "lon": old_row.get("lon"),
                    "lat": old_row.get("lat"),
                    "coord_source": old_row.get("coord_source") or "reused",
                    "coord_score": old_row.get("coord_score"),
                    "matched_address": old_row.get("matched_address") or "",
                    "query": old_row.get("query") or school.get("name") or "",
                }
            )
            rows[index - 1] = row
        else:
            row["query"] = " ".join(x for x in [school.get("name"), school.get("region"), school.get("city")] if x)
            pending.append((index - 1, row))

    print(f"locations reuse={sum(1 for row in rows if row)} pending_geocode={len(pending)}", flush=True)

    def resolve(item):
        idx, row = item
        try:
            found = geocode(row["query"])
        except Exception:
            found = None
        if found:
            row.update(found)
        else:
            row["coord_source"] = "unresolved"
        return idx, row

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(resolve, item) for item in pending]
        for future in concurrent.futures.as_completed(futures):
            idx, row = future.result()
            rows[idx] = row
            completed += 1
            if completed % 50 == 0 or completed == len(pending):
                print(f"locations geocoded={completed}/{len(pending)}", flush=True)

    rows = [row for row in rows if row is not None]

    located = [row for row in rows if row.get("lon") and row.get("lat")]
    payload = {
        "meta": {
            "total": len(rows),
            "located": len(located),
            "poi": sum(1 for row in located if row.get("coord_source") == "arcgis_poi"),
            "locality": sum(1 for row in located if row.get("coord_source") == "arcgis_locality"),
            "unresolved": len(rows) - len(located),
            "source": "Reused previous ArcGIS coordinates; new 2026 junior-college schools geocoded with ArcGIS World Geocoding",
        },
        "schools": rows,
    }
    LOC_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["meta"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
