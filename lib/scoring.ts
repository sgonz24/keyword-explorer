import type { Intent, JourneyStage, KeywordRaw, ScoredKeyword } from "./types";

export function stageFromIntent(intent: Intent | string): JourneyStage {
  switch (intent) {
    case "informational":
      return "Awareness";
    case "commercial":
      return "Consideration";
    case "transactional":
    case "navigational":
      return "Decision";
    default:
      return "Awareness";
  }
}

const INTENT_BOOST: Record<JourneyStage, number> = {
  Awareness: 0.8,
  Consideration: 0.9,
  Decision: 1.0,
};

/**
 * Opportunity score (0-100) for a single keyword given a pre-computed
 * normalized volume (0-1). Rewards high volume + low difficulty +
 * commercial/transactional intent.
 */
export function opportunityFromNorm(
  normVolume: number,
  keyword_difficulty: number,
  stage: JourneyStage
): number {
  const kd = Math.min(100, Math.max(0, keyword_difficulty));
  const score = 100 * normVolume * (1 - kd / 100) * INTENT_BOOST[stage];
  return Math.round(Math.min(100, Math.max(0, score)));
}

// Reference volume that maps to a full normalized score of 1.0.
// Absolute (not set-relative) so scores are stable and comparable across seeds,
// and the lowest-volume keyword in a set isn't unfairly zeroed.
const VOLUME_REFERENCE = 10000;

/**
 * Absolute log-normalize a volume to 0..1 against a fixed reference, with a
 * small floor so a low-volume but easy keyword still earns some opportunity.
 */
export function normalizeVolume(
  volume: number,
  reference: number = VOLUME_REFERENCE
): number {
  const lv = Math.log10(1 + Math.max(0, volume));
  const lref = Math.log10(1 + reference);
  const n = lref === 0 ? 0 : lv / lref;
  return Math.min(1, Math.max(0.05, n));
}

export function scoreKeywords(raw: KeywordRaw[]): ScoredKeyword[] {
  if (raw.length === 0) return [];
  const peakVol = Math.max(...raw.map((r) => r.search_volume || 0));

  return raw.map((r) => {
    const stage = stageFromIntent(r.intent);
    const norm = normalizeVolume(r.search_volume || 0);
    return {
      ...r,
      stage,
      opportunity: opportunityFromNorm(norm, r.keyword_difficulty, stage),
      isPillar: (r.search_volume || 0) === peakVol && peakVol > 0,
    };
  });
}
