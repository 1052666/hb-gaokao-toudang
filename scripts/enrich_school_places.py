# -*- coding: utf-8 -*-
"""Add structured school place fields for list and map display."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data.json"
LOC_PATH = ROOT / "school_locations.json"
EOL_DIRECTORY_PATH = ROOT / "scripts" / "eol_hubei_school_directory_2026.json"

MUNICIPALITIES = {"北京", "天津", "上海", "重庆", "北京市", "天津市", "上海市", "重庆市"}
AUTONOMOUS = {
    "内蒙古": "内蒙古自治区",
    "广西": "广西壮族自治区",
    "西藏": "西藏自治区",
    "宁夏": "宁夏回族自治区",
    "新疆": "新疆维吾尔自治区",
    "香港": "香港特别行政区",
    "澳门": "澳门特别行政区",
}

PLACE_ALIASES = {
    "香港中文大学(深圳)": ("广东省", "深圳市", "龙岗区"),
    "中国矿业大学(北京)": ("北京市", "北京市", "海淀区"),
    "国防科技大学": ("湖南省", "长沙市", "开福区"),
    "哈尔滨工业大学(威海)": ("山东省", "威海市", "环翠区"),
    "山东大学威海分校": ("山东省", "威海市", "环翠区"),
    "大连理工大学(盘锦校区)": ("辽宁省", "盘锦市", "大洼区"),
    "电子科技大学(沙河校区)": ("四川省", "成都市", "成华区"),
    "复旦大学医学院": ("上海市", "上海市", "徐汇区"),
    "中国石油大学(北京)": ("北京市", "北京市", "昌平区"),
    "中国地质大学(武汉)": ("湖北省", "武汉市", "洪山区"),
    "中国石油大学(华东)": ("山东省", "青岛市", "黄岛区"),
    "中国地质大学(北京)": ("北京市", "北京市", "海淀区"),
    "华北电力大学(北京)": ("北京市", "北京市", "昌平区"),
    "合肥工业大学(宣城校区)": ("安徽省", "宣城市", "宣州区"),
    "中国石油大学(北京)克拉玛依校区": ("新疆维吾尔自治区", "克拉玛依市", "克拉玛依区"),
    "陆军军医大学": ("重庆市", "重庆市", "沙坪坝区"),
}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_province(value: str | None) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if value in MUNICIPALITIES:
        return value if value.endswith("市") else f"{value}市"
    if value.endswith(("省", "市", "自治区")):
        return value
    return AUTONOMOUS.get(value, f"{value}省")


def clean_part(value: str | None) -> str:
    value = (value or "").strip()
    return "" if value in {"-", "null", "None"} else value


def place_from_eol(row: dict | None) -> dict:
    if not row:
        return {}
    province = normalize_province(row.get("province_name"))
    city = clean_part(row.get("city_name"))
    county = clean_part(row.get("county_name"))
    return {
        "province": province,
        "city": city,
        "county": county,
        "source": "EOL院校库",
        "confidence": "high",
    }


def place_from_alias(name: str | None) -> dict:
    if name not in PLACE_ALIASES:
        return {}
    province, city, county = PLACE_ALIASES[name]
    return {
        "province": province,
        "city": city,
        "county": county,
        "source": "校区别名表",
        "confidence": "high",
    }


def fallback_place(school: dict, loc: dict | None) -> dict:
    loc = loc or {}
    province = normalize_province(school.get("region") or loc.get("region"))
    city = clean_part(school.get("city"))
    matched = clean_part(loc.get("matched_address"))
    source = "原始院校字段" if province or city else ""
    confidence = "medium" if province or city else ""
    if not province and matched:
      # Only use ArcGIS text as a visible hint, not as a province filter.
        source = "地图匹配地址"
        confidence = "low"
    return {
        "province": province,
        "city": city,
        "county": "",
        "address": matched if matched and matched != school.get("name") else "",
        "source": source,
        "confidence": confidence,
    }


def display_place(place: dict) -> str:
    parts = []
    for key in ("province", "city", "county"):
        value = clean_part(place.get(key))
        if value and value not in parts:
            parts.append(value)
    if parts:
        return " · ".join(parts)
    if place.get("address"):
        return str(place["address"])
    return "位置待核验"


def compact_place(place: dict) -> str:
    parts = []
    for key in ("province", "city"):
        value = clean_part(place.get(key))
        if value and value not in parts:
            parts.append(value)
    return " · ".join(parts) if parts else "位置待核验"


def recompute_filters(schools: list[dict]) -> dict:
    filters = {"科类": set(), "批次": set(), "计划类别": set(), "年份": set()}
    filters.update({"院校层次": set(), "所在地": set(), "城市": set(), "办学性质": set(), "特殊类型": set()})
    for school in schools:
        place = school.get("place") or {}
        if school.get("level"):
            filters["院校层次"].add(str(school["level"]))
        if place.get("province") or school.get("region"):
            filters["所在地"].add(str(place.get("province") or school.get("region")))
        if place.get("city") or school.get("city"):
            filters["城市"].add(str(place.get("city") or school.get("city")))
        if school.get("nature"):
            filters["办学性质"].add(str(school["nature"]))
        for item in school.get("special") or []:
            filters["特殊类型"].add(str(item))
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
    data = load(DATA_PATH)
    locations = load(LOC_PATH)
    directory = load(EOL_DIRECTORY_PATH)
    eol_by_name = {row.get("name"): row for row in directory.get("schools", []) if row.get("name")}
    loc_by_id = {str(row.get("id")): row for row in locations.get("schools", [])}

    stats = {"total": len(data["schools"]), "eol_matched": 0, "fallback": 0, "unverified": 0}
    for school in data["schools"]:
        sid = str(school.get("id"))
        alias_place = place_from_alias(school.get("name"))
        eol_row = eol_by_name.get(school.get("name"))
        if alias_place:
            place = alias_place
            stats["eol_matched"] += 1
        elif eol_row:
            place = place_from_eol(eol_row)
            stats["eol_matched"] += 1
        else:
            place = fallback_place(school, loc_by_id.get(sid))
            stats["fallback"] += 1
        place["display"] = display_place(place)
        place["compact"] = compact_place(place)
        if place.get("confidence") != "high":
            stats["unverified"] += 1
        school["place"] = place
        if place.get("province"):
            school["region"] = place["province"]
        if place.get("city"):
            school["city"] = place["city"]

    for row in locations.get("schools", []):
        school = next((s for s in data["schools"] if str(s.get("id")) == str(row.get("id"))), None)
        if not school:
            continue
        place = school.get("place") or {}
        row["region"] = place.get("province") or row.get("region") or ""
        row["city"] = place.get("city") or ""
        row["county"] = place.get("county") or ""
        row["place_display"] = place.get("display") or ""
        row["place_compact"] = place.get("compact") or ""
        row["place_source"] = place.get("source") or ""
        row["place_confidence"] = place.get("confidence") or ""

    data["meta"]["filters"] = recompute_filters(data["schools"])
    data["meta"]["place_enrichment"] = {
        **stats,
        "source": "EOL api.eol.cn 2026湖北招生院校库；括号校区/分校使用校区别名表补齐",
        "updated_at": "2026-07-26",
    }
    locations["meta"]["place_enrichment"] = data["meta"]["place_enrichment"]

    save(DATA_PATH, data)
    save(LOC_PATH, locations)
    print(json.dumps(data["meta"]["place_enrichment"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
