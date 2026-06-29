import type { Intent, KeywordRaw } from "./types";

const BASE = "https://api.dataforseo.com/v3";

export interface DiscoverOpts {
  locationCode?: number;
  languageCode?: string;
  minVolume?: number;
  maxKd?: number;
  maxVolume?: number;
  limit?: number;
}

function authHeader(login: string, password: string): string {
  const token = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${token}`;
}

// Running tally of real DataForSEO spend (each response carries an exact `cost`).
// Routes call drainDataForSeoCost() after an action to read + reset it for logging.
let _dfsCost = 0;
export function drainDataForSeoCost(): number {
  const c = _dfsCost;
  _dfsCost = 0;
  return c;
}

async function post(
  endpoint: string,
  payload: unknown,
  auth: string
): Promise<any> {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  _dfsCost += Number(data?.cost) || 0;
  return data;
}

function firstResult(data: any): any[] {
  return data?.tasks?.[0]?.result ?? [];
}

function normIntent(raw: string | undefined): Intent {
  const v = (raw || "").toLowerCase();
  if (v === "commercial") return "commercial";
  if (v === "transactional") return "transactional";
  if (v === "navigational") return "navigational";
  return "informational";
}

/**
 * Seed -> candidate keywords with search volume (DataForSEO Labs
 * keyword_suggestions — phrase-match on the FULL seed, so results stay on-topic.
 * Includes the seed's own keyword data when available.
 */
async function fetchSuggestions(
  seed: string,
  opts: Required<DiscoverOpts>,
  auth: string
): Promise<Map<string, number>> {
  const data = await post(
    "/dataforseo_labs/google/keyword_suggestions/live",
    [
      {
        keyword: seed,
        location_code: opts.locationCode,
        language_code: opts.languageCode,
        limit: opts.limit,
        include_serp_info: false,
      },
    ],
    auth
  );
  const out = new Map<string, number>();
  for (const result of firstResult(data)) {
    // Seed's own data
    const seedData = result?.seed_keyword_data;
    if (seedData?.keyword) {
      out.set(seedData.keyword, seedData?.keyword_info?.search_volume ?? 0);
    }
    const items: any[] = result?.items ?? [];
    for (const it of items) {
      const kw = it?.keyword;
      if (!kw) continue;
      const vol = it?.keyword_info?.search_volume ?? it?.search_volume ?? 0;
      out.set(kw, vol || 0);
    }
  }
  return out;
}

/** keywords -> KD (DataForSEO Labs bulk_keyword_difficulty). */
async function fetchDifficulty(
  keywords: string[],
  opts: Required<DiscoverOpts>,
  auth: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (keywords.length === 0) return out;
  const data = await post(
    "/dataforseo_labs/google/bulk_keyword_difficulty/live",
    [
      {
        keywords,
        location_code: opts.locationCode,
        language_code: opts.languageCode,
      },
    ],
    auth
  );
  for (const item of firstResult(data)) {
    const items: any[] = item?.items ?? [item];
    for (const it of items) {
      if (!it?.keyword) continue;
      out.set(it.keyword, it?.keyword_difficulty ?? 0);
    }
  }
  return out;
}

/** keywords -> intent (DataForSEO Labs search_intent). */
async function fetchIntent(
  keywords: string[],
  opts: Required<DiscoverOpts>,
  auth: string
): Promise<Map<string, Intent>> {
  const out = new Map<string, Intent>();
  if (keywords.length === 0) return out;
  const data = await post(
    "/dataforseo_labs/google/search_intent/live",
    [
      {
        keywords,
        language_code: opts.languageCode,
      },
    ],
    auth
  );
  for (const item of firstResult(data)) {
    const items: any[] = item?.items ?? [item];
    for (const it of items) {
      if (!it?.keyword) continue;
      const label =
        it?.keyword_intent?.label ?? it?.intent ?? it?.main_intent?.label;
      out.set(it.keyword, normIntent(label));
    }
  }
  return out;
}

const DEFAULTS: Required<DiscoverOpts> = {
  locationCode: 2840,
  languageCode: "en",
  minVolume: 50,
  maxKd: 65,
  // Generic mega-head terms (national/branded) are almost never the right
  // target for a niche/SMB site; cap them out of competitor-gap results.
  maxVolume: 60000,
  limit: 200,
};

// Mega / social / news / gov domains that surface as "competitors" but are not
// real SEO rivals — excluded from competitor discovery.
const DOMAIN_DENYLIST = [
  "youtube.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "pinterest.com", "reddit.com", "tiktok.com", "wikipedia.org",
  "amazon.com", "ebay.com", "yelp.com", "quora.com", "medium.com",
  "nytimes.com", "cnn.com", "cbsnews.com", "nbcnews.com", "foxnews.com",
  "usatoday.com", "forbes.com", "businessinsider.com", "apnews.com",
];

function isJunkDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (d.endsWith(".gov") || d.endsWith(".edu") || d.includes(".gov")) return true;
  return DOMAIN_DENYLIST.some((bad) => d === bad || d.endsWith("." + bad));
}

function rootDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/** Top real competitor domains for a target (denylist + self filtered). */
async function findCompetitors(
  target: string,
  opts: Required<DiscoverOpts>,
  auth: string,
  max = 3
): Promise<string[]> {
  const data = await post(
    "/dataforseo_labs/google/competitors_domain/live",
    [
      {
        target,
        location_code: opts.locationCode,
        language_code: opts.languageCode,
        limit: 20,
      },
    ],
    auth
  );
  const out: string[] = [];
  for (const result of firstResult(data)) {
    for (const it of result?.items ?? []) {
      const dom = rootDomain(it?.domain ?? "");
      if (!dom || dom === target || isJunkDomain(dom)) continue;
      if (!out.includes(dom)) out.push(dom);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Keywords a domain ranks for, well (rank <= maxRank), with volume + KD. */
async function fetchRankedKeywords(
  target: string,
  opts: Required<DiscoverOpts>,
  auth: string,
  maxRank = 20,
  limit = 150
): Promise<Map<string, { volume: number; kd: number }>> {
  const data = await post(
    "/dataforseo_labs/google/ranked_keywords/live",
    [
      {
        target,
        location_code: opts.locationCode,
        language_code: opts.languageCode,
        limit,
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
      },
    ],
    auth
  );
  const out = new Map<string, { volume: number; kd: number }>();
  for (const result of firstResult(data)) {
    for (const it of result?.items ?? []) {
      const kd = it?.keyword_data;
      const kw = kd?.keyword;
      if (!kw) continue;
      const rank = it?.ranked_serp_element?.serp_item?.rank_absolute ?? 999;
      if (rank > maxRank) continue;
      out.set(kw, {
        volume: kd?.keyword_info?.search_volume ?? 0,
        kd: kd?.keyword_properties?.keyword_difficulty ?? 0,
      });
    }
  }
  return out;
}

export interface DomainDiscoverResult {
  keywords: KeywordRaw[];
  competitors: string[];
}

/**
 * Current SERP positions for a domain across the keywords it ranks for (top
 * 100). Used by the Grow view to track where the site stands for the keywords
 * we've pushed. Returns keyword -> { position (rank_absolute), url }.
 */
export async function fetchKeywordPositions(
  domainInput: string,
  optsIn: DiscoverOpts = {},
  env: { login?: string; password?: string } = {
    login: process.env.DATAFORSEO_LOGIN,
    password: process.env.DATAFORSEO_PASSWORD,
  }
): Promise<Map<string, { position: number; url: string }>> {
  if (!env.login || !env.password) {
    throw new Error("Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD");
  }
  const opts = { ...DEFAULTS, ...optsIn };
  const auth = authHeader(env.login, env.password);
  const target = rootDomain(domainInput);

  const data = await post(
    "/dataforseo_labs/google/ranked_keywords/live",
    [
      {
        target,
        location_code: opts.locationCode,
        language_code: opts.languageCode,
        limit: 1000,
        order_by: ["ranked_serp_element.serp_item.rank_absolute,asc"],
      },
    ],
    auth
  );
  const out = new Map<string, { position: number; url: string }>();
  for (const result of firstResult(data)) {
    for (const it of result?.items ?? []) {
      const kw = it?.keyword_data?.keyword;
      if (!kw) continue;
      const serp = it?.ranked_serp_element?.serp_item;
      const position = serp?.rank_absolute ?? 0;
      const url = serp?.relative_url ?? serp?.url ?? "";
      // Keep the best (lowest) position if the keyword appears more than once.
      const prev = out.get(kw);
      if (!prev || (position && position < prev.position)) {
        out.set(kw, { position, url });
      }
    }
  }
  return out;
}

/**
 * Competitor-gap discovery: given a domain, find its real competitors, pull the
 * keywords THEY rank well for, drop the ones the target already ranks for, and
 * return the gap (scored downstream). Answers "I don't know what to rank for".
 */
export async function discoverByDomain(
  domainInput: string,
  optsIn: DiscoverOpts = {},
  competitorsOverride: string[] = [],
  env: { login?: string; password?: string } = {
    login: process.env.DATAFORSEO_LOGIN,
    password: process.env.DATAFORSEO_PASSWORD,
  }
): Promise<DomainDiscoverResult> {
  if (!env.login || !env.password) {
    throw new Error("Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD");
  }
  const opts = { ...DEFAULTS, ...optsIn };
  const auth = authHeader(env.login, env.password);
  const target = rootDomain(domainInput);

  // Trust user-supplied competitors; otherwise auto-detect (best effort).
  const manual = competitorsOverride
    .map(rootDomain)
    .filter((d) => d && d !== target);
  const competitors =
    manual.length > 0 ? manual : await findCompetitors(target, opts, auth);
  if (competitors.length === 0) {
    return { keywords: [], competitors: [] };
  }

  // What competitors rank for, and what the target already ranks for.
  const [targetOwn, ...compMaps] = await Promise.all([
    fetchRankedKeywords(target, opts, auth, 30, 200),
    ...competitors.map((c) => fetchRankedKeywords(c, opts, auth)),
  ]);

  // Merge competitor keywords (keep max volume / min KD), exclude target's own,
  // and track how many competitors rank for each keyword (consensus signal).
  const merged = new Map<string, { volume: number; kd: number; count: number }>();
  for (const m of compMaps) {
    for (const [kw, v] of m) {
      if (targetOwn.has(kw)) continue; // gap only
      const prev = merged.get(kw);
      if (!prev) merged.set(kw, { ...v, count: 1 });
      else
        merged.set(kw, {
          volume: Math.max(prev.volume, v.volume),
          kd: Math.min(prev.kd, v.kd),
          count: prev.count + 1,
        });
    }
  }

  const passesMetrics = (v: { volume: number; kd: number }) =>
    v.volume >= opts.minVolume &&
    v.volume <= opts.maxVolume &&
    v.kd <= opts.maxKd;

  // Prefer keywords 2+ competitors rank for (real category terms, not one
  // site's incidental business). Relax to single-source if too few survive.
  let candidates = [...merged.entries()].filter(
    ([, v]) => v.count >= 2 && passesMetrics(v)
  );
  if (candidates.length < 20 && competitors.length >= 2) {
    candidates = [...merged.entries()].filter(([, v]) => passesMetrics(v));
  } else if (competitors.length < 2) {
    candidates = [...merged.entries()].filter(([, v]) => passesMetrics(v));
  }
  // Cap to a sane number for the intent call, highest-volume first.
  candidates.sort((a, b) => b[1].volume - a[1].volume);
  const top = candidates.slice(0, 200);
  const keywords = top.map(([kw]) => kw);

  const intent = await fetchIntent(keywords, opts, auth);

  const result: KeywordRaw[] = top.map(([kw, v]) => ({
    keyword: kw,
    search_volume: v.volume,
    keyword_difficulty: v.kd,
    intent: intent.get(kw) ?? "informational",
  }));

  return { keywords: result, competitors };
}

/**
 * Full discovery: ideas -> difficulty -> intent, merged into KeywordRaw[],
 * filtered by volume/KD thresholds. Requires DATAFORSEO_LOGIN/PASSWORD in env.
 */
export async function discoverKeywords(
  seed: string,
  optsIn: DiscoverOpts = {},
  env: { login?: string; password?: string } = {
    login: process.env.DATAFORSEO_LOGIN,
    password: process.env.DATAFORSEO_PASSWORD,
  }
): Promise<KeywordRaw[]> {
  if (!env.login || !env.password) {
    throw new Error("Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD");
  }
  const opts = { ...DEFAULTS, ...optsIn };
  const auth = authHeader(env.login, env.password);

  const suggestions = await fetchSuggestions(seed, opts, auth);
  const keywords = [...suggestions.keys()];

  const [kd, intent] = await Promise.all([
    fetchDifficulty(keywords, opts, auth),
    fetchIntent(keywords, opts, auth),
  ]);

  const merged: KeywordRaw[] = keywords.map((kw) => ({
    keyword: kw,
    search_volume: suggestions.get(kw) ?? 0,
    keyword_difficulty: kd.get(kw) ?? 0,
    intent: intent.get(kw) ?? "informational",
  }));

  return merged.filter(
    (k) =>
      k.search_volume >= opts.minVolume && k.keyword_difficulty <= opts.maxKd
  );
}
