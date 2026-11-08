import type { BotSummary, DeckSummary, NewGameRequest } from "@cpai/core/protocol";

export interface CardData {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  displayName: string;
  type: "legend" | "unit" | "gear" | "program";
  color: "red" | "blue" | "green" | "yellow";
  cost: number | null;
  power: number | null;
  ram: number | null;
  sellTag: boolean;
  tags: string[];
  keywords: string[];
  text: string;
  rarity: string;
  set: { code: string; name: string };
  printNumber: string;
  rulings: { question: string | null; answer: string }[];
}

export interface CardDb {
  all: CardData[];
  byId: Map<string, CardData>;
  bySlug: Map<string, CardData>;
  byName: Map<string, CardData>;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

let dbPromise: Promise<CardDb> | undefined;
export function loadCardDb(): Promise<CardDb> {
  dbPromise ??= getJson<{ cards: CardData[] }>("/api/cards").then(({ cards }) => ({
    all: cards,
    byId: new Map(cards.map((c) => [c.id, c])),
    bySlug: new Map(cards.map((c) => [c.slug, c])),
    byName: new Map(cards.map((c) => [c.name, c])),
  }));
  return dbPromise;
}

export const api = {
  decks: () => getJson<DeckSummary[]>("/api/decks"),
  bots: () => getJson<BotSummary[]>("/api/bots"),
  newGame: (req: NewGameRequest) =>
    getJson<{ gameId: string }>("/api/games", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }),
  gameExists: (id: string) => getJson<{ gameId: string }>(`/api/games/${id}`),
};

export const COLOR_NAME: Record<string, string> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };
export const TYPE_NAME: Record<string, string> = { legend: "Legend", unit: "Unit", gear: "Gear", program: "Program" };
