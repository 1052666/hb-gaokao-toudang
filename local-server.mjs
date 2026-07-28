import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HB_AI_PORT || process.argv.find((arg) => /^\d+$/.test(arg)) || 8787);
const CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const OFFICIAL_DOMAINS = [
  "gaokao.chsi.com.cn",
  "chsi.com.cn",
  "hbea.edu.cn",
  "zsxx.e21.cn",
  "moe.gov.cn",
  "gov.cn",
];
const searchCache = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        service: "hb-gaokao-local-search",
        channels: ["必应", "360搜索", "官方站点定向"],
        now: new Date().toISOString(),
      });
      return;
    }
    if (url.pathname === "/api/search" && request.method === "POST") {
      const input = await readJsonBody(request);
      const result = await runSearch(input);
      sendJson(response, result.ok ? 200 : 502, result);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method || "")) {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    await serveStatic(url.pathname, request.method === "HEAD", response);
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message || "Internal server error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`HB Gaokao local AI server: http://127.0.0.1:${PORT}/ai.html`);
  console.log("Search channels: Bing RSS, 360 Search, official-site targeted search");
});

async function runSearch(input = {}) {
  const query = String(input.query || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const officialOnly = Boolean(input.official_only);
  const maxResults = clamp(Number(input.max_results) || 8, 3, 12);
  if (!query) return { ok: false, error: "搜索词不能为空", results: [] };

  const cacheKey = JSON.stringify([query, officialOnly, maxResults]);
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const officialQuery = `${query} (site:gaokao.chsi.com.cn OR site:hbea.edu.cn OR site:zsxx.e21.cn OR site:moe.gov.cn OR site:edu.cn)`;
  const channels = [
    { name: "必应", run: () => searchBing(query, 6, "必应") },
    { name: "360搜索", run: () => search360(query, 6) },
    { name: "官方站点定向", run: () => searchBing(officialQuery, 8, "官方站点定向") },
  ];
  const settled = await Promise.allSettled(channels.map((channel) => channel.run()));
  const sourceStatus = settled.map((item, index) => ({
    name: channels[index].name,
    ok: item.status === "fulfilled",
    count: item.status === "fulfilled" ? item.value.length : 0,
    error: item.status === "rejected" ? String(item.reason?.message || item.reason) : "",
  }));
  const combined = settled.flatMap((item) => item.status === "fulfilled" ? item.value : []);
  const deduped = dedupeResults(combined)
    .filter((item) => !officialOnly || item.official)
    .sort((a, b) => Number(b.official) - Number(a.official) || Number(b.year || 0) - Number(a.year || 0))
    .slice(0, maxResults);
  const sourcesOk = sourceStatus.filter((item) => item.ok).length;
  const value = {
    ok: sourcesOk > 0,
    query,
    official_only: officialOnly,
    fetched_at: new Date().toISOString(),
    sources_ok: sourcesOk,
    sources: sourceStatus,
    results: deduped,
    note: "搜索摘要用于发现和交叉核验，预测或第三方整理不能替代高校及主管部门最终公告。",
  };
  if (!value.ok) value.error = sourceStatus.map((item) => `${item.name}: ${item.error}`).join("；");
  searchCache.set(cacheKey, { savedAt: Date.now(), value });
  return value;
}

async function searchBing(query, limit, provider) {
  const url = new URL("https://cn.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  url.searchParams.set("mkt", "zh-CN");
  url.searchParams.set("setlang", "zh-hans");
  const xml = await fetchText(url);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit);
  return items.map((match) => {
    const item = match[1];
    const title = cleanText(xmlTag(item, "title"));
    const resultUrl = cleanText(xmlTag(item, "link"));
    const snippet = cleanText(xmlTag(item, "description"));
    return makeResult({ title, url: resultUrl, snippet, provider });
  }).filter((item) => item.url && item.title);
}

async function search360(query, limit) {
  const url = new URL("https://www.so.com/s");
  url.searchParams.set("q", query);
  const html = await fetchText(url);
  const blocks = [...html.matchAll(/<li\s+class=["']res-list["'][^>]*>([\s\S]*?)<\/li>/gi)].slice(0, limit);
  return blocks.map((match) => {
    const block = match[1];
    const heading = block.match(/<h3[^>]*class=["'][^"']*res-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "";
    const anchor = heading.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    const attrs = anchor?.[1] || "";
    const title = cleanText(anchor?.[2] || "");
    const directUrl = htmlAttribute(attrs, "data-mdurl") || htmlAttribute(attrs, "href");
    const snippet = cleanText(block.match(/<p[^>]*class=["'][^"']*res-desc[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    return makeResult({ title, url: directUrl, snippet, provider: "360搜索" });
  }).filter((item) => item.url && item.title);
}

function makeResult({ title, url, snippet, provider }) {
  const safeUrl = normalizeUrl(url);
  const domain = safeUrl ? new URL(safeUrl).hostname.replace(/^www\./, "") : "";
  const yearMatch = `${title} ${snippet}`.match(/\b(20(?:2[4-9]|3\d))\b/);
  return {
    title: title.slice(0, 180),
    url: safeUrl,
    domain,
    snippet: snippet.slice(0, 500),
    provider,
    official: isOfficialDomain(domain),
    year: yearMatch ? Number(yearMatch[1]) : null,
  };
}

function dedupeResults(results) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const output = [];
  for (const result of results) {
    if (!result.url || !result.title) continue;
    const urlKey = result.url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
    const titleKey = result.title.replace(/\s+/g, "").toLowerCase();
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    output.push(result);
  }
  return output;
}

function isOfficialDomain(domain) {
  const host = String(domain || "").toLowerCase();
  return OFFICIAL_DOMAINS.some((item) => host === item || host.endsWith(`.${item}`)) ||
    host.endsWith(".edu.cn") ||
    host.endsWith(".gov.cn");
}

function normalizeUrl(value) {
  try {
    const decoded = decodeEntities(String(value || "").trim());
    const url = new URL(decoded);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => url.searchParams.delete(key));
    return url.href;
  } catch {
    return "";
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function xmlTag(value, tag) {
  return value.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
}

function htmlAttribute(value, name) {
  const match = value.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeEntities(match?.[1] || match?.[2] || "");
}

function cleanText(value) {
  return decodeEntities(String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

async function serveStatic(pathname, headOnly, response) {
  let relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!relative) relative = "index.html";
  let filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(response, 403, { ok: false, error: "Forbidden" });
    return;
  }
  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStat = await stat(filePath);
    }
  } catch {
    sendJson(response, 404, { ok: false, error: "Not found" });
    return;
  }
  const headers = {
    "Content-Length": fileStat.size,
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  };
  response.writeHead(200, headers);
  if (headOnly) {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    ...extra,
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, corsHeaders({
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  }));
  response.end(body);
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) throw new Error("Request body too large");
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
