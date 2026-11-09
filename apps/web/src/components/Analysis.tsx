import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AnalysisFinding, AnalysisJob, AnalysisReport, DeckData, DeckProfile, DeckSummary, WinRate } from "@cpai/core/protocol";
import { api, loadCardDb, type CardDb } from "../api.ts";
import { analyzeInBrowser } from "../browserAnalysis.ts";
import { CardFace } from "./CardFace.tsx";
import { DeckPicker } from "./Lobby.tsx";

const JOB_KEY = "cpai.analysis.job";
/** Last report made in this browser. */
const REPORT_KEY = "cpai.analysis.report";
/** Job id of an analysis running on this device. */
const LOCAL = "local";
/** Deck Builder → analysis handoff for a deck that is not saved yet. */
export const HANDOFF_KEY = "cpai.analysis.deck";
const GAMES = [4, 8, 16];
const pct = (x: number) => `${Math.round(x * 100)}%`;

function readHandoff(): DeckData | undefined {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    return raw ? (JSON.parse(raw) as DeckData) : undefined;
  } catch {
    return undefined;
  }
}

function lobbyBot(): string {
  try {
    return (JSON.parse(localStorage.getItem("cpai.lobby.v1") ?? "{}") as { bot?: string }).bot ?? "tactical";
  } catch {
    return "tactical";
  }
}

