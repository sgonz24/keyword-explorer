import type { Cluster, JourneyStage, ScoredKeyword } from "./types";

const STOP = new Set([
  "the","a","an","and","or","for","to","of","in","on","with","how","what",
  "is","are","do","does","your","you","my","best","near","me","vs","2024",
  "2025","2026","cost","costs","price","prices",
]);

function tokens(kw: string): string[] {
  return kw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function dominantStage(kws: ScoredKeyword[]): JourneyStage {
  const counts: Record<string, number> = {};
  for (const k of kws) counts[k.stage] = (counts[k.stage] || 0) + 1;
  let best: JourneyStage = kws[0].stage;
  let bestN = -1;
  for (const k of kws) {
    if (counts[k.stage] > bestN) {
      bestN = counts[k.stage];
      best = k.stage;
    }
  }
  return best;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Group scored keywords into clusters by their most significant shared token.
 * Each keyword is assigned to the cluster of its highest-frequency
 * non-stopword token (ties broken by token length, then alphabetically).
 */
export function clusterKeywords(
  scored: ScoredKeyword[],
  seed: string
): Cluster[] {
  if (scored.length === 0) return [];

  const seedTokens = new Set(tokens(seed));

  // Document frequency of every token across the corpus.
  const df: Record<string, number> = {};
  const kwTokens = new Map<ScoredKeyword, string[]>();
  for (const k of scored) {
    const ts = tokens(k.keyword);
    kwTokens.set(k, ts);
    for (const t of new Set(ts)) df[t] = (df[t] || 0) + 1;
  }

  // Pick a cluster key per keyword: prefer a shared (df>=2) token that is NOT
  // a generic seed token; otherwise fall back to the first meaningful token.
  const groups = new Map<string, ScoredKeyword[]>();
  for (const k of scored) {
    const ts = kwTokens.get(k)!;
    const candidates = ts
      .filter((t) => df[t] >= 2 && !seedTokens.has(t))
      .sort((a, b) =>
        df[b] - df[a] || b.length - a.length || a.localeCompare(b)
      );
    const fallback = ts.filter((t) => !seedTokens.has(t)).sort(
      (a, b) => b.length - a.length || a.localeCompare(b)
    );
    const key = candidates[0] || fallback[0] || ts[0] || seed.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(k);
  }

  const clusters: Cluster[] = [];
  for (const [key, kws] of groups) {
    kws.sort((a, b) => b.opportunity - a.opportunity);
    clusters.push({
      name: titleCase(key),
      stage: dominantStage(kws),
      opportunity: avg(kws.map((k) => k.opportunity)),
      keywords: kws,
    });
  }

  clusters.sort((a, b) => b.opportunity - a.opportunity);
  return clusters;
}

export function groupByStage(
  clusters: Cluster[]
): Record<JourneyStage, Cluster[]> {
  const out: Record<JourneyStage, Cluster[]> = {
    Awareness: [],
    Consideration: [],
    Decision: [],
  };
  for (const c of clusters) out[c.stage].push(c);
  return out;
}
