import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckData, DeckSummary } from "@cpai/core/protocol";
import { api, loadCardDb, type CardDb } from "../api.ts";
import { checkInBrowser, deckChat, metaBuilds, metaList, type ArchetypeSummary, type Checked, type DeckAnswer, type MetaBuild, type Matchup } from "../browserAnalysis.ts";
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
                      <span className="muted">{c.asked ? " asked for" : " to fill the deck"}</span>
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
  rank?: number;
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
            {rank ? `#${rank} ` : ""}
            {a.name}: {build.deck.name}
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
          <p className="muted small">
            {CHECK_PER} games against each deck: one matchup can swing a lot, the total over {result.games} games is the reliable number.
          </p>
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

const CHAT_KEY = "cpai.lab.chat";
const EXAMPLES = [
  "The best deck with Padre",
  "Aggressive red deck with 3 Mantis Blades, without Satori",
  "Most played deck with 60% sellable cards",
  "A deck that beats 4 Yellow / 2 Red",
  "Something less played with Judy Álvarez",
];

type ChatMsg =
  | { from: "you"; text: string }
  | { from: "bot"; answer: DeckAnswer; shown: MetaBuild | null; test?: { done: number; total: number } | { build: MetaBuild; check: Checked }[] }
  | { from: "claude"; text: string; shown: MetaBuild | null; tools: string[]; usd: number; model: string; refused: boolean };

/** Claude in the chat: the player's own API key, sent from this browser straight to Anthropic's API. */
const CLAUDE_KEY = "cpai.lab.claudeKey";
const CLAUDE_PREFS = "cpai.lab.claudePrefs";
const CLAUDE_HISTORY = "cpai.lab.claudeHistory";
const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const;
type ModelId = (typeof MODELS)[number]["id"];
const TOOL_LABEL: Record<string, string> = {
  list_archetypes: "reading the archetypes",
  archetype_cards: "reading card numbers",
  search_cards: "searching cards",
  build_deck: "building a deck",
  check_deck: "checking a deck",
};

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}
const readKey = () => storage("local")?.getItem(CLAUDE_KEY) ?? storage("session")?.getItem(CLAUDE_KEY) ?? "";
function readPrefs(): { mode: "builtin" | "claude"; model: ModelId; remember: boolean } {
  try {
    return { mode: "builtin", model: "claude-opus-5-5", remember: false, ...JSON.parse(storage("local")?.getItem(CLAUDE_PREFS) ?? "{}") };
  } catch {
    return { mode: "builtin", model: "claude-opus-5-5", remember: false };
  }
}
function readHistory(): unknown[] {
  try {
    return JSON.parse(storage("session")?.getItem(CLAUDE_HISTORY) ?? "[]") as unknown[];
  } catch {
    return [];
  }
}

function readChat(): ChatMsg[] {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as ChatMsg[]).map((m) => (m.from === "bot" && m.test && !Array.isArray(m.test) ? { ...m, test: undefined } : m)) : [];
  } catch {
    return [];
  }
}

