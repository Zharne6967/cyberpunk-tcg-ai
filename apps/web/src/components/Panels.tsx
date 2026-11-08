import { useEffect, useMemo, useRef, useState } from "react";
import type { CardView, GameStateMessage, LogLine, UiAction } from "@cpai/core/protocol";
import { COLOR_NAME, TYPE_NAME, type CardDb } from "../api.ts";
import { CardFace } from "./CardFace.tsx";
import { cardData } from "./Board.tsx";

type Send = (move: string, args?: Record<string, unknown>) => void;

const GROUP_NAME: Record<string, string> = {
  setup: "Setup",
  play: "Play a Card",
  sell: "Sell a Card",
  legend: "Call a Legend",
  attack: "Attack",
  react: "React",
  ability: "Activate an Effect",
  choice: "Choice",
  phase: "Turn",
  other: "Other",
};

export const CHOICE_TITLE: Record<string, string> = {
  chooseFirstPlayer: "Go first or second",
  gainGig: "Gain a Gig",
  chooseTarget: "Choose a target",
  chooseEffect: "Choose one",
  chooseTrigger: "Pending effects",
  chooseGigsToSteal: "Steal",
  preventGigSteal: "Prevent steal",
  scry: "Search",
  revealDestination: "Reveal",
  chooseCardToPlay: "Play a Card",
  chooseCardToMove: "Choose a card",
  chooseCardType: "Choose a card type",
  redirectDefeat: "Replacement effect",
  chooseSacrificialGear: "Choose a Gear",
};

/** "Turn 3 · Your Main Phase", "React Step"… (official phase/step names). */
export function phaseText(s: GameStateMessage): string {
  const v = s.view;
  if (s.result) return "Game over";
  if (v.gamePhase === "setup") return "Setup";
  const whose = v.activePlayerId === s.you ? "Your" : "Rival's";
  const att = v.attackState;
  if (att) {
    const step: Record<string, string> = { attack: "Attack", react: "React Step", fight: "Fight Step", fightResult: "Fight Step", steal: "Steal Step" };
    return `Turn ${v.turnNumber} · ${step[att.step] ?? att.step}`;
  }
  const phase = v.gamePhase === "main" ? "Main Phase" : v.gamePhase === "start" ? "Start Phase" : v.gamePhase === "end" ? "End Phase" : v.gamePhase;
  return `Turn ${v.turnNumber} · ${whose} ${phase}${v.overtimeActive ? " · Overtime" : ""}`;
}

/** Labels for choice actions that need the choice payload (effect options, trigger texts). */
function choiceLabel(a: UiAction, s: GameStateMessage): string {
  const p = (s.choice?.payload ?? {}) as Record<string, unknown>;
  const args = a.args ?? {};
  if (a.move === "resolveChooseEffect") {
    const opt = (p.options as { id: string; label: string }[] | undefined)?.find((o) => o.id === args.optionId);
    if (opt) return opt.label;
  }
  if (a.move === "resolveTrigger" && !args.pass) {
    const opt = (p.options as { triggerId: string; cardName: string; abilityText: string }[] | undefined)?.find((o) => o.triggerId === args.triggerId);
    if (opt) return `${opt.cardName}: ${opt.abilityText}`;
  }
  return a.label;
}

