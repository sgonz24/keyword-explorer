// Demo / sample data so the app renders a populated, convincing UI with zero
// credentials. DEMO_MODE is ON by default and turns OFF automatically once a
// real data source (DataForSEO or Webflow) is configured, or when you set
// DEMO_MODE=false explicitly.

import type { Intent, KeywordRaw } from "./types";
import { BRAND_NAME, SITE_URL } from "./config";

const hasRealSource = Boolean(
  process.env.DATAFORSEO_LOGIN ||
    process.env.WEBFLOW_TOKEN ||
    process.env.GOOGLE_SERVICE_ACCOUNT
);

export const DEMO_MODE =
  (process.env.DEMO_MODE ?? (hasRealSource ? "false" : "true")) === "true";

/** Stable dashboard sample: headline stats, cluster coverage, recent posts. */
export function demoDashboard() {
  const coverage = [
    { name: "Getting Started", covered: 9 },
    { name: "Comparisons", covered: 6 },
    { name: "Use Cases", covered: 11 },
    { name: "Pricing", covered: 4 },
  ];
  const recentTitles = [
    "How to Build a Content Pipeline That Actually Ships",
    "Keyword Clustering by Buyer Journey: A Practical Guide",
    "Search Intent 101: Awareness vs. Consideration vs. Decision",
    "The 7-Step Content Calendar We Use Every Quarter",
    "Topic Clusters vs. Standalone Posts: When to Use Each",
  ];
  const recent = recentTitles.map((name) => ({
    name,
    url: `${SITE_URL}/posts/${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}`,
  }));
  const stats = {
    articlesLive: 34,
    clusters: coverage.length,
    questionsReady: 28,
    searchPotential: 41200,
  };
  return { stats, coverage, recent, brand: BRAND_NAME };
}

// Deterministic pseudo-random so the same seed always yields the same demo set.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const MODIFIERS: { suffix: string; intent: Intent }[] = [
  { suffix: "", intent: "informational" },
  { suffix: "guide", intent: "informational" },
  { suffix: "for beginners", intent: "informational" },
  { suffix: "examples", intent: "informational" },
  { suffix: "tips", intent: "informational" },
  { suffix: "checklist", intent: "informational" },
  { suffix: "best practices", intent: "commercial" },
  { suffix: "tools", intent: "commercial" },
  { suffix: "software", intent: "commercial" },
  { suffix: "best", intent: "commercial" },
  { suffix: "vs alternatives", intent: "commercial" },
  { suffix: "comparison", intent: "commercial" },
  { suffix: "pricing", intent: "transactional" },
  { suffix: "cost", intent: "transactional" },
  { suffix: "free trial", intent: "transactional" },
  { suffix: "template", intent: "transactional" },
  { suffix: "how to", intent: "informational" },
  { suffix: "what is", intent: "informational" },
  { suffix: "strategy", intent: "commercial" },
  { suffix: "for small business", intent: "commercial" },
];

const PREFIXES = ["how to", "what is", "best", "top"];

/** Generate realistic, on-topic sample keywords for a seed (no API needed). */
export function demoKeywords(seed: string): KeywordRaw[] {
  const base = seed.trim().toLowerCase() || "content marketing";
  const out: KeywordRaw[] = [];
  const seen = new Set<string>();

  const push = (keyword: string, intent: Intent, salt: number) => {
    const k = keyword.replace(/\s+/g, " ").trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    const r = hash(k + salt);
    const search_volume = 50 + (r % 9800); // 50 - ~9850
    const keyword_difficulty = 8 + ((r >> 5) % 70); // 8 - 78
    out.push({ keyword: k, search_volume, keyword_difficulty, intent });
  };

  // the head term
  push(base, "informational", 1);

  MODIFIERS.forEach((m, i) => {
    const kw = m.suffix ? `${base} ${m.suffix}` : base;
    push(kw, m.intent, i + 2);
  });
  PREFIXES.forEach((p, i) => {
    push(`${p} ${base}`, p === "best" || p === "top" ? "commercial" : "informational", i + 40);
  });

  // sort by a blend so the list looks naturally ranked
  return out
    .sort(
      (a, b) =>
        b.search_volume - a.search_volume + (a.keyword_difficulty - b.keyword_difficulty)
    )
    .slice(0, 28);
}
