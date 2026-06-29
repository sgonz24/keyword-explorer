// Seed the content_calendar with an example 4-week (3/week) blog plan.
// Fetches LIVE volume + KD + intent from DataForSEO, computes opportunity with
// the same formula the app uses, and appends rows to the content_calendar tab.
// Edit the PLAN array below with your own keywords and clusters.
import fs from "node:fs";
import { google } from "googleapis";

// ── load .env.local ──────────────────────────────────────────────────────────
const env = {};
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const AUTH = "Basic " + Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");

// ── the 12-keyword example plan (week, cluster) ──────────────────────────────
// Replace these with the keywords you discovered in the app's Explore view.
const PLAN = [
  // Week 1 — getting started
  { keyword: "what is email automation", cluster: "Getting Started", week: 1 },
  { keyword: "email automation for beginners", cluster: "Getting Started", week: 1 },
  { keyword: "how to set up email automation", cluster: "Getting Started", week: 1 },
  // Week 2 — comparisons
  { keyword: "best email automation tools", cluster: "Comparisons", week: 2 },
  { keyword: "email automation vs newsletters", cluster: "Comparisons", week: 2 },
  { keyword: "email automation alternatives", cluster: "Comparisons", week: 2 },
  // Week 3 — use cases
  { keyword: "email automation workflows", cluster: "Use Cases", week: 3 },
  { keyword: "welcome email automation examples", cluster: "Use Cases", week: 3 },
  { keyword: "abandoned cart email automation", cluster: "Use Cases", week: 3 },
  // Week 4 — pricing + depth
  { keyword: "email automation pricing", cluster: "Pricing", week: 4 },
  { keyword: "free email automation tools", cluster: "Pricing", week: 4 },
  { keyword: "email automation best practices", cluster: "Use Cases", week: 4 },
];

const keywords = PLAN.map((p) => p.keyword);

async function dfs(path, body) {
  const res = await fetch(`https://api.dataforseo.com/v3${path}`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify([body]),
  });
  if (!res.ok) throw new Error(`DFS ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// volume + intent via keyword_overview; KD via bulk_keyword_difficulty
async function fetchMetrics() {
  const loc = { keywords, location_name: "United States", language_code: "en" };
  const [ov, kdRes] = await Promise.all([
    dfs("/dataforseo_labs/google/keyword_overview/live", loc),
    dfs("/dataforseo_labs/google/bulk_keyword_difficulty/live", loc),
  ]);
  const vol = new Map(), intent = new Map(), kd = new Map();
  for (const it of ov?.tasks?.[0]?.result?.[0]?.items ?? []) {
    vol.set(it.keyword, it?.keyword_info?.search_volume ?? 0);
    intent.set(it.keyword, it?.search_intent_info?.main_intent ?? "informational");
  }
  for (const it of kdRes?.tasks?.[0]?.result?.[0]?.items ?? []) {
    kd.set(it.keyword, it?.keyword_difficulty ?? 0);
  }
  const cost = (ov?.cost ?? 0) + (kdRes?.cost ?? 0);
  return { vol, intent, kd, cost };
}

// ── scoring (mirrors lib/scoring.ts) ─────────────────────────────────────────
const BOOST = { Awareness: 0.8, Consideration: 0.9, Decision: 1.0 };
function stageFromIntent(i) {
  if (i === "commercial") return "Consideration";
  if (i === "transactional" || i === "navigational") return "Decision";
  return "Awareness";
}
function normalizeVolume(v) {
  const lv = Math.log10(1 + Math.max(0, v));
  const lref = Math.log10(1 + 10000);
  return Math.min(1, Math.max(0.05, lv / lref));
}
function opportunity(v, kd, stage) {
  const k = Math.min(100, Math.max(0, kd));
  return Math.round(Math.min(100, Math.max(0, 100 * normalizeVolume(v) * (1 - k / 100) * BOOST[stage])));
}

// ── sheets client ────────────────────────────────────────────────────────────
function sheetsClient() {
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId: env.GOOGLE_SHEET_ID };
}

(async () => {
  const { vol, intent, kd, cost } = await fetchMetrics();

  // schedule: 3/week starting next Monday, Mon/Wed/Fri
  const today = new Date();
  const day = today.getDay(); // 0 Sun .. 6 Sat
  const daysToMon = ((8 - day) % 7) || 7;
  const firstMon = new Date(today);
  firstMon.setDate(today.getDate() + daysToMon);
  const slotOffsets = [0, 2, 4]; // Mon, Wed, Fri

  const rows = PLAN.map((p, i) => {
    const v = vol.get(p.keyword) ?? 0;
    const k = kd.get(p.keyword) ?? 0;
    const stage = stageFromIntent(intent.get(p.keyword) ?? "informational");
    const opp = opportunity(v, k, stage);
    const slotInWeek = i % 3;
    const d = new Date(firstMon);
    d.setDate(firstMon.getDate() + (p.week - 1) * 7 + slotOffsets[slotInWeek]);
    const scheduled = d.toISOString().slice(0, 10);
    return [p.keyword, p.cluster, stage, v, k, opp, "pending", scheduled, "", "", ""];
  });

  const { sheets, sheetId } = sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "content_calendar!A:K",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  console.log(`Seeded ${rows.length} keywords. DataForSEO cost: $${cost.toFixed(4)}`);
  for (const r of rows) console.log(`  ${r[7]}  ${r[0]} [${r[1]}] vol=${r[3]} kd=${r[4]} opp=${r[5]} (${r[2]})`);
})().catch((e) => { console.error(e); process.exit(1); });
