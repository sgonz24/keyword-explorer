import { describe, it, expect } from "vitest";
import {
  stageFromIntent,
  scoreKeywords,
  opportunityFromNorm,
} from "./scoring";
import type { KeywordRaw } from "./types";

describe("stageFromIntent", () => {
  it("maps intents to journey stages", () => {
    expect(stageFromIntent("informational")).toBe("Awareness");
    expect(stageFromIntent("commercial")).toBe("Consideration");
    expect(stageFromIntent("transactional")).toBe("Decision");
    expect(stageFromIntent("navigational")).toBe("Decision");
    expect(stageFromIntent("nonsense")).toBe("Awareness");
  });
});

describe("opportunityFromNorm", () => {
  it("returns 0-100 and rewards low difficulty", () => {
    const easy = opportunityFromNorm(1, 20, "Decision");
    const hard = opportunityFromNorm(1, 90, "Decision");
    expect(easy).toBeGreaterThan(hard);
    expect(easy).toBeLessThanOrEqual(100);
    expect(hard).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreKeywords", () => {
  it("scores a high-volume low-KD commercial term above a low-volume high-KD info term", () => {
    const raw: KeywordRaw[] = [
      {
        keyword: "wildfire home defense systems",
        search_volume: 2400,
        keyword_difficulty: 32,
        intent: "commercial",
      },
      {
        keyword: "what is a wildfire",
        search_volume: 880,
        keyword_difficulty: 70,
        intent: "informational",
      },
    ];
    const scored = scoreKeywords(raw);
    const a = scored.find((k) => k.keyword.includes("defense"))!;
    const b = scored.find((k) => k.keyword.includes("what is"))!;
    expect(a.stage).toBe("Consideration");
    expect(b.stage).toBe("Awareness");
    expect(a.opportunity).toBeGreaterThan(b.opportunity);
    expect(a.isPillar).toBe(true);
    expect(b.isPillar).toBe(false);
  });

  it("handles empty input", () => {
    expect(scoreKeywords([])).toEqual([]);
  });
});
