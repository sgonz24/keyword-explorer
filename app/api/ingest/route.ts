import { NextResponse } from "next/server";
import { parseManualArticle, generateFeaturedImage, drainLlmCost } from "@/lib/llm";
import { logCost } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw: string = body?.raw ?? "";
    const keyword: string = (body?.keyword ?? "").trim();
    const cluster: string = (body?.cluster ?? "").trim();
    const withImage: boolean = body?.image !== false; // default on
    if (!raw.trim()) {
      return NextResponse.json({ error: "Paste the ChatGPT output first" }, { status: 400 });
    }
    if (!keyword) {
      return NextResponse.json({ error: "Missing keyword" }, { status: 400 });
    }
    const article = parseManualArticle(raw, keyword, cluster);
    if (!article.html || article.html.length < 40) {
      return NextResponse.json(
        { error: "Could not read an article body from that paste" },
        { status: 422 }
      );
    }
    // The article body was written free (your ChatGPT subscription); generate
    // only the featured image via gpt-image-1 so it auto-uploads to Webflow.
    if (withImage) {
      try {
        const img = await generateFeaturedImage(article.title, keyword);
        article.imageUrl = img.imageUrl;
        article.imageAlt = img.imageAlt;
      } catch {
        article.imageAlt = "";
      }
      await logCost("openai", "manual-image", 1, drainLlmCost());
    }
    return NextResponse.json(article);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Ingest failed" },
      { status: 500 }
    );
  }
}
