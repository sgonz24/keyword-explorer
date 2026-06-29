"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Cluster,
  GrowResponse,
  JourneyStage,
  ScoredKeyword,
} from "@/lib/types";
import type { GeneratedArticle } from "@/lib/llm";

type SortKey = "opportunity" | "search_volume" | "keyword_difficulty";
type View = "explore" | "queue" | "grow" | "costs" | "settings";
type SettingsTab = "basic" | "intelligence" | "integrations";

const STAGES: JourneyStage[] = ["Awareness", "Consideration", "Decision"];

// Display defaults for the UI. Override the server-side equivalents with the
// BRAND_NAME / SITE_DOMAIN env vars (see lib/config.ts); to surface them in the
// browser too, expose them as NEXT_PUBLIC_BRAND_NAME / NEXT_PUBLIC_SITE_DOMAIN.
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Acme";
const SITE_DOMAIN = process.env.NEXT_PUBLIC_SITE_DOMAIN ?? "example.com";

const SUGGESTED_TOPICS = [
  "content marketing",
  "email automation",
  "seo basics",
  "landing page design",
  "marketing analytics",
  "social media strategy",
  "conversion optimization",
  "keyword research",
];

function oppClass(o: number): string {
  if (o >= 75) return "opp-green";
  if (o >= 50) return "opp-amber";
  return "opp-grey";
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function bigFmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function money(n: number): string {
  return `$${(n || 0).toFixed(2)}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

interface QueueItem {
  keyword: string;
  cluster: string;
  stage: string;
  searchVolume: number;
  keywordDifficulty: number;
  opportunity: number;
  scheduledDate: string;
}

// "2026-06-15" → "Mon, Jun 15"
function dateLabel(d: string): string {
  if (!d) return "Unscheduled";
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface DashData {
  stats: {
    articlesLive: number;
    clusters: number;
    questionsReady: number;
    searchPotential: number;
  };
  coverage: { name: string; covered: number }[];
  recent: { name: string; url: string }[];
}

interface MonthlyCost {
  month: string;
  dataforseo: number;
  openai: number;
  total: number;
  actions: number;
}
interface CostData {
  current: MonthlyCost;
  months: MonthlyCost[];
}

export default function Home() {
  const [view, setView] = useState<View>("explore");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("basic");
  const [showDiscover, setShowDiscover] = useState(false);

  // Queue
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Create / draft preview
  const [draft, setDraft] = useState<GeneratedArticle | null>(null);
  const [draftLoadingKw, setDraftLoadingKw] = useState<string | null>(null);
  const [autoKw, setAutoKw] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Manual mode (ChatGPT subscription, no API credits)
  const [manual, setManual] = useState<
    { keyword: string; cluster: string; prompt: string } | null
  >(null);
  const [manualPaste, setManualPaste] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Grow
  const [growLoading, setGrowLoading] = useState(false);
  const [growError, setGrowError] = useState<string | null>(null);
  const [grow, setGrow] = useState<GrowResponse | null>(null);

  // Explore / discover
  const [mode, setMode] = useState<"seed" | "domain">("seed");
  const [seed, setSeed] = useState("");
  const [compInput, setCompInput] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("opportunity");
  const [selected, setSelected] = useState<
    Map<string, { kw: ScoredKeyword; cluster: string }>
  >(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  // Live dashboard data (Webflow posts + Sheet queue)
  const [dash, setDash] = useState<DashData | null>(null);

  // API cost tracker
  const [costs, setCosts] = useState<CostData | null>(null);
  const [costsLoading, setCostsLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && !d.error) setDash(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function discover(override?: string) {
    const term = (override ?? seed).trim();
    if (!term) return;
    if (override !== undefined) setSeed(term);
    setShowDiscover(false);
    setLoading(true);
    setError(null);
    setClusters(null);
    setCompetitors([]);
    setSelected(new Map());
    try {
      const body =
        mode === "domain"
          ? { mode, domain: term, competitors: compInput }
          : { mode, seed: term };
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Discovery failed");
      setClusters(data.clusters as Cluster[]);
      setCompetitors((data.competitors as string[]) ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const byStage = useMemo(() => {
    const out: Record<JourneyStage, Cluster[]> = {
      Awareness: [],
      Consideration: [],
      Decision: [],
    };
    if (!clusters) return out;
    const sortVal = (k: ScoredKeyword) => k[sortKey] ?? 0;
    for (const c of clusters) {
      const sorted: Cluster = {
        ...c,
        keywords: [...c.keywords].sort((a, b) => sortVal(b) - sortVal(a)),
      };
      out[c.stage].push(sorted);
    }
    for (const s of STAGES) {
      out[s].sort((a, b) =>
        sortKey === "keyword_difficulty"
          ? a.opportunity - b.opportunity
          : b.opportunity - a.opportunity
      );
    }
    return out;
  }, [clusters, sortKey]);

  function toggle(kw: ScoredKeyword, cluster: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(kw.keyword)) next.delete(kw.keyword);
      else next.set(kw.keyword, { kw, cluster });
      return next;
    });
  }

  function selectStage(stage: JourneyStage, on: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const c of byStage[stage]) {
        for (const kw of c.keywords) {
          if (on) next.set(kw.keyword, { kw, cluster: c.name });
          else next.delete(kw.keyword);
        }
      }
      return next;
    });
  }

  function toggleCollapse(stage: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  async function push() {
    if (selected.size === 0) return;
    setPushing(true);
    setError(null);
    try {
      const items = [...selected.values()].map((v) => ({
        keyword: v.kw,
        clusterName: v.cluster,
      }));
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Push failed");
      setToast(
        `Added ${data.added} keyword${data.added === 1 ? "" : "s"} to the queue`
      );
      setSelected(new Map());
      setTimeout(() => setToast(null), 3500);
    } catch (e: any) {
      setError(e?.message ?? "Push failed");
    } finally {
      setPushing(false);
    }
  }

  async function loadGrow() {
    setGrowLoading(true);
    setGrowError(null);
    try {
      const res = await fetch("/api/grow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Grow check failed");
      setGrow(data as GrowResponse);
    } catch (e: any) {
      setGrowError(e?.message ?? "Grow check failed");
    } finally {
      setGrowLoading(false);
    }
  }

  async function loadQueue() {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await fetch("/api/queue");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load queue");
      setQueue(data.items as QueueItem[]);
    } catch (e: any) {
      setQueueError(e?.message ?? "Failed to load queue");
    } finally {
      setQueueLoading(false);
    }
  }

  async function writeDraft(keyword: string, cluster: string) {
    setDraftLoadingKw(keyword);
    setDraftError(null);
    try {
      const res = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, cluster }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      setDraft(data as GeneratedArticle);
    } catch (e: any) {
      setDraftError(e?.message ?? "Generation failed");
    } finally {
      setDraftLoadingKw(null);
    }
  }

  // One-click: generate + image + publish live to Webflow + mark the queue row.
  async function autoPublish(keyword: string, cluster: string) {
    if (autoKw) return;
    setAutoKw(keyword);
    setDraftError(null);
    try {
      const res = await fetch("/api/autopublish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, cluster, live: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Auto-publish failed");
      setToast(`Published live → ${data.liveUrl}`);
      setTimeout(() => setToast(null), 6000);
      await loadQueue(); // refresh so the published row drops off
    } catch (e: any) {
      setDraftError(e?.message ?? "Auto-publish failed");
      setToast(`Auto-publish failed: ${e?.message ?? ""}`);
      setTimeout(() => setToast(null), 6000);
    } finally {
      setAutoKw(null);
    }
  }

  async function openManual(keyword: string, cluster: string) {
    setDraftError(null);
    setManualPaste("");
    setCopied(false);
    setManualLoading(true);
    try {
      const res = await fetch(
        `/api/prompt?keyword=${encodeURIComponent(keyword)}&cluster=${encodeURIComponent(cluster)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not build prompt");
      setManual({ keyword, cluster, prompt: data.prompt });
      try {
        await navigator.clipboard.writeText(data.prompt);
        setCopied(true);
      } catch {
        /* clipboard may be blocked; user can copy manually */
      }
    } catch (e: any) {
      setDraftError(e?.message ?? "Could not build prompt");
    } finally {
      setManualLoading(false);
    }
  }

  async function copyPrompt() {
    if (!manual) return;
    try {
      await navigator.clipboard.writeText(manual.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function loadManualDraft() {
    if (!manual) return;
    setManualLoading(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw: manualPaste,
          keyword: manual.keyword,
          cluster: manual.cluster,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not read that paste");
      setManual(null);
      setManualPaste("");
      setDraft(data as GeneratedArticle);
    } catch (e: any) {
      setDraftError(e?.message ?? "Could not read that paste");
    } finally {
      setManualLoading(false);
    }
  }

  async function publishDraft(live: boolean) {
    if (!draft) return;
    setPublishing(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: draft, live }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Publish failed");
      setDraft(null);
      setToast(
        live
          ? `Published live → ${data.liveUrl}`
          : `Saved as draft in your CMS`
      );
      setTimeout(() => setToast(null), 5000);
    } catch (e: any) {
      setDraftError(e?.message ?? "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function loadCosts() {
    setCostsLoading(true);
    try {
      const res = await fetch("/api/costs");
      const data = await res.json();
      if (res.ok && !data.error) setCosts(data as CostData);
    } catch {
      /* ignore */
    } finally {
      setCostsLoading(false);
    }
  }

  function go(v: View) {
    setView(v);
    if (v === "grow" && !grow && !growLoading) loadGrow();
    if (v === "queue" && !queue && !queueLoading) loadQueue();
    if (v === "costs" && !costs && !costsLoading) loadCosts();
  }

  const hasResults = clusters && clusters.length > 0;

  const NAV: { id: View; label: string; icon: string }[] = [
    { id: "explore", label: "Explore", icon: "◎" },
    { id: "queue", label: "Queue", icon: "≡" },
    { id: "grow", label: "Grow", icon: "↗" },
    { id: "costs", label: "Costs", icon: "$" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">
          <div className="side-logo">{BRAND_NAME.charAt(0).toUpperCase()}</div>
          <div>
            <div className="side-name">{BRAND_NAME}</div>
            <div className="side-domain">{SITE_DOMAIN}</div>
          </div>
        </div>

        <nav className="side-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "side-link active" : "side-link"}
              onClick={() => go(n.id)}
            >
              <span className="side-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="side-section">Recent posts</div>
        <div className="side-recent">
          {(dash?.recent ?? []).slice(0, 3).map((p, i) => (
            <a
              key={i}
              className="side-post"
              href={p.url || undefined}
              target="_blank"
              rel="noreferrer"
            >
              {p.name}
            </a>
          ))}
          {!dash && <a className="side-post">Loading…</a>}
        </div>

        <div className="side-account">
          <div className="side-avatar">U</div>
          <div className="side-acct-meta">
            <div className="side-acct-name">User</div>
            <div className="side-acct-email">user@{SITE_DOMAIN}</div>
          </div>
        </div>
      </aside>

      <main className="main">
        {/* ───────────────── EXPLORE ───────────────── */}
        {view === "explore" && (
          <div className="page">
            <div className="page-head">
              <h1>Explore</h1>
              <p className="page-sub">
                Discover the questions your audience is searching — clustered by
                topic — and queue the gaps you haven't covered yet.
              </p>
            </div>

            <div className="statgrid">
              {[
                {
                  label: "Articles live",
                  value: dash ? String(dash.stats.articlesLive) : "—",
                },
                {
                  label: "Clusters",
                  value: dash ? String(dash.stats.clusters) : "—",
                },
                {
                  label: "Questions queued",
                  value: dash ? String(dash.stats.questionsReady) : "—",
                },
                {
                  label: "Mo. search potential",
                  value: dash ? bigFmt(dash.stats.searchPotential) : "—",
                },
              ].map((s) => (
                <div className="stat" key={s.label}>
                  <div className="stat-value">{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="section-title">Coverage by cluster</div>
            <div className="cov-grid">
              {(() => {
                const cov = dash?.coverage ?? [];
                const max = Math.max(1, ...cov.map((c) => c.covered));
                if (cov.length === 0) {
                  return (
                    <div className="cov-card">
                      <div className="cov-meta">
                        {dash ? "No matching posts yet." : "Loading coverage…"}
                      </div>
                    </div>
                  );
                }
                return cov.map((c) => {
                  const pct = Math.round((c.covered / max) * 100);
                  return (
                    <div className="cov-card" key={c.name}>
                      <div className="cov-top">
                        <span className="cov-name">{c.name}</span>
                        <span className="cov-pct">{c.covered}</span>
                      </div>
                      <div className="cov-bar">
                        <div className="cov-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="cov-meta">
                        {c.covered} {c.covered === 1 ? "article" : "articles"} live
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="cta-row">
              <div className="section-title" style={{ margin: 0 }}>
                Find new keywords
              </div>
              <button
                className="btn"
                onClick={() => setShowDiscover(true)}
              >
                ✨ What to write next
              </button>
            </div>
            <div className="modes">
              <button
                className={mode === "seed" ? "mode active" : "mode"}
                onClick={() => {
                  setMode("seed");
                  setClusters(null);
                  setCompetitors([]);
                }}
              >
                Seed keyword
              </button>
              <button
                className={mode === "domain" ? "mode active" : "mode"}
                onClick={() => {
                  setMode("domain");
                  setClusters(null);
                  setCompetitors([]);
                }}
              >
                Domain gap
              </button>
            </div>

            <div className="searchbar">
              <input
                type="text"
                placeholder={
                  mode === "domain"
                    ? "e.g. competitor.com"
                    : "e.g. email automation"
                }
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && discover()}
              />
              <span className="loc">US · en</span>
              <button
                className="btn"
                onClick={() => discover()}
                disabled={loading || !seed.trim()}
              >
                {loading ? <span className="spinner" /> : "Discover"}
              </button>
            </div>

            {mode === "domain" && (
              <div className="searchbar" style={{ marginTop: 10 }}>
                <input
                  type="text"
                  placeholder="Known competitors, comma-separated (optional)"
                  value={compInput}
                  onChange={(e) => setCompInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && discover()}
                />
              </div>
            )}

            {mode === "domain" && competitors.length > 0 && (
              <div className="competitors">
                Competitor gap from:{" "}
                {competitors.map((c) => (
                  <span className="chip" key={c}>
                    {c}
                  </span>
                ))}
              </div>
            )}

            {hasResults && (
              <div className="controls">
                <span>Sort by</span>
                <span className="seg">
                  {(
                    [
                      ["opportunity", "Opportunity"],
                      ["search_volume", "Volume"],
                      ["keyword_difficulty", "KD"],
                    ] as [SortKey, string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      className={sortKey === k ? "active" : ""}
                      onClick={() => setSortKey(k)}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
            )}

            {error && <div className="error">{error}</div>}

            {!loading && !error && clusters && clusters.length === 0 && (
              <div className="empty">
                No keywords passed the volume/difficulty filters for “{seed}”.{" "}
                {mode === "domain"
                  ? "Try a domain with more established competitors."
                  : "Try a broader seed."}
              </div>
            )}

            {hasResults &&
              STAGES.map((stage) => {
                const list = byStage[stage];
                if (list.length === 0) return null;
                const kwCount = list.reduce((n, c) => n + c.keywords.length, 0);
                const avgOpp = Math.round(
                  list.reduce((n, c) => n + c.opportunity, 0) / list.length
                );
                const isCollapsed = collapsed.has(stage);
                return (
                  <div className={`stage stage-${stage}`} key={stage}>
                    <div
                      className="stage-head"
                      onClick={() => toggleCollapse(stage)}
                    >
                      <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
                      <span className="dot-stage" />
                      <span className="stage-title">{stage}</span>
                      <span className="stage-meta">
                        {kwCount} kw · avg opp {avgOpp}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        className="btn ghost"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectStage(stage, true);
                        }}
                      >
                        Select all
                      </button>
                    </div>

                    {!isCollapsed &&
                      list.map((c) => (
                        <div className="cluster" key={`${stage}-${c.name}`}>
                          <div className="cluster-head">
                            <span className="cluster-name">{c.name}</span>
                            <span className="cluster-meta">
                              {c.keywords.length} kw
                              <span
                                className={`opp-dot ${oppClass(c.opportunity)}`}
                              />
                              opp {c.opportunity}
                            </span>
                          </div>
                          {c.keywords.map((kw) => (
                            <div className="row" key={kw.keyword}>
                              <input
                                type="checkbox"
                                checked={selected.has(kw.keyword)}
                                onChange={() => toggle(kw, c.name)}
                              />
                              <span className="kw" title={kw.keyword}>
                                {kw.keyword}
                              </span>
                              <span className="num">{fmt(kw.search_volume)}</span>
                              <span className="num">
                                KD{kw.keyword_difficulty}
                              </span>
                              <span className="opp">
                                <span
                                  className={`opp-dot ${oppClass(
                                    kw.opportunity
                                  )}`}
                                />
                                {kw.opportunity}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                  </div>
                );
              })}

            {hasResults && (
              <div className="footer">
                <div className="footer-inner">
                  <span className="count">{selected.size} selected</span>
                  <button
                    className="btn"
                    onClick={push}
                    disabled={pushing || selected.size === 0}
                  >
                    {pushing ? <span className="spinner" /> : "Add to queue →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ───────────────── QUEUE ───────────────── */}
        {view === "queue" && (
          <div className="page">
            <div className="page-head">
              <h1>Queue</h1>
              <p className="page-sub">
                Your drip publishing schedule, in order. Work top to bottom — each
                keyword is dated and sequenced by cluster, so you never have to
                guess what to publish next.
              </p>
            </div>

            <div className="controls" style={{ marginTop: 4 }}>
              <span>
                {queue ? `${queue.length} keyword${queue.length === 1 ? "" : "s"} queued` : "Loading…"}
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="btn ghost"
                style={{ padding: "6px 12px", fontSize: 13 }}
                onClick={loadQueue}
                disabled={queueLoading}
              >
                {queueLoading ? <span className="spinner" /> : "Refresh"}
              </button>
            </div>

            {queueError && <div className="error">{queueError}</div>}
            {draftError && <div className="error">{draftError}</div>}

            {queueLoading && !queue && (
              <div className="empty">Loading your queue…</div>
            )}

            {queue && queue.length === 0 && !queueLoading && (
              <div className="queue-empty">
                <div className="queue-empty-icon">≡</div>
                <div className="queue-empty-title">Nothing queued yet</div>
                <p className="queue-empty-sub">
                  Pick keywords in Explore and add them to the queue. Each becomes
                  a drafted article you can review, then it drips out to your CMS
                  on schedule.
                </p>
                <button className="btn" onClick={() => go("explore")}>
                  Go to Explore
                </button>
              </div>
            )}

            {queue && queue.length > 0 && (
              <div className="cluster" style={{ marginTop: 12 }}>
                {queue.map((q, i) => (
                  <div
                    className={i === 0 ? "row queue-row queue-next" : "row queue-row"}
                    key={q.keyword}
                  >
                    <span className="queue-order">{i + 1}</span>
                    <span className="kw" title={q.keyword}>
                      <span className="queue-kw-line">
                        {q.keyword}
                        {i === 0 && <span className="queue-next-tag">Next up</span>}
                      </span>
                      <span className="queue-sub">
                        {dateLabel(q.scheduledDate)}
                        {q.cluster && ` · ${q.cluster}`}
                        {q.opportunity > 0 && ` · opp ${q.opportunity}`}
                      </span>
                    </span>
                    <div className="queue-actions">
                      <button
                        className="btn ghost"
                        style={{ padding: "6px 12px", fontSize: 13 }}
                        onClick={() => openManual(q.keyword, q.cluster)}
                        disabled={manualLoading}
                        title="Write it in your own ChatGPT — no API credits"
                      >
                        ChatGPT (no credits)
                      </button>
                      <button
                        className="btn ghost"
                        style={{ padding: "6px 14px", fontSize: 13 }}
                        onClick={() => writeDraft(q.keyword, q.cluster)}
                        disabled={draftLoadingKw !== null || autoKw !== null}
                        title="Auto-generate via OpenAI API, then review before publishing"
                      >
                        {draftLoadingKw === q.keyword ? (
                          <span className="spinner" />
                        ) : (
                          "Auto draft (review)"
                        )}
                      </button>
                      <button
                        className="btn"
                        style={{ padding: "6px 14px", fontSize: 13 }}
                        onClick={() => autoPublish(q.keyword, q.cluster)}
                        disabled={autoKw !== null || draftLoadingKw !== null}
                        title="Generate + image + publish live to your CMS in one click"
                      >
                        {autoKw === q.keyword ? (
                          <span className="spinner" />
                        ) : (
                          "Auto-publish live →"
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ───────────────── GROW ───────────────── */}
        {view === "grow" && (
          <div className="page">
            <div className="page-head">
              <h1>Grow</h1>
              <p className="page-sub">
                Live rank tracking for everything you've published — straight from
                DataForSEO SERP data, no Search Console required.
              </p>
            </div>

            <div className="controls" style={{ marginTop: 4 }}>
              <span>
                Tracking{" "}
                <strong style={{ color: "var(--text)" }}>
                  {grow?.domain ?? SITE_DOMAIN}
                </strong>
                {grow?.checkedAt ? ` · checked ${grow.checkedAt}` : ""}
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="btn ghost"
                style={{ padding: "6px 12px", fontSize: 13 }}
                onClick={loadGrow}
                disabled={growLoading}
              >
                {growLoading ? <span className="spinner" /> : "Refresh"}
              </button>
            </div>

            {growError && <div className="error">{growError}</div>}

            {growLoading && !grow && (
              <div className="empty">Checking live rankings…</div>
            )}

            {grow && (
              <div
                className={grow.gscConnected ? "gsc-note ok" : "gsc-note"}
                style={{ marginTop: 12 }}
              >
                {grow.gscConnected
                  ? "✓ Google Search Console connected — positions, clicks, and impressions are real Google data (last 28 days)."
                  : "Google Search Console not connected yet — positions are estimated from live SERP data. Connect GSC for real clicks + impressions."}
              </div>
            )}

            {grow && grow.rows.length === 0 && !growLoading && (
              <div className="empty">
                No live articles to track yet. Publish some from the Queue first —
                rankings appear here a few weeks after they go live.
              </div>
            )}

            {grow && grow.rows.length > 0 && (
              <div className="grow-list" style={{ marginTop: 12 }}>
                {grow.rows.map((r) => (
                  <div className="grow-card" key={r.keyword}>
                    <div className="grow-card-kw">{r.keyword}</div>
                    {r.cluster && (
                      <div className="grow-card-cluster">{r.cluster}</div>
                    )}
                    <div className="grow-card-stats">
                      <div className="grow-stat">
                        <span className="grow-stat-label">Clicks</span>
                        <span className="grow-stat-val">
                          {r.clicks > 0 ? fmt(r.clicks) : "—"}
                        </span>
                      </div>
                      <div className="grow-stat">
                        <span className="grow-stat-label">Impr.</span>
                        <span className="grow-stat-val">
                          {r.impressions > 0 ? fmt(r.impressions) : "—"}
                        </span>
                      </div>
                      <div className="grow-stat">
                        <span className="grow-stat-label">Position</span>
                        <span className="grow-stat-val">
                          {r.position > 0 ? `#${r.position}` : "—"}
                        </span>
                      </div>
                      <div className="grow-stat">
                        <span className="grow-stat-label">Trend</span>
                        <span className="grow-stat-val">
                          {r.delta === null ? (
                            <span style={{ color: "var(--muted)" }}>·</span>
                          ) : r.delta > 0 ? (
                            <span style={{ color: "var(--green)" }}>
                              ▲ {r.delta}
                            </span>
                          ) : r.delta < 0 ? (
                            <span style={{ color: "#fca5a5" }}>
                              ▼ {Math.abs(r.delta)}
                            </span>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ───────────────── COSTS ───────────────── */}
        {view === "costs" && (
          <div className="page">
            <div className="page-head">
              <h1>Costs</h1>
              <p className="page-sub">
                Real API spend, logged per action and totaled by month — DataForSEO
                (keyword research + rank tracking) and OpenAI (article + image
                generation). No flat monthly fee.
              </p>
            </div>

            <div className="controls" style={{ marginTop: 4 }}>
              <span>
                {costs
                  ? `${monthLabel(costs.current.month)} so far`
                  : "Loading…"}
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="btn ghost"
                style={{ padding: "6px 12px", fontSize: 13 }}
                onClick={loadCosts}
                disabled={costsLoading}
              >
                {costsLoading ? <span className="spinner" /> : "Refresh"}
              </button>
            </div>

            <div className="statgrid" style={{ marginTop: 12 }}>
              <div className="stat">
                <div className="stat-value">
                  {costs ? money(costs.current.total) : "—"}
                </div>
                <div className="stat-label">This month total</div>
              </div>
              <div className="stat">
                <div className="stat-value">
                  {costs ? money(costs.current.dataforseo) : "—"}
                </div>
                <div className="stat-label">DataForSEO</div>
              </div>
              <div className="stat">
                <div className="stat-value">
                  {costs ? money(costs.current.openai) : "—"}
                </div>
                <div className="stat-label">OpenAI</div>
              </div>
              <div className="stat">
                <div className="stat-value">
                  {costs ? String(costs.current.actions) : "—"}
                </div>
                <div className="stat-label">Billable actions</div>
              </div>
            </div>

            <div className="section-title">Monthly history</div>
            {costs && costs.months.length === 0 && (
              <div className="empty">
                No spend logged yet. Run a Discover, Create, or Grow and it shows up
                here.
              </div>
            )}
            {costs && costs.months.length > 0 && (
              <div className="cluster" style={{ marginTop: 12 }}>
                <div className="row cost-row cost-head">
                  <span className="cost-month">Month</span>
                  <span className="cost-cell">DataForSEO</span>
                  <span className="cost-cell">OpenAI</span>
                  <span className="cost-cell">Actions</span>
                  <span className="cost-cell cost-total">Total</span>
                </div>
                {costs.months.map((m) => (
                  <div className="row cost-row" key={m.month}>
                    <span className="cost-month">{monthLabel(m.month)}</span>
                    <span className="cost-cell">{money(m.dataforseo)}</span>
                    <span className="cost-cell">{money(m.openai)}</span>
                    <span className="cost-cell">{m.actions}</span>
                    <span className="cost-cell cost-total">{money(m.total)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="cost-note">
              Pay only for what you use. Exact provider balances live on your
              keyword-data and{" "}
              <a
                href="https://platform.openai.com/usage"
                target="_blank"
                rel="noreferrer"
              >
                OpenAI
              </a>{" "}
              dashboards.
            </p>
          </div>
        )}

        {/* ───────────────── SETTINGS ───────────────── */}
        {view === "settings" && (
          <div className="page">
            <div className="page-head">
              <h1>Settings</h1>
              <p className="page-sub">
                Site profile, brand intelligence, and the integrations that power
                the Discover → Create → Publish → Grow loop.
              </p>
            </div>

            <div className="subtabs">
              {(
                [
                  ["basic", "Basic Settings"],
                  ["intelligence", "Site Intelligence"],
                  ["integrations", "Integrations"],
                ] as [SettingsTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={settingsTab === id ? "subtab active" : "subtab"}
                  onClick={() => setSettingsTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {settingsTab === "basic" && (
              <div className="form">
                <div className="field">
                  <label>Site name</label>
                  <input type="text" defaultValue={BRAND_NAME} readOnly />
                </div>
                <div className="field">
                  <label>Domain</label>
                  <input type="text" defaultValue={SITE_DOMAIN} readOnly />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Target location</label>
                    <input type="text" defaultValue="United States" readOnly />
                  </div>
                  <div className="field">
                    <label>Language</label>
                    <input type="text" defaultValue="English" readOnly />
                  </div>
                </div>
                <div className="field">
                  <label>Brand summary</label>
                  <textarea
                    rows={4}
                    readOnly
                    defaultValue={`${BRAND_NAME} publishes clear, trustworthy, genuinely useful content for the people it serves. Configure your own brand voice via the BRAND_NAME and BRAND_VOICE environment variables (see lib/config.ts).`}
                  />
                </div>
              </div>
            )}

            {settingsTab === "intelligence" && (
              <div className="intel">
                <p className="page-sub" style={{ marginTop: 0 }}>
                  Pages discovered on {SITE_DOMAIN} — used to detect existing
                  coverage so Explore only surfaces true gaps.
                </p>
                <div className="cluster" style={{ marginTop: 12 }}>
                  {[
                    "/blog",
                    "/features",
                    "/pricing",
                    "/about",
                    "/contact",
                  ].map((p) => (
                    <div className="row intel-row" key={p}>
                      <span className="kw">{p}</span>
                      <span className="num" style={{ color: "var(--accent)" }}>
                        indexed
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {settingsTab === "integrations" && (
              <div className="integrations">
                {[
                  {
                    name: "Your CMS",
                    desc: "Publish target — drafts push to your blog/CMS",
                    status: "Connected",
                    ok: true,
                  },
                  {
                    name: "Search Console",
                    desc: "Index coverage + query data",
                    status: "Connected",
                    ok: true,
                  },
                  {
                    name: "Keyword data",
                    desc: "Keyword discovery, difficulty, and SERP rank data",
                    status: "Connected",
                    ok: true,
                  },
                  {
                    name: "ChatGPT",
                    desc: "Article writing + images via your ChatGPT plan (OAuth)",
                    status: "Connect account",
                    ok: false,
                  },
                ].map((i) => (
                  <div className="intg-card" key={i.name}>
                    <div className="intg-meta">
                      <div className="intg-name">{i.name}</div>
                      <div className="intg-desc">{i.desc}</div>
                    </div>
                    <span
                      className={i.ok ? "intg-status ok" : "intg-status off"}
                    >
                      {i.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {toast && <div className="toast">{toast}</div>}
      </main>

      {draft && (
        <div className="modal-overlay" onClick={() => setDraft(null)}>
          <div
            className="modal draft-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setDraft(null)}
              aria-label="Close"
            >
              ×
            </button>
            <div className="draft-tag">Draft · {draft.cluster || "Uncategorized"}</div>
            <h2 className="draft-h1">{draft.title}</h2>
            <p className="draft-meta">
              <strong>Meta:</strong> {draft.metaDescription}
            </p>
            {draft.imageUrl && (
              <img
                className="draft-img"
                src={draft.imageUrl}
                alt={draft.imageAlt || draft.title}
              />
            )}
            <div
              className="draft-body"
              dangerouslySetInnerHTML={{ __html: draft.html }}
            />
            <div className="modal-section" style={{ marginTop: 20 }}>
              JSON-LD schema
            </div>
            <pre className="draft-schema">{draft.jsonLd}</pre>
            {draftError && <div className="draft-error">{draftError}</div>}
            <div className="draft-actions">
              <button
                className="btn ghost"
                onClick={() => navigator.clipboard?.writeText(draft.html)}
              >
                Copy HTML
              </button>
              <button
                className="btn ghost"
                disabled={publishing}
                onClick={() => publishDraft(false)}
                title="Create as an unpublished draft in your CMS"
              >
                {publishing ? "Sending…" : "Save draft"}
              </button>
              <button
                className="btn"
                disabled={publishing}
                onClick={() => publishDraft(true)}
                title="Create and publish live to your CMS"
              >
                {publishing ? "Publishing…" : "Publish live →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {manual && (
        <div className="modal-overlay" onClick={() => setManual(null)}>
          <div className="modal draft-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setManual(null)}
              aria-label="Close"
            >
              ×
            </button>
            <div className="draft-tag">
              ChatGPT mode · no API credits · {manual.cluster || "Uncategorized"}
            </div>
            <h2 className="draft-h1">{manual.keyword}</h2>

            <div className="manual-step">
              <span className="manual-num">1</span>
              <div>
                Copy this prompt {copied && <em className="manual-copied">— copied ✓</em>}
                , then open ChatGPT and paste it in.
              </div>
            </div>
            <textarea className="manual-prompt" readOnly value={manual.prompt} />
            <div className="manual-row">
              <button className="btn ghost" onClick={copyPrompt}>
                {copied ? "Copied ✓" : "Copy prompt"}
              </button>
              <a
                className="btn"
                href="https://chatgpt.com/"
                target="_blank"
                rel="noreferrer"
              >
                Open ChatGPT →
              </a>
            </div>

            <div className="manual-step" style={{ marginTop: 20 }}>
              <span className="manual-num">2</span>
              <div>
                Paste ChatGPT's full reply back here, then load it as a draft.
                A featured image is generated automatically (~$0.06) and uploads
                to your CMS with the post — no manual image step.
              </div>
            </div>
            <textarea
              className="manual-prompt"
              placeholder="Paste the ===TITLE=== / ===META=== / ===BODY=== reply from ChatGPT here…"
              value={manualPaste}
              onChange={(e) => setManualPaste(e.target.value)}
            />
            {draftError && <div className="draft-error">{draftError}</div>}
            <div className="draft-actions">
              <button className="btn ghost" onClick={() => setManual(null)}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={manualLoading || !manualPaste.trim()}
                onClick={loadManualDraft}
              >
                {manualLoading ? "Writing draft + image…" : "Load draft →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDiscover && (
        <div className="modal-overlay" onClick={() => setShowDiscover(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setShowDiscover(false)}
              aria-label="Close"
            >
              ×
            </button>
            <h2 className="modal-title">What should we write about next?</h2>
            <p className="modal-sub">
              Give me a topic — I'll find the questions people ask and add them to
              your project.
            </p>

            <div className="searchbar modal-search">
              <input
                type="text"
                autoFocus
                placeholder="Search for a topic, e.g. Email Automation"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && discover()}
              />
              <button
                className="btn"
                onClick={() => discover()}
                disabled={loading || !seed.trim()}
              >
                {loading ? <span className="spinner" /> : "Discover"}
              </button>
            </div>

            <div className="modal-section">Suggested topics</div>
            <div className="topic-list">
              {SUGGESTED_TOPICS.map((t) => (
                <button
                  key={t}
                  className="topic-row"
                  onClick={() => discover(t)}
                >
                  <span>{t}</span>
                  <span className="topic-arrow">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
