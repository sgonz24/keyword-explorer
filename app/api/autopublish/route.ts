import { NextResponse } from "next/server";
import { generateArticle, generateFeaturedImage, drainLlmCost } from "@/lib/llm";
import { publishArticle } from "@/lib/webflow";
import { logCost, markPublished } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 300;

// One-shot: keyword -> full article + featured image (Auto API) -> publish to
// Webflow -> write the result back to the content_calendar queue row. The whole
// keyword→live-post loop in a single request.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword: string = (body?.keyword ?? "").trim();
    const cluster: string = (body?.cluster ?? "").trim();
    const live: boolean = body?.live !== false; // default: publish live
    if (!keyword) {
      return NextResponse.json({ error: "Missing keyword" }, { status: 400 });
    }

    // 1. Generate the article (gpt-4o) + featured image (gpt-image-1).
    const article = await generateArticle(keyword, cluster);
    try {
      const img = await generateFeaturedImage(article.title, keyword);
      article.imageUrl = img.imageUrl;
      article.imageAlt = img.imageAlt;
    } catch {
      article.imageAlt = "";
    }
    await logCost("openai", "autopublish-article+image", 1, drainLlmCost());

    // 2. Publish to Webflow (live by default), schema + image baked in.
    const result = await publishArticle(article, { live });

    // 3. Close the loop on the queue row.
    await markPublished(keyword, {
      status: live ? "published" : "draft",
      postUrl: live ? result.liveUrl : "",
      publishedDate: live ? new Date().toISOString().slice(0, 10) : "",
      title: article.title,
    });

    return NextResponse.json({ ...result, title: article.title });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Auto-publish failed" },
      { status: 500 }
    );
  }
}
