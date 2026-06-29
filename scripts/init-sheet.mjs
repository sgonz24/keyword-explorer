import { google } from "googleapis";
import { readFileSync } from "fs";

// Usage: node scripts/init-sheet.mjs <SHEET_ID>
// Creates the content_calendar + rank_history tabs (with headers) the app reads.
const sheetId = process.argv[2];
if (!sheetId) {
  console.error("Pass the sheet ID: node scripts/init-sheet.mjs <SHEET_ID>");
  process.exit(1);
}

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env.split("\n").find((l) => l.startsWith("GOOGLE_SERVICE_ACCOUNT="));
const sa = JSON.parse(line.slice("GOOGLE_SERVICE_ACCOUNT=".length));
const key = sa.private_key.replace(/\\n/g, "\n");

const auth = new google.auth.JWT({
  email: sa.client_email,
  key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// Make sure both tabs exist
const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title);
const requests = [];
for (const t of ["content_calendar", "rank_history"]) {
  if (!titles.includes(t)) {
    requests.push({ addSheet: { properties: { title: t } } });
  }
}
if (requests.length) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests },
  });
}

await sheets.spreadsheets.values.update({
  spreadsheetId: sheetId,
  range: "content_calendar!A1:K1",
  valueInputOption: "RAW",
  requestBody: {
    values: [
      [
        "keyword",
        "cluster",
        "stage",
        "search_volume",
        "keyword_difficulty",
        "opportunity",
        "status",
        "scheduled_date",
        "published_date",
        "post_url",
        "title",
      ],
    ],
  },
});

await sheets.spreadsheets.values.update({
  spreadsheetId: sheetId,
  range: "rank_history!A1:D1",
  valueInputOption: "RAW",
  requestBody: { values: [["date", "keyword", "position", "url"]] },
});

console.log("Initialized content_calendar + rank_history on " + sheetId);
