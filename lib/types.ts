export type Intent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

export type JourneyStage = "Awareness" | "Consideration" | "Decision";

export interface KeywordRaw {
  keyword: string;
  search_volume: number;
  keyword_difficulty: number; // 0-100
  intent: Intent;
}

export interface ScoredKeyword extends KeywordRaw {
  stage: JourneyStage;
  opportunity: number; // 0-100
  isPillar: boolean;
}

export interface Cluster {
  name: string;
  stage: JourneyStage;
  opportunity: number; // avg of members, 0-100
  keywords: ScoredKeyword[];
}

export interface DiscoverResponse {
  seed: string;
  clusters: Cluster[];
  stages: Record<JourneyStage, Cluster[]>;
}

/** A keyword's current ranking position for the tracked domain. */
export interface KeywordPosition {
  position: number; // SERP rank_absolute; 0 = not ranking in top 100
  url: string; // ranking URL (relative or absolute), "" if none
}

/** One row in the Grow view: a tracked keyword + its rank and trend. */
export interface GrowRow {
  keyword: string;
  cluster: string;
  position: number; // 0 = not ranking (top 100)
  url: string;
  previousPosition: number | null; // null if no prior snapshot
  delta: number | null; // positive = improved (moved up), null if no prior
  // Google Search Console (real Google data, last 28 days). 0 when GSC has no
  // data for this query yet or GSC isn't connected.
  clicks: number;
  impressions: number;
  source: "gsc" | "serp" | "none"; // where `position` came from
}

export interface GrowResponse {
  domain: string;
  checkedAt: string; // ISO date of this snapshot
  gscConnected: boolean; // true once GSC returns any data
  rows: GrowRow[];
}
