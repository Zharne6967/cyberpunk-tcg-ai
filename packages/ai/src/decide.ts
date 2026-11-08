import { AIPlayer, LocalEngine, setCardRegistry, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import { getCatalog } from "@cpai/core";
import { getStrategy } from "./strategies.ts";

export interface BotDecision {
  move: string;
  args?: Record<string, unknown>;
  ms: number;
}

let registryReady = false;

/**
 * Decide the bot's next command for `state` without mutating it. Runs on a private engine copy so it
 * can live in a worker thread; the caller applies the returned command to the authoritative engine.
 */
export function decideBotCommand(state: MatchState, botId: string, strategyName: string, seed: string): BotDecision | null {
  if (!registryReady) {
    setCardRegistry(getCatalog().engineCatalog);
    registryReady = true;
  }
  const engine = new LocalEngine(state, { initializeTurnStartCheckpoint: false });
  const player = new AIPlayer(engine, botId as PlayerId, getStrategy(strategyName), { rngSeed: seed });
  const t0 = performance.now();
  const step = player.step();
  if (step.kind !== "acted") return null;
  return { move: step.decision.move, args: step.decision.args as Record<string, unknown> | undefined, ms: performance.now() - t0 };
}
