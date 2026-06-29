import { NextResponse } from "next/server";
import { buildManualPrompt } from "@/lib/llm";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = (searchParams.get("keyword") || "").trim();
  const cluster = (searchParams.get("cluster") || "").trim();
  if (!keyword) {
    return NextResponse.json({ error: "Missing keyword" }, { status: 400 });
  }
  return NextResponse.json({ prompt: buildManualPrompt(keyword, cluster) });
}
