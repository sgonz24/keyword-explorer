# Keyword Explorer

A keyword-discovery and content-pipeline web app: enter a seed topic, get scored keyword candidates clustered by buyer-journey stage, queue the best ones into a Google Sheet, generate SEO articles with an OpenAI-compatible LLM, and publish them to Webflow CMS — then track how they rank.

## Features

- **Discover** — seed-based keyword expansion via DataForSEO Labs, plus a competitor-gap mode (find what rivals rank for that you don't).
- **Score & cluster** — every keyword gets an opportunity score (volume × ease × intent) and is auto-grouped into clusters and Awareness / Consideration / Decision journey stages.
- **Queue** — push selected keywords into a Google Sheet content calendar that doubles as the publishing backlog.
- **Create** — generate a full article (title, HTML body with FAQ, meta description, JSON-LD schema) and a featured image. Or use "manual mode" to generate a prompt you paste into your own ChatGPT session and paste the result back.
- **Publish** — one-click publish to a Webflow CMS collection (draft or live), with the featured image uploaded and structured data baked in.
- **Grow** — track keyword rankings over time, blending DataForSEO SERP positions with real Google Search Console clicks/impressions.
- **Costs** — every DataForSEO and LLM call is logged so you can see monthly API spend by provider.
- **Fully brand-agnostic** — all niche/brand specifics are driven by environment variables and `lib/config.ts`.

## Tech stack

- [Next.js 16](https://nextjs.org/) (App Router, TypeScript)
- React 19
- Plain CSS (no Tailwind)
- [googleapis](https://www.npmjs.com/package/googleapis) for Sheets + Search Console
- [Vitest](https://vitest.dev/) for unit tests (scoring + clustering)
- DataForSEO, an OpenAI-compatible LLM, and Webflow as external services

## Prerequisites

- **DataForSEO account** — for keyword volume, difficulty, intent, and rank data. (https://dataforseo.com)
- **Google Cloud service account** + a Google Sheet shared with that account (Editor). Used for the content calendar, rank history, and cost log. The same account can be added to a Google Search Console property for real query metrics.
- **OpenAI-compatible LLM API key** — OpenAI, Moonshot/Kimi, Together, Groq, or any endpoint that speaks the chat-completions API. Image generation uses OpenAI's image endpoint.
- **Webflow** (optional) — an API token, site ID, and a "Posts" CMS collection ID if you want to publish.

## Setup

```bash
git clone https://github.com/sgonz24/keyword-explorer.git
cd keyword-explorer
npm install
cp .env.example .env.local
# then open .env.local and fill in your values
```

Initialize the Google Sheet tabs the app expects (`content_calendar`, `rank_history`):

```bash
node scripts/init-sheet.mjs <YOUR_SHEET_ID>
```

Configure your brand by setting `BRAND_NAME`, `SITE_DOMAIN`, and friends in `.env.local` (see `lib/config.ts` for every option, including custom topic clusters, suggested topics, and the LLM writing voice).

## Running

```bash
npm run dev      # start the dev server at http://localhost:3000
npm run build    # production build
npm start        # serve the production build
npm test         # run the Vitest unit tests
```

## Deploy on Vercel

1. Push this repo to GitHub and import it into [Vercel](https://vercel.com/).
2. Add every variable from `.env.example` under **Project Settings → Environment Variables**.
3. Deploy. The API routes run on the Node.js runtime (they use `googleapis` and longer timeouts), which Vercel handles automatically.

## How it works

```
Discover → Score → Queue → Create → Publish → Grow
```

1. **Discover** — `lib/dataforseo.ts` calls DataForSEO Labs to expand a seed (or mine competitor gaps) into candidate keywords with volume, difficulty, and intent.
2. **Score** — `lib/scoring.ts` normalizes volume and computes an opportunity score (0–100) that rewards high volume, low difficulty, and commercial/transactional intent. Intent maps to a journey stage.
3. **Cluster** — `lib/cluster.ts` groups keywords by their most significant shared term and labels each cluster with its dominant stage and average opportunity.
4. **Queue** — `lib/sheets.ts` appends chosen keywords to the `content_calendar` tab of your Google Sheet.
5. **Create** — `lib/llm.ts` generates the title, HTML body (with an FAQ section), meta description, JSON-LD, and a featured image via your configured LLM.
6. **Publish** — `lib/webflow.ts` uploads the image and creates a CMS item (draft or live) with structured data embedded.
7. **Grow** — `lib/gsc.ts` + DataForSEO track each published keyword's position over time, preferring Google Search Console's own numbers when available.

## License

[MIT](./LICENSE)
