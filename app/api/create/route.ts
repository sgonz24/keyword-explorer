import { NextResponse } from "next/server";
import { generateArticle, generateFeaturedImage, drainLlmCost } from "@/lib/llm";
import { logCost } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword: string = (body?.keyword ?? "").trim();
    const cluster: string = (body?.cluster ?? "").trim();
    const withImage: boolean = body?.image !== false; // default on
    if (!keyword) {
      return NextResponse.json({ error: "Missing keyword" }, { status: 400 });
    }
    const article = await generateArticle(keyword, cluster);
    if (withImage) {
      try {
        const img = await generateFeaturedImage(article.title, keyword);
        article.imageUrl = img.imageUrl;
        article.imageAlt = img.imageAlt;
      } catch (imgErr) {
        // Article still returns even if image gen fails; surface a soft note.
        article.imageAlt = "";
      }
    }
    await logCost(
      "openai",
      withImage ? "create-article+image" : "create-article",
      1,
      drainLlmCost()
    );
    return NextResponse.json(article);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Generation failed" },
      { status: 500 }
    );
  }
}
