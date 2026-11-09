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
import type { IsmctsOptions } from "./ismcts/search.ts";

/**
 * Bot registry. "fair" = decides only from what its seat has seen (no peeking at your hand or the
 * deck order). Engine bots come from the vendored upstream engine; ISMCTS bots are ours (stage 3).
 */
export interface BotInfo {
  kind: "engine" | "ismcts";
  /** Engine bots: the upstream strategy. */
  strategy?: () => AIStrategy;
  /** ISMCTS bots: search settings (iterations are the total, split across worker threads). */
  ismcts?: Partial<IsmctsOptions>;
  /** Decides from the filtered view only (never sees your hand or deck order). */
  fair: boolean;
  label: string;
  description: string;
  /** Offered in the game lobby. */
  inLobby: boolean;
}

export const STRATEGIES: Record<string, BotInfo> = {
  random: { kind: "engine", strategy: () => randomStrategy, fair: true, label: "Random (testing)", description: "Plays random legal moves.", inLobby: false },
  greedy: { kind: "engine", strategy: () => greedyStrategy, fair: true, label: "Easy", description: "Greedy: best move right now, no planning.", inLobby: true },
  tactical: { kind: "engine", strategy: () => tacticalStrategy, fair: true, label: "Normal", description: "Searches 3 moves ahead. Does not see your cards.", inLobby: true },
  masterful: { kind: "engine", strategy: () => abilityAwareTacticalStrategy, fair: true, label: "Hard", description: "Like Normal, plus card roles and abilities. Does not see your cards.", inLobby: true },
  "ismcts-fast": {
    kind: "ismcts",
    ismcts: { iterations: 300, timeMs: 2500 },
    fair: true,
    label: "Very Hard",
    description: "Simulates hundreds of game continuations (ISMCTS). Does not see your cards. ~1 s per move.",
    inLobby: true,
  },
  "ismcts-sim": {
    kind: "ismcts",
    ismcts: { iterations: 40 },
    fair: true,
    label: "Strong (simulations)",
    description: "ISMCTS with 40 simulations per move and no time limit: the same result on every computer. Wins about 84% against Hard.",
    inLobby: false,
  },
  ismcts: {
    kind: "ismcts",
    ismcts: { iterations: 1200, timeMs: 6000 },
    fair: true,
    label: "Master",
    description: "Like Very Hard with 4x the simulations on all CPU cores. Does not see your cards. ~2-4 s per move.",
    inLobby: true,
  },
  "expert-oracle": { kind: "engine", strategy: () => expertOracleStrategy, fair: false, label: "Expert (cheats)", description: "Sees your hand and deck order.", inLobby: true },
  "monte-carlo": {
    kind: "engine",
    strategy: () => createMonteCarloStrategy({ rolloutsPerAction: 2, maxRolloutSteps: 30, rolloutStrategy: greedyStrategy }),
    fair: false,
    label: "Monte Carlo (sees hidden cards)",
    description: "Rollouts that see hidden cards.",
    inLobby: false,
  },
  mcts: { kind: "engine", strategy: () => mctsStrategy, fair: false, label: "MCTS upstream (sees hidden cards)", description: "Engine MCTS; sees hidden cards.", inLobby: false },
};

export function getBot(name: string): BotInfo {
  const s = STRATEGIES[name];
  if (!s) throw new Error(`Nieznany bot "${name}". Dostępne: ${Object.keys(STRATEGIES).join(", ")}`);
  return s;
}

/** Upstream engine strategy for an engine bot (ISMCTS bots are driven by `decideBotCommand`). */
export function getStrategy(name: string): AIStrategy {
  const s = getBot(name);
  if (!s.strategy) throw new Error(`Bot "${name}" nie jest strategią silnika (użyj decideBotCommand).`);
  return s.strategy();
}
