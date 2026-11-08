import { useState, type DragEvent, type ReactNode } from "react";
import type { CardView, GameStateMessage, Intent, PlayerView, UiAction } from "@cpai/core/protocol";
import type { CardDb } from "../api.ts";
import { CardBack, CardFace, type CardSize } from "./CardFace.tsx";

/**
 * The table, laid out like the official playmat: each player has a Fixer column (D20…D4), the field,
 * the Legends and Eddies areas and the deck/trash piles. The rival's mat is turned 180°, both Gig
 * areas meet in the middle (RIVAL GIGS | FRIENDLY GIGS), like two mats facing each other.
 */

export interface DragInfo {
  cardId: string;
  from: "hand" | "field" | "legendArea";
}

export interface BoardCtx {
  db: CardDb;
  state: GameStateMessage;
  /** Learning mode: glow on cards with legal actions, status tags. */
  hints: boolean;
  actionsByCard: Map<string, UiAction[]>;
  highlight: Set<string>;
  onCardClick: (card: CardView, anchor: HTMLElement) => void;
  onGigAreaClick: (seat: string) => void;
  onInspect: (card: CardView) => void;
  onIntent: (intent: Intent) => void;
  onTrash: (seat: string) => void;
}

// One drag at a time; module state keeps drag-over re-renders cheap.
let dragging: DragInfo | null = null;
// Cards already shown in a zone; a card arriving somewhere new gets a short "lands on the table" animation.
const seenInZone = new Set<string>();
// Not on the first paint of the table (everything would "land" at once).
let landingArmed = false;
let armTimer: ReturnType<typeof setTimeout> | undefined;

export function cardData(db: CardDb, c: CardView | undefined) {
  if (!c || !c.cardName) return undefined;
  return db.byId.get(c.definitionId) ?? db.byName.get(c.cardName);
}

function zone(p: PlayerView, name: string): CardView[] {
  const z = p.zones[name];
  return Array.isArray(z) ? z : [];
}
function zoneCount(p: PlayerView, name: string): number {
  const z = p.zones[name];
  return Array.isArray(z) ? z.length : (z ?? 0);
}

/** What dropping the current drag onto `target` means (null = nothing). */
function dropIntent(ctx: BoardCtx, target: { kind: "field" | "eddies" | "rivalGigs" } | { kind: "card"; card: CardView }): Intent | null {
  const d = dragging;
  if (!d) return null;
  const you = ctx.state.you;
  if (target.kind === "field") return d.from === "hand" || d.from === "legendArea" ? { kind: "play", cardId: d.cardId } : null;
  if (target.kind === "eddies") return d.from === "hand" ? { kind: "sell", cardId: d.cardId } : null;
  if (target.kind === "rivalGigs") return d.from === "field" ? { kind: "attack", cardId: d.cardId, targetId: "rival" } : null;
  if (target.kind !== "card") return null;
  const t = target.card;
  const mineTarget = ownerOf(ctx.state, t.instanceId) === you;
  if (d.from === "hand" && mineTarget) return { kind: "play", cardId: d.cardId, targetId: t.instanceId };
  if (d.from === "field" && !mineTarget) {
    const att = ctx.state.view.attackState;
    if (att?.step === "react" && att.attackerId === t.instanceId) return { kind: "block", cardId: d.cardId };
    return { kind: "attack", cardId: d.cardId, targetId: t.instanceId };
  }
  return null;
}

function ownerOf(s: GameStateMessage, id: string): string | undefined {
  for (const [seat, p] of Object.entries(s.view.players))
    for (const z of Object.values(p.zones)) if (Array.isArray(z) && z.some((c) => c.instanceId === id)) return seat;
  return undefined;
}

/** Drop-zone props: a plain hover outline while something is dragged over (no legality hints). */
function useDrop(ctx: BoardCtx, target: Parameters<typeof dropIntent>[1]) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const intent = dropIntent(ctx, target);
        dragging = null;
        if (intent) ctx.onIntent(intent);
      },
    },
  };
}

