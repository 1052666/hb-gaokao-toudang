(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const metaEl = $("map-meta");
  const searchEl = $("school-search");
  const levelEl = $("level-filter");
  const yearEl = $("year-filter");
  const provinceEl = $("province-filter");
  const cityEl = $("city-filter");
  const onlyLocatedEl = $("only-located");
  const mode2d = $("mode-2d");
  const mode3d = $("mode-3d");
  const layout = document.querySelector(".map-layout");
  const panel = $("info-panel");

  let data = null;
  let locations = null;
  let map = null;
  let layer = null;
  let selectedId = null;
  const chunkCache = new Map();

  Promise.all([
    fetch("data_index.json").then((r) => r.json()),
    fetch("school_locations.json").then((r) => r.json()),
  ]).then(([d, l]) => {
    data = d;
    locations = l;
    initMap();
    initFilters();
    renderMarkers();
    updateMeta();
  }).catch((err) => {
    metaEl.textContent = "地图数据加载失败：" + err.message;
  });

  function initMap() {
    map = L.map("china-map", { zoomControl: true, preferCanvas: true }).setView([35.5, 104.2], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  function initFilters() {
    const levels = [...new Set(data.schools.map((s) => s.level).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const years = [...new Set(data.schools.flatMap((s) => (s.data_years || [s.year]).map(String)).filter(Boolean))].sort();
    const provinces = [...new Set(data.schools.map((s) => placeProvince(s)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const cities = [...new Set(data.schools.map((s) => placeCity(s)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    fill(levelEl, levels);
    fill(yearEl, years);
    fill(provinceEl, provinces);
    updateCityOptions();
    [searchEl, levelEl, yearEl, cityEl, onlyLocatedEl].forEach((el) => el.addEventListener("input", renderMarkers));
    levelEl.addEventListener("change", renderMarkers);
    yearEl.addEventListener("change", renderMarkers);
    provinceEl.addEventListener("change", () => {
      updateCityOptions();
      renderMarkers();
    });
    cityEl.addEventListener("change", renderMarkers);
    mode2d.addEventListener("click", () => setMode(false));
    mode3d.addEventListener("click", () => setMode(true));
  }

  function fill(el, values) {
    const first = el.options[0];
    el.innerHTML = "";
    if (first) el.appendChild(first);
    for (const v of values) {
      const option = document.createElement("option");
      option.value = v;
      option.textContent = v;
      el.appendChild(option);
    }
  }

  function citiesForProvince(province) {
    const cities = data.schools
      .filter((s) => !province || placeProvince(s) === province)
      .map((s) => placeCity(s))
      .filter(Boolean);
    return [...new Set(cities)].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function updateCityOptions() {
    const current = cityEl.value;
    const cities = citiesForProvince(provinceEl.value);
    fill(cityEl, cities);
    cityEl.value = cities.includes(current) ? current : "";
  }

  function updateMeta() {
    const m = locations.meta;
    metaEl.textContent = `共 ${data.schools.length} 所学校；已定位 ${m.located} 所，其中 ${m.poi} 所为POI/地址级坐标，${m.locality} 所为区县/城市级匹配。`;
  }

  function schoolById(id) {
    return data.schools.find((s) => String(s.id) === String(id));
  }

  function filteredLocations() {
    const kw = searchEl.value.trim().toLowerCase();
    const level = levelEl.value;
    const year = yearEl.value;
    const province = provinceEl.value;
    const city = cityEl.value;
    const onlyLocated = onlyLocatedEl.checked;
    return locations.schools.filter((loc) => {
      const s = schoolById(loc.id);
      if (!s) return false;
      const haystack = `${s.name || ""} ${placeText(s, loc)} ${placeAddress(s, loc)}`.toLowerCase();
      if (kw && !haystack.includes(kw)) return false;
      if (level && s.level !== level) return false;
      if (year && !(s.data_years || [s.year]).map(String).includes(year)) return false;
      if (province && placeProvince(s, loc) !== province) return false;
      if (city && placeCity(s, loc) !== city) return false;
      if (onlyLocated && !loc.lon) return false;
      return true;
    });
  }

  function markerStyle(s, loc) {
    const colors = { "985": "#b42318", "211": "#d97706", "本科": "#2563eb", "专科": "#059669" };
    const radius = s.level === "985" ? 7 : s.level === "211" ? 6 : 5;
    return {
      radius,
      color: "#ffffff",
      weight: 2,
      fillColor: colors[s.level] || "#64748b",
      fillOpacity: loc.coord_source === "arcgis_locality" ? .55 : .88,
    };
  }

  function renderMarkers() {
    if (!layer) return;
    layer.clearLayers();
    const rows = filteredLocations();
    let firstLocated = null;
    for (const loc of rows) {
      if (!loc.lon || !loc.lat) continue;
      const s = schoolById(loc.id);
      const marker = L.circleMarker([loc.lat, loc.lon], markerStyle(s, loc));
      marker.bindTooltip(s.name, { direction: "top", offset: [0, -6] });
      marker.on("click", () => selectSchool(loc.id));
      marker.addTo(layer);
      if (!firstLocated) firstLocated = loc;
    }
    metaEl.textContent = `${rows.length} 所符合条件；地图显示 ${rows.filter((x) => x.lon && x.lat).length} 个坐标点。${locations.meta.unresolved} 所暂未可靠定位，可用名称跳转地图搜索。`;
    if (firstLocated && !selectedId) map.setView([firstLocated.lat, firstLocated.lon], 5);
    if (rows.length && (!selectedId || !rows.some((x) => String(x.id) === String(selectedId)))) {
      const preferred = firstLocated || rows[0];
      selectedId = preferred.id;
      renderPanel(schoolById(preferred.id), preferred);
    }
  }

  function selectSchool(id) {
    selectedId = id;
    const s = schoolById(id);
    const loc = locations.schools.find((x) => String(x.id) === String(id)) || {};
    if (loc.lat && loc.lon) map.setView([loc.lat, loc.lon], 9);
    renderPanel(s, loc);
  }

  function renderPanel(s, loc) {
    const planTotal = parseInt(s.plan_total, 10) || 0;
    const majorTotal = parseInt(s.major_total, 10) || 0;
    const located = loc.lat && loc.lon;
    const mapQuery = `${s.name} ${placeText(s, loc)}`;
    const amap = located
      ? `https://uri.amap.com/marker?position=${loc.lon},${loc.lat}&name=${encodeURIComponent(mapQuery)}&src=hb-gaokao-map&coordinate=wgs84&callnative=1`
      : `https://uri.amap.com/search?keyword=${encodeURIComponent(mapQuery)}`;
    const baidu = `https://map.baidu.com/search/${encodeURIComponent(mapQuery)}`;
    panel.innerHTML = `
      <div class="panel-inner">
        <h2 class="panel-title">${escapeHtml(s.name)}</h2>
        <div class="panel-sub">${escapeHtml(placeText(s, loc))}</div>
        <div class="place-box">
          <div><span>省份</span><b>${escapeHtml(placeProvince(s, loc) || "-")}</b></div>
          <div><span>城市</span><b>${escapeHtml(placeCity(s, loc) || "-")}</b></div>
          <div><span>区县</span><b>${escapeHtml(placeCounty(s, loc) || "-")}</b></div>
          ${placeAddress(s, loc) ? `<p>匹配地址：${escapeHtml(placeAddress(s, loc))}</p>` : ""}
          ${placeConfidence(s, loc) !== "high" ? `<p class="warn">该位置来自地图匹配或原始字段，建议以学校官网地址为准。</p>` : ""}
        </div>
        <div class="badge-row">
          ${badge(s.level)}
          ${badge(s.nature)}
          ${s.level === "专科" && (s.data_years || []).includes("2026") ? badge("2026招生计划") : badge(String(s.year) + "年")}
          ${(s.data_years || []).some((y) => y === "2024" || y === "2025") ? badge("含往年参考") : ""}
          ${loc.coord_source === "arcgis_poi" ? badge("真实POI坐标") : loc.coord_source === "arcgis_locality" ? badge("区县/城市坐标", true) : badge("坐标待核验", true)}
          ${(s.special || []).map((x) => badge(x)).join("")}
        </div>
        <div class="stat-grid">
          <div class="stat"><b>${value(loc.max_score)}</b><span>最高分</span></div>
          <div class="stat"><b>${value(loc.min_score)}</b><span>最低分</span></div>
          <div class="stat"><b>${s.level === "专科" ? planTotal || "-" : s.record_count || "-"}</b><span>${s.level === "专科" ? "计划数" : "记录数"}</span></div>
          ${s.level === "专科" ? `<div class="stat"><b>${majorTotal || "-"}</b><span>专业项</span></div>` : ""}
        </div>
        <div class="jump-row">
          <a href="${amap}" target="_blank" rel="noopener">高德地图</a>
          <a class="secondary" href="${baidu}" target="_blank" rel="noopener">百度地图</a>
        </div>
        ${!located ? `<div class="unlocated-note">该校暂未拿到可靠经纬度，地图按钮会按学校名称搜索。</div>` : ""}
        <div class="record-list" id="panel-records"><div class="record-loading">正在加载该校详细数据…</div></div>
      </div>
    `;
    loadSchoolRecords(s)
      .then((records) => {
        if (String(selectedId) !== String(s.id)) return;
        const list = $("panel-records");
        if (list) list.innerHTML = records.map(renderRecord).join("") || '<div class="record-loading">该校暂无详细记录</div>';
      })
      .catch((err) => {
        const list = $("panel-records");
        if (list) list.innerHTML = `<div class="record-loading">详细数据加载失败：${escapeHtml(err.message)}</div>`;
      });
  }

  async function loadSchoolRecords(school) {
    if (!school.record_chunk) return school.records || [];
    if (!chunkCache.has(school.record_chunk)) {
      chunkCache.set(
        school.record_chunk,
        fetch(school.record_chunk).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      );
    }
    const chunk = await chunkCache.get(school.record_chunk);
    const found = (chunk.schools || []).find((s) => String(s.id) === String(school.id));
    return found ? (found.records || []) : [];
  }

  function renderRecord(r) {
    const majors = r["专业列表"] || [];
    const isPlan = r["数据类型"] === "2026招生计划";
    const mainValue = isPlan ? `${r["计划数合计"] || "-"}人` : escapeHtml(r["投档线"] || "-");
    return `
      <article class="record">
        <div class="record-head">
          <div class="record-tags">
            ${["数据类型", "年份", "科类", "类别", "批次", "计划类别", "类型", "专业组名称", "专业组编号"].map((k) => r[k] ? `<span>${escapeHtml(r[k])}</span>` : "").join("")}
          </div>
          <div class="record-score">${mainValue}</div>
        </div>
        <div class="record-tags">
          ${["计划数合计", "位次", "控制线", "选科要求", "院校代码", "志愿序号", "来源年份说明", "备注"].map((k) => r[k] ? `<span>${k}:${escapeHtml(r[k])}</span>` : "").join("")}
        </div>
        ${majors.length ? `<div class="majors">${majors.map(renderMajor).join("")}</div>` : ""}
      </article>
    `;
  }

  function renderMajor(m) {
    const parts = [
      m["计划数"] ? `计划 ${m["计划数"]}人` : "",
      m["学费"] ? `学费 ${m["学费"]}${m["学费单位"] || "元"}/年` : "",
      m["学费年份"] ? `${m["学费年份"]}计划` : "",
    ].filter(Boolean);
    return `<div class="major-item"><b>${escapeHtml(m["专业名称"] || "")}</b> ${escapeHtml(parts.join(" · "))}</div>`;
  }

  function badge(text, warn) {
    if (!text) return "";
    return `<span class="badge ${warn ? "warn" : ""}">${escapeHtml(text)}</span>`;
  }

  function value(v) {
    return v === null || v === undefined ? "-" : v;
  }

  function setMode(is3d) {
    layout.classList.toggle("is-3d", is3d);
    mode2d.classList.toggle("active", !is3d);
    mode3d.classList.toggle("active", is3d);
    setTimeout(() => map.invalidateSize(), 380);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function place(s, loc = {}) {
    return s.place || {
      province: loc.region || s.region || "",
      city: loc.city || s.city || "",
      county: loc.county || "",
      display: loc.place_display || "",
      compact: loc.place_compact || "",
      address: loc.matched_address || "",
      confidence: loc.place_confidence || "",
    };
  }

  function placeProvince(s, loc = {}) {
    return place(s, loc).province || s.region || loc.region || "";
  }

  function placeCity(s, loc = {}) {
    return place(s, loc).city || s.city || loc.city || "";
  }

  function placeCounty(s, loc = {}) {
    return place(s, loc).county || loc.county || "";
  }

  function placeText(s, loc = {}) {
    const p = place(s, loc);
    return p.display || p.compact || [placeProvince(s, loc), placeCity(s, loc), placeCounty(s, loc)].filter(Boolean).join(" · ") || "位置待核验";
  }

  function placeAddress(s, loc = {}) {
    const p = place(s, loc);
    const address = p.address || loc.matched_address || "";
    return address && address !== s.name && address !== placeText(s, loc) ? address : "";
  }

  function placeConfidence(s, loc = {}) {
    return place(s, loc).confidence || loc.place_confidence || (placeProvince(s, loc) ? "medium" : "low");
  }
})();
