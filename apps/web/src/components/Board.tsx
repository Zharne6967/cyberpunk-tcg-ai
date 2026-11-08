import type { CardView, GameStateMessage, PlayerView, UiAction } from "@cpai/core/protocol";
import type { CardDb } from "../api.ts";
import { CardBack, CardFace } from "./CardFace.tsx";

export interface BoardCtx {
  db: CardDb;
  state: GameStateMessage;
  actionsByCard: Map<string, UiAction[]>;
  highlight: Set<string>;
  onCard: (card: CardView, anchor: HTMLElement) => void;
  onInspect: (card: CardView) => void;
}

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

function PowerBadge({ c }: { c: CardView }) {
  if (c.type !== "unit" && c.type !== "legend") return null;
  if (c.type === "legend" && c.zone !== "field") return null;
  const diff = c.effectivePower - c.power;
  return <span className={`pow ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`}>{c.effectivePower}</span>;
}

export function CardSlot({ c, ctx, size = "md", extraClass = "" }: { c: CardView; ctx: BoardCtx; size?: "sm" | "md" | "lg"; extraClass?: string }) {
  const data = cardData(ctx.db, c);
  const acts = ctx.actionsByCard.get(c.instanceId);
  const cls = [
    "slot",
    size,
    c.spent ? "spent" : "",
    acts?.length ? "actionable" : "",
    ctx.highlight.has(c.instanceId) ? "hl" : "",
    ctx.state.botLastCardIds.includes(c.instanceId) ? "bot-last" : "",
    extraClass,
  ].join(" ");
  return (
    <div
      className={cls}
      title={data ? `${data.displayName}${acts?.length ? " — kliknij, aby wybrać akcję" : " — kliknij, aby obejrzeć"}` : "Zakryta karta"}
      onClick={(e) => (acts?.length ? ctx.onCard(c, e.currentTarget) : data ? ctx.onInspect(c) : undefined)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (data) ctx.onInspect(c);
      }}
    >
      <div className="slot-card">{c.faceDown && !data ? <CardBack size={size} /> : <CardFace card={data} size={size} showText={size !== "sm"} />}</div>
      {c.faceDown && data && <span className="tag fd">zakryta</span>}
      <PowerBadge c={c} />
      {c.hasLag && c.zone === "field" && <span className="tag lag">LAG</span>}
      {c.spent && <span className="tag spent-tag">SPENT</span>}
      {c.activeEffects.length > 0 && <span className="tag fx" title={c.activeEffects.map((e) => `${e.sourceName}: ${e.label}`).join("\n")}>FX {c.activeEffects.length}</span>}
    </div>
  );
}

function UnitWithGear({ c, all, ctx }: { c: CardView; all: Map<string, CardView>; ctx: BoardCtx }) {
  const gear = c.attachedGearIds.map((id) => all.get(id)).filter((g): g is CardView => !!g);
  return (
    <div className="unit-stack">
      <CardSlot c={c} ctx={ctx} />
      {gear.length > 0 && (
        <div className="gear-row">
          {gear.map((g) => (
            <CardSlot key={g.instanceId} c={g} ctx={ctx} size="sm" extraClass="gear" />
          ))}
        </div>
      )}
    </div>
  );
}

export function GigDie({ d, ctx }: { d: CardView; ctx: BoardCtx }) {
  const acts = ctx.actionsByCard.get(d.instanceId);
  const sides = String(d.definitionId);
  return (
    <button
      className={`die ${sides} ${acts?.length ? "actionable" : ""} ${ctx.highlight.has(d.instanceId) ? "hl" : ""}`}
      title={`${sides}, wartość ${d.power}`}
      onClick={(e) => acts?.length && ctx.onCard(d, e.currentTarget)}
    >
      <span className="die-val">{d.zone === "fixerArea" ? "–" : d.power}</span>
      <span className="die-type">{sides}</span>
    </button>
  );
}