/** Cards/dice a choice option refers to (highlighted on the table while hovering the option). */
function choiceIds(a: UiAction): string[] {
  const args = a.args ?? {};
  const ids: string[] = [];
  for (const k of ["cardId", "dieId", "targetIds", "cardIds", "dieIds"]) {
    const v = args[k];
    if (typeof v === "string") ids.push(v);
    else if (Array.isArray(v)) ids.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return ids;
}

/** The decision the rules ask you to make right now (targets, pending effects, Gig choices…). */
export function DecisionPanel({ s, db, send, sendAction, onHover }: { s: GameStateMessage; db: CardDb; send: Send; sendAction: (a: UiAction) => void; onHover: (ids: string[]) => void }) {
  const choice = s.choice;
  if (!choice || s.view.gamePhase === "setup") return null;
  const source = (choice.payload as { source?: { displayName?: string; rulesText?: string } } | undefined)?.source;
  const acts = s.actions.filter((a) => a.group === "choice" || a.move === "gainGig");
  return (
    <div className="panel decision-panel">
      <div className="decision-title">{CHOICE_TITLE[choice.type] ?? choice.type}</div>
      {source?.displayName && (
        <div className="choice-src">
          <b>{source.displayName}</b>
          {source.rulesText ? <div className="small">{source.rulesText}</div> : null}
        </div>
      )}
      {choice.type === "scry" && <ScryPicker s={s} db={db} send={send} />}
      {choice.type === "preventGigSteal" && <PreventStealPicker s={s} send={send} />}
      <div className="decision-buttons">
        {acts.map((a) => (
          <button
            key={a.id}
            className="btn act"
            onClick={() => (onHover([]), sendAction(a))}
            onMouseEnter={() => onHover(choiceIds(a))}
            onMouseLeave={() => onHover([])}
          >
            {choiceLabel(a, s)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Learning mode only: every legal action, grouped. */
export function ActionPanel({ s, sendAction, onHover }: { s: GameStateMessage; sendAction: (a: UiAction) => void; onHover: (ids: string[]) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { a: UiAction; n: number }[]>();
    for (const a of s.actions) {
      if (a.move === "passPhase" || a.group === "choice") continue;
      const g = m.get(a.group) ?? [];
      const dup = g.find((x) => x.a.label === a.label && (a.group === "play" || a.group === "sell"));
      if (dup) dup.n++;
      else g.push({ a, n: 1 });
      m.set(a.group, g);
    }
    return [...m.entries()];
  }, [s.actions]);
  return (
    <div className="panel actions-panel">
      {s.botInfo && (
        <div className="small muted">
          Bot: {s.botInfo.iterations} simulations, {(s.botInfo.ms / 1000).toFixed(1)} s, {Math.round(s.botInfo.winRate * 100)}%
        </div>
      )}
      {groups.map(([group, acts]) => (
        <div key={group} className="act-group">
          <div className="act-group-title">{GROUP_NAME[group] ?? group}</div>
          {acts.map(({ a, n }) => (
            <button
              key={a.id}
              className={`btn act g-${a.group}`}
              onClick={() => sendAction(a)}
              onMouseEnter={() => onHover([a.cardId, a.targetId].filter((x): x is string => !!x))}
              onMouseLeave={() => onHover([])}
            >
              {a.label}
              {n > 1 && <span className="mult"> ×{n}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const ZONE_NAME: Record<string, string> = { hand: "Hand", trash: "Trash", deckTop: "Top of deck", deckBottom: "Bottom of deck", field: "Field", eddieArea: "Eddies" };

function ScryPicker({ s, db, send }: { s: GameStateMessage; db: CardDb; send: Send }) {
  const p = s.choice!.payload as {
    revealedCards: CardView[];
    destinations: { zone: string; min?: number; max?: number; remainder?: boolean; eligibleCardIds: string[]; eligibilityLabel: string }[];
  };
  const pickable = p.destinations.filter((d) => !d.remainder);
  const remainder = p.destinations.find((d) => d.remainder);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const submit = () => {
    const destinations = pickable.map((d) => ({ zone: d.zone, cardIds: Object.entries(assign).filter(([, z]) => z === d.zone).map(([id]) => id) }));
    if (remainder) destinations.push({ zone: remainder.zone, cardIds: p.revealedCards.map((c) => c.instanceId).filter((id) => !assign[id]) });
    send("resolveScry", { destinations });
  };
  return (
    <div className="scry">
      {p.revealedCards.map((c) => {
        const opts = pickable.filter((d) => d.eligibleCardIds.includes(c.instanceId));
        return (
          <div key={c.instanceId} className="scry-row">
            <div className="scry-card">
              <CardFace card={cardData(db, c)} size="sm" showText={false} />
            </div>
            <div>
              <div>{c.cardName}</div>
              <select value={assign[c.instanceId] ?? ""} onChange={(e) => setAssign({ ...assign, [c.instanceId]: e.target.value })}>
                <option value="">{remainder ? ZONE_NAME[remainder.zone] ?? remainder.zone : "—"}</option>
                {opts.map((d) => (
                  <option key={d.zone} value={d.zone}>
                    {ZONE_NAME[d.zone] ?? d.zone}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
      <button className="btn primary" onClick={submit}>
        Confirm
      </button>
    </div>
  );
}

function PreventStealPicker({ s, send }: { s: GameStateMessage; send: Send }) {
  const p = s.choice!.payload as { stealEntries: { dieId: string; value: number }[]; handEntries: { cardId: string; cost: number }[] };
  const hand = (s.view.players[s.you]!.zones.hand as CardView[]) ?? [];
  const nameOf = (id: string) => hand.find((c) => c.instanceId === id)?.cardName ?? id;
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const used = new Set(Object.values(pairs));
  return (
    <div className="prevent">
      {p.stealEntries.map((e) => (
        <div key={e.dieId} className="prevent-row">
          Gig <b>{e.value}</b>:{" "}
          <select value={pairs[e.dieId] ?? ""} onChange={(ev) => setPairs({ ...pairs, [e.dieId]: ev.target.value })}>
            <option value="">—</option>
            {p.handEntries
              .filter((h) => h.cost === e.value && (!used.has(h.cardId) || pairs[e.dieId] === h.cardId))
              .map((h) => (
                <option key={h.cardId} value={h.cardId}>
                  {nameOf(h.cardId)}
                </option>
              ))}
          </select>
        </div>
      ))}
      <button
        className="btn primary"
        onClick={() => {
          const preventions = Object.entries(pairs).filter(([, c]) => c).map(([dieId, cardId]) => ({ dieId, cardId }));
          send("resolvePreventGigSteal", preventions.length ? { preventions } : { pass: true, preventions: [] });
        }}
      >
        Confirm
      </button>
    </div>
  );
}

export function LogPanel({ log, rivalName, onCard }: { log: LogLine[]; rivalName: string; onCard: (definitionId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length]);
  return (
    <div className="panel log-panel">
      <h3>Log</h3>
      <div className="log" ref={ref}>
        {log.map((l) => (
          <div key={l.seq} className={`log-line ${l.actor}`}>
            <span className="log-who">{l.actor === "you" ? "You" : l.actor === "rival" ? rivalName : "•"}</span>
            <span className="log-text">
              {l.text}
              {l.cards.map((c) => (
                <button key={c.instanceId} className="log-card" onClick={() => onCard(c.definitionId)}>
                  🔍
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Inspector({ db, definitionId, live, onClose }: { db: CardDb; definitionId: string; live?: CardView; onClose: () => void }) {
  const card = db.byId.get(definitionId) ?? (live?.cardName ? db.byName.get(live.cardName) : undefined);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!card) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal inspector" onClick={(e) => e.stopPropagation()}>
        <div className="insp-img">
          <CardFace card={card} size="lg" />
        </div>
        <div className="insp-body">
          <h2>{card.displayName}</h2>
          <div className="insp-meta">
            <span className={`pill c-${card.color}`}>{COLOR_NAME[card.color]}</span>
            <span className="pill">{TYPE_NAME[card.type]}</span>
            {card.cost != null && <span className="pill">Cost {card.cost} €$</span>}
            {card.power != null && card.type !== "program" && <span className="pill">Power {card.power}</span>}
            {card.ram != null && <span className="pill">RAM {card.ram}</span>}
            {card.sellTag && <span className="pill">Sell Tag €$</span>}
          </div>
          {card.tags.length > 0 && <div className="small">{card.tags.join(", ")}</div>}
          <p className="insp-text">{card.text}</p>
          {live && live.zone === "field" && (
            <div className="insp-live">
              Power {live.effectivePower}
              {live.spent ? " · Spent" : " · Ready"}
              {live.activeEffects.map((e) => (
                <div key={e.id} className={`fx-line ${e.tone}`}>
                  {e.sourceName}: {e.label} {e.durationLabel ? `(${e.durationLabel})` : ""}
                </div>
              ))}
            </div>
          )}
          {card.rulings.length > 0 && (
            <div className="rulings">
              <h4>Official rulings ({card.rulings.length})</h4>
              {card.rulings.map((r, i) => (
                <div key={i} className="ruling">
                  {r.question && <div className="q">Q: {r.question}</div>}
                  <div className="a">A: {r.answer}</div>
                </div>
              ))}
            </div>
          )}
          <div className="small muted">
            {card.set.name} · #{card.printNumber} · {card.rarity}
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Trash is a public area (CR 5.9.2/5.9.3): either player may view its contents and order. */
export function TrashModal({ db, cards, title, onInspect, onClose }: { db: CardDb; cards: CardView[]; title: string; onInspect: (c: CardView) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal trash-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {title} ({cards.length})
        </h3>
        <div className="trash-grid">
          {[...cards].reverse().map((c) => (
            <button key={c.instanceId} className="trash-card" onClick={() => onInspect(c)}>
              <CardFace card={cardData(db, c)} size="sm" showText={false} />
            </button>
          ))}
        </div>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Server asked to disambiguate a table gesture (several abilities, several Gear hosts…). */
export function OptionsModal({ title, options, onPick, onClose }: { title: string; options: { id: string; label: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal options-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {options.map((o) => (
          <button key={o.id} className="btn act" onClick={() => onPick(o.id)}>
            {o.label}
          </button>
        ))}
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
