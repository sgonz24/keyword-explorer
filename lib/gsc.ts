import { google } from "googleapis";

// Real Google performance data per query: clicks, impressions, CTR, and Google's
// own average position. Free, and more accurate than SERP scraping. Requires the
// service account (same one used for Sheets) to be added as a user on the GSC
// property for your site domain (SITE_DOMAIN).

const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];

export interface GscMetrics {
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number; // Google's average position (1 = top)
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

function searchConsole() {
  const sa = serviceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: SCOPES,
  });
  return google.searchconsole({ version: "v1", auth });
}

// GSC properties come in two flavors; we try the domain property first, then the
// URL-prefix property, so either kind of verification works.
function candidateProperties(domain: string): string[] {
  const bare = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const host = bare.replace(/^www\./, "");
  return [
    process.env.GSC_PROPERTY, // explicit override wins
    `sc-domain:${host}`,
    `https://www.${host}/`,
    `https://${host}/`,
  ].filter(Boolean) as string[];
}

/**
 * Last-28-day query performance keyed by lowercased query string. Returns an
 * empty map (never throws) if GSC isn't connected yet, so Grow still renders
 * with DataForSEO data alone.
 */
export async function fetchGscMetrics(
  domain: string
): Promise<Map<string, GscMetrics>> {
  const out = new Map<string, GscMetrics>();
  try {
    const sc = searchConsole();
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 28);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    for (const siteUrl of candidateProperties(domain)) {
      try {
        const res = await sc.searchanalytics.query({
          siteUrl,
          requestBody: {
            startDate: fmt(start),
            endDate: fmt(end),
            dimensions: ["query"],
            rowLimit: 25000,
          },
        });
        const rows = res.data.rows ?? [];
        if (rows.length === 0) continue; // try the next property flavor
        for (const r of rows) {
          const q = String(r.keys?.[0] ?? "").toLowerCase();
          if (!q) continue;
          out.set(q, {
            clicks: r.clicks ?? 0,
            impressions: r.impressions ?? 0,
            ctr: r.ctr ?? 0,
            position: r.position ?? 0,
          });
        }
        return out; // first property that returns data wins
      } catch {
        /* property not accessible — try the next candidate */
      }
    }
  } catch {
    /* GSC not wired up yet — fall back to DataForSEO only */
  }
  return out;
}
