// Fetches language stats across all repos (including private) and generates an SVG bar chart.
// Requires GH_TOKEN env var with repo scope.

const LANGS_TO_SHOW = 8;

// Languages to exclude — typically build artefacts from R/Quarto/pandoc pipelines
const EXCLUDE_LANGS = new Set(["TeX", "HTML", "CSS", "PostScript", "ZAP"]);

// Colours for common languages — falls back to grey
const LANG_COLOURS = {
  R: "#276DC3",
  Python: "#3776AB",
  JavaScript: "#F7DF1E",
  TypeScript: "#3178C6",
  Ruby: "#CC342D",
  C: "#A8B9CC",
  "C++": "#00599C",
  Shell: "#4EAA25",
  PHP: "#777BB4",
  HTML: "#E34F26",
  CSS: "#1572B6",
  TeX: "#3D6117",
  Lua: "#000080",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  Typst: "#239DAD",
  CoffeeScript: "#244776",
  FreeMarker: "#0050b2",
  PostScript: "#da291c",
  ZAP: "#0d665e",
};
const DEFAULT_COLOUR = "#8b8b8b";

async function apiFetch(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  return { json: await res.json(), headers: res.headers };
}

async function fetchAllRepos(token) {
  const repos = [];
  let url = "https://api.github.com/user/repos?per_page=100&affiliation=owner";
  while (url) {
    const { json, headers } = await apiFetch(url, token);
    repos.push(...json.filter((r) => !r.fork));
    const link = headers.get("link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return repos;
}

async function aggregateLanguages(token, repos) {
  const totals = {};
  for (const repo of repos) {
    const { json: langs } = await apiFetch(repo.languages_url, token);

    // Filter excluded languages, then normalise within each repo.
    // Each repo contributes a total weight of 1, split proportionally
    // across its languages. This prevents a single large repo from
    // dominating while still capturing multi-language projects.
    const filtered = Object.entries(langs).filter(
      ([lang]) => !EXCLUDE_LANGS.has(lang),
    );
    const repoTotal = filtered.reduce((sum, [, bytes]) => sum + bytes, 0);
    if (repoTotal === 0) continue;

    for (const [lang, bytes] of filtered) {
      totals[lang] = (totals[lang] || 0) + bytes / repoTotal;
    }
  }
  return totals;
}

function buildSVG(languages, theme = "light") {
  const isDark = theme === "dark";
  const sorted = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LANGS_TO_SHOW);

  const total = sorted.reduce((sum, [, bytes]) => sum + bytes, 0);
  const items = sorted.map(([lang, bytes]) => ({
    lang,
    pct: ((bytes / total) * 100).toFixed(1),
    colour: LANG_COLOURS[lang] || DEFAULT_COLOUR,
  }));

  const barWidth = 400;
  const barHeight = 8;
  const barY = 0;
  const legendY = barY + barHeight + 20;
  const legendColSize = 8;
  const legendRowHeight = 20;
  const cols = 2;
  const colWidth = barWidth / cols;
  const rows = Math.ceil(items.length / cols);
  const svgHeight = legendY + rows * legendRowHeight + 8;

  // Stacked bar segments
  let barSegments = "";
  let x = 0;
  for (const item of items) {
    const w = (parseFloat(item.pct) / 100) * barWidth;
    barSegments += `  <rect x="${x}" y="${barY}" width="${w}" height="${barHeight}" fill="${item.colour}" rx="0" />\n`;
    x += w;
  }

  // Round the overall bar
  const barGroup = `<g clip-path="url(#bar-clip)">\n${barSegments}</g>`;
  const clipPath = `<clipPath id="bar-clip"><rect x="0" y="${barY}" width="${barWidth}" height="${barHeight}" rx="4" /></clipPath>`;

  // Legend
  let legend = "";
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lx = col * colWidth;
    const ly = legendY + row * legendRowHeight;
    legend += `  <circle cx="${lx + legendColSize / 2}" cy="${ly + legendColSize / 2}" r="${legendColSize / 2}" fill="${item.colour}" />\n`;
    const nameColour = isDark ? "#e6edf3" : "#1f2328";
    const pctColour = isDark ? "#9198a1" : "#697077";
    legend += `  <text x="${lx + legendColSize + 6}" y="${ly + legendColSize - 1}" font-size="11" fill="${nameColour}">${item.lang} <tspan fill="${pctColour}">${item.pct}%</tspan></text>\n`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${barWidth}" height="${svgHeight}" viewBox="0 0 ${barWidth} ${svgHeight}">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }</style>
  <defs>${clipPath}</defs>
${barGroup}
${legend}
</svg>`;
}

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) {
    console.error("GH_TOKEN env var is required");
    process.exit(1);
  }

  console.log("Fetching repos...");
  const repos = await fetchAllRepos(token);
  console.log(`Found ${repos.length} non-fork repos`);

  console.log("Fetching languages...");
  const languages = await aggregateLanguages(token, repos);

  const fs = require("fs");
  const path = require("path");
  const statsDir = path.join(__dirname, "..", "stats");

  const lightSvg = buildSVG(languages, "light");
  const darkSvg = buildSVG(languages, "dark");

  fs.writeFileSync(path.join(statsDir, "languages-light.svg"), lightSvg);
  fs.writeFileSync(path.join(statsDir, "languages-dark.svg"), darkSvg);
  console.log("Written light and dark SVGs to stats/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
