import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coachKey, type CardView, type ClientMessage, type CoachAdvice, type CoachMove, type GameStateMessage, type Intent, type ServerMessage, type UiAction, type WaitingMessage } from "@cpai/core/protocol";
import { api, loadCardDb, seatTicket, type CardDb } from "../api.ts";
import { askCoach, stopCoach } from "../coach.ts";
import { WaitingRoom } from "./Rooms.tsx";
import { CardFace } from "./CardFace.tsx";
import { GigArea, Mat, RivalHand, Strip, YourHand, cardData, type BoardCtx } from "./Board.tsx";
import { ActionPanel, DecisionPanel, Inspector, LogPanel, OptionsModal, TrashModal, phaseText } from "./Panels.tsx";

const RESULT_REASON: Record<string, string> = {
  gig_victory: "Gig victory",
  overtime_majority: "Overtime",
  deck_out_victory: "Deck out",
  deckOut: "Deck out",
  concede: "Concede",
  tied: "Tie",
};

const SPEEDS = [
  { ms: 200, label: "Fast" },
  { ms: 700, label: "Normal" },
  { ms: 1500, label: "Slow" },
];

type Options = { title: string; options: { id: string; label: string }[] };

function useGameSocket(gameId: string) {
  const [state, setState] = useState<GameStateMessage>();
  const [waiting, setWaiting] = useState<WaitingMessage | null>(null);
  const [toast, setToast] = useState<string>();
  const [options, setOptions] = useState<Options | null>(null);
  const ticket = useMemo(() => seatTicket(gameId), [gameId]);
  const [conn, setConn] = useState<"connecting" | "open" | "closed" | "missing" | "noseat">(ticket ? "connecting" : "noseat");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!ticket) return;
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      // The seat token decides which side of the table (and which hidden cards) this browser sees.
      const ws = new WebSocket(`${proto}://${location.host}/ws?game=${gameId}&token=${encodeURIComponent(ticket.token)}`);
      wsRef.current = ws;
      ws.onopen = () => setConn("open");
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === "state") {
          setState(msg);
          setWaiting(null);
          setOptions(null);
        } else if (msg.type === "waiting") setWaiting(msg);
        else if (msg.type === "options") setOptions({ title: msg.title, options: msg.options });
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
  }, [gameId, ticket]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const send = useCallback((msg: ClientMessage) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg)), []);
  return { state, waiting, ticket, toast, options, setOptions, conn, send };
}

const pct = (x: number | null) => (x === null ? "" : `${Math.round(x * 100)}%`);

