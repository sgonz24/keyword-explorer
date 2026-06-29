import { NextResponse } from "next/server";
import { readMonthlyCosts } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const months = await readMonthlyCosts();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const current =
      months.find((m) => m.month === thisMonth) ?? {
        month: thisMonth,
        dataforseo: 0,
        openai: 0,
        total: 0,
        actions: 0,
      };
    return NextResponse.json({ current, months });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Cost read failed" },
      { status: 500 }
    );
  }
}
