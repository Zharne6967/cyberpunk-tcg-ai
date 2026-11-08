import type { BotSummary, DeckCheck, DeckData, DeckSummary, NewGameRequest, RoomInfo, SeatTicket, ShareInfo } from "@cpai/core/protocol";

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

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  decks: () => getJson<DeckSummary[]>("/api/decks"),
  deck: (id: string) => getJson<DeckData>(`/api/decks/${encodeURIComponent(id)}`),
  checkDeck: (deck: DeckData) => getJson<DeckCheck>("/api/decks/check", json("POST", { deck })),
  saveDeck: (deck: DeckData) => getJson<DeckSummary>(`/api/decks/${encodeURIComponent(deck.id)}`, json("PUT", deck)),
  deleteDeck: (id: string) => getJson<{ ok: boolean }>(`/api/decks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importDeck: (text: string, name?: string) => getJson<{ deck: DeckData; unresolved: { line: string; name: string }[] }>("/api/decks/import", json("POST", { text, name })),
  bots: () => getJson<BotSummary[]>("/api/bots"),
  newGame: (req: NewGameRequest) => getJson<SeatTicket>("/api/games", json("POST", req)).then(rememberSeat),
  gameExists: (id: string) => getJson<{ gameId: string; mode: string; started: boolean }>(`/api/games/${id}`),
  createRoom: (req: { deckId?: string; deckText?: string; name?: string }) => getJson<SeatTicket>("/api/rooms", json("POST", req)).then(rememberSeat),
  roomInfo: (id: string, invite: string) => getJson<RoomInfo>(`/api/rooms/${id}?invite=${encodeURIComponent(invite)}`),
  joinRoom: (id: string, req: { invite: string; deckId?: string; deckText?: string; name?: string }) => getJson<SeatTicket>(`/api/rooms/${id}/join`, json("POST", req)).then(rememberSeat),
  share: () => getJson<ShareInfo>("/api/share"),
  startShare: () => getJson<ShareInfo>("/api/share/start", { method: "POST" }),
  stopShare: () => getJson<ShareInfo>("/api/share/stop", { method: "POST" }),
};

// ---- your seat in a game: the secret token is what lets this browser play that seat
const seatKey = (gameId: string) => `cpai.seat.${gameId}`;
function rememberSeat(t: SeatTicket): SeatTicket {
  try {
    localStorage.setItem(seatKey(t.gameId), JSON.stringify(t));
  } catch {
    /* private mode: the token still lives in memory below */
  }
  memorySeats.set(t.gameId, t);
  return t;
}
const memorySeats = new Map<string, SeatTicket>();
export function seatTicket(gameId: string): SeatTicket | null {
  const m = memorySeats.get(gameId);
  if (m) return m;
  try {
    const raw = localStorage.getItem(seatKey(gameId));
    return raw ? (JSON.parse(raw) as SeatTicket) : null;
  } catch {
    return null;
  }
}

const NAME_KEY = "cpai.name";
export function playerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setPlayerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export const COLOR_NAME: Record<string, string> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };
export const TYPE_NAME: Record<string, string> = { legend: "Legend", unit: "Unit", gear: "Gear", program: "Program" };
