import { NextResponse } from "next/server";
import { pushToCalendar, type PushItem } from "@/lib/sheets";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items: PushItem[] = body?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No keywords selected" }, { status: 400 });
    }
    const added = await pushToCalendar(items);
    return NextResponse.json({ added });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Push failed" },
      { status: 500 }
    );
  }
}
