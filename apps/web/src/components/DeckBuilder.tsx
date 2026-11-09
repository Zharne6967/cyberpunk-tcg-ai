import { useEffect, useMemo, useState } from "react";
import type { DeckCheck, DeckData, DeckSummary } from "@cpai/core/protocol";
import { COLOR_NAME, TYPE_NAME, api, loadCardDb, type CardData, type CardDb } from "../api.ts";
import { matchesQuery } from "../cardQuery.ts";
import { CardFace } from "./CardFace.tsx";
import { Inspector } from "./Panels.tsx";

const TYPES = ["legend", "unit", "gear", "program"] as const;
const COLORS = ["red", "blue", "green", "yellow"] as const;
const COSTS = ["0", "1", "2", "3", "4", "5", "6", "7+"];
const RAMS = ["1", "2", "3", "4", "5", "6+"];
const MAX_COPIES = 3;
const LS_LOBBY = "cpai.lobby.v1";

const newId = () => `user-${Date.now().toString(36)}`;
const emptyDeck = (): DeckData => ({ id: newId(), name: "New Deck", legends: [], main: {} });

function bucket(n: number | null, top: number): string {
  if (n == null) return "0";
  return n >= top ? `${top}+` : String(n);
}

/** RAM each colour gets from the chosen Legends (CR 3.20 / 7.3.4). */
function legendRam(db: CardDb, legends: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slug of legends) {
    const c = db.bySlug.get(slug);
    if (c) out[c.color] = (out[c.color] ?? 0) + (c.ram ?? 0);
  }
  return out;
}

