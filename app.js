/* ===== 2026湖北高考投档分数线查询 - 应用逻辑 ===== */
(function () {
  "use strict";

  let DATA = null;
  let filteredSchools = [];
  let renderedCount = 0;
  let activeSchoolId = null;
  const PAGE_SIZE = 40;

  const $ = (id) => document.getElementById(id);
  const listEl = $("school-list");
  const searchInput = $("search-input");
  const clearBtn = $("clear-search");
  const filterSubject = $("filter-subject");
  const filterBatch = $("filter-batch");
  const filterPlan = $("filter-plan");
  const filterLevel = $("filter-level");
  const filterRegion = $("filter-region");
  const filterNature = $("filter-nature");
  const filterSpecial = $("filter-special");
  const filterYear = $("filter-year");
  const filterMin = $("filter-min-score");
  const filterMax = $("filter-max-score");
  const resetBtn = $("reset-filters");
  const onlyHasData = $("only-has-data");
  const resultCount = $("result-count");
  const backToTop = $("back-to-top");
  const metaText = $("meta-text");

  // 层次标签颜色
  const LEVEL_CLASS = { "985": "lv-985", "211": "lv-211", "本科": "lv-bk", "专科": "lv-zk" };

  fetch("data.json")
    .then((r) => r.json())
    .then((d) => {
      DATA = d;
      normalizeRecords();
      initFilters();
      restoreFilters();
      updateMeta();
      applyFilters();
    })
    .catch(() => {
      listEl.innerHTML = '<div class="empty-placeholder">数据加载失败，请刷新重试</div>';
    });

  function updateMeta() {
    const m = DATA.meta;
    const z = m.zhuanke_2026;
    metaText.textContent =
      `共 ${m.total_schools} 所学校 · ${m.total_records} 条记录 · ` +
      `本科2026投档线；专科含2026招生计划${z ? `（${z.schools_with_plan}所、${z.plan_rows}条专业计划）` : ""}和2025/2024参考投档线 · ` +
      `数据来源：${m.source}`;
  }

  function normalizeRecords() {
    for (const s of DATA.schools) {
      for (const r of s.records || []) {
        r["年份"] = String(r["年份"] || s.year || "");
      }
    }
  }

  function fillSelect(el, options) {
    (options || []).forEach((v) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = v;
      el.appendChild(o);
    });
  }

  function initFilters() {
    const f = DATA.meta.filters || {};
    fillSelect(filterSubject, f["科类"]);
    fillSelect(filterBatch, [...new Set([...(f["批次"] || []), ...collectRecordValues("批次")])].sort((a, b) => a.localeCompare(b, "zh-CN")));
    fillSelect(filterPlan, [...new Set([...(f["计划类别"] || []), ...collectRecordValues("类型")])].sort((a, b) => a.localeCompare(b, "zh-CN")));
    fillSelect(filterLevel, [...new Set([...(f["院校层次"] || []), ...collectSchoolValues("level")])].sort((a, b) => a.localeCompare(b, "zh-CN")));
    fillSelect(filterRegion, f["所在地"]);
    fillSelect(filterNature, f["办学性质"]);
    fillSelect(filterSpecial, f["特殊类型"]);
    fillSelect(filterYear, [...new Set([...(f["年份"] || []), ...collectRecordValues("年份")])].sort());
  }

  function collectRecordValues(key) {
    const values = [];
    for (const s of DATA.schools) {
      for (const r of s.records || []) {
        if (r[key]) values.push(r[key]);
      }
    }
    return values;
  }

  function collectSchoolValues(key) {
    return DATA.schools.map((s) => s[key]).filter(Boolean);
  }

  // ===== 筛选 =====
  function applyFilters() {
    if (!DATA) return;
    const kw = searchInput.value.trim().toLowerCase();
    const subj = filterSubject.value;
    const batch = filterBatch.value;
    const plan = filterPlan.value;
    const level = filterLevel.value;
    const region = filterRegion.value;
    const nature = filterNature.value;
    const special = filterSpecial.value;
    const year = filterYear.value;
    const minS = filterMin.value ? parseInt(filterMin.value, 10) : null;
    const maxS = filterMax.value ? parseInt(filterMax.value, 10) : null;
    const onlyData = onlyHasData.checked;

    clearBtn.hidden = !kw;
    filteredSchools = [];

    for (const s of DATA.schools) {
      const schoolText = `${s.name || ""} ${s.city || ""} ${s.region || ""}`.toLowerCase();
      const schoolMatchesKeyword = !kw || schoolText.includes(kw);
      // 学校维度筛选
      if (level && s.level !== level) continue;
      if (region && s.region !== region) continue;
      if (nature && s.nature !== nature) continue;
      if (special && !(s.special || []).includes(special)) continue;

      // 记录维度筛选
      let records = s.records || [];
      let keywordFilteredRecords = false;
      if (kw && !schoolMatchesKeyword) {
        records = records.filter((r) => recordMatchesKeyword(r, kw));
        keywordFilteredRecords = true;
      }
      if (subj || batch || plan || year || minS !== null || maxS !== null) {
        records = records.filter((r) => {
          if (subj && r["科类"] !== subj) return false;
          if (batch && r["类别"] !== batch && r["批次"] !== batch) return false;
          if (plan && r["计划类别"] !== plan && r["类型"] !== plan) return false;
          if (year && String(r["年份"] || "") !== year) return false;
          const score = recordScore(r);
          if (minS !== null && score < minS) return false;
          if (maxS !== null && score > maxS) return false;
          return true;
        });
      }

      if (kw && !schoolMatchesKeyword && records.length === 0) continue;
      if (onlyData && records.length === 0) continue;

      const hasRecFilter = keywordFilteredRecords || subj || batch || plan || year || minS !== null || maxS !== null;
      filteredSchools.push({
        ...s,
        _matched: hasRecFilter ? records : s.records,
      });
    }

    filteredSchools.sort((a, b) => {
      const scoreDelta = maxScore(b._matched) - maxScore(a._matched);
      if (scoreDelta !== 0) return scoreDelta;
      const planDelta = totalPlan(b._matched) - totalPlan(a._matched);
      if (planDelta !== 0) return planDelta;
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });
    saveFilters();
    activeSchoolId = null;

    renderedCount = 0;
    listEl.innerHTML = "";
    resultCount.textContent =
      `找到 ${filteredSchools.length} 所学校` +
      (filteredSchools.length !== DATA.schools.length ? `（共 ${DATA.schools.length} 所）` : "");

    if (filteredSchools.length === 0) {
      listEl.innerHTML = '<div class="empty-placeholder">没有符合条件的学校，试试调整筛选条件</div>';
      return;
    }
    renderMore();
    openSchoolFromHash();
  }

  function maxScore(records) {
    let m = -1;
    for (const r of records) {
      const s = recordScore(r);
      if (s >= 0 && s > m) m = s;
    }
    return m;
  }
  function minScore(records) {
    let m = 9999;
    for (const r of records) {
      const s = recordScore(r);
      if (s >= 0 && s < m) m = s;
    }
    return m === 9999 ? -1 : m;
  }

  function recordScore(r) {
    const score = parseInt(r && r["投档线"], 10);
    return Number.isFinite(score) ? score : -1;
  }

  function totalPlan(records) {
    return (records || []).reduce((sum, r) => sum + (parseInt(r["计划数合计"], 10) || 0), 0);
  }

  function totalMajors(records) {
    return (records || []).reduce((sum, r) => sum + ((r["专业列表"] || []).length), 0);
  }

  function recordMatchesKeyword(r, kw) {
    const majors = (r["专业列表"] || []).map((m) => `${m["专业名称"] || ""} ${m["专业说明"] || ""}`).join(" ");
    return [
      r["专业组名称"], r["专业组编号"], r["类型"], r["计划类别"],
      r["科类"], r["批次"], r["类别"], r["选科要求"], majors,
    ].join(" ").toLowerCase().includes(kw);
  }

  // ===== 渲染 =====
  function renderMore() {
    const end = Math.min(renderedCount + PAGE_SIZE, filteredSchools.length);
    for (let i = renderedCount; i < end; i++) {
      listEl.appendChild(renderSchoolCard(filteredSchools[i], i + 1));
    }
    renderedCount = end;
  }

  function badgesHtml(s) {
    const tags = [];
    if (s.level) tags.push(`<span class="school-badge ${LEVEL_CLASS[s.level] || "lv-bk"}">${s.level}</span>`);
    if (s.level === "专科" && (s.data_years || []).includes("2026")) {
      tags.push(`<span class="school-badge bg-year">2026计划</span>`);
    } else if (s.year) {
      tags.push(`<span class="school-badge bg-year">${s.year}年</span>`);
    }
    if ((s.data_years || []).some((y) => y === "2024" || y === "2025")) tags.push(`<span class="school-badge bg-year">含往年参考</span>`);
    if (s.region) tags.push(`<span class="school-badge bg-region">${s.region}</span>`);
    if (s.nature) tags.push(`<span class="school-badge bg-nature">${s.nature}</span>`);
    (s.special || []).forEach((sp) => tags.push(`<span class="school-badge bg-special">${sp}</span>`));
    return tags.join("");
  }

  function renderSchoolCard(s, rank) {
    const card = document.createElement("div");
    card.className = "school-card";
    card.dataset.schoolId = String(s.id);
    const records = s._matched || [];
    const hasData = records.length > 0;
    const hi = maxScore(records);
    const lo = minScore(records);
    const planTotal = totalPlan(records);
    const majorTotal = totalMajors(records);
    const hasScore = hi >= 0;

    card.innerHTML = `
      <div class="school-header">
        <span class="school-rank">${rank}</span>
        <div class="school-title">
          <span class="school-name">${highlight(s.name, searchInput.value.trim())}</span>
          <div class="school-badges">${badgesHtml(s)}</div>
        </div>
        <div class="school-stats">
          ${hasScore ? `
            <div class="school-stat"><span class="val">${hi}</span><span class="lbl">最高分</span></div>
            <div class="school-stat"><span class="val">${lo}</span><span class="lbl">最低分</span></div>
            <div class="school-stat"><span class="val">${records.length}</span><span class="lbl">条记录</span></div>
          ` : hasData ? `
            <div class="school-stat"><span class="val">2026</span><span class="lbl">招生计划</span></div>
            <div class="school-stat"><span class="val">${planTotal || "—"}</span><span class="lbl">计划数</span></div>
            <div class="school-stat"><span class="val">${majorTotal || records.length}</span><span class="lbl">专业/组</span></div>
          ` : `<div class="school-stat no-data"><span class="val">—</span><span class="lbl">暂无数据</span></div>`}
        </div>
        <svg class="expand-arrow" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      <div class="score-detail"></div>
    `;

    const header = card.querySelector(".school-header");
    const detail = card.querySelector(".score-detail");
    header.addEventListener("click", () => {
      if (card.classList.contains("expanded")) {
        closeActiveDetail({ updateUrl: true });
      } else {
        openSchoolCard(card, s, records, { updateUrl: true, scrollIntoView: false });
      }
    });
    return card;
  }

  function openSchoolCard(card, s, records, options = {}) {
    closeActiveDetail({ updateUrl: false });
    const detail = card.querySelector(".score-detail");
    if (detail.children.length === 0) {
      detail.appendChild(renderScoreCards(records, s.name));
    }
    card.classList.add("expanded");
    activeSchoolId = String(s.id);
    if (options.updateUrl) {
      const hash = `#school=${encodeURIComponent(activeSchoolId)}`;
      if (location.hash !== hash) history.pushState({ schoolId: activeSchoolId }, "", hash);
    }
    if (options.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeActiveDetail(options = {}) {
    if (!activeSchoolId) return;
    const card = listEl.querySelector(`.school-card[data-school-id="${cssEscape(activeSchoolId)}"]`);
    if (card) card.classList.remove("expanded");
    activeSchoolId = null;
    if (options.updateUrl && location.hash.startsWith("#school=")) {
      if (history.state && history.state.schoolId) {
        history.back();
      } else {
        history.replaceState(null, "", location.pathname + location.search);
      }
    }
  }

  function openSchoolFromHash() {
    const match = location.hash.match(/^#school=(.+)$/);
    if (!match) return;
    const id = decodeURIComponent(match[1]);
    const index = filteredSchools.findIndex((s) => String(s.id) === id);
    if (index === -1) return;
    while (renderedCount <= index && renderedCount < filteredSchools.length) renderMore();
    const card = listEl.querySelector(`.school-card[data-school-id="${cssEscape(id)}"]`);
    if (card) openSchoolCard(card, filteredSchools[index], filteredSchools[index]._matched || [], { updateUrl: false, scrollIntoView: true });
  }

  function renderScoreCards(records, schoolName) {
    const wrap = document.createElement("div");
    wrap.className = "score-cards";
    const tools = document.createElement("div");
    tools.className = "detail-actions";
    tools.innerHTML = `
      <button type="button" class="detail-back">返回列表</button>
      <span>${escapeHtml(schoolName || "")} · ${records.length} 条记录</span>
    `;
    tools.querySelector(".detail-back").addEventListener("click", () => closeActiveDetail({ updateUrl: true }));
    wrap.appendChild(tools);
    if (records.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:#8c8c8c;text-align:center;padding:20px;";
      empty.textContent = "该学校暂无匹配记录";
      wrap.appendChild(empty);
      return wrap;
    }
    const sorted = records.slice().sort((a, b) => {
      const orderA = a["数据类型"] === "2026招生计划" ? "0" : "1";
      const orderB = b["数据类型"] === "2026招生计划" ? "0" : "1";
      const sa = orderA + (a["年份"] || "") + (a["科类"] || "") + (a["类别"] || "") + (a["专业组编号"] || "");
      const sb = orderB + (b["年份"] || "") + (b["科类"] || "") + (b["类别"] || "") + (b["专业组编号"] || "");
      return sa.localeCompare(sb);
    });
    for (const r of sorted) wrap.appendChild(renderOneCard(r));
    return wrap;
  }

  function renderOneCard(r) {
    const card = document.createElement("div");
    card.className = "score-card";
    const tagsHtml = [];
    if (r["数据类型"]) tagsHtml.push(`<span class="score-tag t-remark">${r["数据类型"]}</span>`);
    if (r["年份"]) tagsHtml.push(`<span class="score-tag t-group">${r["年份"]}</span>`);
    if (r["科类"]) tagsHtml.push(`<span class="score-tag t-subject">${r["科类"]}</span>`);
    if (r["批次"]) tagsHtml.push(`<span class="score-tag t-batch">${r["批次"]}</span>`);
    if (r["类别"]) tagsHtml.push(`<span class="score-tag t-batch">${r["类别"]}</span>`);
    if (r["计划类别"]) tagsHtml.push(`<span class="score-tag t-plan">${r["计划类别"]}</span>`);
    if (r["类型"]) tagsHtml.push(`<span class="score-tag t-plan">${r["类型"]}</span>`);
    if (r["专业组名称"]) tagsHtml.push(`<span class="score-tag t-group">${r["专业组名称"]}</span>`);
    if (r["专业组编号"]) tagsHtml.push(`<span class="score-tag t-group">编号:${r["专业组编号"]}</span>`);
    if (r["备注"]) tagsHtml.push(`<span class="score-tag t-remark">${r["备注"]}</span>`);

    const scoreFields = ["语数之和", "语数最高", "外语", "首选科目", "再选最高", "再选次高", "文化成绩"];
    const otherFields = ["计划数合计", "院校代码", "志愿序号", "位次", "控制线", "选科要求", "备注", "来源年份说明", "来源"];
    const scoreDetailHtml = scoreFields.filter((f) => r[f] !== undefined)
      .map((f) => `<div class="score-field"><span class="fl">${f}</span><span class="fv">${r[f]}</span></div>`).join("");
    const otherHtml = otherFields.filter((f) => r[f] !== undefined)
      .map((f) => `<div class="score-field"><span class="fl">${f}</span><span class="fv">${r[f]}</span></div>`).join("");
    const majors = r["专业列表"] || [];
    const majorsHtml = majors.length ? `<div class="score-detail-grid"><div class="score-field section-title">包含专业(${majors.length}个)</div>${majors.map((m) => {
      const planText = m["计划数"] ? `计划 ${m["计划数"]}人` : "";
      const feeText = m["学费"] ? `学费 ${m["学费"]}${m["学费单位"] || "元"}/年` : "";
      const feeYear = m["学费年份"] ? `${m["学费年份"]}计划` : "";
      return `<div class="score-field"><span class="fl">${m["专业名称"] || ""}</span><span class="fv">${[planText, feeText, feeYear].filter(Boolean).join(" · ")}</span></div>`;
    }).join("")}</div>` : "";

    const hasScore = recordScore(r) >= 0;
    const mainLabel = hasScore ? "投档线" : (r["数据类型"] === "2026招生计划" ? "招生计划" : "投档线");
    const mainValue = hasScore
      ? r["投档线"]
      : (r["数据类型"] === "2026招生计划"
        ? `${r["计划数合计"] || "—"}人`
        : "暂无");

    card.innerHTML = `
      <div class="score-card-tags">${tagsHtml.join("")}</div>
      <div class="score-main-row">
        <span class="score-label">${mainLabel}</span>
        <span class="score-value">${mainValue}</span>
      </div>
      ${scoreDetailHtml ? `<div class="score-detail-grid"><div class="score-field section-title">成绩明细</div>${scoreDetailHtml}</div>` : ""}
      ${otherHtml ? `<div class="score-detail-grid"><div class="score-field section-title">其他信息</div>${otherHtml}</div>` : ""}
      ${majorsHtml}
    `;
    return card;
  }

  function highlight(name, kw) {
    if (!kw) return escapeHtml(name);
    const idx = name.toLowerCase().indexOf(kw.toLowerCase());
    if (idx === -1) return escapeHtml(name);
    return (
      escapeHtml(name.slice(0, idx)) +
      "<mark>" + escapeHtml(name.slice(idx, idx + kw.length)) + "</mark>" +
      escapeHtml(name.slice(idx + kw.length))
    );
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  function currentFilterState() {
    return {
      search: searchInput.value,
      subject: filterSubject.value,
      batch: filterBatch.value,
      plan: filterPlan.value,
      level: filterLevel.value,
      region: filterRegion.value,
      nature: filterNature.value,
      special: filterSpecial.value,
      year: filterYear.value,
      min: filterMin.value,
      max: filterMax.value,
      onlyData: onlyHasData.checked,
    };
  }

  function saveFilters() {
    try {
      sessionStorage.setItem("hbGaokaoFilters", JSON.stringify(currentFilterState()));
    } catch (_) {}
  }

  function restoreFilters() {
    try {
      const raw = sessionStorage.getItem("hbGaokaoFilters");
      if (!raw) return;
      const f = JSON.parse(raw);
      searchInput.value = f.search || "";
      filterSubject.value = f.subject || "";
      filterBatch.value = f.batch || "";
      filterPlan.value = f.plan || "";
      filterLevel.value = f.level || "";
      filterRegion.value = f.region || "";
      filterNature.value = f.nature || "";
      filterSpecial.value = f.special || "";
      filterYear.value = f.year || "";
      filterMin.value = f.min || "";
      filterMax.value = f.max || "";
      onlyHasData.checked = !!f.onlyData;
    } catch (_) {}
  }

  // ===== 事件 =====
  let debounceTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  });
  clearBtn.addEventListener("click", () => {
    searchInput.value = ""; applyFilters(); searchInput.focus();
  });
  [filterSubject, filterBatch, filterPlan, filterLevel, filterRegion, filterNature, filterSpecial, filterYear].forEach((el) =>
    el.addEventListener("change", applyFilters)
  );
  [filterMin, filterMax].forEach((el) =>
    el.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilters, 300);
    })
  );
  onlyHasData.addEventListener("change", applyFilters);
  resetBtn.addEventListener("click", () => {
    searchInput.value = "";
    [filterSubject, filterBatch, filterPlan, filterLevel, filterRegion, filterNature, filterSpecial, filterYear].forEach((el) => (el.value = ""));
    filterMin.value = ""; filterMax.value = "";
    onlyHasData.checked = false;
    applyFilters();
  });

  window.addEventListener("popstate", () => {
    if (location.hash.startsWith("#school=")) {
      openSchoolFromHash();
    } else if (activeSchoolId) {
      const card = listEl.querySelector(`.school-card[data-school-id="${cssEscape(activeSchoolId)}"]`);
      if (card) card.classList.remove("expanded");
      activeSchoolId = null;
    }
  });

  window.addEventListener("scroll", () => {
    backToTop.hidden = window.scrollY < 400;
    if (renderedCount < filteredSchools.length &&
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) {
      renderMore();
    }
  });
  backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
})();
