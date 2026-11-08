import {
  SeededRNG,
  buildPlayerPrompt,
  filterMatchView,
  recomputeActiveEffects,
  type MatchState,
  type PlayerId,
} from "@tcg/cyberpunk-engine";

/**
 * Hidden information and how the bot treats it
 * --------------------------------------------
 * The engine state is complete (both hands, deck order, face-down Legends, the RNG seed). A fair bot
 * may only use what its seat has seen. Before every search iteration we therefore replace all of it
 * with a random sample ("determinization") that is consistent with the bot's information:
 *
 *  - cards the bot can see right now (its hand, the board, trash, revealed cards, cards shown in
 *    its own pending choice) keep their identity and place;
 *  - cards it saw earlier and that went back to a hidden zone (a bounced Unit in your hand, its own
 *    sold Eddies) keep their identity; if they went back into a deck only "it is somewhere in that
 *    deck" is kept, never the position;
 *  - everything else (your hand, both deck orders, your face-down Legends and Eddies) is re-dealt
 *    at random from the cards that are left — like a player who knows your decklist (open decklist)
 *    but not what you drew;
 *  - the engine RNG and seed are replaced, so future dice rolls and shuffles are unknown too.
 *
 * Determinization never reads the real hidden identities: it rebuilds them from canonical, sorted
 * multisets, so two states that differ only in hidden information produce identical samples. The
 * fairness test (`fairness.test.ts`) checks exactly that.
 */

export interface InformationSet {
  viewer: PlayerId;
  /** Cards whose identity and place the viewer knows in every possible world. */
  stableIds: ReadonlySet<string>;
  /** Hidden cards (not in a deck) whose identity the viewer remembers. */
  rememberedIds: ReadonlySet<string>;
  /** Cards known to be somewhere in their owner's deck (identity known, position not). */
  rememberedInDeck: ReadonlySet<string>;
}

/** Collect every card instance the viewer can currently identify in `obj` (a filtered view or prompt). */
export function scanIdentities(obj: unknown, state: MatchState, out: Map<string, string>): void {
  const index = state.G.cardIndex;
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const id = o.instanceId;
    const def = o.definitionId;
    if (typeof id === "string" && typeof def === "string" && def !== "" && o.cardName !== null && index[id]?.definitionId === def) {
      out.set(id, def);
    }
    for (const k in o) {
      const x = o[k];
      if (x && typeof x === "object") visit(x);
    }
  };
  visit(obj);
}

/** Identities visible to `viewer` in this exact state (its filtered view + its own prompt). */
export function visibleIdentities(state: MatchState, viewer: PlayerId): Map<string, string> {
  const out = new Map<string, string>();
  scanIdentities(filterMatchView(state, viewer), state, out);
  scanIdentities(buildPlayerPrompt(state, viewer), state, out);
  return out;
}

/**
 * Remembers every card identity a seat has been shown during the game. Feed it the state after
 * each command; it only ever looks through the seat's filtered view and prompt.
 */
export class KnowledgeTracker {
  private readonly seen = new Map<string, string>();
  constructor(readonly viewer: PlayerId) {}

  observe(state: MatchState): void {
    for (const [id, def] of visibleIdentities(state, this.viewer)) this.seen.set(id, def);
  }

  ids(): string[] {
    return [...this.seen.keys()];
  }

  get size(): number {
    return this.seen.size;
  }
}

/** Build the viewer's information set for `state` (plus identities remembered from earlier states). */
export function informationSet(state: MatchState, viewer: PlayerId, remembered: Iterable<string> = []): InformationSet {
  const visible = visibleIdentities(state, viewer);
  const stable = new Set<string>(visible.keys());
  const rememberedIds = new Set<string>();
  const rememberedInDeck = new Set<string>();
  for (const id of remembered) {
    const card = state.G.cardIndex[id];
    if (!card || stable.has(id)) continue;
    if (card.zone === "deck") rememberedInDeck.add(id);
    else {
      rememberedIds.add(id);
      stable.add(id);
    }
  }
  return { viewer, stableIds: stable, rememberedIds, rememberedInDeck };
}

/** Canonical (sorted) multiset — the only way hidden identities are ever read. */
const canonical = (defs: string[]) => defs.sort();

/**
 * Sample one complete world from the information set. Returns a fresh state; `state` is untouched.
 */
export function determinize(state: MatchState, info: InformationSet, rng: SeededRNG): MatchState {
  const s = structuredClone(state);
  const index = s.G.cardIndex;
  for (const pid of s.ctx.playerIds) {
    const zones = s.G.players[pid]!.zones as Record<string, string[]>;
    const legendSlots: string[] = [];
    const deckSlots: string[] = [];
    const otherSlots: string[] = [];
    const legendDefs: string[] = [];
    const freeDefs: string[] = [];
    const deckOnlyDefs: string[] = [];
    // Fixed zone order + zone array order: the slot list is public structure.
    for (const zone of ["legendArea", "hand", "deck", "eddieArea", "removedFromGame", "field", "trash"]) {
      for (const id of zones[zone] ?? []) {
        if (info.stableIds.has(id)) continue;
        const card = index[id];
        if (!card) continue;
        if (zone === "legendArea") {
          legendSlots.push(id);
          legendDefs.push(card.definitionId);
        } else if (zone === "deck") {
          deckSlots.push(id);
          (info.rememberedInDeck.has(id) ? deckOnlyDefs : freeDefs).push(card.definitionId);
        } else {
          otherSlots.push(id);
          freeDefs.push(card.definitionId);
        }
      }
    }
    // Face-down Legends are re-dealt among themselves.
    const legends = rng.shuffle(canonical(legendDefs));
    legendSlots.forEach((id, i) => (index[id]!.definitionId = legends[i]!));
    // Unknown cards may be anywhere hidden; remembered-in-deck cards stay in the deck.
    const free = rng.shuffle(canonical(freeDefs));
    otherSlots.forEach((id, i) => (index[id]!.definitionId = free[i]!));
    const deck = rng.shuffle(canonical([...free.slice(otherSlots.length), ...deckOnlyDefs]));
    deckSlots.forEach((id, i) => (index[id]!.definitionId = deck[i]!));
  }
  // Future randomness is unknown as well.
  const a = rng.nextInt(1, 0x7fffffff);
  const b = rng.nextInt(1, 0x7fffffff);
  s.ctx.seed = `world-${a.toString(36)}`;
  s.ctx.rngState = { state: b };
  recomputeActiveEffects(s);
  return s;
}
