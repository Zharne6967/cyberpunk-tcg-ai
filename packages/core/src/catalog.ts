import { getCardRulingsBySlug, getMergedCyberpunkCards } from "@tcg/cyberpunk-cards";
import type { CardCatalog } from "@tcg/cyberpunk-engine";
import type { CardDefinition } from "@tcg/cyberpunk-types";

/** Lower-case, strip accents and punctuation so names from different sites compare equal. */
export function normalizeCardName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[—–:\-_/.,!?()"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let cached: Catalog | undefined;

export interface Catalog {
  readonly cards: readonly CardDefinition[];
  bySlug(slug: string): CardDefinition | undefined;
  /** Resolve a human-written card name ("Goro Takemura: Hands Unclean", "Goro Takemura - Hands Unclean"). */
  byName(name: string): CardDefinition | undefined;
  /** Engine-facing catalog (slug and id lookup). */
  readonly engineCatalog: CardCatalog;
  rulings(slug: string): { question: string | null; answer: string }[];
}

export function getCatalog(): Catalog {
  if (cached) return cached;
  const cards = getMergedCyberpunkCards() as CardDefinition[];
  const bySlug = new Map<string, CardDefinition>();
  const byId = new Map<string, CardDefinition>();
  const byName = new Map<string, CardDefinition[]>();
  const addName = (key: string, card: CardDefinition) => {
    const k = normalizeCardName(key);
    if (!k) return;
    const list = byName.get(k) ?? [];
    if (!list.includes(card)) list.push(card);
    byName.set(k, list);
  };
  for (const card of cards) {
    bySlug.set(card.slug, card);
    byId.set(card.id, card);
    addName(card.displayName, card);
    addName(card.slug.replace(/-/g, " "), card);
    // Bare name only when it is unambiguous; resolved below.
    addName(card.name, card);
  }
  const catalog: Catalog = {
    cards,
    bySlug: (slug) => bySlug.get(slug),
    byName(name) {
      const key = normalizeCardName(name);
      const hits = byName.get(key);
      if (hits && hits.length === 1) return hits[0];
      if (hits && hits.length > 1) {
        // Prefer an exact display-name match when a bare name is shared (e.g. several "V" Legends).
        return hits.find((c) => normalizeCardName(c.displayName) === key);
      }
      return bySlug.get(key.replace(/ /g, "-"));
    },
    engineCatalog: {
      get: (slugOrId: string) => bySlug.get(slugOrId) ?? byId.get(slugOrId),
    } as CardCatalog,
    rulings: (slug) =>
      getCardRulingsBySlug(slug).map((r) => ({ question: r.question ?? null, answer: r.answer })),
  };
  cached = catalog;
  return catalog;
}