function PowerBadge({ c }: { c: CardView }) {
  if (c.zone !== "field" || (c.type !== "unit" && c.type !== "legend")) return null;
  const diff = c.effectivePower - c.power;
  return <span className={`pow ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`}>{c.effectivePower}</span>;
}

export function TableCard({ c, ctx, size = "md", dragFrom, dropTarget }: { c: CardView; ctx: BoardCtx; size?: CardSize; dragFrom?: DragInfo["from"]; dropTarget?: boolean }) {
  const data = cardData(ctx.db, c);
  const drop = useDrop(ctx, { kind: "card", card: c });
  const acts = ctx.hints ? ctx.actionsByCard.get(c.instanceId) : undefined;
  const placeKey = `${c.zone}:${c.instanceId}`;
  armTimer ??= setTimeout(() => (landingArmed = true), 800);
  const fresh = landingArmed && !seenInZone.has(placeKey) && c.zone !== "hand";
  seenInZone.add(placeKey);
  const cls = [
    "tcard",
    fresh ? "fresh" : "",
    size,
    c.spent ? "spent" : "",
    acts?.length ? "actionable" : "",
    ctx.highlight.has(c.instanceId) ? "hl" : "",
    ctx.state.rivalLastCardIds.includes(c.instanceId) ? "bot-last" : "",
    drop.over ? "drop-over" : "",
  ].join(" ");
  const canDrag = !!dragFrom && !(c.faceDown && !data);
  return (
    <div
      className={cls}
      draggable={canDrag}
      onDragStart={(e) => {
        dragging = { cardId: c.instanceId, from: dragFrom! };
        e.dataTransfer.setData("text/plain", c.instanceId);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => (dragging = null)}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onCardClick(c, e.currentTarget);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (data) ctx.onInspect(c);
      }}
      {...(dropTarget ? drop.props : {})}
    >
      <div className="tcard-inner">{c.faceDown && !data ? <CardBack size={size} kind={c.zone === "legendArea" ? "legend" : "deck"} /> : <CardFace card={data} size={size} showText={size === "md" || size === "lg"} />}</div>
      <PowerBadge c={c} />
      {ctx.hints && c.hasLag && c.zone === "field" && <span className="tag lag">LAG</span>}
      {ctx.hints && c.activeEffects.length > 0 && (
        <span className="tag fx" title={c.activeEffects.map((e) => `${e.sourceName}: ${e.label}`).join("\n")}>
          FX {c.activeEffects.length}
        </span>
      )}
    </div>
  );
}

/** Die silhouettes drawn as outlines, like the dice spaces printed on the playmat. */
const DIE_SHAPE: Record<string, string> = {
  d4: "50,8 94,88 6,88",
  d6: "12,12 88,12 88,88 12,88",
  d8: "50,4 95,50 50,96 5,50",
  d10: "50,4 92,44 50,96 8,44",
  d12: "50,5 95,38 78,93 22,93 5,38",
  d20: "50,3 93,27 93,73 50,97 7,73 7,27",
};

function DieSvg({ type, value }: { type: string; value?: number }) {
  const label = type.toUpperCase();
  const textY = type === "d4" ? 70 : 50;
  return (
    <svg viewBox="0 0 100 100" className="die-svg" aria-hidden>
      <polygon points={DIE_SHAPE[type] ?? DIE_SHAPE.d6} className="die-outline" />
      {type === "d20" && <polygon points="50,24 74,66 26,66" className="die-inner" />}
      {value != null ? (
        <>
          <text x="50" y={textY - 4} className="die-value">
            {value}
          </text>
          <text x="50" y={textY + 22} className="die-sub">
            {label}
          </text>
        </>
      ) : (
        <text x="50" y={textY + 4} className="die-label">
          {label}
        </text>
      )}
    </svg>
  );
}

