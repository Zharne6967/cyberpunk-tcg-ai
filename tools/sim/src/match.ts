import { createPlayerId, runAutoMatch, type AutoMatchResult } from "@tcg/cyberpunk-engine";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { getStrategy } from "@cpai/ai";

export interface MatchSpec {
  deckA: Deck;
  deckB: Deck;
  strategyA: string;
  strategyB: string;
  seed: string;
  /** Which seat deck A sits in; alternate to cancel the first-player advantage. */
  aSeat: "p1" | "p2";
  maxSteps?: number;
}

export interface MatchOutcome {
  seed: string;
  aSeat: "p1" | "p2";
  winner: "A" | "B" | "draw";
  reason: AutoMatchResult["reason"];
  turns: number;
  steps: number;
  ms: number;
}

export function playMatch(spec: MatchSpec): MatchOutcome {
  const catalog = getCatalog();
  const aIsP1 = spec.aSeat === "p1";
  const [d1, d2] = aIsP1 ? [spec.deckA, spec.deckB] : [spec.deckB, spec.deckA];
  const [s1, s2] = aIsP1 ? [spec.strategyA, spec.strategyB] : [spec.strategyB, spec.strategyA];
  const t0 = performance.now();
  const result = runAutoMatch({
    players: [
      { id: createPlayerId("p1"), name: "p1" },
      { id: createPlayerId("p2"), name: "p2" },
    ],
    decks: [toEngineDeckList(d1, "p1"), toEngineDeckList(d2, "p2")],
    strategies: [getStrategy(s1), getStrategy(s2)],
    catalog: catalog.engineCatalog,
    seed: spec.seed,
    maxSteps: spec.maxSteps ?? 4000,
  });
  const ms = performance.now() - t0;
  let winner: MatchOutcome["winner"] = "draw";
  if (result.winnerId) winner = (result.winnerId === "p1") === aIsP1 ? "A" : "B";
  return { seed: spec.seed, aSeat: spec.aSeat, winner, reason: result.reason, turns: result.turnCount, steps: result.stepCount, ms };
}
