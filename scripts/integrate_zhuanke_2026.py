# -*- coding: utf-8 -*-
"""Integrate verified 2026 junior-college plan data into data.json."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORK = Path(r"C:\Users\lixia\Documents\Codex\2026-07-25\hb-workbuddy\outputs")
VERIFIED = WORK / "hubei_zhuanke_2026_rerun_verified"

DATA_PATH = ROOT / "data.json"
PLANS_PATH = VERIFIED / "plans_2026_deduped.jsonl"
CANDIDATES_PATH = VERIFIED / "school_candidates.json"
REFERENCE_PATH = WORK / "audit_hubei_zhuanke_reference_scores.json"

MUNICIPALITIES = {"北京", "天津", "上海", "重庆"}
AUTONOMOUS = {
    "内蒙古": "内蒙古自治区",
    "广西": "广西壮族自治区",
    "西藏": "西藏自治区",
    "宁夏": "宁夏回族自治区",
    "新疆": "新疆维吾尔自治区",
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_region(name: str | None) -> str:
    if not name:
        return ""
    if name.endswith(("省", "市", "自治区")):
        return name
    if name in MUNICIPALITIES:
        return f"{name}市"
    return AUTONOMOUS.get(name, f"{name}省")


def clean_plan_type(value: str | None) -> str:
    value = (value or "").strip()
    if not value or value == "-":
        return "普通类"
    return value


def group_key(row: dict) -> tuple:
    return (
        row["school_id"],
        row.get("subject") or "",
        row.get("batch") or "",
        row.get("group_name") or "",
        clean_plan_type(row.get("admission_type")),
        row.get("group_requirement") or "",
    )


def school_id(raw_id: str) -> str:
    return f"zk-{raw_id}"


def plan_record(rows: list[dict]) -> dict:
    first = rows[0]
    plan_type = clean_plan_type(first.get("admission_type"))
    total_plan = 0
    majors = []
    for row in rows:
        try:
            total_plan += int(row.get("plan_num") or 0)
        except ValueError:
            pass
        majors.append(
            {
                "专业代码": row.get("major_code") or "",
                "专业名称": row.get("major_name") or "",
                "专业说明": row.get("major_full_name") or row.get("major_name") or "",
                "计划数": row.get("plan_num") or "",
                "学费": row.get("tuition") or "",
                "学费单位": row.get("tuition_unit") or "元",
                "学费年份": 2026,
                "学费来源": "阳光高考/EOL 2026招生计划；已抽样交叉核验",
                "学制": row.get("length") or "",
            }
        )
    return {
        "数据类型": "2026招生计划",
        "年份": "2026",
        "科类": first.get("subject") or "",
        "批次": first.get("batch") or "",
        "类别": first.get("batch") or "",
        "计划类别": plan_type,
        "类型": plan_type,
        "专业组名称": first.get("group_name") or "",
        "专业组编号": first.get("group_name") or "",
        "选科要求": first.get("group_requirement") or "",
        "计划数合计": total_plan,
        "来源": "阳光高考/EOL api.eol.cn 2026招生计划；专科计划已重抓并抽样交叉核验",
        "来源年份说明": "2026招生计划，不是投档录取分数线",
        "专业列表": majors,
    }


def reference_record(row: dict) -> dict:
    plan_type = clean_plan_type(row.get("admission_type"))
    return {
        "数据类型": f"{row.get('year')}参考投档线",
        "年份": str(row.get("year") or ""),
        "科类": row.get("subject") or "",
        "批次": row.get("batch") or "",
        "类别": row.get("batch") or "",
        "计划类别": plan_type,
        "类型": plan_type,
        "专业组名称": row.get("group_name") or "",
        "专业组编号": row.get("group_name") or "",
        "投档线": "" if row.get("min_score") is None else str(row.get("min_score")),
        "位次": row.get("min_rank"),
        "控制线": row.get("control_line"),
        "选科要求": row.get("group_requirement") or "",
        "来源": row.get("source") or f"阳光高考/EOL {row.get('year')}投档线",
        "来源年份说明": f"{row.get('year')}往年参考投档线，不是2026投档线",
    }


def recompute_filters(schools: list[dict]) -> dict:
    filters = {"科类": set(), "批次": set(), "计划类别": set(), "年份": set()}
    filters.update({"院校层次": set(), "所在地": set(), "办学性质": set(), "特殊类型": set()})
    for school in schools:
        if school.get("level"):
            filters["院校层次"].add(school["level"])
        if school.get("region"):
            filters["所在地"].add(school["region"])
        if school.get("nature"):
            filters["办学性质"].add(school["nature"])
        for item in school.get("special") or []:
            filters["特殊类型"].add(item)
        for record in school.get("records") or []:
            if record.get("科类"):
                filters["科类"].add(str(record["科类"]))
            for key in ("批次", "类别"):
                if record.get(key):
                    filters["批次"].add(str(record[key]))
            for key in ("计划类别", "类型"):
                if record.get(key):
                    filters["计划类别"].add(str(record[key]))
            if record.get("年份"):
                filters["年份"].add(str(record["年份"]))
    return {key: sorted(values, key=lambda x: x) for key, values in filters.items()}


def main() -> None:
    data = load_json(DATA_PATH)
    candidates = {str(s["school_id"]): s for s in load_json(CANDIDATES_PATH)["schools"]}
    plans_by_school: dict[str, list[dict]] = defaultdict(list)
    with PLANS_PATH.open(encoding="utf-8") as file:
        for line in file:
            if line.strip():
                row = json.loads(line)
                plans_by_school[str(row["school_id"])].append(row)

    references_by_school: dict[str, list[dict]] = defaultdict(list)
    for row in load_json(REFERENCE_PATH)["reference_scores"]:
        sid = str(row.get("school_id"))
        if sid in plans_by_school:
            references_by_school[sid].append(row)

    original_non_zhuanke = [s for s in data["schools"] if s.get("level") != "专科"]
    zhuanke_schools = []
    for sid, rows in plans_by_school.items():
        first = rows[0]
        candidate = candidates.get(sid, {})
        grouped: dict[tuple, list[dict]] = defaultdict(list)
        for row in rows:
            grouped[group_key(row)].append(row)
        records = [plan_record(group_rows) for group_rows in grouped.values()]
        records.extend(reference_record(row) for row in references_by_school.get(sid, []))
        records.sort(
            key=lambda r: (
                0 if r.get("数据类型") == "2026招生计划" else 1,
                r.get("年份") or "",
                r.get("科类") or "",
                r.get("批次") or "",
                r.get("专业组编号") or "",
            )
        )
        special = []
        if candidate.get("doublehigh") and str(candidate.get("doublehigh")) not in {"", "0"}:
            special.append("双高计划")
        zhuanke_schools.append(
            {
                "id": school_id(sid),
                "source_school_id": sid,
                "name": first.get("school_name") or candidate.get("name") or "",
                "level": "专科",
                "region": normalize_region(first.get("school_province") or candidate.get("province_name")),
                "nature": first.get("school_nature") or candidate.get("nature_name") or "",
                "city": first.get("school_city") or candidate.get("city_name") or "",
                "type": first.get("school_type") or candidate.get("type_name") or "",
                "year": "2026",
                "data_years": sorted({r.get("年份") for r in records if r.get("年份")}),
                "special": special,
                "records": records,
            }
        )

    schools = original_non_zhuanke + sorted(zhuanke_schools, key=lambda s: (s["region"], s["name"]))
    total_records = sum(len(s.get("records") or []) for s in schools)
    data["schools"] = schools
    data["meta"].update(
        {
            "year": "2026",
            "total_schools": len(schools),
            "total_records": total_records,
            "schools_with_data": sum(1 for s in schools if s.get("records")),
            "source": "武汉本地宝(本科2026投档线) + 阳光高考/EOL(2026专科招生计划、2025/2024专科参考投档线，已抽样交叉核验)",
            "source_url": "https://m.wh.bendibao.com/edu/toudangfenshuxian/ ; https://api.eol.cn/",
            "zhuanke_2026": {
                "candidate_schools": 1507,
                "schools_with_plan": len(zhuanke_schools),
                "plan_rows": sum(1 for rows in plans_by_school.values() for _ in rows),
                "integrated_plan_groups": sum(
                    1
                    for school in zhuanke_schools
                    for record in school["records"]
                    if record.get("数据类型") == "2026招生计划"
                ),
                "reference_score_rows_used": sum(len(rows) for rows in references_by_school.values()),
                "verified_at": "2026-07-26",
                "verification_note": "2026专科招生计划已重新抓取；长沙民政职业技术学院、湖北生物科技职业学院等样本已与高校官方来源交叉核验。",
            },
        }
    )
    data["meta"]["filters"] = recompute_filters(schools)
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "schools": len(schools),
                "zhuanke_schools": len(zhuanke_schools),
                "records": total_records,
                "zhuanke_plan_groups": data["meta"]["zhuanke_2026"]["integrated_plan_groups"],
                "zhuanke_reference_rows": data["meta"]["zhuanke_2026"]["reference_score_rows_used"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
