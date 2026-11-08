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
export interface BotInfo {
  strategy: () => AIStrategy;
  /** Decides from the filtered view only (never sees your hand or deck order). */
  fair: boolean;
  label: string;
  description: string;
  /** Offered in the game lobby. */
  inLobby: boolean;
}

export const STRATEGIES: Record<string, BotInfo> = {
  random: { strategy: () => randomStrategy, fair: true, label: "Losowy (do testów)", description: "Wykonuje losowe legalne ruchy.", inLobby: false },
  greedy: { strategy: () => greedyStrategy, fair: true, label: "Łatwy", description: "Gra zachłannie: najlepszy ruch tu i teraz, bez planowania.", inLobby: true },
  tactical: { strategy: () => tacticalStrategy, fair: true, label: "Średni", description: "Przeszukuje 3 ruchy w przód (minimax), nie widzi Twoich kart.", inLobby: true },
  masterful: { strategy: () => abilityAwareTacticalStrategy, fair: true, label: "Trudny", description: "Jak Średni, plus rozumie role kart i zdolności. Nie widzi Twoich kart.", inLobby: true },
  "expert-oracle": { strategy: () => expertOracleStrategy, fair: false, label: "Ekspert (oszukuje)", description: "Najsilniejszy z silnika, ale WIDZI Twoją rękę i kolejność talii. Do treningu pod presją.", inLobby: true },
  "monte-carlo": {
    strategy: () => createMonteCarloStrategy({ rolloutsPerAction: 2, maxRolloutSteps: 30, rolloutStrategy: greedyStrategy }),
    fair: false,
    label: "Monte Carlo (bez determinizacji)",
    description: "Symulacje rozgrywki widzące ukryte karty.",
    inLobby: false,
  },
  mcts: { strategy: () => mctsStrategy, fair: false, label: "MCTS upstream (bez determinizacji)", description: "MCTS z silnika; widzi ukryte karty.", inLobby: false },
};

export function getStrategy(name: string): AIStrategy {
  const s = STRATEGIES[name];
  if (!s) throw new Error(`Nieznany bot "${name}". Dostępne: ${Object.keys(STRATEGIES).join(", ")}`);
  return s.strategy();
}
