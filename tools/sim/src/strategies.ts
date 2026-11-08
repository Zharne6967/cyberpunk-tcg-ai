import {
  createMonteCarloStrategy,
  expertOracleStrategy,
  greedyStrategy,
  mctsStrategy,
  randomStrategy,
  tacticalStrategy,
  abilityAwareTacticalStrategy,
  type AIStrategy,
} from "@tcg/cyberpunk-engine";

/**
 * Bots available today (from the vendored engine). "fair" = decides from the filtered view only
 * (no peeking at hidden cards). Our own bots (ISMCTS etc.) get registered here in stage 3.
 */
export const STRATEGIES: Record<string, { strategy: () => AIStrategy; fair: boolean; label: string }> = {
  random: { strategy: () => randomStrategy, fair: true, label: "Losowy (do testów)" },
  greedy: { strategy: () => greedyStrategy, fair: true, label: "Łatwy (greedy)" },
  tactical: { strategy: () => tacticalStrategy, fair: true, label: "Średni (minimax d3)" },
  masterful: { strategy: () => abilityAwareTacticalStrategy, fair: true, label: "Trudny (minimax + role kart)" },
  "expert-oracle": { strategy: () => expertOracleStrategy, fair: false, label: "Ekspert (widzi ukryte karty!)" },
  "monte-carlo": {
    strategy: () => createMonteCarloStrategy({ rolloutsPerAction: 2, maxRolloutSteps: 30, rolloutStrategy: greedyStrategy }),
    fair: false,
    label: "Monte Carlo (bez determinizacji)",
  },
  mcts: { strategy: () => mctsStrategy, fair: false, label: "MCTS upstream (bez determinizacji)" },
};

export function getStrategy(name: string): AIStrategy {
  const s = STRATEGIES[name];
  if (!s) throw new Error(`Nieznany bot "${name}". Dostępne: ${Object.keys(STRATEGIES).join(", ")}`);
  return s.strategy();
}
