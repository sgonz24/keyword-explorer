import { google } from "googleapis";
import type { ScoredKeyword } from "./types";

const TAB = "content_calendar";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// content_calendar column order:
// keyword | cluster | stage | search_volume | keyword_difficulty |
// opportunity | status | scheduled_date | published_date | post_url | title
export function toRow(k: ScoredKeyword, clusterName: string): (string | number)[] {
  return [
    k.keyword,
    clusterName,
    k.stage,
    k.search_volume,
    k.keyword_difficulty,
    k.opportunity,
    "pending",
    "", // scheduled_date — set when queued
    "", // published_date
    "", // post_url
    "", // title
  ];
}

export interface PushItem {
  keyword: ScoredKeyword;
  clusterName: string;
}

function serviceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT");
  const json = JSON.parse(raw);
  return {
    client_email: json.client_email,
    private_key: (json.private_key as string).replace(/\\n/g, "\n"),
  };
}

function sheetsClient() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID");
  const sa = serviceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: SCOPES,
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId };
}

export async function pushToCalendar(items: PushItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const { sheets, sheetId } = sheetsClient();

  const values = items.map((it) => toRow(it.keyword, it.clusterName));

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${TAB}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return values.length;
}

export interface CalendarKeyword {
  keyword: string;
  cluster: string;
  stage: string;
  searchVolume: number;
  keywordDifficulty: number;
  opportunity: number;
  scheduledDate: string; // YYYY-MM-DD, or "" if unscheduled
}

/**
 * Read the unpublished queue from content_calendar. Rows already marked
 * "published" are skipped so the queue self-cleans once an article goes live.
 * Returns rows in publish order: by scheduled_date ascending (unscheduled rows
 * sort to the bottom), so the dashboard can be worked top-to-bottom.
 * Columns: keyword A | cluster B | stage C | volume D | KD E | opp F |
 *          status G | scheduled_date H
 */
export async function readCalendarKeywords(): Promise<CalendarKeyword[]> {
  const { sheets, sheetId } = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB}!A2:H`,
  });
  const rows = res.data.values ?? [];
  const out: CalendarKeyword[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const keyword = String(r?.[0] ?? "").trim();
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    const status = String(r?.[6] ?? "").trim().toLowerCase();
    if (status === "published") continue; // already live — drop from queue
    seen.add(keyword.toLowerCase());
    out.push({
      keyword,
      cluster: String(r?.[1] ?? "").trim(),
      stage: String(r?.[2] ?? "").trim(),
      searchVolume: Number(r?.[3] ?? 0) || 0,
      keywordDifficulty: Number(r?.[4] ?? 0) || 0,
      opportunity: Number(r?.[5] ?? 0) || 0,
      scheduledDate: String(r?.[7] ?? "").trim(),
    });
  }
  // Publish order: scheduled rows first (earliest date wins), unscheduled last.
  out.sort((a, b) => {
    if (a.scheduledDate && b.scheduledDate)
      return a.scheduledDate.localeCompare(b.scheduledDate);
    if (a.scheduledDate) return -1;
    if (b.scheduledDate) return 1;
    return 0;
  });
  return out;
}

/**
 * Read the PUBLISHED keywords from content_calendar (status col G === "published").
 * This is what Grow tracks — articles that are actually live and can rank.
 */
export async function readPublishedKeywords(): Promise<CalendarKeyword[]> {
  const { sheets, sheetId } = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB}!A2:H`,
  });
  const rows = res.data.values ?? [];
  const out: CalendarKeyword[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const keyword = String(r?.[0] ?? "").trim();
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    const status = String(r?.[6] ?? "").trim().toLowerCase();
    if (status !== "published") continue; // only live articles
    seen.add(keyword.toLowerCase());
    out.push({
      keyword,
      cluster: String(r?.[1] ?? "").trim(),
      stage: String(r?.[2] ?? "").trim(),
      searchVolume: Number(r?.[3] ?? 0) || 0,
      keywordDifficulty: Number(r?.[4] ?? 0) || 0,
      opportunity: Number(r?.[5] ?? 0) || 0,
      scheduledDate: String(r?.[7] ?? "").trim(),
    });
  }
  return out;
}

