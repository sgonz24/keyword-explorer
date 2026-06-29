import { NextResponse } from "next/server";
import { generateFeaturedImage, drainLlmCost } from "@/lib/llm";
import { replaceItemImage, slugify } from "@/lib/webflow";
import { logCost } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 300;

// Re-roll ONLY the featured image on an existing Webflow draft. Keeps the
// article body, slug, and schema untouched — generates a fresh image with the
// new varied art-direction prompt and patches it onto the item.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const itemId: string = (body?.itemId ?? "").trim();
    const keyword: string = (body?.keyword ?? "").trim();
    const title: string = (body?.title ?? keyword).trim();
    const concept: string = (body?.concept ?? "").trim();
    const quality: "medium" | "high" =
      body?.quality === "high" ? "high" : "medium";
    if (!itemId || !keyword) {
      return NextResponse.json(
        { error: "Missing itemId or keyword" },
        { status: 400 }
      );
    }

    const img = await generateFeaturedImage(
      title,
      keyword,
      concept || undefined,
      quality
    );
    await logCost("openai", "reimage", 1, drainLlmCost());

    const result = await replaceItemImage(
      itemId,
      img.imageUrl,
      `${slugify(title || keyword)}.png`
    );
    if (!result) {
      return NextResponse.json(
        { error: "Image generated but upload to Webflow failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ itemId, imageUrl: result.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Re-image failed" },
      { status: 500 }
    );
  }
}
