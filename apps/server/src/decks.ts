import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDeckLegality, deckSize, getCatalog, type Deck, type DeckSummary } from "@cpai/core";
import { DATA_DIR, USER_DECKS_DIR } from "./paths.ts";

const DIRS = [join(DATA_DIR, "decks"), USER_DECKS_DIR];

export function loadAllDecks(): Deck[] {
  const out: Deck[] = [];
  for (const dir of DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as Deck);
      } catch {
        /* skip broken files */
      }
    }
  }
  return out;
}

export function getDeck(id: string): Deck | undefined {
  return loadAllDecks().find((d) => d.id === id);
}

export function summarizeDeck(deck: Deck): DeckSummary {
  const catalog = getCatalog();
  const colors = [...new Set(deck.legends.map((s) => catalog.bySlug(s)?.color).filter((c): c is NonNullable<typeof c> => !!c))];
  return {
    id: deck.id,
    name: deck.name,
    source: deck.source,
    legends: deck.legends,
    size: deckSize(deck),
    colors,
    legal: checkDeckLegality(deck).length === 0,
  };
}
