import { useEffect, useMemo, useState } from "react";
import type { BotSummary, DeckSummary } from "@cpai/core/protocol";
import { api, loadCardDb, type CardDb } from "../api.ts";

const LS_KEY = "cpai.lobby.v1";

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

function DeckList({ decks, db, value, onChange, allowRandom }: { decks: DeckSummary[]; db?: CardDb; value: string; onChange: (id: string) => void; allowRandom?: boolean }) {
  return (
    <div className="deck-list">
      {allowRandom && (
        <button className={`deck-row ${value === "__random" ? "sel" : ""}`} onClick={() => onChange("__random")}>
          <span className="deck-name">🎲 Losowa talia</span>
          <span className="deck-meta">bot wylosuje jedną z legalnych talii</span>
        </button>
      )}
      {decks.map((d) => (
        <button key={d.id} className={`deck-row ${value === d.id ? "sel" : ""} ${d.legal ? "" : "illegal"}`} onClick={() => onChange(d.id)} disabled={!d.legal}>
          <span className="deck-name">
            <ColorDots colors={d.colors} /> {d.name}
          </span>
          <span className="deck-meta">
            {d.legends.map((s) => db?.bySlug.get(s)?.displayName ?? s).join(" · ")} — {d.size} kart
            {d.source?.kind ? ` · ${d.source.kind}` : ""}
          </span>
        </button>
      ))}
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

  useEffect(() => {
    api.decks().then(setDecks).catch((e) => setError(String(e.message ?? e)));
    api.bots().then(setBots).catch(() => {});
    loadCardDb().then(setDb).catch(() => {});
  }, []);

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const legal = decks.filter((d) => d.legal);
      const chosenBotDeck = botDeck === "__random" ? legal[Math.floor(Math.random() * legal.length)]!.id : botDeck;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ yourDeck, botDeck, bot }));
      } catch {
        /* private mode */
      }
      const { gameId } = await api.newGame({ yourDeck, botDeck: chosenBotDeck, bot });
      location.hash = `#/game/${gameId}`;
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  return (
    <div className="lobby">
      <header className="lobby-head">
        <h1>
          CYBERPUNK <span>TCG</span> // AI
        </h1>
        <p>Lokalny rywal do treningu. Wybierz talię, talię bota i poziom — gra startuje od razu, bez kolejki.</p>
      </header>
      {error && <div className="banner error">{error}</div>}
      <div className="lobby-grid">
        <section className="panel">
          <h2>Twoja talia</h2>
          <DeckList decks={decks} db={db} value={yourDeck} onChange={setYourDeck} />
        </section>
        <section className="panel">
          <h2>Talia bota</h2>
          <DeckList decks={decks} db={db} value={botDeck} onChange={setBotDeck} allowRandom />
        </section>
        <section className="panel">
          <h2>Poziom bota</h2>
          <div className="bot-list">
            {bots.map((b) => (
              <button key={b.id} className={`bot-row ${bot === b.id ? "sel" : ""}`} onClick={() => setBot(b.id)}>
                <span className="bot-name">
                  {b.label} {!b.fair && <em className="tag warn">widzi Twoje karty</em>}
                </span>
                <span className="bot-desc">{b.description}</span>
              </button>
            ))}
          </div>
          <button className="btn primary big" disabled={busy || !decks.length} onClick={start}>
            {busy ? "Startuję…" : "▶ Graj"}
          </button>
          <p className="hint">Silniejszy, uczciwy i uczący się bot pojawi się w kolejnym etapie.</p>
        </section>
      </div>
    </div>
  );
}
