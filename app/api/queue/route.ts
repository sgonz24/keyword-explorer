import { NextResponse } from "next/server";
import { readCalendarKeywords } from "@/lib/sheets";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await readCalendarKeywords();
    return NextResponse.json({ items });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load queue" },
      { status: 500 }
    );
  }
}
