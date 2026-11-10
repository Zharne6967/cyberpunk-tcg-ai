import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckData, DeckSummary } from "@cpai/core/protocol";
import { api, loadCardDb, type CardDb } from "../api.ts";
import { checkInBrowser, metaBuilds, metaList, type ArchetypeSummary, type Checked, type MetaBuild, type Matchup } from "../browserAnalysis.ts";
import { addMetaDeck, addedMetaDecks, metaPool, removeMetaDeck } from "../metaPool.ts";
import { LADDER, Rate, Thumb } from "./Analysis.tsx";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const lift = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} pts`;
const liftClass = (x: number) => (x >= 1 ? "up" : x <= -1 ? "down" : "muted");
/** Games per opponent for the check with the Strong simulation bot. */
const CHECK_PER = 4;
const TYPE_ORDER = ["unit", "gear", "program"] as const;
const TYPE_LABEL: Record<string, string> = { unit: "Units", gear: "Gear", program: "Programs" };
const STRONG = LADDER["ismcts-sim"]!;

/** Units, sellable cards (every Gear and Program, almost no Unit) and 5+ cost cards of a deck. */
function DeckShapeLine({ db, deck }: { db: CardDb; deck: DeckData }) {
  let size = 0, units = 0, sell = 0, heavy = 0;
  for (const [slug, n] of Object.entries(deck.main)) {
    const c = db.bySlug.get(slug);
    if (!c) continue;
    size += n;
    if (c.type === "unit") units += n;
    if (c.sellTag) sell += n;
    if ((c.cost ?? 0) >= 5) heavy += n;
  }
  return (
    <div className="muted small">
      {size} cards · {units} Units · {size - units} Gear and Programs · {size ? Math.round((sell / size) * 100) : 0}% sellable · {heavy} costing 5+
    </div>
  );
}

/** The Main Deck by card type, each card with why it is there: its numbers on the ladder. */
function LadderList({ db, build }: { db: CardDb; build: MetaBuild }) {
  const groups = TYPE_ORDER.map((t) => ({
    t,
    cards: build.cards.filter((c) => db.bySlug.get(c.slug)?.type === t).sort((a, b) => (db.bySlug.get(a.slug)?.cost ?? 0) - (db.bySlug.get(b.slug)?.cost ?? 0)),
  })).filter((g) => g.cards.length);
  return (
    <div className="lab-list">
      {groups.map((g) => (
        <div key={g.t}>
          <div className="small muted">
            {TYPE_LABEL[g.t]} ({g.cards.reduce((s, c) => s + c.copies, 0)})
          </div>
          <div className="lab-cards lab-ladder">
            {g.cards.map((c) => (
              <span key={c.slug} className="lab-card">
                <Thumb db={db} slug={c.slug} />
                <span className="small">
                  {c.copies} × {db.bySlug.get(c.slug)?.displayName ?? c.slug}
                  <span className="lab-stat">
                    {c.stat ? (
                      <>
                        {" "}
                        in {c.stat.popularity}% · <span className={liftClass(c.stat.lift)}>{lift(c.stat.lift)}</span>
                      </>
                    ) : (
                      <span className="muted"> to fill the deck</span>
                    )}
                  </span>
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

type Check = { status: "running"; done: number; total: number } | { status: "done"; result: Checked };

/** One deck built from the ladder: Legends, cards with their numbers, and the check with Strong bots. */
function LadderDeck({
  db,
  build,
  rank,
  check,
  busy,
  onCheck,
}: {
  db: CardDb;
  build: MetaBuild;
  rank: number;
  check?: Check;
  busy: boolean;
  onCheck: () => void;
}) {
  const [saved, setSaved] = useState<DeckSummary>();
  const [error, setError] = useState<string>();
  const a = build.archetype;
  const name = (slug: string) => db.bySlug.get(slug)?.displayName ?? slug;
  const result = check?.status === "done" ? check.result : undefined;
  const strong = result ? result.matchups.filter((m) => m.rate >= 0.55).sort((x, y) => y.rate - x.rate) : [];
  const weak = result ? result.matchups.filter((m) => m.rate < 0.45).sort((x, y) => x.rate - y.rate) : [];
  const save = async () => {
    setError(undefined);
    try {
      setSaved(await api.saveDeck({ ...build.deck, id: `user-${Date.now().toString(36)}` }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };
  return (
    <section className="panel lab-deck" id={`lab-${a.key}`}>
      <div className="an-head">
        <div className="an-cards">
          {build.deck.legends.map((s) => (
            <Thumb key={s} db={db} slug={s} size="sm" />
          ))}
        </div>
        <div>
          <h2>
            #{rank} {a.name}: {build.deck.name}
          </h2>
          <div className="lab-verdict">
            Ladder: <b>{a.winRate}%</b> win rate over {a.games} games · {a.share}% of the field
          </div>
          <div className="small">
            {build.deck.legends.map((s, i) => {
              const l = build.legends.find((x) => x.slug === s);
              return (
                <span key={s}>
                  {i ? " · " : ""}
                  {name(s)}
                  {l ? (
                    <>
                      {" "}
                      (in {l.popularity}%, <span className={liftClass(l.lift)}>{lift(l.lift)}</span>)
                    </>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div>
        <h3>Main Deck</h3>
        <DeckShapeLine db={db} deck={build.deck} />
        <LadderList db={db} build={build} />
      </div>
      {result && (
        <>
          <div className="an-overall">
            <span className="small">Strong bots against the meta decks</span>
            <Rate r={result} />
            <span className="muted small">
              ≈ {pct(Math.min(1, result.rate + STRONG.offset / 100))} on the ladder (±{STRONG.miss} pts)
            </span>
          </div>
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
            </div>
            <div>
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
          </div>
          <details className="an-doc-round">
            <summary>All matchups</summary>
            <Matchups db={db} list={result.matchups} />
          </details>
        </>
      )}
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
        {check?.status === "running" ? (
          <span className="an-progress">
            <span className="an-bar wide">
              <span style={{ width: check.total ? pct(check.done / check.total) : "0%" }} />
            </span>
            <span className="small muted">
              Strong bots: {check.done}/{check.total || "…"} games
            </span>
          </span>
        ) : (
          <button className="btn small" disabled={busy} onClick={onCheck}>
            {result ? "Check again" : "Check with Strong bots"}
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
  const [meta, setMeta] = useState<{ source: string; date: string; archetypes: ArchetypeSummary[] }>();
  const [builds, setBuilds] = useState<MetaBuild[]>();
  const [legend, setLegend] = useState("");
  const [order, setOrder] = useState<"winRate" | "games">("winRate");
  const [error, setError] = useState<string>();
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    loadCardDb().then(setDb).catch((e) => setError(String(e.message ?? e)));
    api
      .analysisPool()
      .then(setBuiltIn)
      .catch((e) => setError(String(e.message ?? e)));
    metaList()
      .then(setMeta)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    setBuilds(undefined);
    let live = true;
    metaBuilds(undefined, legend ? [legend] : undefined)
      .then((b) => live && setBuilds(b))
      .catch((e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [legend]);
  const pool = useMemo(() => {
    void poolVersion;
    const m = metaPool(builtIn);
    return m.length >= 3 ? m : [...builtIn, ...addedMetaDecks()];
  }, [builtIn, poolVersion]);
  const legends = useMemo(() => (db ? [...db.bySlug.values()].filter((c) => c.type === "legend").sort((a, b) => a.displayName.localeCompare(b.displayName)) : []), [db]);
  const sorted = useMemo(
    () => [...(builds ?? [])].sort((x, y) => (order === "winRate" ? y.archetype.winRate - x.archetype.winRate : y.archetype.games - x.archetype.games)),
    [builds, order],
  );
  const running = Object.values(checks).some((c) => c.status === "running");

  const runCheck = async (build: MetaBuild) => {
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    const id = build.deck.id;
    setChecks((c) => ({ ...c, [id]: { status: "running", done: 0, total: 0 } }));
    try {
      const [result] = await checkInBrowser(
        [build.deck],
        pool,
        CHECK_PER,
        "ismcts-sim",
        (done, total) => !ctl.signal.aborted && setChecks((c) => ({ ...c, [id]: { status: "running", done, total } })),
        ctl.signal,
      );
      setChecks((c) => ({ ...c, [id]: { status: "done", result: result! } }));
    } catch (e) {
      setChecks((c) => {
        const { [id]: _, ...rest } = c;
        return rest;
      });
      if (!ctl.signal.aborted) setError(String((e as Error).message ?? e));
    }
  };
  const stop = () => {
    abort.current?.abort();
    setChecks((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v.status === "done")));
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
        <p className="small">
          The best deck for every colour archetype, built from real games: the Legends and cards that the winning lists play, each at its usual number of copies, with
          13–17 Units like the meta lists.
          {meta && <span className="muted"> Data: ChoomBattler ranked games, Core BO1, last 30 days (read on {meta.date}).</span>}
        </p>
        <p className="muted small">
          In: the share of the archetype's lists that play the card. The points: how much more (or less) those lists win. "Check with Strong bots" plays the deck against
          the meta decks to show what it beats and what it loses to.
        </p>
        <div className="an-options">
          <span className="small muted">Build around</span>
          <select className="lab-select" value={legend} onChange={(e) => setLegend(e.target.value)}>
            <option value="">Any Legends</option>
            {legends.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.displayName}
              </option>
            ))}
          </select>
          <span className="an-sep" />
          <span className="small muted">Order</span>
          <button className={`chip ${order === "winRate" ? "sel" : ""}`} onClick={() => setOrder("winRate")}>
            Win rate
          </button>
          <button className={`chip ${order === "games" ? "sel" : ""}`} onClick={() => setOrder("games")}>
            Most played
          </button>
          {running && (
            <button className="btn" onClick={stop}>
              Stop
            </button>
          )}
        </div>
        {sorted.length > 0 && (
          <table className="an-table lab-index">
            <tbody>
              {sorted.map((b, i) => (
                <tr key={b.deck.id}>
                  <td className="muted">#{i + 1}</td>
                  <td>
                    <span className="an-cards">
                      {b.deck.legends.map((s) => (
                        <Thumb key={s} db={db} slug={s} />
                      ))}
                    </span>
                  </td>
                  <td>
                    <a href={`#/lab`} onClick={(e) => (e.preventDefault(), document.getElementById(`lab-${b.archetype.key}`)?.scrollIntoView({ behavior: "smooth" }))}>
                      {b.archetype.name}
                    </a>
                  </td>
                  <td>
                    <b>{b.archetype.winRate}%</b>
                  </td>
                  <td className="muted small">
                    {b.archetype.games} games · {b.archetype.share}%
                  </td>
                  <td className="small">
                    {(() => {
                      const c = checks[b.deck.id];
                      return c?.status === "done" ? `Strong bots ${pct(c.result.rate)}` : "";
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {builds && !sorted.length && <p className="muted small">No archetype on the ladder plays this Legend's colour with a legal trio.</p>}
        {!builds && !error && <p className="muted small">Building decks…</p>}
      </section>
      <PoolEditor db={db} builtIn={builtIn} onChange={() => setPoolVersion((v) => v + 1)} />
      {sorted.map((b, i) => (
        <LadderDeck key={b.deck.id} db={db} build={b} rank={i + 1} check={checks[b.deck.id]} busy={running} onCheck={() => void runCheck(b)} />
      ))}
    </div>
  );
}
