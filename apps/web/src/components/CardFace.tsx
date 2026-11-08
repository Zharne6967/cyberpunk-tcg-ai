import { useState } from "react";
import type { CardData } from "../api.ts";
import { TYPE_PL } from "../api.ts";

/** Renders official art when available (cached by the server), otherwise a text card in the card's colour. */
export function CardFace({ card, size = "md", showText = true }: { card: CardData | undefined; size?: "sm" | "md" | "lg"; showText?: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  if (!card) return <div className={`card-face back ${size}`} />;
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
        {TYPE_PL[card.type]}
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

export function CardBack({ size = "md", label }: { size?: "sm" | "md" | "lg"; label?: string }) {
  return (
    <div className={`card-face back ${size}`}>
      <span>{label ?? ""}</span>
    </div>
  );
}
