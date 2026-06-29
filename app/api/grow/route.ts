import { NextResponse } from "next/server";
import { fetchKeywordPositions, drainDataForSeoCost } from "@/lib/dataforseo";
import { fetchGscMetrics } from "@/lib/gsc";
import {
  readPublishedKeywords,
  readLatestPositions,
  appendRankSnapshot,
  logCost,
} from "@/lib/sheets";
import type { GrowRow } from "@/lib/types";
import { SITE_DOMAIN } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_DOMAIN = process.env.GROW_DOMAIN ?? SITE_DOMAIN;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const domain: string = (body?.domain ?? DEFAULT_DOMAIN).trim();

    // Grow tracks PUBLISHED articles (live, can rank) — not the queue.
    const [published, positions, prior, gsc] = await Promise.all([
      readPublishedKeywords(),
      fetchKeywordPositions(domain),
      readLatestPositions(),
      fetchGscMetrics(domain),
    ]);

    await logCost("dataforseo", "grow-ranks", 1, drainDataForSeoCost());

    const checkedAt = new Date().toISOString().slice(0, 10);
    const gscConnected = gsc.size > 0;

    const rows: GrowRow[] = published.map((c) => {
      const g = gsc.get(c.keyword.toLowerCase());
      const cur = positions.get(c.keyword);
      const serpPosition = cur?.position ?? 0;
      // Prefer Google's own position when GSC has data; else fall back to SERP.
      const gscPosition = g && g.position > 0 ? Math.round(g.position) : 0;
      const position = gscPosition || serpPosition;
      const source: GrowRow["source"] = gscPosition
        ? "gsc"
        : serpPosition
          ? "serp"
          : "none";
      const url = cur?.url ?? "";
      const prev = prior.get(c.keyword.toLowerCase());
      const previousPosition = prev ? prev.position : null;
      const delta =
        previousPosition && previousPosition > 0 && position > 0
          ? previousPosition - position // positive = moved up the SERP
          : null;
      return {
        keyword: c.keyword,
        cluster: c.cluster,
        position,
        url,
        previousPosition,
        delta,
        clicks: g?.clicks ?? 0,
        impressions: g?.impressions ?? 0,
        source,
      };
    });

    // Record this run so the next check can show movement.
    await appendRankSnapshot(
      checkedAt,
      rows.map((r) => ({
        keyword: r.keyword.toLowerCase(),
        position: r.position,
        url: r.url,
      }))
    );

    // Ranking keywords first (best position), then the not-yet-ranking ones.
    rows.sort((a, b) => {
      const ap = a.position || 9999;
      const bp = b.position || 9999;
      return ap - bp;
    });

    return NextResponse.json({ domain, checkedAt, gscConnected, rows });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Grow check failed" },
      { status: 500 }
    );
  }
}
