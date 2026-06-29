// Provider-agnostic LLM client (OpenAI-compatible chat completions).
// Defaults to OpenAI; swap LLM_BASE_URL + LLM_API_KEY + LLM_MODEL to point at
// any other OpenAI-compatible endpoint (Moonshot/Kimi, Together, Groq, etc.).

import { BRAND_NAME, BRAND_VOICE, SITE_URL, BLOG_NAME } from "./config";

const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.LLM_MODEL ?? "gpt-4o";

// The brand-agnostic writing voice, sourced from config so it is fully
// configurable via the BRAND_NAME / BRAND_VOICE env vars.
export const BRAND_SYSTEM_PROMPT = BRAND_VOICE;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Running tally of real OpenAI spend for the current request. gpt-4o token rates
// ($2.50 / 1M input, $10 / 1M output) + a flat per-image cost for medium 1536x1024.
const GPT4O_INPUT_PER_TOKEN = 2.5 / 1_000_000;
const GPT4O_OUTPUT_PER_TOKEN = 10 / 1_000_000;
const IMAGE_COST_MEDIUM = 0.063; // gpt-image-1, 1536x1024, quality "medium"
const IMAGE_COST_HIGH = 0.19; // gpt-image-1, 1536x1024, quality "high"
let _llmCost = 0;
export function drainLlmCost(): number {
  const c = _llmCost;
  _llmCost = 0;
  return c;
}

