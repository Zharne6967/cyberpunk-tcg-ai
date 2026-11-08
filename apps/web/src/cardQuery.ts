import type { CardData } from "./api.ts";

/**
 * Card search used by the deck builder. Free words match name, subtitle and rules text; filters:
 *   type:unit  color:blue  cost<=3  cost:2  ram>=2  power>5  tag:netrunner  kw:blocker  sell:yes
 * Combine freely: `type:unit color:red cost<=3 attack`. Quotes keep phrases: "draw a card".
 */
export function matchesQuery(card: CardData, query: string): boolean {
  const tokens = query.match(/"[^"]*"|\S+/g) ?? [];
  for (const raw of tokens) {
    const tok = raw.replace(/^"|"$/g, "").toLowerCase();
    if (!tok) continue;
    const m = /^(type|t|color|c|cost|ram|power|pow|tag|kw|keyword|sell|set|rarity)(:|<=|>=|<|>|=)(.+)$/.exec(tok);
    if (!m) {
      const hay = `${card.displayName} ${card.subtitle ?? ""} ${card.text} ${card.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(tok)) return false;
      continue;
    }
    const [, key, op, val] = m;
    switch (key) {
      case "type":
      case "t":
        if (!card.type.startsWith(val!)) return false;
        break;
      case "color":
      case "c":
        if (!card.color.startsWith(val!)) return false;
        break;
      case "tag":
        if (!card.tags.some((t) => t.toLowerCase().includes(val!))) return false;
        break;
      case "kw":
      case "keyword":
        if (!card.keywords.some((k) => k.toLowerCase().includes(val!.replace(/\s/g, "")))) return false;
        break;
      case "sell":
        if (card.sellTag !== (val === "yes" || val === "true" || val === "1")) return false;
        break;
      case "set":
        if (!card.set.code.toLowerCase().includes(val!) && !card.set.name.toLowerCase().includes(val!)) return false;
        break;
      case "rarity":
        if (!card.rarity.toLowerCase().startsWith(val!)) return false;
        break;
      default: {
        const field = key === "pow" ? "power" : key;
        const v = (card as unknown as Record<string, number | null>)[field!];
        if (v == null) return false;
        const n = Number(val);
        if (Number.isNaN(n)) return false;
        if (op === ":" || op === "=") {
          if (v !== n) return false;
        } else if (op === "<=" ? !(v <= n) : op === ">=" ? !(v >= n) : op === "<" ? !(v < n) : !(v > n)) return false;
      }
    }
  }
  return true;
}