function Die({ d, ctx, empty, type }: { d?: CardView; ctx: BoardCtx; empty?: boolean; type: string }) {
  if (empty || !d)
    return (
      <div className={`die die-${type} empty`}>
        <DieSvg type={type} />
      </div>
    );
  const acts = ctx.hints ? ctx.actionsByCard.get(d.instanceId) : undefined;
  return (
    <button
      className={`die die-${type} ${d.zone === "gigArea" ? "gig" : ""} ${acts?.length ? "actionable" : ""} ${ctx.highlight.has(d.instanceId) ? "hl" : ""} ${ctx.state.rivalLastCardIds.includes(d.instanceId) ? "bot-last" : ""}`}
      title={d.zone === "gigArea" ? `${type.toUpperCase()}: ${d.power}` : type.toUpperCase()}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onCardClick(d, e.currentTarget);
      }}
    >
      <DieSvg type={type} value={d.zone === "gigArea" ? d.power : undefined} />
    </button>
  );
}

const DICE_ORDER = ["d20", "d12", "d10", "d8", "d6", "d4"];

function Fixer({ p, ctx }: { p: PlayerView; ctx: BoardCtx }) {
  const fixer = zone(p, "fixerArea");
  return (
    <div className="mat-fixer">
      {DICE_ORDER.map((t) => {
        const d = fixer.find((x) => String(x.definitionId).toLowerCase() === t);
        return <Die key={t} d={d} ctx={ctx} empty={!d} type={t} />;
      })}
      <div className="mat-label">FIXER</div>
    </div>
  );
}

export function GigArea({ seat, ctx, label, rival }: { seat: string; ctx: BoardCtx; label: string; rival: boolean }) {
  const p = ctx.state.view.players[seat]!;
  const gigs = zone(p, "gigArea");
  const drop = useDrop(ctx, { kind: "rivalGigs" });
  return (
    <div
      className={`gig-area ${rival ? "rival" : "friendly"} ${drop.over ? "drop-over" : ""}`}
      onClick={() => ctx.onGigAreaClick(seat)}
      {...(rival ? drop.props : {})}
    >
      <div className="mat-label">{label}</div>
      <div className="gig-dice">
        {gigs.map((d) => (
          <Die key={d.instanceId} d={d} ctx={ctx} type={String(d.definitionId).toLowerCase()} />
        ))}
      </div>
      <div className="gig-count" title="Street Cred">
        <b>{p.gigCount}</b>/7 <span className="cred">★ {p.streetCred}</span>
      </div>
    </div>
  );
}

