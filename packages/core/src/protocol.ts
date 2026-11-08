/**
 * Wire protocol between apps/server and apps/web. Types only — the browser never imports the engine.
 * Engine view types are re-declared structurally (subset) so the web bundle stays engine-free.
 */

export type Seat = "p1" | "p2";

export interface CardView {
  instanceId: string;
  definitionId: string;
  cardName: string | null;
  color?: string | null;
  zone: string;
  faceDown: boolean;
  revealed?: boolean;
  spent: boolean;
  power: number;
  effectivePower: number;
  cost: number | null;
  effectiveCost: number | null;
  type: "legend" | "unit" | "gear" | "program" | null;
  classifications: string[];
  hasSellTag: boolean;
  attachedGearIds: string[];
  attachedToId: string | null;
  hasLag: boolean;
  hasAttackedThisTurn: boolean;
  keywords: string[];
  activeEffects: { id: string; sourceName: string; label: string; detail: string; tone: "buff" | "debuff" | "neutral"; durationLabel?: string }[];
}

export interface PlayerView {
  firstPlayer: boolean;
  zones: Record<string, CardView[] | number>;
  eddies: number;
  availableEddies: number;
  soldThisTurn: boolean;
  calledLegendThisTurn: boolean;
  gigCount: number;
  fixerCount: number;
  streetCred: number;
  combatPriority?: "automatic" | "hold";
}

export interface MatchView {
  players: Record<string, PlayerView>;
  gamePhase: string;
  turnNumber: number;
  activePlayerId: string;
  overtimeActive: boolean;
  attackState: { step: string; attackerId?: string; defenderId?: string; kind?: string } | null;
  gameEnded: boolean;
  winnerId: string | null;
  winReason: string | null;
  stateID: number;
}

/** One legal action offered to the human, already labelled in Polish. */
export interface UiAction {
  id: string;
  move: string;
  args?: Record<string, unknown>;
  label: string;
  group: "setup" | "play" | "sell" | "legend" | "attack" | "react" | "ability" | "phase" | "choice" | "other";
  /** Card the action is "about" (clicking that card offers this action). */
  cardId?: string;
  /** Secondary card/die (attack target, attach host...). */
  targetId?: string;
}

export interface LogLine {
  seq: number;
  turn: number;
  actor: "you" | "rival" | "system";
  text: string;
  /** Public cards mentioned in the line (clickable in the UI). */
  cards: { instanceId: string; definitionId: string }[];
  /** Engine message key (e.g. "setup.firstPlayerChoice"). */
  key?: string;
}

export interface ChoiceView {
  type: string;
  chooserId: string;
  payload: Record<string, unknown>;
}

export interface GameStateMessage {
  type: "state";
  gameId: string;
  /** Against the bot, or against a friend (two humans). */
  mode: "bot" | "friend";
  you: Seat;
  rival: Seat;
  yourName: string;
  /** Bot level or the friend's name. */
  rivalLabel: string;
  yourDeck: string;
  rivalDeck: string;
  view: MatchView;
  promptStatus: "idle" | "action" | "choice" | "waiting";
  choice: ChoiceView | null;
  actions: UiAction[];
  log: LogLine[];
  /** The bot is computing its move. */
  rivalThinking: boolean;
  /** Instance ids the rival touched in their latest action (for highlighting). */
  rivalLastCardIds: string[];
  /** Your chance to win (0..1) from public table information only (learned model), null in setup. */
  winChance: number | null;
  /** Last ISMCTS search of the bot: simulations run and its estimated chance to win. */
  botInfo: null | { iterations: number; winRate: number; ms: number };
  result: null | { winner: "you" | "rival" | "draw"; reason: string | null };
}

/** Friend room before the second player joined. */
export interface WaitingMessage {
  type: "waiting";
  gameId: string;
  you: Seat;
  hostName: string;
  hostDeck: string;
}

/**
 * What the player did on the table (drag & drop, click). The server maps it to the matching legal
 * engine command, asks to disambiguate when several fit, or answers with the engine's reason.
 */
export type Intent =
  | { kind: "play"; cardId: string; targetId?: string }
  | { kind: "sell"; cardId: string }
  | { kind: "call"; cardId: string }
  | { kind: "attack"; cardId: string; targetId: string | "rival" }
  | { kind: "block"; cardId: string }
  | { kind: "activate"; cardId: string }
  | { kind: "goSolo"; cardId: string }
  | { kind: "select"; id: string }
  | { kind: "pass" };

export type ServerMessage =
  | GameStateMessage
  | WaitingMessage
  | { type: "error"; message: string }
  | { type: "toast"; message: string }
  | { type: "options"; title: string; options: { id: string; label: string }[] };

export type ClientMessage =
  | { type: "action"; actionId: string; stateID: number }
  | { type: "command"; move: string; args?: Record<string, unknown>; stateID: number }
  | { type: "intent"; intent: Intent; stateID: number }
  | { type: "setBotSpeed"; ms: number }
  | { type: "concede" };

export interface DeckSummary {
  id: string;
  name: string;
  source?: { kind: string; url?: string };
  legends: string[];
  size: number;
  colors: string[];
  legal: boolean;
  /** Your own deck (var/decks) — can be saved over and deleted. */
  editable?: boolean;
}

/** Deck as stored and edited (slugs; main = slug -> copies). */
export interface DeckData {
  id: string;
  name: string;
  source?: { kind: string; url?: string; author?: string; date?: string; note?: string };
  legends: string[];
  main: Record<string, number>;
  /** Tournament sideboard: 7 main-deck cards, no Legends. */
  sideboard?: Record<string, number>;
}

export interface DeckCheck {
  problems: { severity: "error" | "warning"; code: string; message: string }[];
  legal: boolean;
  size: number;
  /** The deck as a text list (export). */
  text: string;
}

export interface BotSummary {
  id: string;
  label: string;
  fair: boolean;
  description: string;
}

export interface NewGameRequest {
  yourDeck: string;
  botDeck: string;
  bot: string;
  seed?: string;
  name?: string;
}

/** Response of POST /api/games, /api/rooms and /api/rooms/:id/join: your seat's secret. */
export interface SeatTicket {
  gameId: string;
  token: string;
  /** Friend rooms (host only): the code for the invite link. */
  invite?: string;
}

/** GET /api/rooms/:id?invite=… — what the invited player sees before joining. */
export interface RoomInfo {
  gameId: string;
  status: "waiting" | "started";
  hostName: string;
  hostDeck: string;
}

/** GET /api/share — internet sharing (Cloudflare quick tunnel) status. */
export interface ShareInfo {
  active: boolean;
  /** Public https URL of this server while sharing. */
  url: string | null;
  /** Access key remote visitors need (part of every shared link). */
  key: string;
  /** cloudflared found on this computer. */
  available: boolean;
  error?: string;
}