/** Card image; the full card after a short hover, or a long press on touch screens. */
function Thumb({ db, slug, size = "xs" }: { db: CardDb; slug: string; size?: "xs" | "sm" }) {
  const [preview, setPreview] = useState<{ rect: DOMRect; touch: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const card = db.bySlug.get(slug);
  const start = (e: ReactPointerEvent, touch: boolean, ms: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPreview({ rect, touch }), ms);
  };
  const stop = () => {
    clearTimeout(timer.current);
    setPreview((p) => (p?.touch ? p : null));
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const w = 300;
  const h = 420;
  return (
    <span
      className="an-thumb"
      title={card?.displayName ?? slug}
      onPointerEnter={(e) => e.pointerType === "mouse" && start(e, false, 450)}
      onPointerLeave={stop}
      onPointerDown={(e) => e.pointerType !== "mouse" && start(e, true, 500)}
      onPointerUp={() => clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CardFace card={card} size={size} showText={false} />
      {preview &&
        (preview.touch ? (
          <div className="preview-touch" onClick={(e) => (e.stopPropagation(), setPreview(null))}>
            <CardFace card={card} size="lg" />
          </div>
        ) : (
          <div
            className="preview-hover"
            style={{
              left: preview.rect.right + 12 + w < window.innerWidth ? preview.rect.right + 12 : Math.max(8, preview.rect.left - 12 - w),
              top: Math.min(Math.max(8, preview.rect.top + preview.rect.height / 2 - h / 2), window.innerHeight - h - 8),
            }}
          >
            <CardFace card={card} size="lg" />
          </div>
        ))}
    </span>
  );
}

function Rate({ r }: { r: WinRate }) {
  return (
    <span className="an-rate" title={`95% interval ${pct(r.ci[0])}–${pct(r.ci[1])}`}>
      <span className="an-bar">
        <span style={{ width: pct(r.rate) }} className={r.rate < 0.4 ? "low" : r.rate > 0.6 ? "high" : ""} />
      </span>
      <b>{pct(r.rate)}</b> <span className="muted">{r.wins}/{r.games}</span>
    </span>
  );
}

function Findings({ db, list, empty }: { db: CardDb; list: AnalysisFinding[]; empty: string }) {
  if (!list.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="an-findings">
      {list.map((f, i) => (
        <li key={i}>
          <span>{f.text}</span>
          {f.cards && f.cards.length > 0 && (
            <span className="an-cards">
              {f.cards.map((s) => (
                <Thumb key={s} db={db} slug={s} />
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProfileTable({ a, b }: { a: DeckProfile; b: DeckProfile }) {
  const rows: [string, number, number][] = [
    ["Main Deck", a.size, b.size],
    ["Units", a.units, b.units],
    ["Gear", a.gears, b.gears],
    ["Programs", a.programs, b.programs],
    ["Average cost", a.averageCost, b.averageCost],
    ["Units costing 2 or less", a.earlyUnits, b.earlyUnits],
    ["Cards costing 5 or more", a.highCost, b.highCost],
    ["Sellable", a.sellable, b.sellable],
    ["[BLOCKER]", a.blockers, b.blockers],
    ["[GO SOLO]", a.goSolo, b.goSolo],
    ["Average Unit power", a.averageUnitPower, b.averageUnitPower],
  ];
  const max = Math.max(1, ...a.curve, ...b.curve);
  return (
    <div className="an-profile">
      <table className="an-table">
        <thead>
          <tr>
            <th />
            <th>This deck</th>
            <th>Other decks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, x, y]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>
                <b>{x}</b>
              </td>
              <td className="muted">{y}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="an-curve" title="Cost curve: this deck (yellow), other decks (grey)">
        {a.curve.map((n, i) => (
          <div key={i} className="an-curve-col">
            <div className="an-curve-bars">
              <span className="mine" style={{ height: `${(n / max) * 100}%` }} />
              <span className="pool" style={{ height: `${((b.curve[i] ?? 0) / max) * 100}%` }} />
            </div>
            <span className="small muted">{i === 7 ? "7+" : i}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Report({ db, report, decks }: { db: CardDb; report: AnalysisReport; decks: DeckSummary[] }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const weaknesses = report.findings.filter((f) => f.kind === "weakness");
  const strengths = report.findings.filter((f) => f.kind === "strength");
  const playCounter = async (counterId: string) => {
    setBusy(counterId);
    setError(undefined);
    try {
      const d = report.deck;
      const { gameId } = await api.newGame({ yourDeck: counterId, botDeck: d.id, bot: lobbyBot(), botDeckData: { id: d.id, name: d.name, legends: d.legends, main: d.main } });
      location.hash = `#/game/${gameId}`;
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(undefined);
    }
  };
  const canOpen = (id: string) => decks.some((d) => d.id === id);
  return (
    <div className="an-report">
      <section className="panel an-head">
        <div className="an-cards">
          {report.deck.legends.map((s) => (
            <Thumb key={s} db={db} slug={s} size="sm" />
          ))}
        </div>
        <div>
          <h2>{report.deck.name}</h2>
          <div className="an-overall">
            <Rate r={report.overall} />
            <span className="muted small">
              against {report.matchups.length} decks · {report.gamesPerMatchup} games each · {report.bot} bots on both sides · {(report.ms / 1000).toFixed(0)} s
            </span>
          </div>
          <div className="muted small">
            Going first {pct(report.goingFirst.rate)} · going second {pct(report.goingSecond.rate)} · wins in {report.averageTurnsWin} turns, losses in {report.averageTurnsLoss} turns
          </div>
        </div>
      </section>

      <div className="an-grid">
        <section className="panel">
          <h3>Weaknesses</h3>
          <Findings db={db} list={weaknesses} empty="No clear weakness against these decks." />
          {strengths.length > 0 && (
            <>
              <h3>Strengths</h3>
              <Findings db={db} list={strengths} empty="" />
            </>
          )}
        </section>
        <section className="panel">
          <h3>How to beat it</h3>
          <Findings db={db} list={report.plan} empty="No deck here beats it reliably." />
          <h3>Counter decks</h3>
          {error && <div className="banner error">{error}</div>}
          <div className="an-counters">
            {report.counters.map((c) => (
              <div key={c.deckId} className="an-counter">
                <div className="an-counter-top">
                  <span className="an-cards">
                    {c.legends.map((s) => (
                      <Thumb key={s} db={db} slug={s} />
                    ))}
                  </span>
                  <div>
                    <b>{c.deckName}</b>
                    <div>
                      <Rate r={c} />
                    </div>
                  </div>
                </div>
                {c.techCards.length > 0 && (
                  <div className="an-tech">
                    <span className="small muted">Cards to add:</span>
                    {c.techCards.map((s) => (
                      <Thumb key={s} db={db} slug={s} />
                    ))}
                  </div>
                )}
                <div className="an-counter-actions">
                  <button className="btn small primary" disabled={!!busy} onClick={() => playCounter(c.deckId)}>
                    {busy === c.deckId ? "Starting…" : "Play it vs this deck"}
                  </button>
                  {canOpen(c.deckId) && (
                    <a className="btn small" href={`#/builder/${c.deckId}`}>
                      Open in Deck Builder
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="an-grid">
        <section className="panel">
          <h3>Matchups</h3>
          <table className="an-table an-matchups">
            <tbody>
              {report.matchups.map((m) => (
                <tr key={m.deckId}>
                  <td>
                    <span className="an-cards">
                      {m.legends.map((s) => (
                        <Thumb key={s} db={db} slug={s} />
                      ))}
                    </span>
                  </td>
                  <td className="an-mname">{m.deckName}</td>
                  <td>
                    <Rate r={m} />
                  </td>
                  <td className="muted small">{m.averageTurns} turns</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h3>Key cards</h3>
          <p className="muted small">Win rate in games where the deck played the card, and in games where it did not.</p>
          <div className="an-keys">
            {report.keyCards.map((k) => (
              <div key={k.slug} className="an-key">
                <Thumb db={db} slug={k.slug} size="sm" />
                <div className="small">
                  <div>
                    <b>{pct(k.whenPlayed.rate)}</b> / <span className="muted">{pct(k.whenNotPlayed.rate)}</span>
                  </div>
                  <div className="muted">played in {pct(k.playedIn)}</div>
                </div>
              </div>
            ))}
          </div>
          <h3>Deck profile</h3>
          <ProfileTable a={report.profile} b={report.poolProfile} />
        </section>
      </div>
    </div>
  );
}

export function Analysis({ deckId }: { deckId?: string }) {
  const [db, setDb] = useState<CardDb>();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [builderDeck] = useState<DeckData | undefined>(() => (deckId === "builder" ? readHandoff() : undefined));
  const [source, setSource] = useState<"deck" | "list">("deck");
  const [pick, setPick] = useState(deckId && deckId !== "builder" ? deckId : "");
  const [text, setText] = useState("");
  const [games, setGames] = useState(8);
  const [job, setJob] = useState<AnalysisJob>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadCardDb().then(setDb).catch((e) => setError(String(e.message ?? e)));
    api
      .decks()
      .then((list) => {
        setDecks(list);
        if (!builderDeck) setPick((id) => id || list.find((d) => d.legal)?.id || "");
      })
      .catch(() => {});
    // Coming back to this page (or a reload) shows the last analysis.
    if (deckId) return;
    try {
      const saved = sessionStorage.getItem(JOB_KEY);
      const local = sessionStorage.getItem(REPORT_KEY);
      if (saved) api.analysisJob(saved).then(setJob).catch(() => {});
      else if (local) setJob({ id: LOCAL, status: "done", done: 0, total: 0, report: JSON.parse(local) as AnalysisReport });
    } catch {
      /* ignore */
    }
  }, [deckId]);
  // Leaving the page stops games running on this device.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const active = job && (job.status === "queued" || job.status === "running");
  useEffect(() => {
    if (!job || !active || job.id === LOCAL) return;
    const t = setTimeout(
      () =>
        api
          .analysisJob(job.id)
          .then(setJob)
          .catch((e) => (setError(String(e.message ?? e)), setJob(undefined))),
      1000,
    );
    return () => clearTimeout(t);
  }, [job, active]);

  /** The deck to analyse as data (a pasted list is resolved and checked by the server first). */
  const target = async (): Promise<DeckData> => {
    if (builderDeck && source === "deck" && !pick) return builderDeck;
    if (source === "deck") return api.deck(pick);
    const { deck, unresolved } = await api.importDeck(text);
    if (unresolved.length) throw new Error(`Unknown cards: ${unresolved.map((u) => u.name).join(", ")}`);
    const check = await api.checkDeck(deck);
    if (!check.legal) throw new Error(`The deck is not legal: ${check.problems.filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`);
    return deck;
  };

  const remember = (key: string, value: string) => {
    try {
      sessionStorage.removeItem(JOB_KEY);
      sessionStorage.removeItem(REPORT_KEY);
      sessionStorage.setItem(key, value);
    } catch {
      /* ignore (a report can exceed the storage quota) */
    }
  };

  const start = async () => {
    setError(undefined);
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    let deck: DeckData;
    try {
      deck = await target();
    } catch (e) {
      return setError(String((e as Error).message ?? e));
    }
    // On this device first (several threads); the server plays the games when that is not possible.
    try {
      setJob({ id: LOCAL, status: "running", done: 0, total: 0 });
      const pool = await api.analysisPool();
      const report = await analyzeInBrowser(deck, pool, games, (done, total) => !ctl.signal.aborted && setJob({ id: LOCAL, status: "running", done, total }), ctl.signal);
      setJob({ id: LOCAL, status: "done", done: report.overall.games, total: report.overall.games, report });
      remember(REPORT_KEY, JSON.stringify(report));
      return;
    } catch (e) {
      if (ctl.signal.aborted) return;
      console.warn("Analysis in the browser failed, using the server:", e);
    }
    try {
      const j = await api.analyze({ deck, games });
      setJob(j);
      remember(JOB_KEY, j.id);
    } catch (e) {
      setJob(undefined);
      setError(String((e as Error).message ?? e));
    }
  };

  if (!db) return <div className="center-msg">{error ?? "Loading cards…"}</div>;
  return (
    <div className="analysis">
      <header className="lobby-top">
        <h1>
          <a href="#/" className="brand">
            CYBERPUNK <span>TCG</span> // AI
          </a>
        </h1>
        <span className="an-title">Deck Analysis</span>
        <a className="btn" href="#/builder">
          Deck Builder
        </a>
      </header>
      {error && <div className="banner error">{error}</div>}
      <section className="panel an-input">
        <div className="mode-tabs">
          <button className={`chip ${source === "deck" ? "sel" : ""}`} onClick={() => setSource("deck")}>
            Saved deck
          </button>
          <button className={`chip ${source === "list" ? "sel" : ""}`} onClick={() => setSource("list")}>
            Paste a list
          </button>
        </div>
        {source === "deck" ? (
          builderDeck && !pick ? (
            <div className="an-builder-deck">
              <b>{builderDeck.name}</b> <span className="muted small">from the Deck Builder</span>{" "}
              <button className="btn small" onClick={() => setPick(decks.find((d) => d.legal)?.id ?? "")}>
                Choose another
              </button>
            </div>
          ) : (
            <DeckPicker decks={decks} db={db} value={pick} onChange={setPick} />
          )
        ) : (
          <textarea
            className="an-text"
            rows={8}
            placeholder={"Legends\n1 …\nMain Deck\n3 …"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="an-options">
          <span className="small muted">Games per matchup</span>
          {GAMES.map((g) => (
            <button key={g} className={`chip ${games === g ? "sel" : ""}`} onClick={() => setGames(g)}>
              {g}
            </button>
          ))}
          <button className="btn primary" disabled={!!active || (source === "list" ? !text.trim() : !pick && !builderDeck)} onClick={start}>
            {active ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {active && (
          <div className="an-progress">
            {job.status === "queued" ? (
              <span className="muted small">Waiting for other analyses{job.position ? ` (${job.position} ahead)` : ""}…</span>
            ) : (
              <>
                <span className="an-bar wide">
                  <span style={{ width: job.total ? pct(job.done / job.total) : "0%" }} />
                </span>
                <span className="small muted">
                  Playing games: {job.done}/{job.total || "…"}
                </span>
              </>
            )}
          </div>
        )}
        {job?.status === "error" && <div className="banner error">{job.error}</div>}
      </section>
      {job?.report && <Report db={db} report={job.report} decks={decks} />}
    </div>
  );
}
