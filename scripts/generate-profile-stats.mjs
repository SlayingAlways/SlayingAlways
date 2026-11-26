import { mkdir, writeFile } from "node:fs/promises";

const login = process.env.PROFILE_LOGIN || "SlayingAlways";
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required.");

const to = new Date();
const from = new Date(to);
from.setUTCFullYear(from.getUTCFullYear() - 1);

const query = `
query ProfileStats($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount }
        }
      }
    }
  }
}`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "SlayingAlways-profile-stats"
  },
  body: JSON.stringify({
    query,
    variables: { login, from: from.toISOString(), to: to.toISOString() }
  })
});
if (!response.ok) throw new Error(`GitHub GraphQL failed: ${response.status} ${await response.text()}`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(payload.errors.map(e => e.message).join("; "));
const user = payload.data?.user;
if (!user) throw new Error(`GitHub user not found: ${login}`);

const esc = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const out = "assets";
await mkdir(out, { recursive: true });

const repos = user.repositories.nodes || [];
const stars = repos.reduce((sum, repo) => sum + repo.stargazerCount, 0);
const calendar = user.contributionsCollection.contributionCalendar;
const commits = calendar.totalContributions;
const metrics = [
  ["PUBLIC REPOSITORIES", user.repositories.totalCount],
  ["STARS EARNED", stars],
  ["FOLLOWERS", user.followers.totalCount],
  ["CONTRIBUTIONS / YEAR", commits]
];

const metricBlocks = metrics.map(([label, value], index) => {
  const x = 24 + index * 219;
  return `<g><text x="${x}" y="42" fill="#8b949e" font-size="11" letter-spacing="1">${esc(label)}</text><text x="${x}" y="82" fill="#f0f6fc" font-size="30" font-weight="700">${Number(value).toLocaleString("en-US")}</text></g>`;
}).join("");

const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="120" viewBox="0 0 900 120" role="img" aria-label="Live GitHub profile statistics">
<rect width="900" height="120" rx="8" fill="#0d1117" stroke="#30363d"/>
<g font-family="monospace">${metricBlocks}</g></svg>`;
await writeFile(`${out}/profile-stats.svg`, statsSvg);

const totals = new Map();
for (const repo of repos) {
  for (const edge of repo.languages.edges || []) {
    const old = totals.get(edge.node.name) || { bytes: 0, color: edge.node.color || "#8b949e" };
    old.bytes += edge.size;
    totals.set(edge.node.name, old);
  }
}
const sorted = [...totals.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 6);
const totalBytes = sorted.reduce((sum, [, data]) => sum + data.bytes, 0) || 1;
let cursor = 24;
const bar = sorted.map(([name, data]) => {
  const width = 852 * data.bytes / totalBytes;
  const rect = `<rect x="${cursor.toFixed(2)}" y="20" width="${Math.max(1, width).toFixed(2)}" height="12" fill="${esc(data.color)}"/>`;
  cursor += width;
  return rect;
}).join("");
const legend = sorted.map(([name, data], i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const x = 24 + col * 285, y = 62 + row * 24;
  const pct = (data.bytes / totalBytes * 100).toFixed(1);
  return `<circle cx="${x}" cy="${y - 4}" r="4" fill="${esc(data.color)}"/><text x="${x + 12}" y="${y}" fill="#c9d1d9" font-size="12">${esc(name)}</text><text x="${x + 250}" y="${y}" fill="#8b949e" font-size="12" text-anchor="end">${pct}%</text>`;
}).join("");
const langsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="120" viewBox="0 0 900 120" role="img" aria-label="Programming languages by bytes across public repositories">
<rect width="900" height="120" rx="8" fill="#0d1117" stroke="#30363d"/>${bar}<g font-family="monospace">${legend}</g></svg>`;
await writeFile(`${out}/profile-languages.svg`, langsSvg);

const days = calendar.weeks.flatMap(week => week.contributionDays);
const palette = ["#161b22", "#18344a", "#205777", "#2e83ad", "#58a6ff"];
const cell = 11, gap = 4, startX = 26, startY = 26;
const squares = days.map((day, i) => {
  const week = Math.floor(i / 7), weekday = i % 7;
  const level = day.contributionCount === 0 ? 0 : day.contributionCount < 3 ? 1 : day.contributionCount < 6 ? 2 : day.contributionCount < 10 ? 3 : 4;
  const x = startX + week * (cell + gap), y = startY + weekday * (cell + gap);
  return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${palette[level]}"><title>${esc(day.date)}: ${day.contributionCount} contributions</title></rect>`;
}).join("");
const months = [];
let lastMonth = "";
calendar.weeks.forEach((week, index) => {
  const first = week.contributionDays[0];
  if (!first) return;
  const month = first.date.slice(0, 7);
  if (month !== lastMonth) {
    months.push(`<text x="${startX + index * (cell + gap)}" y="15" fill="#8b949e" font-size="10">${new Date(first.date + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</text>`);
    lastMonth = month;
  }
});
const bannerPalette = ["#15191f", "#0e4429", "#006d32", "#26a641", "#39d353"];
const bannerDays = calendar.weeks.flatMap(week => week.contributionDays).slice(-371);
const bannerCell = 12, bannerGap = 4, bannerX = 18, bannerY = 34;
const bannerSquares = bannerDays.map((day, i) => {
  const col = Math.floor(i / 7), row = i % 7;
  const level = day.contributionCount === 0 ? 0 : day.contributionCount < 2 ? 1 : day.contributionCount < 5 ? 2 : day.contributionCount < 9 ? 3 : 4;
  const x = bannerX + col * (bannerCell + bannerGap), y = bannerY + row * (bannerCell + bannerGap);
  return `<rect x="${x}" y="${y}" width="${bannerCell}" height="${bannerCell}" rx="1" fill="${bannerPalette[level]}"><title>${esc(day.date)} · ${day.contributionCount} contributions</title></rect>`;
}).join("");
const activeWeeks = calendar.weeks.filter(week => week.contributionDays.some(day => day.contributionCount > 0)).length;
const lineWidth = Math.min(850, Math.max(40, Math.round(calendar.totalContributions * 3.5)));
const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="192" viewBox="0 0 880 192" role="img" aria-label="GitHub contributions pixel banner for the last year">
<rect width="880" height="192" fill="#000000"/>
<g>${bannerSquares}</g>
<rect x="0" y="176" width="${lineWidth}" height="2" fill="#004d2b"/>
<text x="868" y="188" fill="#30363d" font-family="monospace" font-size="9" text-anchor="end">${calendar.totalContributions} CONTRIBUTIONS / YEAR</text>
</svg>`;
await writeFile(`${out}/profile-contributions.svg`, bannerSvg);

console.log(`Updated profile cards for @${login}: ${repos.length} public repositories, ${commits} contributions in the selected year.`);
