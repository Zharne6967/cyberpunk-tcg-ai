import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CardView, GameStateMessage, UiAction } from "@cpai/core/protocol";
import type { CardDb } from "../api.ts";
import { CardFace } from "./CardFace.tsx";
import { cardData } from "./Board.tsx";

/**
 * Choices where you pick among cards that are not on the table (searching the deck, revealed cards,
 * cards to play or move): a window over the table with every card large, the eligible ones lit,
 * click to pick, a counter, Done — and Hide to look at the board meanwhile.
 */
export const CARD_PICK_TYPES = new Set(["scry", "revealDestination", "chooseCardToPlay", "chooseCardToMove"]);

const TITLE: Record<string, string> = { scry: "Search", revealDestination: "Reveal", chooseCardToPlay: "Play a Card", chooseCardToMove: "Choose a card" };
const ZONE: Record<string, string> = { hand: "Hand", trash: "Trash", deckTop: "Top of deck", deckBottom: "Bottom of deck", field: "Field", eddieArea: "Eddies", legendArea: "Legends" };
const zoneName = (z: string | undefined) => (z ? (ZONE[z] ?? z.replace(/^./, (c) => c.toUpperCase())) : "");

interface Dest {
  zone: string;
  min?: number;
  max?: number;
  remainder?: boolean;
  eligibleCardIds: string[];
  eligibilityLabel: string;
}

type Send = (move: string, args?: Record<string, unknown>) => void;
type Preview = (card: CardView | null, rect?: DOMRect) => void;

/** One card: large image, lit when it can be picked, a short hover shows it bigger. */
function PickCard({ db, card, state, tag, onClick, onPreview }: { db: CardDb; card: CardView; state: "picked" | "eligible" | "off"; tag?: string; onClick?: () => void; onPreview: Preview }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={`pick-card ${state}`}
      disabled={state === "off"}
      onClick={onClick}
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onPreview(card, rect), 450);
      }}
      onMouseLeave={() => (clearTimeout(timer.current), onPreview(null))}
    >
      <CardFace card={cardData(db, card)} size="md" showText={false} />
      {tag && <span className="pick-tag">{tag}</span>}
    </button>
  );
}

function range(d: Dest): string {
  if (d.max === undefined) return d.min ? `at least ${d.min}` : "any number";
  if (d.min && d.min === d.max) return `exactly ${d.max}`;
  if (d.min) return `${d.min} to ${d.max}`;
  return `up to ${d.max}`;
}

/** Search (scry): put revealed cards into the destinations the effect allows; the rest go to the remainder zone. */
function SearchPick({ s, db, send, onPreview, footer }: { s: GameStateMessage; db: CardDb; send: Send; onPreview: Preview; footer: (done: ReactNode) => ReactNode }) {
  const p = s.choice!.payload as { revealedCards: CardView[]; destinations: Dest[] };
  const pickable = p.destinations.filter((d) => !d.remainder);
  const remainder = p.destinations.find((d) => d.remainder);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const count = (zone: string) => Object.values(assign).filter((z) => z === zone).length;
  const room = (d: Dest) => d.max === undefined || count(d.zone) < d.max;
  const click = (id: string) => {
    const options = pickable.filter((d) => d.eligibleCardIds.includes(id));
    if (!options.length) return;
    const current = assign[id];
    const next = { ...assign };
    if (current) {
      // Picked: move on to the next destination it may go to, or put it back.
      const i = options.findIndex((d) => d.zone === current);
      const after = options.slice(i + 1).find((d) => room(d));
      if (after) next[id] = after.zone;
      else delete next[id];
    } else {
      const free = options.find((d) => room(d));
      if (free) next[id] = free.zone;
      else if (options.length === 1 && options[0]!.max === 1) {
        // Only one may be taken: switch to this card.
        for (const [k, z] of Object.entries(next)) if (z === options[0]!.zone) delete next[k];
        next[id] = options[0]!.zone;
      } else return;
    }
    setAssign(next);
  };
  const ok = pickable.every((d) => count(d.zone) >= (d.min ?? 0) && (d.max === undefined || count(d.zone) <= d.max));
  const submit = () => {
    const destinations = pickable.map((d) => ({ zone: d.zone, cardIds: Object.entries(assign).filter(([, z]) => z === d.zone).map(([id]) => id) }));
    if (remainder) destinations.push({ zone: remainder.zone, cardIds: p.revealedCards.map((c) => c.instanceId).filter((id) => !assign[id]) });
    send("resolveScry", { destinations });
  };
  const multi = pickable.length > 1;
  return (
    <>
      <div className="pick-rules">
        {pickable.map((d) => (
          <div key={d.zone}>
            <b>{zoneName(d.zone)}</b>: {d.eligibilityLabel}, {range(d)} <span className="pick-count">({count(d.zone)}{d.max !== undefined ? `/${d.max}` : ""})</span>
          </div>
        ))}
        {remainder && <div className="muted">The rest: {zoneName(remainder.zone)}</div>}
      </div>
      <div className="pick-cards">
        {p.revealedCards.map((c) => {
          const eligible = pickable.some((d) => d.eligibleCardIds.includes(c.instanceId));
          const z = assign[c.instanceId];
          return (
            <PickCard
              key={c.instanceId}
              db={db}
              card={c}
              state={z ? "picked" : eligible ? "eligible" : "off"}
              tag={z ? (multi ? zoneName(z) : "✓") : undefined}
              onClick={() => click(c.instanceId)}
              onPreview={onPreview}
            />
          );
        })}
      </div>
      {footer(
        <button className="btn primary" disabled={!ok} onClick={submit}>
          Done
        </button>,
      )}
    </>
  );
}

