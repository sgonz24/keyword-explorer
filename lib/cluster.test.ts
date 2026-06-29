import { describe, it, expect } from "vitest";
import { clusterKeywords, groupByStage } from "./cluster";
import { scoreKeywords } from "./scoring";
import type { KeywordRaw } from "./types";

const raw: KeywordRaw[] = [
  { keyword: "wildfire insurance california", search_volume: 1900, keyword_difficulty: 40, intent: "commercial" },
  { keyword: "wildfire insurance cost", search_volume: 700, keyword_difficulty: 35, intent: "commercial" },
  { keyword: "defensible space requirements", search_volume: 500, keyword_difficulty: 22, intent: "informational" },
  { keyword: "defensible space 100 ft", search_volume: 320, keyword_difficulty: 18, intent: "informational" },
];

describe("clusterKeywords", () => {
  it("groups by shared head term and flags the top-volume pillar", () => {
    const scored = scoreKeywords(raw);
    const clusters = clusterKeywords(scored, "wildfire");

    const names = clusters.map((c) => c.name.toLowerCase());
    expect(names.some((n) => n.includes("insurance"))).toBe(true);
    expect(names.some((n) => n.includes("defensible") || n.includes("space"))).toBe(true);

    const insurance = clusters.find((c) => c.name.toLowerCase().includes("insurance"))!;
    expect(insurance.keywords.length).toBe(2);

    const pillar = scored.find((k) => k.isPillar)!;
    expect(pillar.keyword).toBe("wildfire insurance california");
  });

  it("sorts clusters by opportunity desc and computes avg opportunity", () => {
    const scored = scoreKeywords(raw);
    const clusters = clusterKeywords(scored, "wildfire");
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i - 1].opportunity).toBeGreaterThanOrEqual(clusters[i].opportunity);
    }
    const c = clusters[0];
    const expectedAvg = Math.round(
      c.keywords.reduce((n, k) => n + k.opportunity, 0) / c.keywords.length
    );
    expect(c.opportunity).toBe(expectedAvg);
  });

  it("groupByStage buckets clusters into the three stages", () => {
    const scored = scoreKeywords(raw);
    const clusters = clusterKeywords(scored, "wildfire");
    const stages = groupByStage(clusters);
    const total =
      stages.Awareness.length + stages.Consideration.length + stages.Decision.length;
    expect(total).toBe(clusters.length);
  });
});