/** Write what you want of a deck; the bot builds it from the ladder data and explains it. */
function DeckChat({
  db,
  pool,
  checks,
  busy,
  onCheck,
  onBusy,
}: {
  db: CardDb;
  pool: DeckData[];
  checks: Record<string, Check>;
  busy: boolean;
  onCheck: (b: MetaBuild) => void;
  onBusy: (b: boolean) => void;
}) {
  const [log, setLog] = useState<ChatMsg[]>(readChat);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string>();
  const [prefs, setPrefs] = useState(readPrefs);
  const [apiKey, setApiKey] = useState(readKey);
  const [history, setHistory] = useState<unknown[]>(readHistory);
  const [working, setWorking] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const claudeAbort = useRef<AbortController | null>(null);
  const newest = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => (abort.current?.abort(), claudeAbort.current?.abort()), []);
  useEffect(() => {
    try {
      storage("local")?.setItem(CLAUDE_PREFS, JSON.stringify(prefs));
    } catch {
      /* preferences are a convenience */
    }
  }, [prefs]);
  useEffect(() => {
    try {
      storage("session")?.setItem(CLAUDE_HISTORY, JSON.stringify(history));
    } catch {
      /* the conversation still works in this tab */
    }
  }, [history]);
  const saveKey = (key: string, remember: boolean) => {
    setApiKey(key);
    try {
      storage("local")?.removeItem(CLAUDE_KEY);
      storage("session")?.removeItem(CLAUDE_KEY);
      if (key) storage(remember ? "local" : "session")?.setItem(CLAUDE_KEY, key);
    } catch {
      /* kept in memory for this page */
    }
  };
  const claude = prefs.mode === "claude";
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(log.slice(-12)));
    } catch {
      /* the chat still works without storage */
    }
  }, [log]);
  const lastBot = [...log].reverse().find((m): m is Extract<ChatMsg, { from: "bot" }> => m.from === "bot");

  const askClaude = async (msg: string) => {
    claudeAbort.current?.abort();
    const ctl = (claudeAbort.current = new AbortController());
    setWorking([]);
    const { askClaude: ask, claudeError } = await import("../claudeChat.ts");
    try {
      const turn = await ask({
        apiKey,
        model: prefs.model,
        history: history as Parameters<typeof ask>[0]["history"],
        text: msg,
        pool,
        signal: ctl.signal,
        onTool: (name) => setWorking((w) => [...w, name]),
      });
      setHistory(turn.history);
      setLog((l) => [
        ...l,
        { from: "claude", text: turn.refused ? "Claude declined this request." : turn.text, shown: turn.build, tools: turn.tools, usd: turn.usd, model: prefs.model, refused: turn.refused },
      ]);
      requestAnimationFrame(() => newest.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      if (!ctl.signal.aborted) setError(claudeError(e));
    }
  };
  const send = async (t: string) => {
    const msg = t.trim();
    if (!msg || thinking) return;
    if (claude && !apiKey.trim()) return setError("Enter your Anthropic API key to talk with Claude, or switch to Built-in.");
    setText("");
    setError(undefined);
    setThinking(true);
    setLog((l) => [...l, { from: "you", text: msg }]);
    if (claude) {
      await askClaude(msg);
      setThinking(false);
      return;
    }
    try {
      const answer = await deckChat(msg, lastBot?.answer.request ?? null, pool, lastBot?.shown?.archetype.key ?? null);
      setLog((l) => [...l, { from: "bot", answer, shown: answer.build }]);
      requestAnimationFrame(() => newest.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setThinking(false);
    }
  };
  const reset = () => {
    abort.current?.abort();
    claudeAbort.current?.abort();
    setLog([]);
    setHistory([]);
    setError(undefined);
  };
  const stopClaude = () => {
    claudeAbort.current?.abort();
    setThinking(false);
  };
  const patch = (index: number, p: Partial<Extract<ChatMsg, { from: "bot" }>>) =>
    setLog((l) => l.map((x, i) => (i === index && x.from === "bot" ? { ...x, ...p } : x)));
  const test = async (index: number) => {
    const m = log[index];
    if (m?.from !== "bot" || !m.answer.beat) return;
    const { candidates, decks } = m.answer.beat;
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    onBusy(true);
    patch(index, { test: { done: 0, total: 0 } });
    try {
      const res = await checkInBrowser(
        candidates.map((b) => b.deck),
        decks,
        CHECK_PER,
        "ismcts-sim",
        (done, total) => !ctl.signal.aborted && patch(index, { test: { done, total } }),
        ctl.signal,
      );
      const results = candidates
        .map((build) => ({ build, check: res.find((r) => r.deckId === build.deck.id)! }))
        .filter((r) => r.check)
        .sort((x, y) => y.check.rate - x.check.rate);
      patch(index, { test: results, shown: results[0]?.build ?? m.shown });
    } catch (e) {
      patch(index, { test: undefined });
      if (!ctl.signal.aborted) setError(String((e as Error).message ?? e));
    } finally {
      onBusy(false);
    }
  };
  const stop = (index: number) => {
    abort.current?.abort();
    patch(index, { test: undefined });
    onBusy(false);
  };

  return (
    <section className="panel lab-chat">
      <h2>Ask for a deck</h2>
      <div className="an-options">
        <button className={`chip ${!claude ? "sel" : ""}`} disabled={thinking} onClick={() => setPrefs((p) => ({ ...p, mode: "builtin" }))}>
          Built-in
        </button>
        <button className={`chip ${claude ? "sel" : ""}`} disabled={thinking} onClick={() => setPrefs((p) => ({ ...p, mode: "claude" }))}>
          Claude
        </button>
        {claude && (
          <select className="lab-select" value={prefs.model} disabled={thinking} onChange={(e) => setPrefs((p) => ({ ...p, model: e.target.value as ModelId }))}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {claude ? (
        <div className="chat-claude">
          <div className="chat-key">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Your Anthropic API key"
              value={apiKey}
              onChange={(e) => saveKey(e.target.value, prefs.remember)}
            />
            <label className="small">
              <input
                type="checkbox"
                checked={prefs.remember}
                onChange={(e) => (setPrefs((p) => ({ ...p, remember: e.target.checked })), saveKey(apiKey, e.target.checked))}
              />{" "}
              Remember on this device
            </label>
            {apiKey && (
              <button className="btn small" onClick={() => saveKey("", false)}>
                Forget key
              </button>
            )}
          </div>
          <p className="muted small">
            Talk with Claude about the deck you want; it builds and checks decks with the same ladder data. The key and your messages go from this browser straight to
            Anthropic's API, and every message is billed to your API account (the cost of each answer is shown under it). Keys:{" "}
            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
              Claude Console
            </a>
            .
          </p>
        </div>
      ) : (
        <p className="muted small">
          Write what you want: colours, Legends, cards to play or to leave out, an aggressive or a control deck, how many Units or sellable cards, or which deck it should
          beat. Every message changes the last deck; "New deck" starts over.
        </p>
      )}
      {log.map((m, i) =>
        m.from === "you" ? (
          <div key={i} className="chat-you">
            {m.text}
          </div>
        ) : m.from === "claude" ? (
          <div key={i} ref={i === log.length - 1 ? newest : undefined} className="chat-bot chat-claude-msg">
            <div className="chat-text">{m.text || "(no text)"}</div>
            <div className="small muted">
              {MODELS.find((x) => x.id === m.model)?.label ?? m.model}
              {m.tools.length > 0 && ` · ${[...new Set(m.tools)].map((t) => TOOL_LABEL[t] ?? t).join(", ")}`} · ≈ ${m.usd < 0.01 ? m.usd.toFixed(4) : m.usd.toFixed(2)}
            </div>
            {m.shown && <LadderDeck db={db} build={m.shown} check={checks[m.shown.deck.id]} busy={busy} onCheck={() => onCheck(m.shown!)} />}
          </div>
        ) : (
          <div key={i} ref={i === log.length - 1 ? newest : undefined} className="chat-bot">
            <div className="chat-reply">
              {m.answer.reply.map((r, k) => (
                <p key={k} className={k === 0 ? "chat-head" : ""}>
                  {r}
                </p>
              ))}
              {!m.answer.understood.length && i > 1 && (
                <p className="muted small">Nothing new read from this message: name colours, Legends or cards, or write "without …", "aggressive", "15 Units".</p>
              )}
            </div>
            {m.answer.summary.length > 0 && <div className="small muted">Your request: {m.answer.summary.join(" · ")}</div>}
            {m.answer.beat && m.answer.beat.decks.length > 0 && (
              <div className="chat-test">
                {Array.isArray(m.test) ? (
                  <>
                    <div className="small">
                      Strong bots against {m.answer.beat.label} ({m.answer.beat.decks.map((d) => d.name).join("; ")}):
                    </div>
                    <table className="an-table">
                      <tbody>
                        {m.test.map((r) => (
                          <tr key={r.build.deck.id}>
                            <td className="small">
                              {r.build.archetype.name}: {r.build.deck.name}
                            </td>
                            <td>
                              <Rate r={r.check} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="muted small">
                      The deck below is the best of them. {CHECK_PER} games against each deck: a rough result.
                    </div>
                  </>
                ) : m.test ? (
                  <span className="an-progress">
                    <span className="an-bar wide">
                      <span style={{ width: m.test.total ? pct(m.test.done / m.test.total) : "0%" }} />
                    </span>
                    <span className="small muted">
                      Strong bots: {m.test.done}/{m.test.total || "…"} games
                    </span>
                    <button className="btn small" onClick={() => stop(i)}>
                      Stop
                    </button>
                  </span>
                ) : (
                  <button className="btn small" disabled={busy} onClick={() => void test(i)}>
                    Test against {m.answer.beat.label}
                  </button>
                )}
              </div>
            )}
            {m.shown && <LadderDeck db={db} build={m.shown} check={checks[m.shown.deck.id]} busy={busy} onCheck={() => onCheck(m.shown!)} />}
            {m.answer.alternatives.length > 0 && (
              <div className="chat-alts small">
                <span className="muted">Also fits:</span>
                {m.answer.alternatives.map((a) => (
                  <button key={a.key} className="chip" disabled={thinking} onClick={() => void send(a.name)}>
                    {a.name} · {a.winRate}%
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      )}
      {thinking &&
        (claude ? (
          <div className="chat-bot muted">
            Claude is working{working.length ? `: ${TOOL_LABEL[working.at(-1)!] ?? working.at(-1)}` : "…"}{" "}
            <button className="btn small" onClick={stopClaude}>
              Stop
            </button>
          </div>
        ) : (
          <div className="chat-bot muted">Building…</div>
        ))}
      {error && <div className="banner error">{error}</div>}
      {!log.length && (
        <div className="chat-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => void send(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input">
        <textarea
          rows={2}
          placeholder={claude ? "Ask Claude for a deck…" : "Describe the deck you want…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <button className="btn primary" disabled={!text.trim() || thinking} onClick={() => void send(text)}>
          {claude ? "Send" : "Build"}
        </button>
        {log.length > 0 && (
          <button className="btn" onClick={reset}>
            New deck
          </button>
        )}
      </div>
    </section>
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
  const [testing, setTesting] = useState(false);
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
  const running = testing || Object.values(checks).some((c) => c.status === "running");

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
      <DeckChat db={db} pool={pool} checks={checks} busy={running} onCheck={(b) => void runCheck(b)} onBusy={setTesting} />
      <section className="panel an-input">
        <h2 className="lab-h2">The best deck of every archetype</h2>
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
