import { NextResponse } from "next/server";
import {
  discoverKeywords,
  discoverByDomain,
  drainDataForSeoCost,
} from "@/lib/dataforseo";
import { scoreKeywords } from "@/lib/scoring";
import { clusterKeywords, groupByStage } from "@/lib/cluster";
import { logCost } from "@/lib/sheets";
import { DEMO_MODE, demoKeywords } from "@/lib/demo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode: string = body?.mode === "domain" ? "domain" : "seed";
    const minVolume = Number(body?.minVolume ?? 50);
    const maxKd = Number(body?.maxKd ?? 65);

    if (DEMO_MODE) {
      const query: string =
        mode === "domain"
          ? (body?.domain ?? "").trim() || "example.com"
          : (body?.seed ?? "").trim() || "content marketing";
      const seedForKw =
        mode === "domain" ? query.replace(/^https?:\/\//, "").split(".")[0] : query;
      const scored = scoreKeywords(demoKeywords(seedForKw));
      const clusters = clusterKeywords(scored, mode === "domain" ? "" : query);
      const stages = groupByStage(clusters);
      return NextResponse.json(
        mode === "domain"
          ? { mode, query, competitors: [], clusters, stages }
          : { mode, query, clusters, stages }
      );
    }

    if (mode === "domain") {
      const domain: string = (body?.domain ?? "").trim();
      if (!domain) {
        return NextResponse.json({ error: "Missing domain" }, { status: 400 });
      }
      const competitorsInput: string[] = Array.isArray(body?.competitors)
        ? body.competitors
        : typeof body?.competitors === "string"
          ? body.competitors.split(",")
          : [];
      const { keywords, competitors } = await discoverByDomain(
        domain,
        { minVolume, maxKd },
        competitorsInput.map((s) => s.trim()).filter(Boolean)
      );
      await logCost("dataforseo", "discover-domain", 1, drainDataForSeoCost());
      const scored = scoreKeywords(keywords);
      const clusters = clusterKeywords(scored, "");
      const stages = groupByStage(clusters);
      return NextResponse.json({
        mode,
        query: domain,
        competitors,
        clusters,
        stages,
      });
    }

    const seed: string = (body?.seed ?? "").trim();
    if (!seed) {
      return NextResponse.json({ error: "Missing seed" }, { status: 400 });
    }
    const raw = await discoverKeywords(seed, { minVolume, maxKd });
    await logCost("dataforseo", "discover-seed", 1, drainDataForSeoCost());
    const scored = scoreKeywords(raw);
    const clusters = clusterKeywords(scored, seed);
    const stages = groupByStage(clusters);
    return NextResponse.json({ mode, query: seed, clusters, stages });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Discovery failed" },
      { status: 500 }
    );
  }
}