export function DeckBuilder({ deckId }: { deckId?: string }) {
  const [db, setDb] = useState<CardDb>();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deck, setDeck] = useState<DeckData>(emptyDeck);
  const [dirty, setDirty] = useState(false);
  const [check, setCheck] = useState<DeckCheck>();
  const [pick, setPick] = useState(deckId ?? "");
  const [toast, setToast] = useState<string>();
  const [inspect, setInspect] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "import" | "export" | "hand">(null);
  const [hand, setHand] = useState<string[]>([]);
  // library filters
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const [color, setColor] = useState<string>("all");
  const [cost, setCost] = useState<string>("all");
  const [ram, setRam] = useState<string>("all");
  const [matchRam, setMatchRam] = useState(false);
  const [sort, setSort] = useState<"cost" | "name" | "number">("cost");
  const [target, setTarget] = useState<"main" | "side">("main");
  const [drawPct, setDrawPct] = useState(false);

  const [hidden, setHidden] = useState<Set<string>>(() => api.hiddenDecks());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refreshDecks = () => {
    setHidden(api.hiddenDecks());
    return api.decks({ includeHidden: true }).then((d) => setDecks(d.sort((a, b) => a.name.localeCompare(b.name))));
  };
  useEffect(() => {
    loadCardDb().then(setDb);
    void refreshDecks();
  }, []);
  useEffect(() => {
    setPick(deckId ?? "");
    if (!deckId) {
      setDeck(emptyDeck());
      setDirty(false);
      return;
    }
    api
      .deck(deckId)
      .then((d) => {
        setDeck(d);
        setDirty(false);
      })
      .catch((e) => setToast(String(e.message ?? e)));
  }, [deckId]);
  // Server-side legality (official checks) and the text export, debounced.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const run = (retries: number) =>
      api
        .checkDeck(deck)
        .then(setCheck)
        .catch(() => retries > 0 && (t = setTimeout(() => run(retries - 1), 1000)));
    t = setTimeout(() => run(5), 200);
    return () => clearTimeout(t);
  }, [deck]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const ramBudget = useMemo(() => (db ? legendRam(db, deck.legends) : {}), [db, deck.legends]);

  const library = useMemo(() => {
    if (!db) return [];
    const list = db.all.filter((c) => {
      if (type !== "all" && c.type !== type) return false;
      if (color !== "all" && c.color !== color) return false;
      if (cost !== "all" && bucket(c.cost, 7) !== cost) return false;
      if (ram !== "all" && bucket(c.ram, 6) !== ram) return false;
      if (matchRam && deck.legends.length && c.type !== "legend") {
        const budget = ramBudget[c.color];
        if (budget == null || (c.ram ?? 0) > budget) return false;
      }
      return !query.trim() || matchesQuery(c, query);
    });
    const byName = (a: CardData, b: CardData) => a.displayName.localeCompare(b.displayName);
    if (sort === "name") list.sort(byName);
    else if (sort === "number") list.sort((a, b) => `${a.set.code}-${a.printNumber}`.localeCompare(`${b.set.code}-${b.printNumber}`, undefined, { numeric: true }));
    else list.sort((a, b) => (a.cost ?? -1) - (b.cost ?? -1) || byName(a, b));
    return list;
  }, [db, query, type, color, cost, ram, matchRam, sort, deck.legends, ramBudget]);

  if (!db) return <div className="center-msg">Loading cards…</div>;

  const update = (fn: (d: DeckData) => DeckData) => {
    setDeck(fn);
    setDirty(true);
  };
  const sideCount = Object.values(deck.sideboard ?? {}).reduce((s, n) => s + n, 0);
  const addSide = (c: CardData) => {
    if (c.type === "legend") return setToast("Legends cannot be in the sideboard");
    if (sideCount >= 7) return setToast("Sideboard is full (7)");
    const n = deck.sideboard?.[c.slug] ?? 0;
    if (n >= MAX_COPIES) return setToast(`Max ${MAX_COPIES} copies`);
    update((d) => ({ ...d, sideboard: { ...(d.sideboard ?? {}), [c.slug]: n + 1 } }));
  };
  const removeSide = (slug: string) =>
    update((d) => {
      const side = { ...(d.sideboard ?? {}) };
      const n = (side[slug] ?? 0) - 1;
      if (n > 0) side[slug] = n;
      else delete side[slug];
      return { ...d, sideboard: side };
    });
  const add = (c: CardData) => {
    if (target === "side") return addSide(c);
    if (c.type === "legend") {
      if (deck.legends.includes(c.slug)) return update((d) => ({ ...d, legends: d.legends.filter((s) => s !== c.slug) }));
      if (deck.legends.length >= 3) return setToast("Legend area is full (3)");
      if (deck.legends.some((s) => db.bySlug.get(s)?.name === c.name)) return setToast(`Only one Legend named ${c.name}`);
      return update((d) => ({ ...d, legends: [...d.legends, c.slug] }));
    }
    const n = deck.main[c.slug] ?? 0;
    if (n >= MAX_COPIES) return setToast(`Max ${MAX_COPIES} copies`);
    update((d) => ({ ...d, main: { ...d.main, [c.slug]: n + 1 } }));
  };
  const remove = (slug: string) =>
    update((d) => {
      const n = (d.main[slug] ?? 0) - 1;
      const main = { ...d.main };
      if (n > 0) main[slug] = n;
      else delete main[slug];
      return { ...d, main };
    });

  const summary = decks.find((d) => d.id === deck.id);
  const editable = summary?.editable ?? !summary;
  const mainCards = Object.entries(deck.main)
    .map(([slug, n]) => ({ card: db.bySlug.get(slug), n }))
    .filter((x): x is { card: CardData; n: number } => !!x.card);
  const size = mainCards.reduce((s, x) => s + x.n, 0);
  const avgCost = size ? mainCards.reduce((s, x) => s + (x.card.cost ?? 0) * x.n, 0) / size : 0;
  const sellable = mainCards.reduce((s, x) => s + (x.card.sellTag ? x.n : 0), 0);
  const curve = COSTS.map((b) => mainCards.filter((x) => bucket(x.card.cost, 7) === b).reduce((s, x) => s + x.n, 0));
  const curveMax = Math.max(1, ...curve);
  const colorCount = COLORS.map((c) => ({ c, n: mainCards.filter((x) => x.card.color === c).reduce((s, x) => s + x.n, 0) })).filter((x) => x.n);
  /** Chance to have at least one copy in the 6-card opening hand (hypergeometric). */
  const openingChance = (copies: number) => {
    if (size < 6) return 0;
    let none = 1;
    for (let i = 0; i < 6; i++) none *= Math.max(0, size - copies - i) / (size - i);
    return 1 - none;
  };
  const sideCards = Object.entries(deck.sideboard ?? {})
    .map(([slug, n]) => ({ card: db.bySlug.get(slug), n }))
    .filter((x): x is { card: CardData; n: number } => !!x.card)
    .sort((a, b) => (a.card.cost ?? 0) - (b.card.cost ?? 0) || a.card.displayName.localeCompare(b.card.displayName));
  const groups = (["unit", "gear", "program"] as const).map((t) => ({
    t,
    cards: mainCards.filter((x) => x.card.type === t).sort((a, b) => (a.card.cost ?? 0) - (b.card.cost ?? 0) || a.card.displayName.localeCompare(b.card.displayName)),
  }));

  const save = async () => {
    try {
      const s = await api.saveDeck(deck);
      if (s.id !== deck.id) setToast("Saved as your own copy");
      else setToast("Saved");
      setDeck((d) => ({ ...d, id: s.id }));
      setDirty(false);
      await refreshDecks();
      if (location.hash !== `#/builder/${s.id}`) history.replaceState(null, "", `#/builder/${s.id}`);
    } catch (e) {
      setToast(String((e as Error).message ?? e));
    }
  };
  const playWith = () => {
    try {
      const prefs = JSON.parse(localStorage.getItem(LS_LOBBY) ?? "{}");
      localStorage.setItem(LS_LOBBY, JSON.stringify({ ...prefs, yourDeck: deck.id }));
    } catch {
      /* ignore */
    }
    location.hash = "#/";
  };
  const drawHand = () => {
    const pool = mainCards.flatMap((x) => Array.from({ length: x.n }, () => x.card.slug));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    setHand(pool.slice(0, 6));
    setModal("hand");
  };

  const chip = (value: string, current: string, set: (v: string) => void, label: string, cls = "") => (
    <button key={value} className={`chip ${cls} ${current === value ? "sel" : ""}`} onClick={() => set(current === value ? "all" : value)}>
      {label}
    </button>
  );

  return (
    <div className="builder">
      <div className="builder-bar">
        <a href="#/" className="brand">
          CYBERPUNK <span>TCG</span> // AI
        </a>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Saved decks…</option>
          {decks.filter((d) => d.editable || !hidden.has(d.id)).map((d) => (
            <option key={d.id} value={d.id}>
              {d.editable ? "★ " : ""}
              {d.name} ({d.size})
            </option>
          ))}
        </select>
        <button className="btn small" disabled={!pick} onClick={() => (location.hash = `#/builder/${pick}`)}>
          Load
        </button>
        <button className="btn small" onClick={() => (location.hash = "#/builder")}>
          New Deck
        </button>
        <button
          className="btn small"
          onClick={() => {
            setDeck((d) => ({ ...d, id: newId(), name: `${d.name} (copy)` }));
            setDirty(true);
            history.replaceState(null, "", "#/builder");
          }}
        >
          Copy
        </button>
        <button
          className="btn small danger"
          disabled={!summary}
          onBlur={() => setConfirmDelete(false)}
          onClick={async () => {
            if (!summary) return;
            if (!confirmDelete) return setConfirmDelete(true);
            setConfirmDelete(false);
            // Built-in decks stay on the server; deleting one removes it from your lists (can be restored).
            if (summary.editable) await api.deleteDeck(deck.id).catch((e) => setToast(String(e.message ?? e)));
            else api.setDeckHidden(deck.id, true);
            await refreshDecks();
            setToast(`Deleted "${deck.name}"`);
            location.hash = "#/builder";
          }}
        >
          {confirmDelete ? "Confirm delete" : "Delete"}
        </button>
        {hidden.size > 0 && (
          <button
            className="btn small"
            onClick={async () => {
              for (const id of hidden) api.setDeckHidden(id, false);
              await refreshDecks();
              setToast(`Restored ${hidden.size} built-in deck${hidden.size === 1 ? "" : "s"}`);
            }}
          >
            Restore built-in decks ({hidden.size})
          </button>
        )}
        <button className="btn small" onClick={() => setModal("import")}>
          Import
        </button>
        <span className="bar-sep" />
        <input className="deck-name-input" value={deck.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
        <button className="btn small primary" onClick={save}>
          Save Deck
        </button>
        {dirty && <span className="tag warn">Unsaved</span>}
        {!editable && <span className="tag">Built-in</span>}
        <span className="spacer" />
        <button className="btn small" onClick={() => setModal("export")}>
          Export
        </button>
        <button className="btn small" disabled={!check?.legal || dirty} onClick={playWith}>
          Play
        </button>
      </div>

      <div className="builder-body">
        <section className="panel library">
          <div className="lib-head">
            <h2>Library</h2>
            <span className="muted small">{library.length} cards</span>
          </div>
          <input className="search" placeholder="Search: name, text, or filters like type:unit cost<=3 color:blue" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="filters">
            <div className="filter-row">
              <span className="f-label">Type</span>
              {TYPES.map((t) => chip(t, type, setType, TYPE_NAME[t]!))}
            </div>
            <div className="filter-row">
              <span className="f-label">Color</span>
              {COLORS.map((c) => chip(c, color, setColor, COLOR_NAME[c]!, `c-${c}`))}
            </div>
            <div className="filter-row">
              <span className="f-label">Cost</span>
              {COSTS.map((c) => chip(c, cost, setCost, c))}
            </div>
            <div className="filter-row">
              <span className="f-label">RAM</span>
              {RAMS.map((r) => chip(r, ram, setRam, r))}
              <label className="opt">
                <input type="checkbox" checked={matchRam} onChange={(e) => setMatchRam(e.target.checked)} /> Match Legends RAM
              </label>
            </div>
            <div className="filter-row">
              <span className="f-label">Add to</span>
              <button className={`chip ${target === "main" ? "sel" : ""}`} onClick={() => setTarget("main")}>
                Main Deck
              </button>
              <button className={`chip ${target === "side" ? "sel" : ""}`} onClick={() => setTarget("side")}>
                Sideboard
              </button>
            </div>
            <div className="filter-row">
              <span className="f-label">Sort</span>
              {(["cost", "name", "number"] as const).map((s) => (
                <button key={s} className={`chip ${sort === s ? "sel" : ""}`} onClick={() => setSort(s)}>
                  {s === "cost" ? "Cost" : s === "name" ? "Name" : "Number"}
                </button>
              ))}
            </div>
          </div>
          <div className="lib-grid">
            {library.map((c) => {
              const n = c.type === "legend" ? (deck.legends.includes(c.slug) ? 1 : 0) : (deck.main[c.slug] ?? 0);
              return (
                <button
                  key={c.slug}
                  className={`lib-card ${n ? "in-deck" : ""}`}
                  title={c.displayName}
                  onClick={() => add(c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setInspect(c.id);
                  }}
                >
                  <CardFace card={c} size="md" />
                  {n > 0 && <span className="count">{c.type === "legend" ? "✓" : `x${n}`}</span>}
                  {(deck.sideboard?.[c.slug] ?? 0) > 0 && <span className="count side">SB {deck.sideboard![c.slug]}</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel editor">
          <div className="stats">
            <div className={`stat ${size >= 40 && size <= 50 ? "ok" : ""}`}>
              <span>Main Deck</span>
              <b>
                {size} / 40-50
              </b>
            </div>
            <div className="stat">
              <span>Average cost</span>
              <b>{size ? avgCost.toFixed(2) : "—"}</b>
            </div>
            <div className="stat">
              <span>Sellable</span>
              <b>
                {sellable}/{size}
              </b>
            </div>
            <div className={`stat ${check?.legal ? "ok" : "bad"}`}>
              <span>Status</span>
              <b>{check ? (check.legal ? "Legal ✓" : "Not legal") : "…"}</b>
            </div>
          </div>
          {check && check.problems.length > 0 && (
            <ul className="problems">
              {check.problems.map((p, i) => (
                <li key={i} className={p.severity}>
                  {p.message}
                </li>
              ))}
            </ul>
          )}

          <h3>
            Legends <span className="muted small">{deck.legends.length}/3</span>
          </h3>
          <div className="legend-row">
            {[0, 1, 2].map((i) => {
              const c = db.bySlug.get(deck.legends[i] ?? "");
              return c ? (
                <button
                  key={c.slug}
                  className="deck-card"
                  title={`${c.displayName} — click to remove`}
                  onClick={() => update((d) => ({ ...d, legends: d.legends.filter((s) => s !== c.slug) }))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setInspect(c.id);
                  }}
                >
                  <CardFace card={c} size="md" />
                </button>
              ) : (
                <div key={i} className="legend-empty">
                  LEGEND
                </div>
              );
            })}
            <div className="ram-box">
              <div className="f-label">RAM</div>
              {Object.entries(ramBudget).length ? (
                Object.entries(ramBudget).map(([c, n]) => (
                  <div key={c} className={`ram-line c-${c}`}>
                    <i className={`dot c-${c}`} /> {COLOR_NAME[c]} <b>{n}</b>
                  </div>
                ))
              ) : (
                <div className="muted small">—</div>
              )}
            </div>
          </div>

          <div className="charts">
            <div className="curve">
              <div className="f-label">Cost curve</div>
              <div className="bars">
                {curve.map((n, i) => (
                  <div key={i} className="bar-col">
                    <span className="bar-n">{n || ""}</span>
                    <div className="bar" style={{ height: `${(n / curveMax) * 100}%` }} />
                    <span className="bar-x">{COSTS[i]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="color-split">
              <div className="f-label">Colors</div>
              {colorCount.map(({ c, n }) => (
                <div key={c} className="ram-line">
                  <i className={`dot c-${c}`} /> {COLOR_NAME[c]} <b>{n}</b>
                </div>
              ))}
              <button className="btn small" disabled={size < 6} onClick={drawHand}>
                Draw Starting Hand
              </button>
              <label className="opt">
                <input type="checkbox" checked={drawPct} onChange={(e) => setDrawPct(e.target.checked)} /> Draw %
              </label>
            </div>
          </div>

          {groups.map(({ t, cards }) =>
            cards.length ? (
              <div key={t}>
                <h3>
                  {TYPE_NAME[t]}s <span className="muted small">{cards.reduce((s, x) => s + x.n, 0)}</span>
                </h3>
                <div className="deck-grid">
                  {cards.map(({ card, n }) => (
                    <div key={card.slug} className="deck-card" title={card.displayName}>
                      <button
                        className="deck-card-face"
                        onClick={() => remove(card.slug)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setInspect(card.id);
                        }}
                      >
                        <CardFace card={card} size="md" />
                      </button>
                      <span className="count">x{n}</span>
                      {drawPct && (
                        <span className="draw-pct" title="Chance to have at least one in the opening hand (6 cards)">
                          {Math.round(openingChance(n) * 100)}%
                        </span>
                      )}
                      <div className="qty">
                        <button onClick={() => remove(card.slug)}>−</button>
                        <button
                          onClick={() => {
                            const n2 = deck.main[card.slug] ?? 0;
                            if (n2 >= MAX_COPIES) return setToast(`Max ${MAX_COPIES} copies`);
                            update((d) => ({ ...d, main: { ...d.main, [card.slug]: n2 + 1 } }));
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}

          <h3>
            Sideboard <span className="muted small">{sideCount}/7</span>
          </h3>
          <div className="deck-grid">
            {sideCards.map(({ card, n }) => (
              <div key={card.slug} className="deck-card" title={card.displayName}>
                <button
                  className="deck-card-face"
                  onClick={() => removeSide(card.slug)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setInspect(card.id);
                  }}
                >
                  <CardFace card={card} size="md" />
                </button>
                <span className="count">x{n}</span>
                <div className="qty">
                  <button onClick={() => removeSide(card.slug)}>−</button>
                  <button onClick={() => addSide(card)}>+</button>
                </div>
              </div>
            ))}
            {!sideCards.length && <div className="legend-empty side-empty">SIDEBOARD</div>}
          </div>
        </section>
      </div>

      {modal === "import" && (
        <ImportModal
          onClose={() => setModal(null)}
          onImport={async (text) => {
            const r = await api.importDeck(text);
            setDeck(r.deck);
            setDirty(true);
            history.replaceState(null, "", "#/builder");
            if (r.unresolved.length) setToast(`Not found: ${r.unresolved.map((u) => u.name).join(", ")}`);
            setModal(null);
          }}
        />
      )}
      {modal === "export" && check && <ExportModal name={deck.name} text={check.text} onClose={() => setModal(null)} />}
      {modal === "hand" && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Starting hand</h3>
            <div className="hand-sample">
              {hand.map((s, i) => (
                <CardFace key={i} card={db.bySlug.get(s)} size="md" />
              ))}
            </div>
            <div className="row-btns">
              <button className="btn primary" onClick={drawHand}>
                Draw again
              </button>
              <button className="btn" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {inspect && <Inspector db={db} definitionId={inspect} onClose={() => setInspect(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ImportModal({ onImport, onClose }: { onImport: (text: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import deck</h3>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Deck name\n\nLegends\n1 Goro Takemura: Hands Unclean\n...\n\nMain Deck\n3x Psycho Squad\n..."}
        />
        <div className="row-btns">
          <button
            className="btn primary"
            disabled={!text.trim() || busy}
            onClick={async () => {
              setBusy(true);
              await onImport(text).finally(() => setBusy(false));
            }}
          >
            Import
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportModal({ name, text, onClose }: { name: string; text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export</h3>
        <textarea readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
        <div className="row-btns">
          <button
            className="btn primary"
            onClick={() =>
              navigator.clipboard
                .writeText(text)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a className="btn" download={`${name.replace(/[^\w-]+/g, "_") || "deck"}.txt`} href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>
            Download .txt
          </a>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
