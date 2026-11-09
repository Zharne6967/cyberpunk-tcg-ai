/**
 * cyberpunk-tcg-sim.online: the snapshot fields the coach reads, and where the coach may run.
 * No engine imports: the extension's page script uses this alone.
 */

// ---- the snapshot (only the fields we read; everything optional: the site may change)
export interface SimCard {
  id?: string;
  cardId?: string | null;
  name?: string;
  type?: string;
  zone?: string;
  faceDown?: boolean;
  exhausted?: boolean;
  slotIndex?: number | null;
  canDeclareAttackThisTurn?: boolean;
  attachments?: (SimCard | string)[];
  /** Status kinds from the card's currentEffects (e.g. "lag", "spent"). */
  effects?: string[];
}
export interface SimDie {
  id?: string;
  label?: string;
  sides?: number;
  value?: number;
  available?: boolean;
  /** The site lets you roll this Fixer die now (Start Phase). */
  canRoll?: boolean;
  originalOwnerId?: string;
}
export interface SimPlayer {
  id?: string;
  hand?: SimCard[];
  handCount?: number;
  field?: SimCard[];
  legends?: SimCard[];
  eddies?: SimCard[];
  trash?: SimCard[];
  deckCount?: number;
  dicePool?: SimDie[];
  gigDice?: SimDie[];
  soldCardThisTurn?: boolean;
  calledLegendThisTurn?: boolean;
}
export interface SimSnapshot {
  room?: {
    mode?: string;
    joinCode?: string | null;
    isPublicLobby?: boolean;
    isQuickPlayRoom?: boolean;
    /** "private" for rooms by code (and local games); other values count as matchmaking. */
    matchCategory?: string;
    deckSelections?: Record<string, { deckLegendIds?: string[]; deckCardQuantities?: Record<string, number> } | undefined>;
    [k: string]: unknown;
  };
  self?: { playerId?: string | null; role?: string; isSpectator?: boolean };
  game?: {
    stage?: string;
    turnStep?: string | null;
    /** "Main Phase" also while turnStep stays "attack" after an attack resolved. */
    turnStepLabel?: string | null;
    turnNumber?: number;
    activePlayerId?: string | null;
    firstPlayerId?: string | null;
    playerOrder?: string[];
    overtime?: boolean;
    winnerId?: string | null;
  };
  players?: Record<string, SimPlayer>;
  /**
   * pending: the site's open choice (type, label, who decides, the card it comes from, the option labels);
   * primaryActions: action types such as "end_turn"; the can… flags: the choices before the first turn.
   */
  controls?: {
    pending?: SimPending | boolean | null;
    primaryActions?: string[];
    canChooseTurnOrder?: boolean;
    canKeepOpeningHand?: boolean;
    canMulligan?: boolean;
  };
}

export interface SimPending {
  type?: string;
  stepLabel?: string;
  actorId?: string;
  prompt?: string;
  sourceCard?: { id?: string; cardId?: string } | null;
  /** The site's buttons for this choice ("PLUS", "TARGET FRIENDLY D4 4"…). */
  options?: string[];
}

/**
 * main / start: your Main Phase or the Gig roll; order: go first or second; mulligan: keep or mulligan
 * the opening hand; choice: a choice of yours from a card effect (the coach replays the move that led to it).
 */
export type SimDecision = { kind: "main" | "start" | "order" | "mulligan" } | { kind: "choice"; label: string } | { kind: "wait"; reason: string };

const choiceLabel = (p: SimPending) => (p.stepLabel ? `${p.stepLabel.charAt(0)}${p.stepLabel.slice(1).toLowerCase()}` : "Your choice on the board");

/** Is it a decision of yours that the coach covers? */
export function simDecision(snap: SimSnapshot): SimDecision {
  const g = snap.game ?? {};
  const me = snap.self?.playerId;
  const pending = snap.controls?.pending;
  if (!me || !g.stage) return { kind: "wait", reason: "No game in progress" };
  if (g.winnerId) return { kind: "wait", reason: "The game is over" };
  if (pending) {
    const p = typeof pending === "object" ? pending : {};
    if (p.actorId && p.actorId !== me) return { kind: "wait", reason: "Rival is choosing" };
    return { kind: "choice", label: choiceLabel(p) };
  }
  if (g.stage === "turn_order_selection") return snap.controls?.canChooseTurnOrder ? { kind: "order" } : { kind: "wait", reason: "Rival chooses who goes first" };
  if (g.stage === "opening_hand_selection")
    return snap.controls?.canKeepOpeningHand || snap.controls?.canMulligan ? { kind: "mulligan" } : { kind: "wait", reason: "Rival decides on the opening hand" };
  if (g.stage !== "player_turn") return { kind: "wait", reason: "Waiting for the game to start" };
  if (g.activePlayerId !== me) return { kind: "wait", reason: "Rival's turn" };
  if (g.turnStep === "ready_roll") return { kind: "start" };
  const main = g.turnStepLabel === "Main Phase" || g.turnStep === "play" || g.turnStep === "attack" || (snap.controls?.primaryActions ?? []).includes("end_turn");
  return main ? { kind: "main" } : { kind: "wait", reason: "Waiting for your Main Phase" };
}

// ---- where the coach may run (the site's terms forbid outside help in matches that count)

/** Off in online matchmaking, public lobbies, Ranked and tournaments; on in solo, hotseat, tutorial and private rooms. */
export function simCoachAllowed(snap: SimSnapshot): { allowed: boolean; reason?: string } {
  const room = snap.room ?? {};
  const mode = room.mode;
  if (snap.self?.role !== "player" || snap.self?.isSpectator) return { allowed: false, reason: "Only for the players of the game" };
  if (mode === "solo" || mode === "hotseat" || mode === "tutorial" || mode === "test") return { allowed: true };
  if (mode === "network") {
    const counted = Object.entries(room).some(([k, v]) => /rank|tournament|ladder|league|event|prerelease|pre_release/i.test(k) && !!v);
    const privateRoom = room.matchCategory === undefined || room.matchCategory === "private";
    if (!counted && privateRoom && room.isPublicLobby !== true && room.isQuickPlayRoom !== true && typeof room.joinCode === "string" && room.joinCode)
      return { allowed: true };
  }
  return { allowed: false, reason: "Off in Quick Play, public lobbies, Ranked and tournaments" };
}
