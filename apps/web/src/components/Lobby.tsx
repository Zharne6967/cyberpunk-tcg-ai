import { useEffect, useMemo, useRef, useState } from "react";
import type { BotSummary, DeckSummary } from "@cpai/core/protocol";
import { api, loadCardDb, playerName, setPlayerName, type CardDb } from "../api.ts";

const LS_KEY = "cpai.lobby.v1";
const RANDOM = "__random";

function loadPrefs(): { yourDeck?: string; botDeck?: string; bot?: string } {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function ColorDots({ colors }: { colors: string[] }) {
  return (
    <span className="color-dots">
      {colors.map((c) => (
        <i key={c} className={`dot c-${c}`} />
      ))}
    </span>
  );
}

/** Compact deck picker: shows the chosen deck; opens a searchable list on click. */
export function DeckPicker({ decks, db, value, onChange, allowRandom }: { decks: DeckSummary[]; db?: CardDb; value: string; onChange: (id: string) => void; allowRandom?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const legendNames = (d: DeckSummary) => d.legends.map((s) => db?.bySlug.get(s)?.name ?? s).join(" · ");
  const current = decks.find((d) => d.id === value);
  const shown = decks
    .filter((d) => !q.trim() || `${d.name} ${legendNames(d)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(!!b.editable) - Number(!!a.editable) || a.name.localeCompare(b.name));
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  return (
    <div className="deck-picker" ref={ref}>
      <button className={`picker-btn ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        {value === RANDOM ? (
          <span className="deck-name">🎲 Random deck</span>
        ) : current ? (
          <>
            <span className="deck-name">
              <ColorDots colors={current.colors} /> {current.editable ? "★ " : ""}
              {current.name}
            </span>
            <span className="deck-meta">
              {legendNames(current)} · {current.size} cards
            </span>
          </>
        ) : (
          <span className="deck-name muted">Choose a deck…</span>
        )}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="picker-pop">
          <input autoFocus className="search" placeholder="Search decks or Legends" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="picker-list">
            {allowRandom && !q && (
              <button className={`picker-row ${value === RANDOM ? "sel" : ""}`} onClick={() => pick(RANDOM)}>
                <span className="deck-name">🎲 Random deck</span>
              </button>
            )}
            {shown.map((d) => (
              <button key={d.id} className={`picker-row ${value === d.id ? "sel" : ""}`} disabled={!d.legal} onClick={() => pick(d.id)}>
                <span className="deck-name">
                  <ColorDots colors={d.colors} /> {d.editable ? "★ " : ""}
                  {d.name}
                </span>
                <span className="deck-meta">
                  {legendNames(d)} · {d.size} cards{d.legal ? "" : " · not legal"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Lobby() {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [db, setDb] = useState<CardDb>();
  const prefs = useMemo(loadPrefs, []);
  const [yourDeck, setYourDeck] = useState(prefs.yourDeck ?? "starter-the-heist");
  const [botDeck, setBotDeck] = useState(prefs.botDeck ?? "starter-embracing-power");
  const [bot, setBot] = useState(prefs.bot ?? "tactical");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<"bot" | "friend">("bot");
  const [name, setName] = useState(playerName());
  const [code, setCode] = useState("");

  async function joinByCode() {
    setError(undefined);
    try {
      const room = await api.roomByCode(code.trim());
      location.hash = `#/join/${room.gameId}/${room.invite}`;
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  async function createRoom() {
    setBusy(true);
    setError(undefined);
    try {
      setPlayerName(name);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ yourDeck, botDeck, bot }));
      } catch {
        /* private mode */
      }
      const { gameId } = await api.createRoom({ deckId: yourDeck, name: name.trim() || "Player 1" });
      location.hash = `#/game/${gameId}`;
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  useEffect(() => {
    api
      .decks()
      .then((list) => {
        setDecks(list);
        // A remembered deck may have been deleted since.
        const legal = list.filter((d) => d.legal);
        if (legal.length) {
          setYourDeck((id) => (list.some((d) => d.id === id) ? id : legal[0]!.id));
          setBotDeck((id) => (id === RANDOM || list.some((d) => d.id === id) ? id : (legal[1] ?? legal[0])!.id));
        }
      })
      .catch((e) => setError(String(e.message ?? e)));
    api.bots().then(setBots).catch(() => {});
    loadCardDb().then(setDb).catch(() => {});
  }, []);

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const legal = decks.filter((d) => d.legal);
      const chosenBotDeck = botDeck === RANDOM ? legal[Math.floor(Math.random() * legal.length)]!.id : botDeck;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ yourDeck, botDeck, bot }));
      } catch {
        /* private mode */
      }
      setPlayerName(name);
      const { gameId } = await api.newGame({ yourDeck, botDeck: chosenBotDeck, bot, name: name.trim() || undefined });
      location.hash = `#/game/${gameId}`;
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  const selectedBot = bots.find((b) => b.id === bot);
  return (
    <div className="lobby compact">
      <header className="lobby-top">
        <h1>
          CYBERPUNK <span>TCG</span> // AI
        </h1>
        <a className="btn" href="#/builder">
          Deck Builder
        </a>
      </header>
      {error && <div className="banner error">{error}</div>}
      <section className="panel lobby-card">
        <div className="mode-tabs">
          <button className={`chip ${mode === "bot" ? "sel" : ""}`} onClick={() => setMode("bot")}>
            vs Bot
          </button>
          <button className={`chip ${mode === "friend" ? "sel" : ""}`} onClick={() => setMode("friend")}>
            vs Friend
          </button>
        </div>
        <div className="lobby-row">
          <label>Your name</label>
          <input className="search" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <span />
        </div>
        <div className="lobby-row">
          <label>Your deck</label>
          <DeckPicker decks={decks} db={db} value={yourDeck} onChange={setYourDeck} />
          <a className="small edit-link" href={`#/builder/${yourDeck}`}>
            Edit
          </a>
        </div>
        {mode === "bot" ? (
          <>
            <div className="lobby-row">
              <label>Bot deck</label>
              <DeckPicker decks={decks} db={db} value={botDeck} onChange={setBotDeck} allowRandom />
              <span />
            </div>
            <div className="lobby-row">
              <label>Bot level</label>
              <div className="level-chips">
                {bots.map((b) => (
                  <button key={b.id} className={`chip ${bot === b.id ? "sel" : ""} ${b.fair ? "" : "warn"}`} onClick={() => setBot(b.id)}>
                    {b.label}
                  </button>
                ))}
              </div>
              <span />
            </div>
            {selectedBot && <p className="level-desc">{selectedBot.description}</p>}
            <button className="btn primary big" disabled={busy || !decks.length} onClick={start}>
              {busy ? "Starting…" : "▶ Play"}
            </button>
          </>
        ) : (
          <>
            <button className="btn primary big" disabled={busy || !decks.length} onClick={createRoom}>
              {busy ? "Creating…" : "Create room"}
            </button>
            <div className="lobby-row">
              <label>Room code</label>
              <input
                className="search code-input"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && code.length === 6 && joinByCode()}
              />
              <button className="btn" disabled={code.length !== 6} onClick={joinByCode}>
                Join
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