/** One card to play or move (or decline): pick a card, then confirm. */
function SinglePick({ s, db, sendAction, onPreview, footer }: { s: GameStateMessage; db: CardDb; sendAction: (a: UiAction) => void; onPreview: Preview; footer: (done: ReactNode) => ReactNode }) {
  const p = s.choice!.payload as { cards: CardView[]; destination?: string };
  const pickMoves = new Set(["resolveCardToPlay", "resolveCardToMove"]);
  const byCard = new Map(s.actions.filter((a) => pickMoves.has(a.move) && typeof a.args?.cardId === "string").map((a) => [a.args!.cardId as string, a]));
  const decline = s.actions.find((a) => pickMoves.has(a.move) && !a.args?.cardId);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <>
      {p.destination && (
        <div className="pick-rules">
          <b>To</b>: {zoneName(p.destination)}
        </div>
      )}
      <div className="pick-cards">
        {p.cards.map((c) => (
          <PickCard
            key={c.instanceId}
            db={db}
            card={c}
            state={picked === c.instanceId ? "picked" : byCard.has(c.instanceId) ? "eligible" : "off"}
            tag={picked === c.instanceId ? "✓" : undefined}
            onClick={() => setPicked(picked === c.instanceId ? null : c.instanceId)}
            onPreview={onPreview}
          />
        ))}
      </div>
      {footer(
        <>
          {decline && (
            <button className="btn" onClick={() => sendAction(decline)}>
              {decline.label}
            </button>
          )}
          <button className="btn primary" disabled={!picked} onClick={() => picked && byCard.get(picked) && sendAction(byCard.get(picked)!)}>
            Done
          </button>
        </>,
      )}
    </>
  );
}

/** Revealed cards and where they all go (Hand or Trash). */
function RevealPick({ s, db, sendAction, onPreview, footer }: { s: GameStateMessage; db: CardDb; sendAction: (a: UiAction) => void; onPreview: Preview; footer: (done: ReactNode) => ReactNode }) {
  const p = s.choice!.payload as { revealedCards: CardView[] };
  const choices = s.actions.filter((a) => a.move === "resolveRevealDestination");
  return (
    <>
      <div className="pick-cards">
        {p.revealedCards.map((c) => (
          <PickCard key={c.instanceId} db={db} card={c} state="eligible" onPreview={onPreview} />
        ))}
      </div>
      {footer(
        <>
          {choices.map((a) => (
            <button key={a.id} className="btn primary" onClick={() => sendAction(a)}>
              {a.label}
            </button>
          ))}
        </>,
      )}
    </>
  );
}

export function CardPick({ s, db, send, sendAction, onPreview }: { s: GameStateMessage; db: CardDb; send: Send; sendAction: (a: UiAction) => void; onPreview: Preview }) {
  const choice = s.choice!;
  const [hidden, setHidden] = useState(false);
  const source = (choice.payload as { source?: { displayName?: string; rulesText?: string } }).source;
  const title = TITLE[choice.type] ?? "Choose";
  // Hidden, not removed: what you picked so far stays.
  const bar = hidden && (
      <div className="pick-bar">
        <span>
          {title}
          {source?.displayName ? ` · ${source.displayName}` : ""}
        </span>
        <button className="btn small primary" onClick={() => setHidden(false)}>
          Show
        </button>
      </div>
    );
  const footer = (done: ReactNode) => (
    <div className="pick-actions">
      <button className="btn" onClick={() => (onPreview(null), setHidden(true))}>
        Hide
      </button>
      <span className="spacer" />
      {done}
    </div>
  );
  return (
    <>
    {bar}
    <div className="pick-overlay" hidden={hidden} onClick={(e) => e.stopPropagation()}>
      <div className="pick-window">
        <div className="pick-head">
          <h2>{title}</h2>
          {source?.displayName && <div className="pick-source">{source.displayName}</div>}
          {source?.rulesText && <div className="small muted">{source.rulesText}</div>}
        </div>
        {choice.type === "scry" ? (
          <SearchPick s={s} db={db} send={send} onPreview={onPreview} footer={footer} />
        ) : choice.type === "revealDestination" ? (
          <RevealPick s={s} db={db} sendAction={sendAction} onPreview={onPreview} footer={footer} />
        ) : (
          <SinglePick s={s} db={db} sendAction={sendAction} onPreview={onPreview} footer={footer} />
        )}
      </div>
    </div>
    </>
  );
}
