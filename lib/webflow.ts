// Webflow CMS v2 publisher for a "Posts" collection (your blog).
// Maps a GeneratedArticle into the collection's fields and creates a CMS item.

import crypto from "crypto";
import type { GeneratedArticle } from "./llm";
import { buildJsonLd } from "./llm";
import { BRAND_NAME, SITE_URL } from "./config";

const API = "https://api.webflow.com/v2";

function token(): string {
  const t = process.env.WEBFLOW_TOKEN;
  if (!t) throw new Error("Missing WEBFLOW_TOKEN");
  return t;
}

function collectionId(): string {
  const c = process.env.WEBFLOW_COLLECTION_ID;
  if (!c) throw new Error("Missing WEBFLOW_COLLECTION_ID");
  return c;
}

function siteId(): string {
  const s = process.env.WEBFLOW_SITE_ID;
  if (!s) throw new Error("Missing WEBFLOW_SITE_ID");
  return s;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 256);
}

async function wf(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text.slice(0, 300);
    throw new Error(`Webflow ${res.status}: ${msg}`);
  }
  return json;
}

// Upload a base64 data URL (the GPT image) to Webflow site assets and return the
// hosted asset reference usable in a CMS Image field.
async function uploadImage(
  dataUrl: string,
  fileName: string
): Promise<{ fileId: string; url: string } | null> {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  const fileHash = crypto.createHash("md5").update(buf).digest("hex");

  // 1. Register the asset → get a presigned S3 upload target.
  const reg = await wf(`/sites/${siteId()}/assets`, {
    method: "POST",
    body: JSON.stringify({ fileName, fileHash }),
  });

  // 2. Upload the bytes to S3 with the returned multipart form fields.
  const uploadUrl: string = reg.uploadUrl;
  const details: Record<string, string> = reg.uploadDetails || {};
  const form = new FormData();
  for (const [k, v] of Object.entries(details)) form.append(k, v);
  form.append(
    "file",
    new Blob([buf], { type: details["content-type"] || "image/png" }),
    fileName
  );
  const up = await fetch(uploadUrl, { method: "POST", body: form });
  if (!up.ok) {
    throw new Error(`Asset upload failed (${up.status})`);
  }

  return { fileId: reg.id, url: reg.hostedUrl || reg.assetUrl || "" };
}

// Swap ONLY the featured image on an existing draft item — the write-up, slug,
// schema, and everything else stay exactly as they are. Returns the new hosted
// image URL, or null if the upload failed.
export async function replaceItemImage(
  itemId: string,
  dataUrl: string,
  fileName: string
): Promise<{ url: string } | null> {
  const image = await uploadImage(dataUrl, fileName);
  if (!image?.fileId) return null;
  await wf(`/collections/${collectionId()}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({
      isArchived: false,
      isDraft: true, // keep it a draft — we're only changing the image
      fieldData: { "main-image": { fileId: image.fileId, url: image.url } },
    }),
  });
  return { url: image.url };
}

export interface PostSummary {
  name: string;
  slug: string;
  postDate: string;
}

// Read every item in the Posts collection (paginated) for dashboard stats.
export async function fetchPosts(): Promise<PostSummary[]> {
  const cid = collectionId();
  const out: PostSummary[] = [];
  let offset = 0;
  for (;;) {
    const data = await wf(
      `/collections/${cid}/items?limit=100&offset=${offset}`,
      { method: "GET" }
    );
    const items: any[] = data.items ?? [];
    for (const it of items) {
      const f = it.fieldData ?? {};
      out.push({
        name: f.name ?? "",
        slug: f.slug ?? "",
        postDate: f["post-date"] ?? it.lastPublished ?? it.createdOn ?? "",
      });
    }
    const total = data.pagination?.total ?? out.length;
    offset += items.length;
    if (items.length === 0 || offset >= total) break;
  }
  return out;
}

export interface PublishResult {
  itemId: string;
  slug: string;
  liveUrl: string;
  imageUploaded: boolean;
}

// Create a CMS item in the Posts collection. isDraft=true stages it (stays
// unpublished in Webflow); live=true publishes it immediately.
export async function publishArticle(
  article: GeneratedArticle,
  opts: { live?: boolean } = {}
): Promise<PublishResult> {
  const slug = slugify(article.title || article.keyword);
  const now = new Date().toISOString();

  let image: { fileId: string; url: string } | null = null;
  if (article.imageUrl?.startsWith("data:")) {
    try {
      image = await uploadImage(article.imageUrl, `${slug}.png`);
    } catch {
      image = null; // publish text even if image upload fails
    }
  }

  // Rebuild JSON-LD at publish time so it carries the FINAL slug, post date, and
  // the hosted (https) image URL — then inject it as a <script> block at the end
  // of the body so the structured data ships inside the Webflow RichText field.
  const jsonLd = buildJsonLd(
    article.title,
    article.metaDescription,
    article.keyword,
    article.faq,
    {
      slug,
      datePublished: now,
      dateModified: now,
      imageUrl: image?.url,
    }
  );
  const body = `${article.html}\n<script type="application/ld+json">${jsonLd}</script>`;

  const fieldData: Record<string, any> = {
    name: article.title,
    slug,
    "meta-description": article.metaDescription,
    description: body,
    "post-date": now,
    "last-update": now,
    by: BRAND_NAME,
  };
  if (image?.fileId) {
    fieldData["main-image"] = { fileId: image.fileId, url: image.url };
  }

  const path = opts.live
    ? `/collections/${collectionId()}/items/live`
    : `/collections/${collectionId()}/items`;

  const created = await wf(path, {
    method: "POST",
    body: JSON.stringify({ isArchived: false, isDraft: !opts.live, fieldData }),
  });

  return {
    itemId: created.id,
    slug,
    liveUrl: `${SITE_URL}/posts/${slug}`,
    imageUploaded: !!image?.fileId,
  };
}
