import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AnalysisFinding, AnalysisJob, AnalysisReport, DeckData, DeckProfile, DeckSummary, WinRate } from "@cpai/core/protocol";
import { api, loadCardDb, type CardDb } from "../api.ts";
import { analyzeInBrowser, confirmInBrowser, metaAdviceFor, type MetaAdvice } from "../browserAnalysis.ts";
import type { Confirmation } from "../browserAnalysis.ts";
import { addedMetaDecks, metaPool } from "../metaPool.ts";
import { CardFace } from "./CardFace.tsx";
import { DeckPicker } from "./Lobby.tsx";

const JOB_KEY = "cpai.analysis.job";
/** Last report made in this browser. */
const REPORT_KEY = "cpai.analysis.report";
/** Job id of an analysis running on this device. */
const LOCAL = "local";
/** Deck Builder → analysis handoff for a deck that is not saved yet. */
export const HANDOFF_KEY = "cpai.analysis.deck";
/** Games per matchup: Easy bots play a game in a blink, Strong bots in seconds. */
const GAMES: Record<string, number[]> = { greedy: [4, 8, 16], "ismcts-sim": [2, 4, 8] };
const BOTS: { id: string; label: string }[] = [
  { id: "ismcts-sim", label: "Strong" },
  { id: "greedy", label: "Easy (fast)" },
];
/**
 * From a result against the meta decks to the ChoomBattler ladder (Core BO1, 30 days), measured on the
 * 7 meta decks (docs/BENCHMARK.md, 2026-11-10): the ladder also has weaker decks, so its win rates are
 * higher by `offset` points on average; after adding it, the estimate is off by `miss` points on average.
 */
export const LADDER: Record<string, { offset: number; miss: number }> = { greedy: { offset: 9, miss: 10 }, "ismcts-sim": { offset: 7, miss: 4 } };

