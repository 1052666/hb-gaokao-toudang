(() => {
  "use strict";

  const data = window.MEDICAL_DATA;
  if (!data) {
    document.getElementById("school-results").innerHTML =
      '<div class="empty-state"><strong>数据文件加载失败</strong><p>请刷新页面后重试。</p></div>';
    return;
  }

  const elements = {
    score: document.getElementById("score-input"),
    rank: document.getElementById("rank-estimate"),
    search: document.getElementById("search-input"),
    nature: document.getElementById("nature-filter"),
    city: document.getElementById("city-filter"),
    category: document.getElementById("category-filter"),
    plan: document.getElementById("plan-filter"),
    line: document.getElementById("line-filter"),
    sort: document.getElementById("sort-filter"),
    hideSpecial: document.getElementById("hide-special"),
    results: document.getElementById("school-results"),
    empty: document.getElementById("empty-state"),
    resultCount: document.getElementById("result-count"),
    resultExplanation: document.getElementById("result-explanation"),
    reset: document.getElementById("reset-filters"),
    backToTop: document.getElementById("back-to-top"),
  };

  let quickMode = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "—";
  }

  function scoreValue() {
    if (elements.score.value.trim() === "") return null;
    const value = Number(elements.score.value);
    return Number.isFinite(value) ? value : null;
  }

  function estimateRank(score) {
    if (score === null || score < 300 || score > 370) return null;
    const points = data.rankPoints;
    const exact = points.find(([point]) => point === score);
    if (exact) return exact[1];
    const upper = points.find(([point]) => point > score);
    const lower = [...points].reverse().find(([point]) => point < score);
    if (!upper || !lower) return null;
    const ratio = (score - lower[0]) / (upper[0] - lower[0]);
    return Math.round(lower[1] + (upper[1] - lower[1]) * ratio);
  }

  function updateRankEstimate() {
    const score = scoreValue();
    elements.rank.classList.remove("invalid");
    if (score === null) {
      elements.rank.textContent = "未填写分数，不自动代入任何默认值";
      return;
    }
    if (score < 300 || score > 370) {
      elements.rank.textContent = "本页研究区间为 300–370 分，请输入区间内分数";
      elements.rank.classList.add("invalid");
      return;
    }
    const rank = estimateRank(score);
    elements.rank.textContent = `按 2025 一分一段，同分约累计至 ${formatNumber(rank)} 位；这不是 2026 位次`;
  }

  function riskFor(group, score) {
    if (score === null) {
      return { className: "neutral", label: "待输入分数", detail: "" };
    }
    if (score < 300 || score > 370) {
      return { className: "invalid", label: "超出研究区间", detail: "" };
    }
    if (!Number.isFinite(group.score2025)) {
      return { className: "neutral", label: "无同组参考", detail: "" };
    }
    const delta = score - group.score2025;
    const rough = group.referenceQuality !== "same-group" ? " · 粗参考" : "";
    if (delta >= 15) {
      return {
        className: "safe",
        label: `高 ${delta} 分${rough}`,
        detail: "相对宽裕",
      };
    }
    if (delta >= 5) {
      return {
        className: "match",
        label: `高 ${delta} 分${rough}`,
        detail: "较匹配",
      };
    }
    if (delta >= -5) {
      const deltaText = delta === 0 ? "持平" : delta > 0 ? `高 ${delta} 分` : `低 ${Math.abs(delta)} 分`;
      return {
        className: "reach",
        label: `${deltaText}${rough}`,
        detail: "可冲",
      };
    }
    return {
      className: "low",
      label: `低 ${Math.abs(delta)} 分${rough}`,
      detail: "低于去年组线",
    };
  }

  function isQualificationPlan(planType) {
    return /乡村振兴|定向|专本联合培养/.test(planType || "");
  }

  function matchesLineFilter(group, value) {
    if (!value) return true;
    const score = group.score2025;
    if (value === "missing") return !Number.isFinite(score);
    if (!Number.isFinite(score)) return false;
    if (value === "at-most-370") return score <= 370;
    if (value === "300-370") return score >= 300 && score <= 370;
    if (value === "above-370") return score > 370;
    if (value === "below-300") return score < 300;
    return true;
  }

  function filteredSchools() {
    const query = elements.search.value.trim().toLowerCase();
    const hideSpecial = elements.hideSpecial.checked;
    const filtered = [];

    for (const school of data.schools) {
      if (elements.nature.value && school.nature !== elements.nature.value) continue;
      if (elements.city.value && school.city !== elements.city.value) continue;
      if (quickMode === "public-match" && school.nature !== "公办") continue;
      if (quickMode === "private" && school.nature !== "民办") continue;

      const schoolMatchesQuery =
        !query ||
        `${school.name} ${school.city} ${school.institutionCode}`.toLowerCase().includes(query);
      const groups = [];

      for (const group of school.groups) {
        if (elements.plan.value && group.planType2026 !== elements.plan.value) continue;
        if (hideSpecial && isQualificationPlan(group.planType2026)) continue;
        if (!matchesLineFilter(group, elements.line.value)) continue;
        if (
          (quickMode === "public-match" || quickMode === "private") &&
          (!Number.isFinite(group.score2025) || group.score2025 > 370)
        ) {
          continue;
        }

        let majors = group.majors;
        if (elements.category.value) {
          majors = majors.filter((major) => major.category === elements.category.value);
        }
        if (quickMode === "nursing") {
          majors = majors.filter((major) => /护理|助产/.test(major.name));
        }
        if (quickMode === "clinical") {
          majors = majors.filter((major) => /临床医学|口腔医学/.test(major.name));
        }
        if (query && !schoolMatchesQuery) {
          majors = majors.filter((major) =>
            `${major.name} ${major.nationalCode} ${major.localCode}`.toLowerCase().includes(query)
          );
        }
        if (!majors.length) continue;
        groups.push({ ...group, majors });
      }

      if (groups.length) filtered.push({ ...school, groups });
    }

    const scoreForSchool = (school) => {
      const scores = school.groups.map((group) => group.score2025).filter(Number.isFinite);
      return scores.length ? Math.min(...scores) : Number.POSITIVE_INFINITY;
    };
    const tuitionForSchool = (school) => {
      const values = school.groups
        .flatMap((group) => group.majors)
        .map((major) => major.tuition)
        .filter(Number.isFinite);
      return values.length ? Math.min(...values) : Number.POSITIVE_INFINITY;
    };

    filtered.sort((a, b) => {
      if (elements.sort.value === "score-desc") return scoreForSchool(b) - scoreForSchool(a);
      if (elements.sort.value === "public-first") {
        return (
          Number(b.nature === "公办") - Number(a.nature === "公办") ||
          scoreForSchool(a) - scoreForSchool(b)
        );
      }
      if (elements.sort.value === "tuition-asc") {
        return tuitionForSchool(a) - tuitionForSchool(b) || scoreForSchool(a) - scoreForSchool(b);
      }
      if (elements.sort.value === "name") return a.name.localeCompare(b.name, "zh-CN");
      return scoreForSchool(a) - scoreForSchool(b);
    });

    return filtered;
  }

  function planTag(group) {
    const special = group.planType2026 !== "普通类";
    return `<span class="plan-tag${special ? " special" : ""}">${escapeHtml(group.planType2026)}</span>`;
  }

  function referenceQualityText(group) {
    if (group.referenceQuality === "same-group") return "同号组";
    if (group.referenceQuality === "analog-group") return "相近组";
    if (group.referenceQuality === "type-mismatch") return "类型不一致";
    return "无同组数据";
  }

  function renderMajorRow(major) {
    const localCode = major.localCode
      ? `<span class="local-code"><strong>${escapeHtml(major.localCode)}</strong><small>${escapeHtml(major.localCodeYear || "2026")}</small></span>`
      : '<span class="local-code missing"><strong>未取得</strong><small>2025公开资料</small></span>';
    const note = major.note
      ? escapeHtml(major.note)
      : major.localCode
        ? "—"
        : "六位代码不是湖北填报代号";
    return `
      <tr>
        <td><span class="major-name">${escapeHtml(major.name)}</span></td>
        <td>${localCode}</td>
        <td class="major-code"><code>${escapeHtml(major.nationalCode || "—")}</code></td>
        <td>${major.plan ?? "—"}</td>
        <td class="tuition">${major.tuition ? `${formatNumber(major.tuition)} 元/年` : "2025公开收费未取得"}</td>
        <td>${note}</td>
      </tr>
    `;
  }

  function renderGroup(group, score) {
    const risk = riskFor(group, score);
    const referenceWarning = group.referenceQuality !== "same-group";
    const planCount = group.majors.reduce((sum, major) => sum + (major.plan || 0), 0);
    const sourceText = group.codeSource
      ? `已取得的湖北两位专业代号，年份已标在每个代号下方；来源：${escapeHtml(group.codeSource)}。`
      : "2025参考核对：未取得该组可靠的湖北组内两位专业代号，因此不展示猜测值。2026正式填报时须查《湖北招生考试》第22期。";
    return `
      <section class="group-block">
        <div class="group-head">
          <div class="group-title">
            <h4><span class="group-code">${escapeHtml(group.groupCode)}</span>第${escapeHtml(group.groupNo)}组 ${planTag(group)}</h4>
            <div class="group-subline">
              <span>${escapeHtml(group.selection)}</span>
              <span>本页列出 ${group.majors.length} 个相关专业</span>
              <span>相关专业计划 ${formatNumber(planCount)} 人</span>
              ${group.planTotal ? `<span>全组计划 ${formatNumber(group.planTotal)} 人</span>` : ""}
            </div>
          </div>
          <div class="risk-badge ${risk.className}">
            <span>${escapeHtml(risk.detail || risk.label)}</span>
            ${risk.detail ? `<br><small>${escapeHtml(risk.label)}</small>` : ""}
          </div>
        </div>

        <div class="score-reference">
          <div>
            <span>2025 组最低分</span>
            <strong>${Number.isFinite(group.score2025) ? `${group.score2025} 分` : "2025无同组记录"}</strong>
          </div>
          <div>
            <span>2025 对应位次</span>
            <strong>${Number.isFinite(group.rank2025) ? `${formatNumber(group.rank2025)} 位` : "—"}</strong>
          </div>
          <div>
            <span>参考质量</span>
            <strong>${referenceQualityText(group)}</strong>
          </div>
        </div>
        <p class="reference-note${referenceWarning ? " warning" : ""}">${escapeHtml(group.referenceNote)}</p>

        <div class="major-table-wrap">
          <table class="major-table">
            <thead>
              <tr>
                <th>2026 专业</th>
                <th>湖北组内代号（年份）</th>
                <th>国标代码</th>
                <th>计划</th>
                <th>2026 学费</th>
                <th>限制/校区备注</th>
              </tr>
            </thead>
            <tbody>${group.majors.map(renderMajorRow).join("")}</tbody>
          </table>
        </div>
        <p class="code-note">${sourceText}</p>
      </section>
    `;
  }

  function renderSchool(school, score) {
    const scores = school.groups.map((group) => group.score2025).filter(Number.isFinite);
    const minScore = scores.length ? Math.min(...scores) : null;
    const natureClass = school.nature === "公办" ? "public" : "private";
    const dormStatus = {
      official: { label: "校方公开材料", className: "official" },
      secondary: { label: "第三方二次参考", className: "secondary" },
      unavailable: { label: "2025未检索到固定信息", className: "unavailable" },
    }[school.dorm.status] || { label: "2025参考状态未识别", className: "unavailable" };
    const dormSource = school.dorm.source
      ? `<a href="${escapeHtml(school.dorm.source)}" target="_blank" rel="noopener">查看${dormStatus.label}（${escapeHtml(school.dorm.year)}）</a>`
      : "";
    return `
      <article class="school-card">
        <div class="school-card-head">
          <div class="school-title-block">
            <div class="school-title-row">
              <h3>${escapeHtml(school.name)}</h3>
              <span class="badge ${natureClass}">${escapeHtml(school.nature)}</span>
              <span class="badge level">${escapeHtml(school.schoolLevel)}</span>
            </div>
            <div class="school-meta">
              <span>所在地：${escapeHtml(school.city)}</span>
              <span>湖北院校代码：<code>${escapeHtml(school.institutionCode)}</code></span>
              <span>${school.groups.length} 个相关专业组</span>
            </div>
          </div>
          <div class="school-summary">
            <strong>${minScore === null ? "2025无同组记录" : `${minScore} 分`}</strong>
            <span>所列组中最低的 2025 参考线</span>
          </div>
        </div>
        <details>
          <summary>
            <span>查看专业组、专业代码、计划、学费和宿舍</span>
          </summary>
          <div class="school-detail">
            ${school.groups.map((group) => renderGroup(group, score)).join("")}
            <div class="dorm-row">
              <div class="dorm-head">
                <strong>宿舍环境</strong>
                <span class="dorm-status ${dormStatus.className}">${dormStatus.label}</span>
                <span class="dorm-year">参考年份：${escapeHtml(school.dorm.year)}</span>
              </div>
              <p>${escapeHtml(school.dorm.text)}</p>
              ${dormSource}
            </div>
          </div>
        </details>
      </article>
    `;
  }

  function renderResults() {
    updateRankEstimate();
    const score = scoreValue();
    const schools = filteredSchools();
    const groupCount = schools.reduce((sum, school) => sum + school.groups.length, 0);
    const majorCount = schools.reduce(
      (sum, school) =>
        sum + school.groups.reduce((inner, group) => inner + group.majors.length, 0),
      0
    );
    elements.resultCount.textContent = `${schools.length} 所学校 · ${groupCount} 个组`;
    elements.resultExplanation.textContent =
      score !== null && score >= 300 && score <= 370
        ? `按 ${score} 分与 2025 组线比较，共显示 ${majorCount} 条专业计划`
        : `共显示 ${majorCount} 条专业计划；输入分数后生成风险标签`;
    elements.results.innerHTML = schools.map((school) => renderSchool(school, score)).join("");
    elements.empty.hidden = schools.length > 0;
  }

  function populateFilters() {
    const cities = [...new Set(data.schools.map((school) => school.city))].sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    );
    const categories = [
      ...new Set(
        data.schools.flatMap((school) =>
          school.groups.flatMap((group) => group.majors.map((major) => major.category))
        )
      ),
    ];
    elements.city.insertAdjacentHTML(
      "beforeend",
      cities.map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join("")
    );
    elements.category.insertAdjacentHTML(
      "beforeend",
      categories
        .map(
          (category) =>
            `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
        )
        .join("")
    );
  }

  function renderSummary() {
    const publicCount = data.schools.filter((school) => school.nature === "公办").length;
    const normalAtMost370 = data.schools.reduce(
      (sum, school) =>
        sum +
        school.groups.filter(
          (group) =>
            group.planType2026 === "普通类" &&
            Number.isFinite(group.score2025) &&
            group.score2025 <= 370
        ).length,
      0
    );
    const nursingPlans = data.schools.reduce(
      (sum, school) =>
        sum +
        school.groups.reduce(
          (groupSum, group) =>
            groupSum +
            group.majors
              .filter((major) => /护理|助产/.test(major.name))
              .reduce((majorSum, major) => majorSum + (major.plan || 0), 0),
          0
        ),
      0
    );
    const localCodes = data.schools.reduce(
      (sum, school) =>
        sum +
        school.groups.reduce(
          (groupSum, group) =>
            groupSum + group.majors.filter((major) => major.localCode).length,
          0
        ),
      0
    );
    const items = [
      [data.meta.schoolCount, "湖北省内相关院校", "accent"],
      [publicCount, "其中公办院校", ""],
      [data.meta.majorCount, "2026 相关专业记录", ""],
      [normalAtMost370, "普通组且2025线≤370", "warning"],
      [formatNumber(nursingPlans), `护理/助产计划人次 · 已核且标年份的两位码 ${localCodes} 条`, "accent"],
    ];
    document.getElementById("summary-grid").innerHTML = items
      .map(
        ([value, label, className]) =>
          `<div class="summary-item ${className}"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`
      )
      .join("");
    document.getElementById(
      "dataset-scope"
    ).textContent = `${data.meta.schoolCount} 所学校 · ${data.meta.groupCount} 个专业组 · ${data.meta.majorCount} 条专业记录`;
  }

  function renderRankTable() {
    document.getElementById("rank-table").innerHTML = data.rankPoints
      .map(
        ([score, rank]) =>
          `<div class="rank-cell"><strong>${score} 分</strong><span>${formatNumber(rank)} 位</span></div>`
      )
      .join("");
  }

  function renderUndergraduate() {
    document.getElementById("undergrad-body").innerHTML = data.undergraduateOnly
      .map(
        (school) => `
          <tr>
            <td><strong>${escapeHtml(school.name)}</strong></td>
            <td><code>${escapeHtml(school.code)}</code></td>
            <td>${escapeHtml(school.groups)}</td>
            <td>${escapeHtml(school.majors)}</td>
            <td>${escapeHtml(school.tuition)}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderSources() {
    document.getElementById("source-count").textContent = `${data.sources.length} 个来源`;
    document.getElementById("source-list").innerHTML = data.sources
      .map((source) => {
        const official = /官方|政府|校方/.test(source.type);
        return `
          <div class="source-item">
            <span class="source-type${official ? " official" : ""}">${escapeHtml(source.type)}</span>
            <div>
              <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.title)}</a>
              <p>${escapeHtml(source.purpose)}</p>
            </div>
            <span class="source-year">数据年份 ${escapeHtml(source.year)}</span>
          </div>
        `;
      })
      .join("");
  }

  function clearQuickMode() {
    quickMode = "";
    document.querySelectorAll("[data-quick]").forEach((button) => button.classList.remove("active"));
  }

  function resetFilters() {
    clearQuickMode();
    elements.score.value = "";
    elements.search.value = "";
    elements.nature.value = "";
    elements.city.value = "";
    elements.category.value = "";
    elements.plan.value = "";
    elements.line.value = "";
    elements.sort.value = "score-asc";
    elements.hideSpecial.checked = false;
    renderResults();
  }

  function applyQuickFilter(button) {
    const mode = button.dataset.quick;
    const nextMode = quickMode === mode ? "" : mode;
    resetFilters();
    quickMode = nextMode;
    if (!quickMode) return;
    button.classList.add("active");
    if (quickMode === "public-match") {
      elements.nature.value = "公办";
      elements.plan.value = "普通类";
      elements.line.value = "at-most-370";
    } else if (quickMode === "nursing") {
      elements.category.value = "护理助产";
    } else if (quickMode === "private") {
      elements.nature.value = "民办";
      elements.line.value = "at-most-370";
    }
    renderResults();
  }

  function bindEvents() {
    const regularControls = [
      elements.score,
      elements.search,
      elements.nature,
      elements.city,
      elements.category,
      elements.plan,
      elements.line,
      elements.sort,
      elements.hideSpecial,
    ];
    regularControls.forEach((control) => {
      const eventName =
        control.type === "checkbox" || control.tagName !== "INPUT" ? "change" : "input";
      control.addEventListener(eventName, () => {
        if (control !== elements.score) clearQuickMode();
        renderResults();
      });
    });

    elements.reset.addEventListener("click", resetFilters);
    document.querySelectorAll("[data-quick]").forEach((button) => {
      button.addEventListener("click", () => applyQuickFilter(button));
    });

    document.getElementById("print-page").addEventListener("click", () => window.print());
    window.addEventListener("scroll", () => {
      elements.backToTop.hidden = window.scrollY < 600;
    });
    elements.backToTop.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );

    let detailsBeforePrint = [];
    window.addEventListener("beforeprint", () => {
      detailsBeforePrint = [...document.querySelectorAll(".school-card details")].map(
        (details) => details.open
      );
      document.querySelectorAll(".school-card details").forEach((details) => {
        details.open = true;
      });
    });
    window.addEventListener("afterprint", () => {
      document.querySelectorAll(".school-card details").forEach((details, index) => {
        details.open = detailsBeforePrint[index] || false;
      });
    });
  }

  populateFilters();
  renderSummary();
  renderRankTable();
  renderUndergraduate();
  renderSources();
  bindEvents();
  renderResults();
})();
