import { NextResponse } from "next/server";
import { fetchPosts } from "@/lib/webflow";
import { readQueueStats } from "@/lib/sheets";
import { CLUSTER_MATCHERS, SITE_URL } from "@/lib/config";
import { DEMO_MODE, demoDashboard } from "@/lib/demo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  if (DEMO_MODE) {
    return NextResponse.json(demoDashboard());
  }
  try {
    const [posts, queue] = await Promise.all([
      fetchPosts().catch(() => []),
      readQueueStats().catch(() => ({ count: 0, searchVolume: 0 })),
    ]);

    const coverage = CLUSTER_MATCHERS.map((m) => {
      const covered = posts.filter((p) => {
        const t = (p.name || "").toLowerCase();
        return m.needles.some((n) => t.includes(n));
      }).length;
      return { name: m.name, covered };
    }).filter((c) => c.covered > 0);

    const recent = [...posts]
      .sort((a, b) => (b.postDate || "").localeCompare(a.postDate || ""))
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        url: p.slug ? `${SITE_URL}/posts/${p.slug}` : "",
      }));

    const stats = {
      articlesLive: posts.length,
      clusters: coverage.length,
      questionsReady: queue.count,
      searchPotential: queue.searchVolume,
    };

    return NextResponse.json({ stats, coverage, recent });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Dashboard fetch failed" },
      { status: 500 }
    );
  }
}
