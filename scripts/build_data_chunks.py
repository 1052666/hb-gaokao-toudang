# -*- coding: utf-8 -*-
"""Build a lightweight school index and record chunks for static hosting."""

from __future__ import annotations

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data.json"
INDEX_PATH = ROOT / "data_index.json"
CHUNK_DIR = ROOT / "data_chunks"
SCHOOLS_PER_CHUNK = 60


def record_score(record: dict) -> float | None:
    try:
        return float(record.get("投档线"))
    except (TypeError, ValueError):
        return None


def values(records: list[dict], *keys: str) -> list[str]:
    found = set()
    for record in records:
        for key in keys:
            value = record.get(key)
            if value:
                found.add(str(value))
    return sorted(found)


def major_search_text(records: list[dict]) -> str:
    parts: list[str] = []
    for record in records:
        for key in ("专业组名称", "专业组编号", "类型", "计划类别", "科类", "批次", "类别", "选科要求"):
            if record.get(key):
                parts.append(str(record[key]))
        for major in record.get("专业列表") or []:
            for key in ("专业名称", "专业说明"):
                if major.get(key):
                    parts.append(str(major[key]))
    return " ".join(parts)


def school_summary(school: dict, chunk_name: str) -> dict:
    records = school.get("records") or []
    scores = [score for score in (record_score(record) for record in records) if score is not None]
    plan_total = sum(int(record.get("计划数合计") or 0) for record in records if str(record.get("计划数合计") or "").isdigit())
    major_total = sum(len(record.get("专业列表") or []) for record in records)
    summary = {key: value for key, value in school.items() if key != "records"}
    summary.update(
        {
            "record_count": len(records),
            "record_chunk": chunk_name,
            "max_score": max(scores) if scores else None,
            "min_score": min(scores) if scores else None,
            "plan_total": plan_total,
            "major_total": major_total,
            "record_facets": {
                "科类": values(records, "科类"),
                "批次": values(records, "批次", "类别"),
                "计划类别": values(records, "计划类别", "类型"),
                "年份": values(records, "年份"),
            },
            "search_text": major_search_text(records),
        }
    )
    return summary


def main() -> None:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    schools = data.get("schools") or []
    CHUNK_DIR.mkdir(exist_ok=True)
    for old in CHUNK_DIR.glob("chunk_*.json"):
        old.unlink()

    summaries = []
    chunks = math.ceil(len(schools) / SCHOOLS_PER_CHUNK)
    for chunk_index in range(chunks):
        start = chunk_index * SCHOOLS_PER_CHUNK
        chunk_schools = schools[start : start + SCHOOLS_PER_CHUNK]
        chunk_name = f"data_chunks/chunk_{chunk_index:03d}.json"
        chunk_payload = {
            "chunk": chunk_index,
            "schools": [
                {
                    "id": str(school.get("id")),
                    "name": school.get("name") or "",
                    "records": school.get("records") or [],
                }
                for school in chunk_schools
            ],
        }
        (ROOT / chunk_name).write_text(json.dumps(chunk_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        summaries.extend(school_summary(school, chunk_name) for school in chunk_schools)

    index_payload = {
        "meta": {
            **data.get("meta", {}),
            "split_data": {
                "enabled": True,
                "chunk_count": chunks,
                "schools_per_chunk": SCHOOLS_PER_CHUNK,
                "built_at": "2026-07-26",
            },
        },
        "schools": summaries,
    }
    INDEX_PATH.write_text(json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"schools": len(summaries), "chunks": chunks}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
