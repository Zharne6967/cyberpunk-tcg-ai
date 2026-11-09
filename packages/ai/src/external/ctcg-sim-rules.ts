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
}
export interface SimDie {
  id?: string;
  label?: string;
  sides?: number;
  value?: number;
  available?: boolean;
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
    turnNumber?: number;
    activePlayerId?: string | null;
    firstPlayerId?: string | null;
    playerOrder?: string[];
    overtime?: boolean;
    winnerId?: string | null;
  };
  players?: Record<string, SimPlayer>;
  controls?: { pending?: unknown };
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
