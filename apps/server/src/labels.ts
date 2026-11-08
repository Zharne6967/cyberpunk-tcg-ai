import { enMessages } from "@tcg/cyberpunk-engine";
import type { CardView, MatchView } from "@cpai/core/protocol";

type MessageKey = keyof typeof enMessages;

/**
 * Game log: the engine's own English messages (official terminology). Every line already shows who acted,
 * so the internal seat id ("Player p1") is dropped from the concede line.
 */
export const LOG_MESSAGES = { ...enMessages, "move.concede": "Conceded the game." } as Record<MessageKey, string>;

export interface NameIndex {
  card(id: string | undefined): CardView | undefined;
  name(id: string | undefined): string;
}

export function buildNameIndex(view: MatchView): NameIndex {
  const byId = new Map<string, CardView>();
  for (const p of Object.values(view.players)) {
    for (const cards of Object.values(p.zones)) {
      if (Array.isArray(cards)) for (const c of cards) byId.set(c.instanceId, c);
    }
  }
  return {
    card: (id) => (id ? byId.get(id) : undefined),
    name(id) {
      if (!id) return "?";
      const c = byId.get(id);
      if (!c) return "?";
      if (id.startsWith("gd_")) return c.zone === "gigArea" ? `${c.definitionId.toUpperCase()} (${c.power})` : c.definitionId.toUpperCase();
      return c.cardName ?? (c.zone === "legendArea" ? "face-down Legend" : "face-down card");
    },
  };
}

export interface ActionLabel {
  label: string;
  group: "setup" | "play" | "sell" | "legend" | "attack" | "react" | "ability" | "phase" | "choice" | "other";
  cardId?: string;
  targetId?: string;
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Position (1-based) of a card in its Legends area — face-down Legends have no other name. */
function legendSlot(view: MatchView, id: string | undefined): number {
  for (const p of Object.values(view.players)) {
    const z = p.zones.legendArea;
    if (Array.isArray(z)) {
      const i = z.findIndex((c) => c.instanceId === id);
      if (i >= 0) return i + 1;
    }
  }
  return 0;
}

/** Labels for engine commands, in the official English terms of the Comprehensive Rules. */
export function labelAction(move: string, args: Record<string, unknown> | undefined, idx: NameIndex, view: MatchView): ActionLabel {
  const a = args ?? {};
  switch (move) {
    case "keepHand":
      return { label: "Keep", group: "setup" };
    case "mulligan":
      return { label: "Mulligan", group: "setup" };
    case "resolveFirstPlayer":
      return { label: a.goFirst ? "Go first" : "Go second", group: "choice" };
    case "playCard": {
      const card = s(a.cardId);
      if (a.attachToId) return { label: `Play a Card: ${idx.name(card)} → ${idx.name(s(a.attachToId))}`, group: "play", cardId: card, targetId: s(a.attachToId) };
      return { label: `Play a Card: ${idx.name(card)}`, group: "play", cardId: card };
    }
    case "sellCard":
      return { label: `Sell a Card: ${idx.name(s(a.cardId))}`, group: "sell", cardId: s(a.cardId) };
    case "callLegend": {
      const id = s(a.legendId);
      const known = idx.card(id)?.cardName;
      return { label: known ? `Call a Legend: ${known}` : `Call a Legend (${legendSlot(view, id)})`, group: "legend", cardId: id };
    }
    case "attackUnit":
      return { label: `Attack: ${idx.name(s(a.attackerId))} → ${idx.name(s(a.defenderId))}`, group: "attack", cardId: s(a.attackerId), targetId: s(a.defenderId) };
    case "attackRival":
      return { label: `Attack: ${idx.name(s(a.attackerId))} → Rival Gig area`, group: "attack", cardId: s(a.attackerId) };
    case "useBlocker":
      return { label: `[BLOCKER]: ${idx.name(s(a.blockerId))}`, group: "react", cardId: s(a.blockerId) };
    case "goSolo":
      return { label: `[GO SOLO]: ${idx.name(s(a.cardId))}`, group: "ability", cardId: s(a.cardId) };
    case "activateAbility": {
      const card = s(a.cardId);
      const n = typeof a.abilityIndex === "number" && a.abilityIndex > 0 ? ` (${a.abilityIndex + 1})` : "";
      return { label: `Activate an Effect${n}: ${idx.name(card)}`, group: "ability", cardId: card };
    }
    case "gainGig":
      return a.dieId ? { label: `Gain a Gig: ${idx.name(s(a.dieId))}`, group: "choice", cardId: s(a.dieId) } : { label: "Gain a Gig", group: "phase" };
    case "passPhase": {
      if (view.attackState?.step === "react") return { label: "Pass", group: "phase" };
      if (view.gamePhase === "main") return { label: "Pass Turn", group: "phase" };
      return { label: "Pass", group: "phase" };
    }
    case "resolveAttack":
      return { label: a.pass ? "Pass" : "Continue", group: "phase" };
    case "resolveTrigger":
      return a.pass ? { label: "Decline", group: "choice" } : { label: "Resolve", group: "choice" };
    case "resolveEffectTarget": {
      if (a.pass) return { label: "Decline", group: "choice" };
      const ids = Array.isArray(a.targetIds) ? (a.targetIds as string[]) : [];
      if (ids.length === 0) return { label: "Choose none", group: "choice" };
      return { label: ids.map((i) => idx.name(i)).join(", "), group: "choice", cardId: ids[0] };
    }
    case "resolveDiscardFromHand": {
      if (a.pass) return { label: "Decline", group: "choice" };
      const ids = Array.isArray(a.cardIds) ? (a.cardIds as string[]) : [];
      return { label: `Trash: ${ids.map((i) => idx.name(i)).join(", ")}`, group: "choice", cardId: ids[0] };
    }
    case "resolveStealGigs": {
      const ids = Array.isArray(a.dieIds) ? (a.dieIds as string[]) : [];
      return { label: `Steal: ${ids.map((i) => idx.name(i)).join(", ")}`, group: "choice", cardId: ids[0] };
    }
    case "resolvePreventGigSteal":
      return { label: "Decline", group: "choice" };
    case "resolveAdjustGig":
      return a.kind === "noAdjustment"
        ? { label: "No adjustment", group: "choice" }
        : { label: `Adjust: ${idx.name(s(a.dieId))} → ${String(a.value)}`, group: "choice", cardId: s(a.dieId) };
    case "resolveChooseEffect":
      return { label: String(a.optionId), group: "choice" };
    case "resolveCardToPlay":
      return { label: `Play a Card: ${idx.name(s(a.cardId))}`, group: "choice", cardId: s(a.cardId) };
    case "resolveCardToMove":
      return a.pass ? { label: "Decline", group: "choice" } : { label: idx.name(s(a.cardId)), group: "choice", cardId: s(a.cardId) };
    case "resolveRevealDestination":
      return { label: a.destination === "hand" ? "Hand" : "Trash", group: "choice" };
    case "resolveCardTypeChoice":
      return { label: String(a.cardType).replace(/^./, (c) => c.toUpperCase()), group: "choice" };
    case "resolveRedirectDefeat":
      return { label: a.pass ? "Decline" : "Apply", group: "choice" };
    case "resolveSacrificialGear":
      return { label: idx.name(s(a.cardId)), group: "choice", cardId: s(a.cardId) };
    default:
      return { label: move, group: "other" };
  }
}
