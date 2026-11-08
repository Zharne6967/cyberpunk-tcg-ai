import { useState } from "react";
import type { CardData } from "../api.ts";
import { TYPE_NAME } from "../api.ts";

export type CardSize = "xs" | "sm" | "md" | "lg";

/** Renders official art when available (cached by the server), otherwise a text card in the card's colour. */
export function CardFace({ card, size = "md", showText = true }: { card: CardData | undefined; size?: CardSize; showText?: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  if (!card) return <CardBack size={size} />;
  if (imgOk) {
    return (
      <div className={`card-face img ${size} c-${card.color}`}>
        <img src={`/img/${card.slug}`} alt={card.displayName} loading="lazy" draggable={false} onError={() => setImgOk(false)} />
      </div>
    );
  }
  return (
    <div className={`card-face text ${size} c-${card.color}`}>
      <div className="cf-top">
        {card.cost != null && card.type !== "legend" && <span className="cf-cost">{card.cost}</span>}
        <span className="cf-name">{card.name}</span>
      </div>
      {card.subtitle && <div className="cf-sub">{card.subtitle}</div>}
      <div className="cf-type">
        {TYPE_NAME[card.type]}
        {card.tags.length ? ` — ${card.tags.join(", ")}` : ""}
      </div>
      {showText && <div className="cf-text">{card.text}</div>}
      <div className="cf-bottom">
        {card.ram != null && <span className="cf-ram">RAM {card.ram}</span>}
        {card.sellTag && <span className="cf-sell">€$</span>}
        {card.power != null && card.type !== "program" && <span className="cf-power">{card.power}</span>}
      </div>
    </div>
  );
}

/**
 * Card back (our own design, not the official artwork). Legends have a different back than deck
 * cards — CR 3.4.1: a face-down card still shows whether it is a Legend.
 */
export function CardBack({ size = "md", kind = "deck" }: { size?: CardSize; kind?: "deck" | "legend" }) {
  return (
    <div className={`card-face back back-${kind} ${size}`}>
      <span className="back-mark">{kind === "legend" ? "LEGEND" : "CYBERPUNK"}</span>
    </div>
  );
}
