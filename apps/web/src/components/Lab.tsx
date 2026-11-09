import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckData, DeckSummary } from "@cpai/core/protocol";
import { api, loadCardDb, type CardDb } from "../api.ts";
import { checkInBrowser, labInBrowser, type Checked, type LabOptions, type LabReport, type Matchup } from "../browserAnalysis.ts";
import { addMetaDeck, addedMetaDecks, metaPool, removeMetaDeck } from "../metaPool.ts";
import { Rate, Thumb } from "./Analysis.tsx";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SIZES: Record<"Quick" | "Normal" | "Deep", Partial<LabOptions>> = {
  Quick: { generations: 3, population: 16, survivors: 6, screen: 32, final: 120 },
  Normal: {},
  Deep: { generations: 12, population: 32, survivors: 10, screen: 64, final: 480 },
};
/** Games per opponent for the check with the Strong simulation bot. */
const CHECK_PER = 4;
const TYPE_ORDER = ["unit", "gear", "program"] as const;
const TYPE_LABEL: Record<string, string> = { unit: "Units", gear: "Gear", program: "Programs" };

type State = { status: "running"; text: string; done: number; total: number } | { status: "done"; report: LabReport<DeckData> };

function DeckList({ db, deck }: { db: CardDb; deck: DeckData }) {
  const groups = TYPE_ORDER.map((t) => ({
    t,
    cards: Object.entries(deck.main)
      .filter(([s]) => db.bySlug.get(s)?.type === t)
      .sort(([a], [b]) => (db.bySlug.get(a)?.cost ?? 0) - (db.bySlug.get(b)?.cost ?? 0)),
  })).filter((g) => g.cards.length);
  return (
    <div className="lab-list">
      {groups.map((g) => (
        <div key={g.t}>
          <div className="small muted">
            {TYPE_LABEL[g.t]} ({g.cards.reduce((s, [, n]) => s + n, 0)})
          </div>
          <div className="lab-cards">
            {g.cards.map(([s, n]) => (
              <span key={s} className="lab-card">
                <Thumb db={db} slug={s} />
                <span className="small">
                  {n} × {db.bySlug.get(s)?.displayName ?? s}
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Matchups({ db, list }: { db: CardDb; list: Matchup[] }) {
  return (
    <table className="an-table an-matchups">
      <tbody>
        {[...list]
          .sort((a, b) => b.rate - a.rate)
          .map((m) => (
            <tr key={m.opponent}>
              <td>
                <span className="an-cards">
                  {m.legends.map((s) => (
                    <Thumb key={s} db={db} slug={s} />
                  ))}
                </span>
              </td>
              <td className="an-mname">{m.name}</td>
              <td>
                <Rate r={m} />
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function verdict(list: Matchup[]) {
  const beaten = list.filter((m) => m.ci[0] > 0.5).length;
  const ahead = list.filter((m) => m.rate > 0.5).length;
  return { beaten, ahead, all: list.length, worst: [...list].sort((a, b) => a.rate - b.rate)[0] };
}

function LabDeck({ db, entry, rank, check }: { db: CardDb; entry: LabReport<DeckData>["finalists"][number]; rank: number; check?: Checked }) {
  const [saved, setSaved] = useState<DeckSummary>();
  const [error, setError] = useState<string>();
  const v = verdict(entry.matchups);
  const strong = entry.matchups.filter((m) => m.rate >= 0.55).sort((a, b) => b.rate - a.rate);
  const weak = entry.matchups.filter((m) => m.rate < 0.45).sort((a, b) => a.rate - b.rate);
  const save = async () => {
    setError(undefined);
    try {
      setSaved(await api.saveDeck({ ...entry.deck, id: `user-${Date.now().toString(36)}` }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };
  return (
    <section className="panel lab-deck">
      <div className="an-head">
        <div className="an-cards">
          {entry.deck.legends.map((s) => (
            <Thumb key={s} db={db} slug={s} size="sm" />
          ))}
        </div>
        <div>
          <h2>
            #{rank} {entry.deck.name}
          </h2>
          <div className="an-overall">
            <Rate r={entry} />
            <span className="muted small">
              {entry.games} games against {entry.matchups.length} decks · Easy bots on both sides
            </span>
          </div>
          {check && (
            <div className="an-overall">
              <span className="small">Strong bots</span>
              <Rate r={check} />
              <span className="muted small">{check.games} games</span>
            </div>
          )}
          <div className={`lab-verdict ${v.beaten === v.all ? "up" : ""}`}>
            {v.beaten === v.all
              ? "Beats every deck in the pool"
              : `Wins more than half the games against ${v.ahead} of ${v.all} decks (clearly against ${v.beaten})`}
            {v.worst && ` · weakest matchup: ${pct(v.worst.rate)} vs ${v.worst.name}`}
          </div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="an-grid">
        <div>
          <h3>Strong against</h3>
          {strong.length ? (
            <ul className="an-findings">
              {strong.map((m) => (
                <li key={m.opponent}>
                  <span>{m.name}</span>
                  <b className="up">{pct(m.rate)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No matchup at 55% or more.</p>
          )}
          <h3>Loses to</h3>
          {weak.length ? (
            <ul className="an-findings">
              {weak.map((m) => (
                <li key={m.opponent}>
                  <span>{m.name}</span>
                  <b className="down">{pct(m.rate)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No matchup below 45%.</p>
          )}
        </div>
        <div>
          <h3>Main Deck</h3>
          <DeckList db={db} deck={entry.deck} />
        </div>
      </div>
      <details className="an-doc-round">
        <summary>All matchups</summary>
        <Matchups db={db} list={entry.matchups} />
      </details>
      <div className="an-counter-actions">
        {saved ? (
          <>
            <a className="btn small" href={`#/builder/${saved.id}`}>
              Open in Deck Builder
            </a>
            <a className="btn small" href={`#/analyze/${saved.id}`}>
              Deck Analysis
            </a>
          </>
        ) : (
          <button className="btn small primary" onClick={save}>
            Save as a new deck
          </button>
        )}
      </div>
    </section>
  );
}

function PoolEditor({ db, builtIn, onChange }: { db: CardDb; builtIn: DeckData[]; onChange: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const added = new Set(addedMetaDecks().map((d) => d.id));
  const list = metaPool(builtIn);
  const add = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const { deck, unresolved } = await api.importDeck(text);
      if (unresolved.length) throw new Error(`Unknown cards: ${unresolved.map((u) => u.name).join(", ")}`);
      const check = await api.checkDeck(deck);
      if (!check.legal) throw new Error(`The deck is not legal: ${check.problems.filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`);
      addMetaDeck(deck);
      setText("");
      onChange();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="panel lab-pool">
      <summary>Meta pool ({list.length} decks)</summary>
      <ul className="an-findings">
        {list.map((d) => (
          <li key={d.id}>
            <span className="an-swap">
              <span className="an-cards">
                {d.legends.map((s) => (
                  <Thumb key={s} db={db} slug={s} />
                ))}
              </span>
              <span className="small">{d.name}</span>
            </span>
            {added.has(d.id) && (
              <button className="btn small" onClick={() => (removeMetaDeck(d.id), onChange())}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="banner error">{error}</div>}
      <textarea className="an-text" rows={5} placeholder={"Add a deck to the pool\nLegends\n1 …\nMain Deck\n3 …"} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn small" disabled={busy || !text.trim()} onClick={add}>
        Add to the meta pool
      </button>
    </details>
  );
}

export function Lab() {
  const [db, setDb] = useState<CardDb>();
  const [builtIn, setBuiltIn] = useState<DeckData[]>([]);
  const [poolVersion, setPoolVersion] = useState(0);
  const [against, setAgainst] = useState<"meta" | "all">("meta");
  const [objective, setObjective] = useState<LabOptions["objective"]>("average");
  const [size, setSize] = useState<keyof typeof SIZES>("Normal");
  const [keep, setKeep] = useState("");
  const [state, setState] = useState<State>();
  const [error, setError] = useState<string>();
  const [check, setCheck] = useState<{ done: number; total: number } | Checked[]>();
  const abort = useRef<AbortController | null>(null);
  const checkAbort = useRef<AbortController | null>(null);
  useEffect(() => () => (abort.current?.abort(), checkAbort.current?.abort()), []);
  useEffect(() => {
    loadCardDb().then(setDb).catch((e) => setError(String(e.message ?? e)));
    api
      .analysisPool()
      .then(setBuiltIn)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  const pool = useMemo(() => {
    void poolVersion;
    const meta = metaPool(builtIn);
    return against === "meta" && meta.length >= 3 ? meta : [...builtIn, ...addedMetaDecks()];
  }, [builtIn, against, poolVersion]);
  const legends = useMemo(() => (db ? [...db.bySlug.values()].filter((c) => c.type === "legend").sort((a, b) => a.displayName.localeCompare(b.displayName)) : []), [db]);
  const running = state?.status === "running";

  const start = async () => {
    setError(undefined);
    setCheck(undefined);
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setState({ status: "running", text: "Starting", done: 0, total: 1 });
    try {
      const report = await labInBrowser(pool, { ...SIZES[size], objective, keep: keep ? [keep] : [] }, (text, done, total) => !ctl.signal.aborted && setState({ status: "running", text, done, total }), ctl.signal);
      setState({ status: "done", report });
    } catch (e) {
      if (ctl.signal.aborted) return;
      setState(undefined);
      setError(String((e as Error).message ?? e));
    }
  };
  const stop = () => {
    abort.current?.abort();
    setState(undefined);
  };
  const runCheck = async (report: LabReport<DeckData>) => {
    checkAbort.current?.abort();
    const ctl = (checkAbort.current = new AbortController());
    const decks = [report.finalists[0]?.deck, report.bestPool?.deck].filter((d): d is DeckData => !!d);
    setCheck({ done: 0, total: 0 });
    try {
      setCheck(await checkInBrowser(decks, report.opponents, CHECK_PER, "ismcts-sim", (done, total) => !ctl.signal.aborted && setCheck({ done, total }), ctl.signal));
    } catch (e) {
      if (ctl.signal.aborted) return;
      setCheck(undefined);
      setError(String((e as Error).message ?? e));
    }
  };

  if (!db) return <div className="center-msg">{error ?? "Loading cards…"}</div>;
  const report = state?.status === "done" ? state.report : undefined;
  const checked = Array.isArray(check) ? check : undefined;
  const progress = check && !Array.isArray(check) ? check : undefined;
  return (
    <div className="analysis">
      <header className="lobby-top">
        <h1>
          <a href="#/" className="brand">
            CYBERPUNK <span>TCG</span> // AI
          </a>
        </h1>
        <span className="an-title">Deck Lab</span>
        <span className="lobby-links">
          <a className="btn" href="#/analyze">
            Deck Analysis
          </a>
          <a className="btn" href="#/builder">
            Deck Builder
          </a>
        </span>
      </header>
      {error && <div className="banner error">{error}</div>}
      <section className="panel an-input">
        <div className="an-options">
          <span className="small muted">Opponents</span>
          <button className={`chip ${against === "meta" ? "sel" : ""}`} disabled={running} onClick={() => setAgainst("meta")}>
            Meta decks ({metaPool(builtIn).length})
          </button>
          <button className={`chip ${against === "all" ? "sel" : ""}`} disabled={running} onClick={() => setAgainst("all")}>
            All decks ({builtIn.length + addedMetaDecks().length})
          </button>
        </div>
        <div className="an-options">
          <span className="small muted">Goal</span>
          <button className={`chip ${objective === "average" ? "sel" : ""}`} disabled={running} onClick={() => setObjective("average")}>
            Best average
          </button>
          <button className={`chip ${objective === "worst" ? "sel" : ""}`} disabled={running} onClick={() => setObjective("worst")}>
            Beat every deck
          </button>
          <span className="an-sep" />
          {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((s) => (
            <button key={s} className={`chip ${size === s ? "sel" : ""}`} disabled={running} onClick={() => setSize(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="an-options">
          <span className="small muted">Legend</span>
          <select className="lab-select" value={keep} disabled={running} onChange={(e) => setKeep(e.target.value)}>
            <option value="">Any Legends</option>
            {legends.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.displayName}
              </option>
            ))}
          </select>
          {running ? (
            <button className="btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" disabled={pool.length < 2} onClick={start}>
              Create decks
            </button>
          )}
        </div>
        {state?.status === "running" && (
          <div className="an-progress">
            <span className="an-bar wide">
              <span style={{ width: state.total ? pct(Math.min(1, state.done / state.total)) : "0%" }} />
            </span>
            <span className="small muted">
              {state.text} · {state.done}/{state.total} games
            </span>
          </div>
        )}
      </section>
      <PoolEditor db={db} builtIn={builtIn} onChange={() => setPoolVersion((v) => v + 1)} />
      {report && (
        <>
          <section className="panel an-doctor">
            <div className="an-overall">
              <span>
                {report.finalists.length} new decks · {report.history.at(-1)?.decks ?? 0} decks tested · {report.games} games · {(report.ms / 1000).toFixed(0)} s
              </span>
            </div>
            <div className="lab-history">
              {report.history.map((h) => (
                <span key={h.generation} className="small muted">
                  Generation {h.generation}: best {pct(h.best)}
                </span>
              ))}
            </div>
            {report.bestPool && (
              <div className="an-overall">
                <span className="small">Best pool deck: {report.bestPool.deck.name}</span>
                <Rate r={report.bestPool} />
                {checked?.[1] && (
                  <>
                    <span className="small">Strong bots</span>
                    <Rate r={checked[1]} />
                  </>
                )}
              </div>
            )}
            <div className="an-counter-actions">
              {!progress ? (
                <button className="btn small" onClick={() => runCheck(report)}>
                  Check with Strong bots
                </button>
              ) : (
                <span className="an-progress">
                  <span className="an-bar wide">
                    <span style={{ width: progress.total ? pct(progress.done / progress.total) : "0%" }} />
                  </span>
                  <span className="small muted">
                    Strong bots: {progress.done}/{progress.total || "…"} games
                  </span>
                </span>
              )}
            </div>
          </section>
          {report.finalists.map((e, i) => (
            <LabDeck key={e.deck.id} db={db} entry={e} rank={i + 1} check={i === 0 ? checked?.[0] : undefined} />
          ))}
        </>
      )}
    </div>
  );
}
