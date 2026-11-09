import type { AnalysisJob, BotSummary, DeckCheck, DeckData, DeckSummary, NewGameRequest, RoomInfo, SeatTicket, ShareInfo } from "@cpai/core/protocol";

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

type DeckRef = { deckId?: string; deck?: DeckData; deckText?: string };

const rawApi = {
  decks: () => getJson<DeckSummary[]>("/api/decks"),
  deck: (id: string) => getJson<DeckData>(`/api/decks/${encodeURIComponent(id)}`),
  saveDeck: (deck: DeckData) => getJson<DeckSummary>(`/api/decks/${encodeURIComponent(deck.id)}`, json("PUT", deck)),
  deleteDeck: (id: string) => getJson<{ ok: boolean }>(`/api/decks/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const api = {
  config: () => (configPromise ??= getJson<ServerConfig>("/api/config").catch(() => ({ cloud: false, landingUrl: null }))),
  /** Built-in decks + your decks (on this server locally, in this browser online), without deleted built-in decks. */
  decks: async (opts: { includeHidden?: boolean } = {}): Promise<DeckSummary[]> => {
    const [server, cfg] = await Promise.all([rawApi.decks(), api.config()]);
    const all = cfg.cloud ? [...server, ...browserDecks().map((d) => d.summary)] : server;
    const hidden = hiddenDecks();
    return opts.includeHidden ? all : all.filter((d) => d.editable || !hidden.has(d.id));
  },
  /** Built-in decks cannot be deleted from the server: "Delete" hides them in this browser. */
  hiddenDecks: () => hiddenDecks(),
  setDeckHidden: (id: string, hide: boolean) => {
    const set = hiddenDecks();
    if (hide) set.add(id);
    else set.delete(id);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
    } catch {
      /* private mode */
    }
  },
  deck: async (id: string): Promise<DeckData> => browserDecks().find((d) => d.deck.id === id)?.deck ?? rawApi.deck(id),
  checkDeck: (deck: DeckData) => getJson<DeckCheck>("/api/decks/check", json("POST", { deck })),
  /** Save: online into this browser, locally on the server (built-in decks become your copy). */
  saveDeck: async (deck: DeckData): Promise<DeckSummary> => {
    if (!(await api.config()).cloud) return rawApi.saveDeck(deck);
    const check = await api.checkDeck(deck);
    const id = deck.id.startsWith("user-") ? deck.id : `user-${Date.now().toString(36)}`;
    const saved = { ...deck, id };
    const summary: DeckSummary = { id, name: deck.name, legends: deck.legends, size: check.size, colors: [], legal: check.legal, editable: true, source: { kind: "user" } };
    const db = await loadCardDb();
    summary.colors = [...new Set(deck.legends.map((s) => db.bySlug.get(s)?.color).filter((c): c is CardData["color"] => !!c))];
    writeBrowserDecks([...browserDecks().filter((d) => d.deck.id !== id), { deck: saved, summary }]);
    return summary;
  },
  deleteDeck: async (id: string) => {
    if (!(await api.config()).cloud) return rawApi.deleteDeck(id);
    writeBrowserDecks(browserDecks().filter((d) => d.deck.id !== id));
    return { ok: true };
  },
  importDeck: (text: string, name?: string) => getJson<{ deck: DeckData; unresolved: { line: string; name: string }[] }>("/api/decks/import", json("POST", { text, name })),
  bots: () => getJson<BotSummary[]>("/api/bots"),
  /** Deck analysis: a saved deck, deck data (Deck Builder) or a pasted list; the job is polled. */
  analyze: async (req: { deckId?: string; deck?: DeckData; deckText?: string; games: number }) =>
    getJson<AnalysisJob>("/api/analyze", json("POST", { games: req.games, ...(req.deck ? { deck: req.deck } : req.deckText ? { deckText: req.deckText } : await deckRef(req.deckId ?? "")) })),
  /** Opponents of an analysis (built-in decks, full lists). */
  analysisPool: () => getJson<DeckData[]>("/api/analyze/pool"),
  analysisJob: (id: string) => getJson<AnalysisJob>(`/api/analyze/${encodeURIComponent(id)}`),
  /** botDeckData: play against a deck that is not saved (e.g. an analysed list). */
  newGame: async (req: NewGameRequest & { botDeckData?: DeckData }) => {
    const you = await deckRef(req.yourDeck);
    const bot = req.botDeckData ? { deck: req.botDeckData } : await deckRef(req.botDeck);
    return getJson<SeatTicket>("/api/games", json("POST", { ...req, ...(you.deck ? { yourDeckData: you.deck } : {}), ...(bot.deck ? { botDeckData: bot.deck } : {}) })).then(rememberSeat);
  },
  /** Coach: a world sampled from what your seat knows (your seat's token proves who you are). */
  coachWorld: (gameId: string) => getJson<unknown>(`/api/games/${encodeURIComponent(gameId)}/coach`, { headers: { "x-seat-token": seatTicket(gameId)?.token ?? "" } }),
  gameExists: (id: string) => getJson<{ gameId: string; mode: string; started: boolean }>(`/api/games/${id}`),
  createRoom: async (req: { deckId: string; name?: string }) => getJson<SeatTicket>("/api/rooms", json("POST", { name: req.name, ...(await deckRef(req.deckId)) })).then(rememberSeat),
  roomByCode: (code: string) => getJson<{ gameId: string; invite: string }>(`/api/rooms/code/${encodeURIComponent(code)}`),
  roomInfo: (id: string, invite: string) => getJson<RoomInfo>(`/api/rooms/${id}?invite=${encodeURIComponent(invite)}`),
  joinRoom: async (id: string, req: { invite: string; deckId?: string; deckText?: string; name?: string }) =>
    getJson<SeatTicket>(`/api/rooms/${id}/join`, json("POST", { invite: req.invite, name: req.name, ...(req.deckText ? { deckText: req.deckText } : await deckRef(req.deckId ?? "")) })).then(rememberSeat),
  share: () => getJson<ShareInfo>("/api/share"),
  startShare: () => getJson<ShareInfo>("/api/share/start", { method: "POST" }),
  stopShare: () => getJson<ShareInfo>("/api/share/stop", { method: "POST" }),
};

// ---- server configuration and decks kept in this browser (online mode)
export interface ServerConfig {
  cloud: boolean;
  /** Always-on start page that wakes the sleeping server (invite links point there). */
  landingUrl: string | null;
}
let configPromise: Promise<ServerConfig> | undefined;

const DECKS_KEY = "cpai.decks.v1";
const HIDDEN_KEY = "cpai.hiddenDecks.v1";
function hiddenDecks(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function browserDecks(): { deck: DeckData; summary: DeckSummary }[] {
  try {
    return JSON.parse(localStorage.getItem(DECKS_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeBrowserDecks(list: { deck: DeckData; summary: DeckSummary }[]) {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(list));
  } catch {
    /* storage full or disabled */
  }
}
/** How to send a deck to the server: by id (server decks) or as data (decks saved in this browser). */
async function deckRef(id: string): Promise<DeckRef> {
  const local = browserDecks().find((d) => d.deck.id === id);
  return local ? { deck: local.deck } : { deckId: id };
}

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