/** The coach's advice: best move (click = play it), alternatives, the rest of the turn's plan. */
function CoachPanel({
  loading,
  error,
  advice,
  items,
  onPlay,
  onHover,
  compact,
}: {
  loading: boolean;
  error?: string;
  advice?: CoachAdvice;
  items: { move: CoachMove; action?: UiAction }[];
  onPlay: (a: UiAction) => void;
  onHover: (ids: string[]) => void;
  compact?: boolean;
}) {
  const ids = (m: CoachMove) => [m.cardId, m.targetId].filter((x): x is string => !!x);
  const row = (it: { move: CoachMove; action?: UiAction }, best: boolean) => (
    <button
      key={it.move.key}
      className={`btn act coach-move ${best ? "best" : ""}`}
      disabled={!it.action}
      onClick={() => it.action && onPlay(it.action)}
      onMouseEnter={() => onHover(ids(it.move))}
      onMouseLeave={() => onHover([])}
    >
      <span>{it.move.label}</span>
      <b>{pct(it.move.winRate)}</b>
    </button>
  );
  return (
    <div className={`panel coach-panel ${compact ? "compact" : ""}`}>
      <div className="coach-head">
        <span>Coach</span>
        {loading && <span className="small muted">Thinking…</span>}
        {!loading && advice && advice.iterations > 0 && <span className="small muted">{advice.iterations} simulations</span>}
      </div>
      {error ? (
        <div className="small muted">{error}</div>
      ) : items.length ? (
        <>
          {items.slice(0, compact ? 1 : 3).map((it, i) => row(it, i === 0))}
          {!compact && advice && advice.why.length > 0 && (
            <div className="coach-why small">
              <div className="muted">By your next turn: this move (with {advice.whyVs})</div>
              {advice.why.map((w) => (
                <div key={w.text} className={w.good ? "good" : "cost"}>
                  {w.good ? "+" : "−"} {w.text}
                </div>
              ))}
            </div>
          )}
          {advice && advice.plan.length > 0 && (
            <div className="coach-plan small">
              <span className="muted">Then: </span>
              {advice.plan.join(" → ")}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Start of the game: CR 7.5 (a random player decides who goes first) and the opening hand. */
function SetupDialog({ state, onAction }: { state: GameStateMessage; onAction: (a: UiAction) => void }) {
  const [botNoticeClosed, setBotNoticeClosed] = useState(false);
  if (state.view.gamePhase !== "setup") return null;
  const first = state.actions.filter((a) => a.move === "resolveFirstPlayer");
  const hand = state.actions.filter((a) => a.move === "keepHand" || a.move === "mulligan");
  const botChoice = state.log.find((l) => l.actor === "rival" && l.key === "setup.firstPlayerChoice");
  let body: import("react").ReactNode = null;
  if (first.length) {
    body = (
      <>
        <h2>First player</h2>
        <p>You were chosen at random. Go first or second?</p>
        <div className="row">
          {first.map((a) => (
            <button key={a.id} className="btn primary" onClick={() => onAction(a)}>
              {a.label}
            </button>
          ))}
        </div>
      </>
    );
  } else if (botChoice && !botNoticeClosed && !hand.length) {
    body = (
      <>
        <h2>First player</h2>
        <p>{state.rivalLabel} was chosen at random: {botChoice.text}</p>
        <div className="row">
          <button className="btn primary" onClick={() => setBotNoticeClosed(true)}>
            OK
          </button>
        </div>
      </>
    );
  } else if (hand.length) {
    body = (
      <>
        <h2>Opening hand</h2>
        {botChoice && <p className="small muted">{state.rivalLabel}: {botChoice.text}</p>}
        <div className="row">
          {hand.map((a) => (
            <button key={a.id} className={`btn ${a.move === "keepHand" ? "primary" : ""}`} onClick={() => onAction(a)}>
              {a.label}
            </button>
          ))}
        </div>
      </>
    );
  }
  if (!body) return null;
  return (
    <div className="setup-overlay">
      <div className="result setup">{body}</div>
    </div>
  );
}

/**
 * Card details without clicking: next to the card after a short mouse hover, or centred after a
 * press-and-hold on a touch screen (tap anywhere to close).
 */
function CardPreview({ db, preview, onClose, onDetails }: { db: CardDb; preview: { card: CardView; rect: DOMRect; touch: boolean }; onClose: () => void; onDetails: () => void }) {
  const data = cardData(db, preview.card);
  if (!data) return null;
  const c = preview.card;
  const live = c.zone === "field" && (c.effectivePower !== c.power || c.activeEffects.length > 0) && (
    <div className="preview-live">
      {c.effectivePower !== c.power && <div>Power {c.effectivePower}</div>}
      {c.activeEffects.map((e) => (
        <div key={e.id} className={`fx-line ${e.tone}`}>
          {e.sourceName}: {e.label}
        </div>
      ))}
    </div>
  );
  if (preview.touch)
    return (
      <div className="preview-touch" onClick={onClose}>
        <CardFace card={data} size="lg" />
        {live}
        <button className="btn small" onClick={(e) => (e.stopPropagation(), onDetails())}>
          Rulings
        </button>
      </div>
    );
  const w = 300;
  const h = 420;
  const r = preview.rect;
  const left = r.right + 12 + w < window.innerWidth ? r.right + 12 : Math.max(8, r.left - 12 - w);
  const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), window.innerHeight - h - 8);
  return (
    <div className="preview-hover" style={{ left, top }}>
      <CardFace card={data} size="lg" />
      {live}
    </div>
  );
}

/** Win chance from what is openly on the table (learned model on public information). */
function WinChanceBar({ you }: { you: number }) {
  const y = Math.round(you * 100);
  return (
    <div className="chance" title="Win chance from the cards on the table">
      <span className="chance-you">{y}%</span>
      <div className="chance-bar">
        <div className="chance-fill" style={{ width: `${y}%` }} />
      </div>
      <span className="chance-bot">{100 - y}%</span>
    </div>
  );
}

function WinChanceChart({ points }: { points: [number, number][] }) {
  const w = 300;
  const h = 80;
  const maxTurn = Math.max(...points.map((p) => p[0]));
  const minTurn = Math.min(...points.map((p) => p[0]));
  const x = (t: number) => ((t - minTurn) / Math.max(1, maxTurn - minTurn)) * w;
  const y = (p: number) => h - p * h;
  return (
    <div className="chance-chart">
      <div className="small muted">Win chance by turn</div>
      <svg viewBox={`-4 -4 ${w + 8} ${h + 8}`} width={w} height={h}>
        <line x1={0} x2={w} y1={h / 2} y2={h / 2} className="mid" />
        <polyline points={points.map(([t, p]) => `${x(t)},${y(p)}`).join(" ")} />
      </svg>
    </div>
  );
}

interface MenuItem {
  label: string;
  run: () => void;
}

function ownerOf(s: GameStateMessage, id: string): string | undefined {
  for (const [seat, p] of Object.entries(s.view.players))
    for (const z of Object.values(p.zones)) if (Array.isArray(z) && z.some((c) => c.instanceId === id)) return seat;
  return undefined;
}

export function Game({ gameId }: { gameId: string }) {
  const { state, waiting, ticket, toast, options, setOptions, conn, send } = useGameSocket(gameId);
  const [db, setDb] = useState<CardDb>();
  const [menu, setMenu] = useState<{ card: CardView; items: MenuItem[]; x: number; y: number } | null>(null);
  const [inspect, setInspect] = useState<{ definitionId: string; live?: CardView } | null>(null);
  const [trashSeat, setTrashSeat] = useState<string | null>(null);
  const [targeting, setTargeting] = useState<{ attackerId: string } | null>(null);
  const [hover, setHover] = useState<string[]>([]);
  const [hints, setHints] = useState(() => {
    try {
      return localStorage.getItem("cpai.hints") === "1";
    } catch {
      return false;
    }
  });
  const [speed, setSpeed] = useState(() => {
    try {
      return Number(localStorage.getItem("cpai.speed") ?? 700);
    } catch {
      return 700;
    }
  });
  const [hideResult, setHideResult] = useState(false);
  const [preview, setPreview] = useState<{ card: CardView; rect: DOMRect; touch: boolean } | null>(null);
  // Phone layout: the log is a bottom sheet, the options live behind "⋯".
  const [logOpen, setLogOpen] = useState(false);
  // In-page confirmation: browser confirm() dialogs can be blocked (e.g. in embedded browsers).
  const [confirmConcede, setConfirmConcede] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const [showChance, setShowChance] = useState(() => {
    try {
      return localStorage.getItem("cpai.winChance") !== "0";
    } catch {
      return true;
    }
  });
  // Your win chance at the end of each turn (for the chart on the result screen).
  const chanceByTurn = useRef(new Map<number, number>());
  if (state?.winChance != null) chanceByTurn.current.set(state.view.turnNumber, state.winChance);

  useEffect(() => {
    loadCardDb().then(setDb);
  }, []);
  useEffect(() => {
    if (conn === "open") send({ type: "setBotSpeed", ms: speed });
  }, [conn, speed, send]);

  // ---- Coach: your best move, searched in this browser from what you know (the rival sees "Coach ON").
  const [coachOn, setCoachOn] = useState(() => {
    try {
      return localStorage.getItem("cpai.coach") === "1";
    } catch {
      return false;
    }
  });
  const [coach, setCoach] = useState<{ stateID: number; advice?: CoachAdvice; error?: string } | null>(null);
  const serverCoach = state?.coach.you;
  useEffect(() => {
    if (conn === "open" && serverCoach !== undefined && serverCoach !== coachOn) send({ type: "coach", on: coachOn });
  }, [conn, serverCoach, coachOn, send]);
  const coachTurn = !!state && !state.result && (state.promptStatus === "action" || state.promptStatus === "choice") && state.actions.length > 0;
  const stateID = state?.view.stateID;
  // A single legal move needs no search.
  const onlyAction = state && state.actions.length === 1 ? state.actions[0]! : null;
  useEffect(() => {
    if (!coachOn || !serverCoach || !coachTurn || stateID === undefined) {
      setCoach(null);
      return;
    }
    if (onlyAction) {
      const m: CoachMove = { key: coachKey(onlyAction.move, onlyAction.args), move: onlyAction.move, args: onlyAction.args, label: onlyAction.label, cardId: onlyAction.cardId, targetId: onlyAction.targetId, visits: 0, winRate: null };
      setCoach({ stateID, advice: { stateID, moves: [m], plan: [], why: [], whyVs: null, iterations: 0, ms: 0 } });
      return;
    }
    let live = true;
    setCoach({ stateID });
    const t = setTimeout(() => {
      api
        .coachWorld(gameId)
        .then((world) => askCoach(world))
        .then((advice) => live && setCoach({ stateID, advice }))
        .catch((e: Error) => live && e.name !== "AbortError" && setCoach({ stateID, error: e.message }));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [coachOn, serverCoach, coachTurn, stateID, gameId]);
  useEffect(() => () => stopCoach(), []);
  const coachAdvice = coach && coach.stateID === stateID ? coach.advice : undefined;
  const coachActions = useMemo(() => {
    const byKey = new Map((state?.actions ?? []).map((a) => [coachKey(a.move, a.args), a]));
    return (coachAdvice?.moves ?? []).map((m) => ({ move: m, action: byKey.get(m.key) }));
  }, [coachAdvice, state?.actions]);
  const coachPick = useMemo(() => {
    const best = coachAdvice?.moves[0];
    return new Set([best?.cardId, best?.targetId].filter((x): x is string => !!x));
  }, [coachAdvice]);

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
  const sendCommand = useCallback((move: string, args?: Record<string, unknown>) => state && send({ type: "command", move, args, stateID: state.view.stateID }), [send, state]);
  const sendIntent = useCallback(
    (intent: Intent) => {
      if (!state) return;
      setMenu(null);
      setTargeting(null);
      send({ type: "intent", intent, stateID: state.view.stateID });
    },
    [send, state],
  );

  // Enter = pass, Esc = cancel.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!state || inspect || trashSeat) return;
      if (e.key === "Escape") {
        setMenu(null);
        setTargeting(null);
      }
      if (e.key === "Enter" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) sendIntent({ kind: "pass" });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [state, sendIntent, inspect, trashSeat]);

  if (conn === "missing" || conn === "noseat")
    return (
      <div className="center-msg">
        <p>{conn === "missing" ? "This game no longer exists (the server was restarted)." : "You are not a player in this game."}</p>
        <a className="btn primary" href="#/">
          Back to lobby
        </a>
      </div>
    );
  if (waiting && ticket) return <WaitingRoom gameId={gameId} invite={ticket.invite} hostDeck={waiting.hostDeck} />;
  if (!state || !db) return <div className="center-msg">Connecting…</div>;

  const choosing = !!state.choice && state.view.gamePhase !== "setup";
  const view = (card: CardView) => setInspect({ definitionId: card.definitionId, live: card });

  /** Generic, official table actions for a card — not filtered by legality (the engine judges). */
  const tableMenu = (card: CardView): MenuItem[] => {
    const items: MenuItem[] = [];
    const data = cardData(db, card);
    if (hints) {
      for (const a of actionsByCard.get(card.instanceId) ?? []) items.push({ label: a.label, run: () => sendAction(a) });
    } else if (ownerOf(state, card.instanceId) === state.you) {
      const kw = data?.keywords ?? [];
      if (card.zone === "hand") {
        items.push({ label: "Play a Card", run: () => sendIntent({ kind: "play", cardId: card.instanceId }) });
        if (data?.sellTag) items.push({ label: "Sell a Card", run: () => sendIntent({ kind: "sell", cardId: card.instanceId }) });
        if (kw.includes("goSolo")) items.push({ label: "[GO SOLO]", run: () => sendIntent({ kind: "goSolo", cardId: card.instanceId }) });
      } else if (card.zone === "legendArea") {
        if (card.faceDown) items.push({ label: "Call a Legend", run: () => sendIntent({ kind: "call", cardId: card.instanceId }) });
        else {
          items.push({ label: "Play a Card", run: () => sendIntent({ kind: "play", cardId: card.instanceId }) });
          items.push({ label: "Activate an Effect", run: () => sendIntent({ kind: "activate", cardId: card.instanceId }) });
        }
      } else if (card.zone === "field") {
        if (card.type === "unit" || card.type === "legend") {
          items.push({ label: "Attack", run: () => (setMenu(null), setTargeting({ attackerId: card.instanceId })) });
          if (kw.includes("blocker")) items.push({ label: "[BLOCKER]", run: () => sendIntent({ kind: "block", cardId: card.instanceId }) });
        }
        items.push({ label: "Activate an Effect", run: () => sendIntent({ kind: "activate", cardId: card.instanceId }) });
      }
    }
    if (data) items.push({ label: "View Card", run: () => (setMenu(null), view(card)) });
    return items;
  };

  const ctx: BoardCtx = {
    db,
    state,
    hints,
    actionsByCard,
    highlight: new Set([...hover, ...(menu ? [menu.card.instanceId] : []), ...(targeting ? [targeting.attackerId] : [])]),
    coachPick,
    onCardClick: (card, anchor) => {
      if (targeting) {
        if (ownerOf(state, card.instanceId) === state.rival && card.zone === "field") sendIntent({ kind: "attack", cardId: targeting.attackerId, targetId: card.instanceId });
        else setTargeting(null);
        return;
      }
      if (choosing) return sendIntent({ kind: "select", id: card.instanceId });
      const items = tableMenu(card);
      if (items.length === 1 && items[0]!.label === "View Card") return view(card);
      if (!items.length) return;
      const r = anchor.getBoundingClientRect();
      setMenu({ card, items, x: Math.min(r.left, window.innerWidth - 240), y: Math.min(r.bottom + 4, window.innerHeight - 40 * items.length - 20) });
    },
    onGigAreaClick: (seat) => {
      if (targeting && seat === state.rival) sendIntent({ kind: "attack", cardId: targeting.attackerId, targetId: "rival" });
    },
    onInspect: view,
    onIntent: sendIntent,
    onTrash: setTrashSeat,
    onPreview: (card, rect, touch) => setPreview(card && rect ? { card, rect, touch: !!touch } : null),
  };

  const myPrompt = state.promptStatus === "action" || state.promptStatus === "choice";
  const passLabel = state.view.attackState?.step === "react" ? "Pass" : "Pass Turn";
  const trashCards = trashSeat ? ((state.view.players[trashSeat]!.zones.trash as CardView[]) ?? []) : [];

  return (
    <div className="game" onClick={() => (menu && setMenu(null), optsOpen && setOptsOpen(false))}>
      <div className="topbar">
        <a href="#/" className="brand">
          CYBERPUNK <span>TCG</span> // AI
        </a>
        <span className="vs">
          {state.yourDeck} <b>vs</b> {state.rivalDeck} <span className="muted">({state.rivalLabel})</span>
        </span>
        {state.coach.you && <span className="tag coach-on">Coach ON</span>}
        {state.coach.rival && <span className="tag coach-on">{state.rivalLabel}: Coach ON</span>}
        <span className="spacer" />
        <button className="btn small mobile-only" onClick={(e) => (e.stopPropagation(), setLogOpen(!logOpen))}>
          Log
        </button>
        <button className="btn small mobile-only" onClick={(e) => (e.stopPropagation(), setOptsOpen(!optsOpen))}>
          ⋯
        </button>
        <div className={`top-opts ${optsOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <label className="opt">
          <input
            type="checkbox"
            checked={hints}
            onChange={(e) => {
              setHints(e.target.checked);
              try {
                localStorage.setItem("cpai.hints", e.target.checked ? "1" : "0");
              } catch {
                /* ignore */
              }
            }}
          />{" "}
          Learning mode
        </label>
        <label className="opt">
          <input
            type="checkbox"
            checked={showChance}
            onChange={(e) => {
              setShowChance(e.target.checked);
              try {
                localStorage.setItem("cpai.winChance", e.target.checked ? "1" : "0");
              } catch {
                /* ignore */
              }
            }}
          />{" "}
          Win chance
        </label>
        <label className="opt" title="Best move from what you know. Your rival sees Coach ON.">
          <input
            type="checkbox"
            checked={coachOn}
            onChange={(e) => {
              setCoachOn(e.target.checked);
              try {
                localStorage.setItem("cpai.coach", e.target.checked ? "1" : "0");
              } catch {
                /* ignore */
              }
            }}
          />{" "}
          Coach
        </label>
        {state.mode === "bot" && (
        <label className="opt">
          Bot speed{" "}
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
        )}
        {!state.result && (
          <button
            className="btn danger small"
            onClick={() => (confirmConcede ? (send({ type: "concede" }), setConfirmConcede(false)) : setConfirmConcede(true))}
            onBlur={() => setConfirmConcede(false)}
          >
            {confirmConcede ? "Confirm concede" : "Concede"}
          </button>
        )}
        </div>
        {conn !== "open" && <span className="tag warn">Reconnecting…</span>}
      </div>

      <div className="table-wrap">
        <div className="tabletop">
          <RivalHand ctx={ctx} />
          <Mat seat={state.rival} ctx={ctx} rival />
          <Strip>
            <GigArea seat={state.rival} ctx={ctx} label="RIVAL GIGS" rival />
            <div className={`phase-box ${state.view.activePlayerId === state.you ? "you" : "bot"}`}>
              <div className="phase-text">
                {phaseText(state)}
                {state.rivalThinking && <span className="dots" />}
              </div>
              {showChance && state.winChance != null && <WinChanceBar you={state.winChance} />}
              {!state.result && state.view.gamePhase !== "setup" && (
                <button className="btn primary pass" disabled={!myPrompt || choosing} onClick={() => sendIntent({ kind: "pass" })}>
                  {passLabel}
                </button>
              )}
            </div>
            <GigArea seat={state.you} ctx={ctx} label="FRIENDLY GIGS" rival={false} />
          </Strip>
          <Mat seat={state.you} ctx={ctx} rival={false} />
          {coachOn && coach && (
            <div className="coach-inline">
              <CoachPanel compact loading={!coach.advice && !coach.error} error={coach.error} advice={coachAdvice} items={coachActions} onPlay={sendAction} onHover={setHover} />
            </div>
          )}
          <YourHand ctx={ctx} />
        </div>
        <aside className={`sidebar ${logOpen ? "open" : ""} ${choosing ? "has-decision" : ""}`}>
          <button className="btn small mobile-only sheet-close" onClick={() => setLogOpen(false)}>
            Close
          </button>
          <LogPanel log={state.log} rivalName={state.rivalLabel} onCard={(definitionId) => setInspect({ definitionId })} />
          {coachOn && coach && (
            <CoachPanel loading={!coach.advice && !coach.error} error={coach.error} advice={coachAdvice} items={coachActions} onPlay={sendAction} onHover={setHover} />
          )}
          <DecisionPanel s={state} db={db} send={sendCommand} sendAction={sendAction} onHover={setHover} />
          {hints && <ActionPanel s={state} sendAction={sendAction} onHover={setHover} />}
        </aside>
      </div>

      {targeting && (
        <div className="targeting-bar">
          Attack target{" "}
          <button className="btn small" onClick={() => setTargeting(null)}>
            Cancel
          </button>
        </div>
      )}
      {menu && (
        <div className="card-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="card-menu-title">{menu.card.cardName ?? (menu.card.zone === "legendArea" ? "Legend" : "Card")}</div>
          {menu.items.map((it) => (
            <button key={it.label} className="btn act" onClick={it.run}>
              {it.label}
            </button>
          ))}
        </div>
      )}
      {options && (
        <OptionsModal
          title={options.title}
          options={options.options}
          onPick={(id) => {
            setOptions(null);
            send({ type: "action", actionId: id, stateID: state.view.stateID });
          }}
          onClose={() => setOptions(null)}
        />
      )}
      {trashSeat && <TrashModal db={db} cards={trashCards} title={trashSeat === state.you ? "Your trash" : "Rival trash"} onInspect={view} onClose={() => setTrashSeat(null)} />}
      {preview && !menu && <CardPreview db={db} preview={preview} onClose={() => setPreview(null)} onDetails={() => (setPreview(null), view(preview.card))} />}
      {inspect && <Inspector db={db} definitionId={inspect.definitionId} live={inspect.live} onClose={() => setInspect(null)} />}
      {toast && <div className="toast">{toast}</div>}
      {!state.result && <SetupDialog state={state} onAction={sendAction} />}
      {state.result && !hideResult && (
        <div className="result-overlay">
          <div className={`result ${state.result.winner}`}>
            <h2>{state.result.winner === "you" ? "YOU WIN" : state.result.winner === "rival" ? "YOU LOSE" : "DRAW"}</h2>
            <p>
              {RESULT_REASON[state.result.reason ?? ""] ?? state.result.reason ?? ""} · Turn {state.view.turnNumber}
            </p>
            {chanceByTurn.current.size > 1 && <WinChanceChart points={[...chanceByTurn.current.entries()].sort((a, b) => a[0] - b[0])} />}
            <div className="row">
              <a className="btn primary" href="#/">
                New game
              </a>
              <button className="btn" onClick={() => setHideResult(true)}>
                View table
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
