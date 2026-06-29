import { NextResponse } from "next/server";
import { publishArticle } from "@/lib/webflow";
import { markPublished } from "@/lib/sheets";
import type { GeneratedArticle } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const article: GeneratedArticle | undefined = body?.article;
    const live: boolean = body?.live === true;
    if (!article?.title || !article?.html) {
      return NextResponse.json(
        { error: "Missing article (title/html)" },
        { status: 400 }
      );
    }
    const result = await publishArticle(article, { live });

    // Close the loop: update the queue row so it self-tracks. Live posts get a
    // published_date + post_url; staged drafts just flip status to "draft".
    await markPublished(article.keyword, {
      status: live ? "published" : "draft",
      postUrl: live ? result.liveUrl : "",
      publishedDate: live ? new Date().toISOString().slice(0, 10) : "",
      title: article.title,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Publish failed" },
      { status: 500 }
    );
  }
}
