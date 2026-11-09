import type { DeckData } from "@cpai/core/protocol";
import { isMetaDeck } from "./browserAnalysis.ts";

/** Decks the player added to the meta pool (this browser only). */
const KEY = "cpai.metaPool.v1";

export function addedMetaDecks(): DeckData[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as DeckData[];
  } catch {
    return [];
  }
}

function write(list: DeckData[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export function addMetaDeck(deck: DeckData): DeckData {
  const added = { ...deck, id: `meta-user-${Date.now().toString(36)}` };
  write([...addedMetaDecks(), added]);
  return added;
}

export function removeMetaDeck(id: string) {
  write(addedMetaDecks().filter((d) => d.id !== id));
}

/** The meta pool: the built-in tournament and ladder decks plus the player's additions. */
export function metaPool(builtIn: DeckData[]): DeckData[] {
  return [...builtIn.filter(isMetaDeck), ...addedMetaDecks()];
}