function Field({ p, ctx, mine }: { p: PlayerView; ctx: BoardCtx; mine: boolean }) {
  const drop = useDrop(ctx, { kind: "field" });
  const all = new Map<string, CardView>();
  for (const z of Object.values(p.zones)) if (Array.isArray(z)) for (const c of z) all.set(c.instanceId, c);
  const units = zone(p, "field").filter((c) => !c.attachedToId);
  return (
    <div className={`mat-field ${drop.over ? "drop-over" : ""}`} {...(mine ? drop.props : {})}>
      <div className="mat-label">FIELD</div>
      <div className="field-cards">
        {units.map((c) => {
          const gear = c.attachedGearIds.map((id) => all.get(id)).filter((g): g is CardView => !!g);
          return (
            <div key={c.instanceId} className="unit-stack" style={{ paddingBottom: `calc(var(--card-h) * ${0.3 * gear.length})` }}>
              {/* Equipped Gear is tucked under its Unit with its bottom textbox showing. */}
              {gear.map((g, i) => (
                <div key={g.instanceId} className="gear-under" style={{ top: `calc(var(--card-h) * ${0.3 * (i + 1)})` }}>
                  <TableCard c={g} ctx={ctx} />
                </div>
              ))}
              <TableCard c={c} ctx={ctx} dragFrom={mine ? "field" : undefined} dropTarget />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legends({ p, ctx, mine }: { p: PlayerView; ctx: BoardCtx; mine: boolean }) {
  return (
    <div className="mat-legends">
      <div className="mat-label">LEGENDS</div>
      <div className="legend-slots">
        {zone(p, "legendArea").map((c) => (
          <TableCard key={c.instanceId} c={c} ctx={ctx} size="sm" dragFrom={mine && !c.faceDown ? "legendArea" : undefined} dropTarget={mine && !c.faceDown} />
        ))}
      </div>
    </div>
  );
}

function Eddies({ p, ctx, mine }: { p: PlayerView; ctx: BoardCtx; mine: boolean }) {
  const drop = useDrop(ctx, { kind: "eddies" });
  const cards = zone(p, "eddieArea");
  return (
    <div className={`mat-eddies ${drop.over ? "drop-over" : ""}`} {...(mine ? drop.props : {})}>
      <div className="mat-label">EDDIES</div>
      <div className="eddie-cards">
        {cards.map((c) => (
          <TableCard key={c.instanceId} c={c} ctx={ctx} size="xs" />
        ))}
      </div>
      <div className="eddie-count">
        €$ <b>{p.availableEddies}</b>
      </div>
    </div>
  );
}

function Piles({ seat, p, ctx }: { seat: string; p: PlayerView; ctx: BoardCtx }) {
  const deck = zoneCount(p, "deck");
  const trash = zone(p, "trash");
  const top = trash.at(-1);
  return (
    <div className="mat-piles">
      <div className="pile">
        <div className="mat-label">DECK</div>
        {deck > 0 ? (
          <div className="pile-stack" style={{ ["--depth" as string]: Math.min(6, Math.ceil(deck / 8)) }}>
            <CardBack size="sm" />
          </div>
        ) : (
          <div className="pile-empty sm" />
        )}
        <div className="pile-count">{deck}</div>
      </div>
      <div className="pile" onClick={() => ctx.onTrash(seat)}>
        <div className="mat-label">TRASH</div>
        {top ? (
          <div className="pile-stack">
            <CardFace card={cardData(ctx.db, top)} size="sm" showText={false} />
          </div>
        ) : (
          <div className="pile-empty sm" />
        )}
        <div className="pile-count">{trash.length}</div>
      </div>
    </div>
  );
}

/** One player's mat. `rival` turns the layout 180° (Fixer on the right, piles on the left). */
export function Mat({ seat, ctx, rival }: { seat: string; ctx: BoardCtx; rival: boolean }) {
  const p = ctx.state.view.players[seat]!;
  const active = ctx.state.view.activePlayerId === seat;
  return (
    <div className={`mat ${rival ? "rival" : "mine"} ${active ? "active" : ""}`}>
      <Fixer p={p} ctx={ctx} />
      <Field p={p} ctx={ctx} mine={!rival} />
      <div className="mat-lower">
        <Legends p={p} ctx={ctx} mine={!rival} />
        <Eddies p={p} ctx={ctx} mine={!rival} />
      </div>
      <Piles seat={seat} p={p} ctx={ctx} />
    </div>
  );
}

export function YourHand({ ctx }: { ctx: BoardCtx }) {
  const p = ctx.state.view.players[ctx.state.you]!;
  return (
    <div className="hand mine">
      {zone(p, "hand").map((c) => (
        <TableCard key={c.instanceId} c={c} ctx={ctx} dragFrom="hand" />
      ))}
    </div>
  );
}

export function RivalHand({ ctx }: { ctx: BoardCtx }) {
  const n = zoneCount(ctx.state.view.players[ctx.state.rival]!, "hand");
  return (
    <div className="hand rival" title={`${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="hand-back">
          <CardBack size="xs" />
        </div>
      ))}
      <span className="hand-count">{n}</span>
    </div>
  );
}

export function Strip({ children }: { children: ReactNode }) {
  return <div className="center-strip">{children}</div>;
}