async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; max_tokens?: number } = {}
): Promise<string> {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error("Missing LLM_API_KEY");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 6000,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const usage = data?.usage ?? {};
  _llmCost +=
    (Number(usage.prompt_tokens) || 0) * GPT4O_INPUT_PER_TOKEN +
    (Number(usage.completion_tokens) || 0) * GPT4O_OUTPUT_PER_TOKEN;
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

function clean(html: string): string {
  return html
    .replace(/```html/g, "")
    .replace(/```/g, "")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface GeneratedArticle {
  keyword: string;
  cluster: string;
  title: string;
  metaDescription: string;
  html: string;
  faq: { q: string; a: string }[];
  jsonLd: string;
  imageUrl?: string;
  imageAlt?: string;
}

// Featured-image generation via OpenAI's GPT image model (gpt-image-1).
// Always uses OpenAI directly (image endpoint is OpenAI-specific), reusing the
// same OpenAI key the Create stage already runs on.
const IMAGE_MODEL = process.env.IMAGE_MODEL ?? "gpt-image-1";

// Ask the model — which knows exactly what this article is about — to art-direct
// a scene that visually communicates the SPECIFIC meaning of the topic. This keeps
// the image relevant and on-topic while staying varied, since different topics
// yield different scenes.
async function imageConceptFor(title: string, keyword: string): Promise<string> {
  try {
    const concept = (
      await chat(
        [
          {
            role: "system",
            content:
              "You are a photo art director. You translate an article's core idea into ONE concrete, photographable scene that a reader instantly connects to the topic.",
          },
          {
            role: "user",
            content: `Article title: "${title}" (topic/keyword: "${keyword}").

Describe ONE concrete photographic scene that visually communicates what THIS topic actually means to the reader — not a generic stock image. Think about the real meaning of the topic and depict that idea directly.

Rules:
- One vivid sentence, concrete and photographable (specific subject, action, setting, light).
- It must clearly relate to "${keyword}".
- Avoid generic, clichéd compositions; choose a scene that is specific to this topic.
- Vary people vs. objects vs. environment as fits the meaning.
Return ONLY the scene sentence.`,
          },
        ],
        { temperature: 0.8, max_tokens: 120 }
      )
    )
      .replace(/^["']|["']$/g, "")
      .trim();
    return concept || `A relevant, clean editorial scene illustrating ${keyword}.`;
  } catch {
    return `A relevant, clean editorial scene illustrating ${keyword}.`;
  }
}

export async function generateFeaturedImage(
  title: string,
  keyword: string,
  concept?: string,
  quality: "medium" | "high" = "medium"
): Promise<{ imageUrl: string; imageAlt: string }> {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error("Missing LLM_API_KEY");

  const scene = concept?.trim() || (await imageConceptFor(title, keyword));
  const prompt = `Editorial featured image for an article titled "${title}" (topic: "${keyword}"). SCENE — depict exactly this: ${scene} STYLE: modern, clean editorial photography, natural light, tasteful color palette, authentic and professional. Any people must look natural and anatomically correct — open, relaxed eyes (not closed or mid-blink), natural hands. Avoid generic, clichéd compositions. No text, no words, no logos, no watermarks.`;

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size: "1536x1024",
      quality,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  _llmCost += quality === "high" ? IMAGE_COST_HIGH : IMAGE_COST_MEDIUM;
  const item = data?.data?.[0] ?? {};
  const imageUrl = item.b64_json
    ? `data:image/png;base64,${item.b64_json}`
    : item.url ?? "";
  const imageAlt = `${keyword} — ${BRAND_NAME}`;
  return { imageUrl, imageAlt };
}

// ─── Manual mode (no API credits) ───────────────────────────────────────────
// Build a single self-contained prompt the user pastes into their own ChatGPT
// session, then paste the result back to publish — zero OpenAI API usage.

export function buildManualPrompt(keyword: string, cluster: string, wordCount = 1400): string {
  return `${BRAND_SYSTEM_PROMPT}

TASK: Write a comprehensive, genuinely useful article about: "${keyword}"${cluster ? ` (content cluster: ${cluster})` : ""}.

REQUIREMENTS:
- At least ${wordCount} words. Stay focused on "${keyword}".
- Do NOT include an <h1> — the page title is rendered separately. Start with a <p> opening paragraph that uses the keyword "${keyword}" in the first sentence and meets the reader where they are.
- Use the primary keyword naturally 4-6 times. Make several <h2> headings phrased as real questions a reader would ask (for AI Overview / featured-snippet eligibility).
- Structure: 6-9 <h2> sections covering every practical angle; <h3> subsections where useful.
- Include 2-3 contextual internal links ONLY where genuinely relevant, pointing to pages on ${SITE_URL} (e.g. <a href="${SITE_URL}/about">about</a>, <a href="${SITE_URL}/contact">contact</a>).
- Cite at least 2 reputable, well-known external sources with real links. Never invent statistics.
- Include a "Frequently Asked Questions" <h2> section with 6-8 questions, each as an <h3> question (ending in "?") followed by a <p> 1-2 sentence answer.
- End with a helpful next-steps paragraph inviting the reader to learn more from ${BRAND_NAME}.
- The BODY must be HTML only, per the FORMAT RULES above.

OUTPUT FORMAT — return EXACTLY this and nothing else. Put each marker on its own line:
===TITLE===
(one compelling, empathetic title under 60 characters, keyword near the start)
===META===
(a 150-160 character meta description that includes the keyword and never says "free")
===BODY===
(the full HTML article body)`;
}

// Parse what the user pastes back from ChatGPT into a GeneratedArticle.
export function parseManualArticle(
  raw: string,
  keyword: string,
  cluster: string
): GeneratedArticle {
  const text = raw.replace(/```html/gi, "").replace(/```/g, "").trim();

  const titleM = /===TITLE===\s*([\s\S]*?)\s*===META===/i.exec(text);
  const metaM = /===META===\s*([\s\S]*?)\s*===BODY===/i.exec(text);
  const bodyM = /===BODY===\s*([\s\S]*)$/i.exec(text);

  let title = (titleM?.[1] ?? "").replace(/^["']|["']$/g, "").trim();
  let metaDescription = (metaM?.[1] ?? "").replace(/^["']|["']$/g, "").slice(0, 160).trim();
  let body = clean(bodyM?.[1] ?? text);

  // Fallbacks if the markers were dropped: derive a title from the first heading.
  if (!title) {
    const h = /<h[12][^>]*>(.*?)<\/h[12]>/i.exec(body);
    title = (h?.[1]?.replace(/<[^>]+>/g, "").trim() || keyword).slice(0, 70);
  }
  if (!metaDescription) {
    const p = /<p[^>]*>(.*?)<\/p>/i.exec(body);
    metaDescription = (p?.[1]?.replace(/<[^>]+>/g, "").trim() || title).slice(0, 160);
  }

  const faq = extractFaq(body);
  const jsonLd = buildJsonLd(title, metaDescription, keyword, faq);
  return { keyword, cluster, title, metaDescription, html: body, faq, jsonLd };
}

// Classify an article's search intent from its keyword so cluster articles don't
// all re-explain the same fundamentals (which causes keyword cannibalization).
// "what is X" → pillar/education; "X near me" / "best X" → decision/local.
interface ArticleAngle {
  label: "pillar" | "decision" | "standard";
  guidance: string;
}
function angleFor(keyword: string): ArticleAngle {
  const k = keyword.toLowerCase();
  const isLocal =
    /\bnear me\b|\bnear you\b|in my area|\bbest\b|\btop\b|\bfind\b|\bservices?\b|\bproviders?\b|how much|\bcost\b|\bprice\b|\bcheap\b|\baffordable\b/.test(
      k
    );
  const isPillar =
    /^what (is|are|s)\b|^whats\b|^what'?s\b|guide to|\bexplained\b|definition|meaning of|^how does|^understanding\b/.test(
      k
    );
  if (isLocal)
    return {
      label: "decision",
      guidance: `INTENT — DECISION / LOCAL: The reader ALREADY knows the basics of "${keyword}". Do NOT spend more than ONE brief sentence re-defining the concept, and do NOT include a "what is" or "types of" explainer section. Focus entirely on the practical decision: how to find and vet local providers, the specific questions to ask, what to look for and red flags to avoid, what costs to expect and how to pay, and concrete next steps to get started. Headings must be action- and decision-oriented (finding, choosing, comparing, evaluating, paying, getting started).`,
    };
  if (isPillar)
    return {
      label: "pillar",
      guidance: `INTENT — AWARENESS / PILLAR: This is the foundational explainer for the topic. Define the concept clearly and completely, cover the types, the benefits, who it helps, and how it works. Stay educational. Do NOT turn this into a "how to find a local provider" piece — keep logistics light and high-level so it doesn't overlap with the local/decision article in this cluster.`,
    };
  return {
    label: "standard",
    guidance: `INTENT — STANDARD: Balance a concise definition with practical, actionable guidance specific to "${keyword}".`,
  };
}

export async function generateArticle(
  keyword: string,
  cluster: string,
  wordCount = 1400
): Promise<GeneratedArticle> {
  const angle = angleFor(keyword);
  // 1. Title
  const title = (
    await chat(
      [
        {
          role: "user",
          content: `Generate ONE compelling blog post title for an article on the topic: "${keyword}". Include the keyword near the start, under 60 characters, helpful not clickbait. ${
            angle.label === "decision"
              ? "Frame it around finding, choosing, or getting started — practical and action-oriented."
              : angle.label === "pillar"
                ? "Frame it as a clear explainer or guide that helps the reader understand the topic."
                : "Keep it practical and clear."
          } Return ONLY the title.`,
        },
      ],
      { temperature: 0.7, max_tokens: 80 }
    )
  )
    .replace(/^["']|["']$/g, "")
    .trim();

  // 2. Body (HTML, includes an FAQ section)
  const body = clean(
    await chat(
      [
        { role: "system", content: BRAND_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Write a comprehensive, genuinely useful article about: "${keyword}".

${angle.guidance}

REQUIREMENTS:
- At least ${wordCount} words. Stay focused on "${keyword}".
- Do NOT include an <h1> — the page title is rendered separately. Start with a <p> opening paragraph that uses the keyword "${keyword}" in the first sentence and meets the reader where they are.
- Use the primary keyword naturally 4-6 times. Make several <h2> headings phrased as real questions a reader would ask (for AI Overview / featured-snippet eligibility).
- Structure: 6-9 <h2> sections covering every practical angle; <h3> subsections where useful.
- Include 2-3 contextual internal links ONLY where genuinely relevant, pointing to pages on ${SITE_URL} (e.g. <a href="${SITE_URL}/about">about</a>, <a href="${SITE_URL}/contact">contact</a>).
- Cite at least 2 reputable, well-known external sources with real links. Never invent statistics.
- Include a "Frequently Asked Questions" <h2> section with 6-8 questions, each as an <h3> question (ending in "?") followed by a <p> 1-2 sentence answer.
- End with a helpful next-steps paragraph inviting the reader to learn more from ${BRAND_NAME}.
- HTML only, per the format rules.`,
        },
      ],
      { temperature: 0.7, max_tokens: 6000 }
    )
  );

  // 3. Meta description
  const metaDescription = (
    await chat(
      [
        {
          role: "user",
          content: `Write a 150-160 character meta description for a blog post titled "${title}" (keyword: "${keyword}"). Clear, includes the keyword, ends with value. Return ONLY the meta description.`,
        },
      ],
      { temperature: 0.6, max_tokens: 120 }
    )
  )
    .replace(/^["']|["']$/g, "")
    .slice(0, 160)
    .trim();

  // 4. Extract FAQ pairs from the generated HTML for schema
  const faq = extractFaq(body);

  // 5. JSON-LD (Article + FAQPage)
  const jsonLd = buildJsonLd(title, metaDescription, keyword, faq);

  return { keyword, cluster, title, metaDescription, html: body, faq, jsonLd };
}

function extractFaq(html: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  // Match <h3>question</h3> immediately followed by <p>answer</p>
  const re = /<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/gis;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const q = m[1].replace(/<[^>]+>/g, "").trim();
    const a = m[2].replace(/<[^>]+>/g, "").trim();
    if (q.endsWith("?")) out.push({ q, a });
  }
  return out.slice(0, 8);
}

export const SITE = SITE_URL;

// Local slug helper (kept here to avoid a circular import with webflow.ts).
export function slugFor(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 256);
}

export interface JsonLdOpts {
  slug?: string;
  datePublished?: string; // ISO
  dateModified?: string; // ISO
  imageUrl?: string; // hosted (https) image — data: URLs are skipped
}

// Build a complete, valid JSON-LD @graph with absolute URLs, real dates, a
// non-empty author/publisher, an article image, and a BreadcrumbList.
// Article + BreadcrumbList + (optional) FAQPage.
export function buildJsonLd(
  title: string,
  desc: string,
  keyword: string,
  faq: { q: string; a: string }[],
  opts: JsonLdOpts = {}
): string {
  const slug = opts.slug || slugFor(title || keyword);
  const url = `${SITE}/posts/${slug}`;
  const published = opts.datePublished || new Date().toISOString();
  const modified = opts.dateModified || published;
  const image =
    opts.imageUrl && /^https?:\/\//.test(opts.imageUrl) ? opts.imageUrl : undefined;

  const publisher = {
    "@type": "Organization",
    name: BRAND_NAME,
    url: SITE,
    logo: {
      "@type": "ImageObject",
      url: `${SITE}/logo.png`,
    },
  };

  const article: any = {
    "@type": "Article",
    headline: title,
    description: desc,
    keywords: keyword,
    inLanguage: "en-US",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    datePublished: published,
    dateModified: modified,
    author: { "@type": "Organization", name: BRAND_NAME, url: SITE },
    publisher,
  };
  if (image) article.image = { "@type": "ImageObject", url: image };

  const graph: any[] = [
    article,
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        {
          "@type": "ListItem",
          position: 2,
          name: BLOG_NAME,
          item: `${SITE}/posts`,
        },
        { "@type": "ListItem", position: 3, name: title, item: url },
      ],
    },
  ];

  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  return JSON.stringify(
    { "@context": "https://schema.org", "@graph": graph },
    null,
    2
  );
}
