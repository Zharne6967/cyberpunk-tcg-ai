import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkDeckLegality, deckFromText, deckSize, deckToText, getCatalog, isDeckLegal, type Deck, type DeckSummary } from "@cpai/core";
import { DATA_DIR, USER_DECKS_DIR } from "./paths.ts";

const BUILTIN_DIR = join(DATA_DIR, "decks");

function readDir(dir: string): Deck[] {
  if (!existsSync(dir)) return [];
  const out: Deck[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as Deck);
    } catch {
      /* skip broken files */
    }
  }
  return out;
}

/** Built-in decks (data/decks) plus your own decks (var/decks); your deck wins on an id clash. */
export function loadAllDecks(): Deck[] {
  const user = readDir(USER_DECKS_DIR);
  const ids = new Set(user.map((d) => d.id));
  return [...readDir(BUILTIN_DIR).filter((d) => !ids.has(d.id)), ...user];
}

/** Built-in decks only (the opponents of a deck analysis). */
export function loadBuiltinDecks(): Deck[] {
  return readDir(BUILTIN_DIR).sort((a, b) => a.id.localeCompare(b.id));
}

export function getDeck(id: string): Deck | undefined {
  return loadAllDecks().find((d) => d.id === id);
}

export function isUserDeck(id: string): boolean {
  return readDir(USER_DECKS_DIR).some((d) => d.id === id);
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
    legal: isDeckLegal(deck),
    editable: isUserDeck(deck.id),
  };
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Normalise a deck coming from the browser: known slugs only, positive integer counts. */
export function sanitizeDeck(input: unknown): Deck {
  const d = input as Partial<Deck>;
  const catalog = getCatalog();
  const id = String(d.id ?? "").toLowerCase();
  if (!SAFE_ID.test(id)) throw new Error("Invalid deck id");
  const name = String(d.name ?? "").trim().slice(0, 80) || "Untitled deck";
  const legends = (Array.isArray(d.legends) ? d.legends : []).map(String).filter((s) => catalog.bySlug(s)).slice(0, 3);
  const counts = (input: Record<string, number> | undefined) => {
    const out: Record<string, number> = {};
    for (const [slug, n] of Object.entries(input ?? {})) {
      const count = Math.floor(Number(n));
      if (catalog.bySlug(slug) && count > 0) out[slug] = Math.min(count, 50);
    }
    return out;
  };
  const main = counts(d.main);
  const sideboard = counts(d.sideboard);
  return {
    id,
    name,
    source: { kind: "user", date: new Date().toISOString().slice(0, 10) },
    legends,
    main,
    ...(Object.keys(sideboard).length ? { sideboard } : {}),
  };
}

export function saveUserDeck(deck: Deck): void {
  writeFileSync(join(USER_DECKS_DIR, `${deck.id}.json`), JSON.stringify(deck, null, 2));
}

export function deleteUserDeck(id: string): boolean {
  if (!SAFE_ID.test(id)) return false;
  const file = join(USER_DECKS_DIR, `${id}.json`);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/** Legality problems + the deck as a shareable text list. */
export function checkDeck(deck: Deck) {
  const problems = checkDeckLegality(deck);
  return { problems, legal: problems.every((p) => p.severity !== "error"), size: deckSize(deck), text: deckToText(deck) };
}

/** Parse a pasted deck list (deck sites' "3x Card Name" format) into an unsaved deck. */
export function importDeckText(text: string, name?: string) {
  const id = `user-${Date.now().toString(36)}`;
  const deck = deckFromText(String(text ?? ""), { id, name: name?.trim() || undefined });
  const { unresolved, ...rest } = deck;
  return { deck: rest as Deck, unresolved };
}
