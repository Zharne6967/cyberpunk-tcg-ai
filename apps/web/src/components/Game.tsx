import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardView, ClientMessage, GameStateMessage, ServerMessage, UiAction } from "@cpai/core/protocol";
import { api, loadCardDb, type CardDb } from "../api.ts";
import { PlayerSide, type BoardCtx } from "./Board.tsx";
import { ActionPanel, Inspector, LogPanel } from "./Panels.tsx";

const REASON_PL: Record<string, string> = {
  gig_victory: "7 Gigów na początku tury",
  overtime_majority: "Dogrywka — większość Gigów",
  deck_out_victory: "Rywalowi skończyła się talia",
  deckOut: "Skończyła się talia",
  concede: "Poddanie partii",
  tied: "Remis",
};

const SPEEDS = [
  { ms: 200, label: "Szybko" },
  { ms: 700, label: "Normalnie" },
  { ms: 1500, label: "Wolno" },
];

function useGameSocket(gameId: string) {
  const [state, setState] = useState<GameStateMessage>();
  const [toast, setToast] = useState<string>();
  const [conn, setConn] = useState<"connecting" | "open" | "closed" | "missing">("connecting");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws?game=${gameId}`);
      wsRef.current = ws;
      ws.onopen = () => setConn("open");
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === "state") setState(msg);
        else setToast(msg.message);
      };
      ws.onclose = () => {
        if (stop) return;
        setConn("closed");
        api
          .gameExists(gameId)
          .then(() => (retry = setTimeout(connect, 1000)))
          .catch(() => setConn("missing"));
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [gameId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const send = useCallback((msg: ClientMessage) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg)), []);
  return { state, toast, conn, send };
}

export function Game({ gameId }: { gameId: string }) {
  const { state, toast, conn, send } = useGameSocket(gameId);
  const [db, setDb] = useState<CardDb>();
  const [menu, setMenu] = useState<{ card: CardView; x: number; y: number } | null>(null);
  const [inspect, setInspect] = useState<{ definitionId: string; live?: CardView } | null>(null);
  const [hover, setHover] = useState<string[]>([]);
  const [speed, setSpeed] = useState(() => {
    try {
      return Number(localStorage.getItem("cpai.speed") ?? 700);
    } catch {
      return 700;
    }
  });
  const [hideResult, setHideResult] = useState(false);

  useEffect(() => {
    loadCardDb().then(setDb);
  }, []);
  useEffect(() => {
    if (conn === "open") send({ type: "setBotSpeed", ms: speed });
  }, [conn, speed, send]);

  const actionsByCard = useMemo(() => {
    const m = new Map<string, UiAction[]>();
    for (const a of state?.actions ?? []) {
      if (!a.cardId) continue;
      const list = m.get(a.cardId) ?? [];
      list.push(a);
      m.set(a.cardId, list);
    }
    return m;
  }, [state?.actions]);

  const sendAction = useCallback(
    (a: UiAction) => {
      if (!state) return;
      setMenu(null);
      setHover([]);
      send({ type: "action", actionId: a.id, stateID: state.view.stateID });
    },
    [send, state],
  );
  const sendCommand = useCallback(
    (move: string, args?: Record<string, unknown>) => state && send({ type: "command", move, args, stateID: state.view.stateID }),
    [send, state],
  );

  // Enter = pass / end turn.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !state || inspect) return;
      const pass = state.actions.find((a) => a.move === "passPhase");
      if (pass) sendAction(pass);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [state, sendAction, inspect]);

  if (conn === "missing")
    return (
      <div className="center-msg">
        <p>Ta gra już nie istnieje (serwer był restartowany).</p>
        <a className="btn primary" href="#/">
          Wróć do lobby
        </a>
      </div>
    );
  if (!state || !db) return <div className="center-msg">Łączenie z grą…</div>;

  const ctx: BoardCtx = {
    db,
    state,
    actionsByCard,
    highlight: new Set([...hover, ...(menu ? [menu.card.instanceId] : [])]),
    onCard: (card, anchor) => {
      const r = anchor.getBoundingClientRect();
      setMenu({ card, x: Math.min(r.left, window.innerWidth - 340), y: r.bottom + 4 });
    },
    onInspect: (card) => setInspect({ definitionId: card.definitionId, live: card }),
  };
  const menuActions = menu ? (actionsByCard.get(menu.card.instanceId) ?? []) : [];

  return (
    <div className="game" onClick={() => menu && setMenu(null)}>
      <div className="topbar">
        <a href="#/" className="brand">
          CYBERPUNK <span>TCG</span> // AI
        </a>
        <span className="vs">
          {state.yourDeck} <b>vs</b> {state.botDeck}
        </span>
        <span className="spacer" />
        <label className="speed">
          Tempo bota{" "}
          <select
            value={speed}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSpeed(v);
              try {
                localStorage.setItem("cpai.speed", String(v));
              } catch {
                /* ignore */
              }
            }}
          >
            {SPEEDS.map((s) => (
              <option key={s.ms} value={s.ms}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {!state.result && (
          <button className="btn danger small" onClick={() => confirm("Na pewno poddać partię?") && send({ type: "concede" })}>
            Poddaj
          </button>
        )}
        {conn !== "open" && <span className="tag warn">rozłączono — łączę ponownie…</span>}
      </div>
      <div className="table">
        <div className="board">
          <PlayerSide seat={state.bot} ctx={ctx} mine={false} />
          <div className="midline">
            <span>{state.view.attackState ? "⚔ trwa atak" : ""}</span>
          </div>
          <PlayerSide seat={state.you} ctx={ctx} mine />
        </div>
        <div className="sidebar">
          <ActionPanel s={state} db={db} send={sendCommand} sendAction={sendAction} onHover={setHover} />
          <LogPanel log={state.log} onCard={(definitionId) => setInspect({ definitionId })} />
        </div>
      </div>

      {menu && (
        <div className="card-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="card-menu-title">{menu.card.cardName ?? "Karta"}</div>
          {menuActions.map((a) => (
            <button key={a.id} className={`btn act g-${a.group}`} onMouseEnter={() => setHover(a.targetId ? [a.targetId] : [])} onClick={() => sendAction(a)}>
              {a.label}
            </button>
          ))}
          {menu.card.cardName && (
            <button className="btn ghost" onClick={() => (setInspect({ definitionId: menu.card.definitionId, live: menu.card }), setMenu(null))}>
              🔍 Szczegóły karty
            </button>
          )}
        </div>
      )}
      {inspect && <Inspector db={db} definitionId={inspect.definitionId} live={inspect.live} onClose={() => setInspect(null)} />}
      {toast && <div className="toast">{toast}</div>}
      {state.result && !hideResult && (
        <div className="result-overlay">
          <div className={`result ${state.result.winner}`}>
            <h2>{state.result.winner === "you" ? "WYGRAŁEŚ" : state.result.winner === "bot" ? "PRZEGRAŁEŚ" : "REMIS"}</h2>
            <p>
              {REASON_PL[state.result.reason ?? ""] ?? state.result.reason ?? ""} · tura {state.view.turnNumber}
            </p>
            <div className="row">
              <a className="btn primary" href="#/">
                Nowa partia
              </a>
              <button className="btn" onClick={() => setHideResult(true)}>
                Zobacz stół
              </button>
            </div>
            <p className="small muted">Partia zapisana w var/games — bot będzie się z niej uczył w etapie 4.</p>
          </div>
        </div>
      )}
    </div>
  );
}