/** The ladder win rate of a list from the meta pool (its source note), if the analysed deck is one. */
function ladderOf(deck: DeckData, pool: DeckData[]): { rate: number; share: number | null } | null {
  const key = (d: DeckData) => JSON.stringify([[...d.legends].sort(), Object.entries(d.main).sort(([a], [b]) => a.localeCompare(b))]);
  const ref = pool.find((d) => d.id === deck.id || key(d) === key(deck)) as (DeckData & { source?: { note?: string } }) | undefined;
  const note = ref?.source?.note ?? "";
  const rate = /([\d.]+)% win rate/.exec(note);
  if (!rate) return null;
  const share = /([\d.]+)% of the field/.exec(note);
  return { rate: Number(rate[1]) / 100, share: share ? Number(share[1]) / 100 : null };
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Games per opponent for the check with Strong bots (seconds per game on this device). */
const VERIFY_PER = 4;

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
export function Thumb({ db, slug, size = "xs" }: { db: CardDb; slug: string; size?: "xs" | "sm" }) {
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

export function Rate({ r }: { r: WinRate }) {
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

/** The report in a few sentences: the total, the best and the worst matchups, the ladder, how far to trust it. */
function Summary({ report, ladder, bot, field }: { report: AnalysisReport; ladder: { rate: number; share: number | null } | null; bot: string; field: "meta" | "all" }) {
  const cal = LADDER[bot];
  // Only against the meta decks: that is what the ladder offset was measured on.
  const estimate = cal && field === "meta" ? Math.min(0.99, report.overall.rate + cal.offset / 100) : null;
  const sorted = [...report.matchups].sort((a, b) => b.rate - a.rate);
  const best = sorted.slice(0, 2);
  const worst = sorted.slice(-2).reverse();
  const list = (ms: typeof sorted) => ms.map((m) => `${m.deckName} (${pct(m.rate)})`).join(" and ");
  return (
    <>
      <p className="doc-verdict">
        This deck wins <b>{pct(report.overall.rate)}</b> of its games against these {report.matchups.length} decks.
        {sorted.length >= 4 && (
          <>
            {" "}
            Best against {list(best)}; worst against {list(worst)}.
          </>
        )}
      </p>
      {estimate !== null && (
        <p className="small">
          Estimated ladder win rate: <b>about {pct(estimate)}</b>
          {ladder ? (
            <>
              {" "}
              · on the ChoomBattler ladder this list wins <b>{pct(ladder.rate)}</b>
              {ladder.share !== null ? ` (${pct(ladder.share)} of the games)` : ""}
            </>
          ) : null}
          . The ladder has weaker decks too, so its win rates are higher than here, where only the top decks play each other
          (+{cal!.offset} points on average); 50% here means as strong as the average top deck.
        </p>
      )}
      {estimate === null && ladder && (
        <p className="small">
          On the ChoomBattler ladder this list wins <b>{pct(ladder.rate)}</b>: that is against everyone who plays, weaker decks too.
        </p>
      )}
      <p className="muted small">
        {report.bot} bots on both sides.{" "}
        {bot === "greedy"
          ? `Easy bots misplay decks that need skill (Gear, Programs with conditions): on the meta decks their estimate is off by ${LADDER.greedy!.miss} points on average, Strong bots' by ${LADDER["ismcts-sim"]!.miss}. Use Strong bots for a verdict.`
          : `On the meta decks this estimate is off by ${LADDER["ismcts-sim"]!.miss} points on average.`}{" "}
        With {report.gamesPerMatchup} games per deck one matchup can be off by a lot; the total is steadier.
      </p>
    </>
  );
}

function Report({ db, report, decks, ladder, bot, field }: { db: CardDb; report: AnalysisReport; decks: DeckSummary[]; ladder: { rate: number; share: number | null } | null; bot: string; field: "meta" | "all" }) {
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
          <Summary report={report} ladder={ladder} bot={report.bot.startsWith("Strong") ? "ismcts-sim" : report.bot === "Easy" ? "greedy" : bot} field={field} />
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

function Swap({ db, out, inn, copies }: { db: CardDb; out: string; inn: string; copies: number }) {
  const name = (s: string) => db.bySlug.get(s)?.displayName ?? s;
  return (
    <span className="an-swap">
      <Thumb db={db} slug={out} />
      <span className="small">
        −{copies} {name(out)}
      </span>
      <span className="muted">→</span>
      <Thumb db={db} slug={inn} />
      <span className="small">
        +{copies} {name(inn)}
      </span>
    </span>
  );
}

const lift = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} pts`;
const liftClass = (x: number) => (x >= 1 ? "up" : x <= -1 ? "down" : "muted");

/** "better", "worse" or "within chance" for two win rates on n games each (two standard errors). */
function difference(before: number, after: number, n: number): "better" | "worse" | "same" {
  const se = Math.sqrt((before * (1 - before) + after * (1 - after)) / Math.max(1, n));
  if (after - before > 2 * se) return "better";
  if (before - after > 2 * se) return "worse";
  return "same";
}

/** Deck Doctor from the ladder: what winning lists of this archetype play, card by card. */
function LadderDoctorView({ db, deck, advice, keep, onKeep }: { db: CardDb; deck: DeckData; advice: MetaAdvice; keep: string[]; onKeep: (slug: string) => void }) {
  const [saved, setSaved] = useState<DeckSummary>();
  const [error, setError] = useState<string>();
  const [check, setCheck] = useState<{ done: number; total: number } | Confirmation>();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const name = (slug: string) => db.bySlug.get(slug)?.displayName ?? slug;
  const a = advice.archetype;
  const changed = advice.swaps.length > 0;
  const save = async () => {
    setError(undefined);
    try {
      setSaved(await api.saveDeck({ ...advice.improved, id: `user-${Date.now().toString(36)}`, name: `${deck.name} (ladder)` }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };
  const verify = async () => {
    setError(undefined);
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setCheck({ done: 0, total: 0 });
    try {
      const opponents = metaPool(await api.analysisPool()).filter((d) => d.id !== deck.id);
      setCheck(await confirmInBrowser(deck, advice.improved, opponents, VERIFY_PER, "ismcts-sim", (done, total) => !ctl.signal.aborted && setCheck({ done, total }), ctl.signal));
    } catch (e) {
      if (ctl.signal.aborted) return;
      setCheck(undefined);
      setError(String((e as Error).message ?? e));
    }
  };
  if (!a)
    return (
      <section className="panel an-doctor">
        <h2>Deck Doctor: {deck.name}</h2>
        <p className="doc-verdict">The ladder data has no decks with these Legends' colours yet, so there is nothing to compare this deck with.</p>
      </section>
    );
  return (
    <section className="panel an-doctor">
      <h2>Deck Doctor: {deck.name}</h2>
      <p className="doc-verdict">
        {a.name} on the ChoomBattler ladder: <b>{a.winRate}%</b> win rate over {a.games} games ({a.share}% of the field, last 30 days).{" "}
        {changed ? `${advice.swaps.length === 1 ? "1 change" : `${advice.swaps.length} changes`} from what the winning lists play:` : "Your deck already plays what the winning lists of this archetype play."}
      </p>
      <p className="muted small">
        Popularity: the share of these lists that play a card. Lift: how many points more (or fewer) the lists with the card win. Numbers from real players' games; a lift over few
        games is less sure.
      </p>
      {error && <div className="banner error">{error}</div>}
      {changed && (
        <ul className="an-findings">
          {advice.swaps.map((s) => (
            <li key={s.out} className="doc-swap">
              <Swap db={db} out={s.out} inn={s.in} copies={s.copies} />
              <div className="small">
                <div>
                  <span className="down">−</span> {name(s.out)}:{" "}
                  {s.outStat ? (
                    <>
                      in {s.outStat.popularity}% of the lists, <span className={liftClass(s.outStat.lift)}>{lift(s.outStat.lift)}</span>
                    </>
                  ) : (
                    "not among the cards these lists play"
                  )}
                </div>
                <div>
                  <span className="up">+</span> {name(s.in)}: in {s.inStat.popularity}% of the lists ({s.inStat.copies} copies on average),{" "}
                  <span className={liftClass(s.inStat.lift)}>{lift(s.inStat.lift)}</span> over {s.inStat.games} games
                </div>
              </div>
              <button className="btn small" title={`Never cut ${name(s.out)}`} onClick={() => onKeep(s.out)}>
                Keep {name(s.out).split(":")[0]}
              </button>
            </li>
          ))}
        </ul>
      )}
      {advice.legendSwaps.length > 0 && (
        <>
          <h3>Legends</h3>
          <ul className="an-findings">
            {advice.legendSwaps.map((l) => (
              <li key={l.out}>
                <Swap db={db} out={l.out} inn={l.in} copies={1} />
                <span className="small">
                  {name(l.out)} {l.outStat ? <span className={liftClass(l.outStat.lift)}>{lift(l.outStat.lift)}</span> : "(rarely played here)"} → {name(l.in)}{" "}
                  <span className={liftClass(l.inStat.lift)}>{lift(l.inStat.lift)}</span> in {l.inStat.popularity}% of the lists
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {changed && (
        <div className="an-counter-actions">
          {saved ? (
            <a className="btn small" href={`#/builder/${saved.id}`}>
              Open in Deck Builder
            </a>
          ) : (
            <button className="btn small primary" onClick={save}>
              Save as a new deck
            </button>
          )}
          {!check || "before" in check ? (
            <button className="btn small" onClick={verify}>
              Check with Strong bots
            </button>
          ) : (
            <span className="an-progress">
              <span className="an-bar wide">
                <span style={{ width: check.total ? pct(check.done / check.total) : "0%" }} />
              </span>
              <span className="small muted">
                Strong bots: {check.done}/{check.total || "…"} games
              </span>
            </span>
          )}
        </div>
      )}
      {check && "before" in check && (
        <p className="doc-verdict">
          Strong bots against the meta decks: <b>{pct(check.before)}</b> → <b className={check.after > check.before ? "up" : check.after < check.before ? "down" : ""}>{pct(check.after)}</b> on{" "}
          {check.games} games each —{" "}
          {difference(check.before, check.after, check.games) === "better"
            ? "the changes help."
            : difference(check.before, check.after, check.games) === "worse"
              ? "worse with the changes here."
              : "within chance on this many games; the ladder numbers above come from far more games."}
        </p>
      )}
      <h3>Your cards on the ladder</h3>
      <table className="an-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Yours</th>
            <th>Usual</th>
            <th>Popularity</th>
            <th>Lift</th>
          </tr>
        </thead>
        <tbody>
          {advice.cards.map((c) => (
            <tr key={c.slug}>
              <td>
                <span className="an-swap">
                  <Thumb db={db} slug={c.slug} />
                  <span className="small">
                    {name(c.slug)}
                    {keep.includes(c.slug) ? <span className="muted"> · kept</span> : null}
                  </span>
                </span>
              </td>
              <td>{c.copies}</td>
              <td className="muted">{c.stat ? c.stat.copies : "–"}</td>
              <td>{c.stat ? `${c.stat.popularity}%` : <span className="muted">not in the top cards</span>}</td>
              <td className={c.stat ? liftClass(c.stat.lift) : "muted"}>{c.stat ? lift(c.stat.lift) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Analysis({ deckId }: { deckId?: string }) {
  const [db, setDb] = useState<CardDb>();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [builderDeck] = useState<DeckData | undefined>(() => (deckId === "builder" ? readHandoff() : undefined));
  const [source, setSource] = useState<"deck" | "list">("deck");
  const [pick, setPick] = useState(deckId && deckId !== "builder" ? deckId : "");
  const [text, setText] = useState("");
  const [bot, setBot] = useState("ismcts-sim");
  const [games, setGames] = useState(4);
  /** The pool the last analysis played (for the ladder win rate of a meta list). */
  const [lastPool, setLastPool] = useState<DeckData[]>([]);
  const [lastBot, setLastBot] = useState("greedy");
  const [lastField, setLastField] = useState<"meta" | "all">("meta");
  const [job, setJob] = useState<AnalysisJob>();
  const [error, setError] = useState<string>();
  const [doctor, setDoctor] = useState<"running" | { deck: DeckData; advice: MetaAdvice; keep: string[] }>();

  const [against, setAgainst] = useState<"meta" | "all">("meta");

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
      const all = await api.analysisPool();
      const meta = metaPool(all);
      const pool = against === "meta" && meta.length >= 3 ? meta : [...all, ...addedMetaDecks()];
      setLastPool(all);
      setLastBot(bot);
      setLastField(pool === meta ? "meta" : "all");
      const report = await analyzeInBrowser(deck, pool, games, (done, total) => !ctl.signal.aborted && setJob({ id: LOCAL, status: "running", done, total }), ctl.signal, bot);
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

  /** Deck Doctor: the deck against what the ladder's winning lists of its archetype play (no games needed). */
  const runDoctor = async (keep: string[] = []) => {
    setError(undefined);
    let deck: DeckData;
    try {
      deck = await target();
    } catch (e) {
      return setError(String((e as Error).message ?? e));
    }
    setDoctor("running");
    try {
      setDoctor({ deck, advice: await metaAdviceFor(deck, keep), keep });
    } catch (e) {
      setDoctor(undefined);
      setError(String((e as Error).message ?? e));
    }
  };
  const doctoring = doctor === "running";

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
        <span className="lobby-links">
          <a className="btn" href="#/lab">
            Deck Lab
          </a>
          <a className="btn" href="#/builder">
            Deck Builder
          </a>
        </span>
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
          <span className="small muted">Opponents</span>
          <button className={`chip ${against === "meta" ? "sel" : ""}`} disabled={doctoring || !!active} onClick={() => setAgainst("meta")}>
            Meta decks
          </button>
          <button className={`chip ${against === "all" ? "sel" : ""}`} disabled={doctoring || !!active} onClick={() => setAgainst("all")}>
            All decks
          </button>
        </div>
        <div className="an-options">
          <span className="small muted">Bots</span>
          {BOTS.map((b) => (
            <button
              key={b.id}
              className={`chip ${bot === b.id ? "sel" : ""}`}
              disabled={!!active}
              onClick={() => {
                setBot(b.id);
                setGames(b.id === "greedy" ? 8 : 4);
              }}
            >
              {b.label}
            </button>
          ))}
          <span className="an-sep" />
          <span className="small muted">Games per matchup</span>
          {GAMES[bot]!.map((g) => (
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
        <div className="an-options">
          <span className="small muted">Deck Doctor: your deck against the ladder's winning lists</span>
          <button className="btn primary" disabled={doctoring || (source === "list" ? !text.trim() : !pick && !builderDeck)} onClick={() => void runDoctor([])}>
            {doctoring ? "Reading the ladder…" : "Find improvements"}
          </button>
        </div>
      </section>
      {doctor && doctor !== "running" && (
        <LadderDoctorView
          key={JSON.stringify(doctor.keep)}
          db={db}
          deck={doctor.deck}
          advice={doctor.advice}
          keep={doctor.keep}
          onKeep={(slug) => void runDoctor([...doctor.keep, slug])}
        />
      )}
      {job?.report && <Report db={db} report={job.report} decks={decks} ladder={ladderOf(job.report.deck as DeckData, lastPool)} bot={lastBot} field={lastField} />}
    </div>
  );
}
