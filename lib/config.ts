// Central, env-driven configuration so anyone can run this app for their own
// brand/site without editing source. Every value falls back to a generic
// default, so the app boots and the UI renders even with no env set.

/** Brand name shown in the sidebar/header and used in the LLM "voice". */
export const BRAND_NAME = process.env.BRAND_NAME ?? "Acme";

/**
 * The site this app writes/tracks content for. Used as the default domain for
 * Grow (rank tracking + GSC) and to build absolute post URLs in JSON-LD.
 * No protocol — just the bare host, e.g. "example.com".
 */
export const SITE_DOMAIN = (process.env.SITE_DOMAIN ?? "example.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

/** Canonical https origin (with www) for the site. */
export const SITE_URL = process.env.SITE_URL ?? `https://www.${SITE_DOMAIN}`;

/** Short label used as the blog/section name in breadcrumbs. */
export const BLOG_NAME = process.env.BLOG_NAME ?? `${BRAND_NAME} Blog`;

/**
 * Example seed topics surfaced as one-click chips on the Explore screen.
 * Generic by default; override with a comma-separated SUGGESTED_TOPICS env var
 * to tailor them to your niche.
 */
export const SUGGESTED_TOPICS: string[] = (
  process.env.SUGGESTED_TOPICS ??
  [
    "content marketing",
    "email automation",
    "seo basics",
    "landing page design",
    "marketing analytics",
    "social media strategy",
    "conversion optimization",
    "keyword research",
  ].join(",")
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

/**
 * Cluster matchers used by the dashboard to estimate topical coverage from
 * existing post titles. These are generic examples — override by editing this
 * list for your own content pillars. The clustering ENGINE (lib/cluster.ts)
 * derives clusters dynamically from the keywords themselves; these matchers
 * only label already-published posts on the dashboard.
 */
export const CLUSTER_MATCHERS: { name: string; needles: string[] }[] = [
  { name: "Getting Started", needles: ["getting started", "beginner", "guide", "how to", "basics", "what is"] },
  { name: "Comparisons", needles: ["vs", "versus", "compare", "comparison", "alternative", "best"] },
  { name: "Use Cases", needles: ["use case", "example", "for", "workflow", "template", "strategy"] },
  { name: "Pricing", needles: ["pricing", "cost", "price", "plan", "free"] },
];

/**
 * Brand-agnostic, helpful-expert writing voice for LLM article generation.
 * Interpolates BRAND_NAME so generated content reads as if written for your
 * brand. Edit freely to match your tone.
 */
export const BRAND_VOICE = `
You are writing for ${BRAND_NAME} — a brand that publishes clear, trustworthy,
genuinely useful content for the people it serves.

WHO YOU ARE WRITING FOR:
- Readers searching for clear, practical, accurate answers — not fluff or jargon
- They want to understand the topic and know what to do next

WRITING RULES:
- Helpful, credible, and expert-backed — confident without being salesy
- Plain language. Short paragraphs (2-3 sentences). Skimmable structure.
- Be specific and practical: concrete steps, real examples, what to expect
- Cite reputable, well-known sources by name where relevant, but do NOT invent
  statistics, studies, or quotes
- Do not over-promise outcomes or make guarantees you can't back up

FORMAT RULES:
- Output ONLY HTML tags: <h2>, <h3>, <p>, <strong>, <ul>, <li>, <ol>, <a>
- No markdown, no ## or **, no code fences or backticks
- Do NOT include the post title (added separately), no author box, no byline, no reading time
`;