export function PlayerSide({ seat, ctx, mine }: { seat: string; ctx: BoardCtx; mine: boolean }) {
  const p = ctx.state.view.players[seat]!;
  const all = new Map<string, CardView>();
  for (const z of Object.values(p.zones)) if (Array.isArray(z)) for (const c of z) all.set(c.instanceId, c);
  const field = zone(p, "field").filter((c) => !c.attachedToId);
  const legends = zone(p, "legendArea");
  const gigs = zone(p, "gigArea");
  const fixer = zone(p, "fixerArea");
  const hand = zone(p, "hand");
  const handCount = zoneCount(p, "hand");
  const isActive = ctx.state.view.activePlayerId === seat;

  const statusBar = (
    <div className={`status-bar ${isActive ? "active" : ""}`}>
      <span className="who">{mine ? "TY" : `BOT · ${ctx.state.botLabel}`}</span>
      <span className="stat" title="Gigi (wygrywasz, mając 7 na początku swojej tury)">
        🎲 Gigi <b>{p.gigCount}</b>/7
      </span>
      <span className="stat" title="Street Cred = suma wartości Twoich Gigów">
        ★ Street Cred <b>{p.streetCred}</b>
      </span>
      <span className="stat" title="Eddies dostępne / wszystkie">
        €$ <b>{p.availableEddies}</b>/{p.eddies}
      </span>
      <span className="stat">🂠 Talia {zoneCount(p, "deck")}</span>
      <span className="stat">🗑 Kosz {zoneCount(p, "trash")}</span>
      {!mine && (
        <span className="stat" title="Karty na ręce bota (ukryte)">
          ✋ Ręka {handCount}
          <span className="mini-backs">
            {Array.from({ length: Math.min(handCount, 10) }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        </span>
      )}
      {p.soldThisTurn && <span className="tag">sprzedano w tej turze</span>}
      {p.calledLegendThisTurn && <span className="tag">przywołano Legendę</span>}
    </div>
  );

  const legendsAndDice = (
    <div className="side-row">
      <div className="legends">
        <div className="row-label">Legendy</div>
        <div className="cards">
          {legends.map((c) => (
            <CardSlot key={c.instanceId} c={c} ctx={ctx} size="sm" />
          ))}
        </div>
      </div>
      <div className="gigs">
        <div className="row-label">Gigi ({gigs.length}/7)</div>
        <div className="dice">
          {gigs.length ? gigs.map((d) => <GigDie key={d.instanceId} d={d} ctx={ctx} />) : <span className="muted">brak</span>}
        </div>
      </div>
      <div className="gigs">
        <div className="row-label">Fixer ({fixer.length})</div>
        <div className="dice fixer">
          {fixer.map((d) => (
            <GigDie key={d.instanceId} d={d} ctx={ctx} />
          ))}
        </div>
      </div>
      <TrashPeek cards={zone(p, "trash")} ctx={ctx} />
    </div>
  );

  const fieldRow = (
    <div className={`field ${mine ? "mine" : "theirs"}`}>
      {field.length ? field.map((c) => <UnitWithGear key={c.instanceId} c={c} all={all} ctx={ctx} />) : <span className="muted empty-field">— pole puste —</span>}
    </div>
  );

  if (mine) {
    return (
      <div className="side mine">
        {fieldRow}
        {legendsAndDice}
        {statusBar}
        <div className="hand">
          {hand.map((c) => (
            <CardSlot key={c.instanceId} c={c} ctx={ctx} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="side theirs">
      {statusBar}
      {legendsAndDice}
      {fieldRow}
    </div>
  );
}

function TrashPeek({ cards, ctx }: { cards: CardView[]; ctx: BoardCtx }) {
  const top = cards.at(-1);
  return (
    <div className="trash-peek">
      <div className="row-label">Kosz ({cards.length})</div>
      {top ? (
        <div className="trash-top">
          <CardSlot c={top} ctx={ctx} size="sm" />
          {cards.length > 1 && (
            <details className="trash-all">
              <summary>pokaż wszystkie</summary>
              <div className="trash-list">
                {[...cards].reverse().map((c) => (
                  <button key={c.instanceId} className="linklike" onClick={() => ctx.onInspect(c)}>
                    {c.cardName}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <span className="muted">pusty</span>
      )}
    </div>
  );
}