// Update a content_calendar row in place once its article is published.
// Finds the row by keyword (col A) and writes status (G), published_date (I),
// post_url (J), and title (K). Best-effort — never throws into the caller.
export async function markPublished(
  keyword: string,
  opts: { status: string; postUrl?: string; publishedDate?: string; title?: string }
): Promise<void> {
  try {
    const { sheets, sheetId } = sheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TAB}!A2:A`,
    });
    const rows = res.data.values ?? [];
    const target = keyword.trim().toLowerCase();
    let rowIndex = -1; // 0-based within A2:A
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i]?.[0] ?? "").trim().toLowerCase() === target) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex === -1) return; // keyword not in the queue — nothing to update
    const sheetRow = rowIndex + 2; // account for header + 1-based rows

    // G = status, I = published_date, J = post_url, K = title
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TAB}!G${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[opts.status]] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TAB}!I${sheetRow}:K${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[opts.publishedDate ?? "", opts.postUrl ?? "", opts.title ?? ""]],
      },
    });
  } catch {
    /* never break a successful publish over a write-back failure */
  }
}

export interface QueueStats {
  count: number;
  searchVolume: number;
}

/** Aggregate the content_calendar queue: # of keywords + total search volume (col D). */
export async function readQueueStats(): Promise<QueueStats> {
  const { sheets, sheetId } = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB}!A2:D`,
  });
  const rows = res.data.values ?? [];
  let count = 0;
  let searchVolume = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const keyword = String(r?.[0] ?? "").trim();
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    seen.add(keyword.toLowerCase());
    count += 1;
    searchVolume += Number(r?.[3] ?? 0) || 0;
  }
  return { count, searchVolume };
}

// ─── API cost tracking ───────────────────────────────────────────────────────
const COST_TAB = "cost_log";

async function ensureCostTab(
  sheets: ReturnType<typeof sheetsClient>["sheets"],
  sheetId: string
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === COST_TAB
  );
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: COST_TAB } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${COST_TAB}!A1:F1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["timestamp", "month", "provider", "action", "units", "cost_usd"]],
    },
  });
}

/** Append one API-spend row. Never throws into the caller — cost logging is best-effort. */
export async function logCost(
  provider: string,
  action: string,
  units: number,
  costUsd: number
): Promise<void> {
  if (!costUsd || costUsd <= 0) return;
  try {
    const { sheets, sheetId } = sheetsClient();
    await ensureCostTab(sheets, sheetId);
    const now = new Date();
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${COST_TAB}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[now.toISOString(), month, provider, action, units, Number(costUsd.toFixed(4))]],
      },
    });
  } catch {
    /* never break the main action over a logging failure */
  }
}

export interface MonthlyCost {
  month: string;
  dataforseo: number;
  openai: number;
  total: number;
  actions: number;
}

/** Aggregate cost_log into per-month totals split by provider (most recent first). */
export async function readMonthlyCosts(): Promise<MonthlyCost[]> {
  const { sheets, sheetId } = sheetsClient();
  await ensureCostTab(sheets, sheetId);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${COST_TAB}!A2:F`,
  });
  const rows = res.data.values ?? [];
  const map = new Map<string, MonthlyCost>();
  for (const r of rows) {
    const month = String(r?.[1] ?? "").trim();
    const provider = String(r?.[2] ?? "").trim().toLowerCase();
    const cost = Number(r?.[5] ?? 0) || 0;
    if (!month) continue;
    const m =
      map.get(month) ??
      { month, dataforseo: 0, openai: 0, total: 0, actions: 0 };
    if (provider.includes("dataforseo")) m.dataforseo += cost;
    else m.openai += cost;
    m.total += cost;
    m.actions += 1;
    map.set(month, m);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

const HISTORY_TAB = "rank_history";

async function ensureHistoryTab(
  sheets: ReturnType<typeof sheetsClient>["sheets"],
  sheetId: string
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === HISTORY_TAB
  );
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: HISTORY_TAB } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${HISTORY_TAB}!A1:D1`,
    valueInputOption: "RAW",
    requestBody: { values: [["date", "keyword", "position", "url"]] },
  });
}

/** Latest recorded position per keyword from rank_history (most recent date wins). */
export async function readLatestPositions(): Promise<
  Map<string, { date: string; position: number }>
> {
  const { sheets, sheetId } = sheetsClient();
  await ensureHistoryTab(sheets, sheetId);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${HISTORY_TAB}!A2:D`,
  });
  const rows = res.data.values ?? [];
  const out = new Map<string, { date: string; position: number }>();
  for (const r of rows) {
    const date = String(r?.[0] ?? "");
    const keyword = String(r?.[1] ?? "").toLowerCase();
    const position = Number(r?.[2] ?? 0);
    if (!keyword || !date) continue;
    const prev = out.get(keyword);
    if (!prev || date > prev.date) out.set(keyword, { date, position });
  }
  return out;
}

/** Append a dated snapshot of keyword -> position to rank_history. */
export async function appendRankSnapshot(
  date: string,
  rows: { keyword: string; position: number; url: string }[]
): Promise<void> {
  if (rows.length === 0) return;
  const { sheets, sheetId } = sheetsClient();
  await ensureHistoryTab(sheets, sheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${HISTORY_TAB}!A:D`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((r) => [date, r.keyword, r.position, r.url]),
    },
  });
}
