import { AIPlayer, LocalEngine, allMoves, manualMoves, registerMoves, setCardRegistry, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import { getCatalog } from "@cpai/core";
import { getBot, getStrategy } from "./strategies.ts";
import type { Action } from "./ismcts/actions.ts";
import { ismctsSearch, rankStats, type IsmctsOptions, type RootStat } from "./ismcts/search.ts";

export interface BotDecision {
  move: string;
  args?: Record<string, unknown>;
  ms: number;
  /** Next-best moves (ISMCTS), tried by the server if the engine rejects the first one. */
  alternatives?: Action[];
  /** Search summary for the UI/benchmarks. */
  info?: { iterations: number; winRate: number; visits: number };
}

let registryReady = false;

export function ensureRegistry(): void {
  if (registryReady) return;
  setCardRegistry(getCatalog().engineCatalog);
  // The lean simulation path (processCommandLean) needs the moves even when no LocalEngine was created
  // in this thread yet (e.g. the coach's Web Worker).
  registerMoves({ ...allMoves, ...manualMoves });
  registryReady = true;
}

export interface DecideOptions {
  /** Card instances the bot saw earlier this game (KnowledgeTracker.ids()). */
  remembered?: Iterable<string>;
  /** Override ISMCTS settings (e.g. a smaller per-worker budget). */
  ismcts?: Partial<IsmctsOptions>;
}

/** Turn root statistics into a decision (best first). */
export function decisionFromStats(stats: RootStat[], iterations: number, ms: number): BotDecision | null {
  const ranked = rankStats(stats);
  const best = ranked[0];
  if (!best) return null;
  return {
    move: best.action.move,
    args: best.action.args,
    ms,
    alternatives: ranked.slice(1, 6).map((s) => s.action),
    info: { iterations, visits: best.visits, winRate: best.visits ? best.value / best.visits : 0.5 },
  };
}

/** Upstream engine bot: one step of an AIPlayer on a private engine copy. */
function decideWithEngine(state: MatchState, botId: string, strategyName: string, seed: string): BotDecision | null {
  const engine = new LocalEngine(state, { initializeTurnStartCheckpoint: false });
  const player = new AIPlayer(engine, botId as PlayerId, getStrategy(strategyName), { rngSeed: seed });
  const t0 = performance.now();
  const step = player.step();
  if (step.kind !== "acted") return null;
  return { move: step.decision.move, args: step.decision.args as Record<string, unknown> | undefined, ms: performance.now() - t0 };
}

/**
 * Decide the bot's next command for `state` without mutating it (single thread). The caller applies
 * the returned command to the authoritative engine. Fair bots only use the bot seat's information;
 * ISMCTS proves it by construction (see ismcts/determinize.ts and fairness.test.ts).
 */
export function decideBotCommand(state: MatchState, botId: string, strategyName: string, seed: string, opts: DecideOptions = {}): BotDecision | null {
  ensureRegistry();
  const bot = getBot(strategyName);
  if (bot.kind === "engine") return decideWithEngine(state, botId, strategyName, seed);
  // Mulligan / first-player decisions: short playouts from the setup phase say little; use the
  // greedy heuristics (they only read the bot's own hand).
  if (state.G.gamePhase === "setup") return decideWithEngine(state, botId, "greedy", seed);
  const result = ismctsSearch(state, botId as PlayerId, { ...bot.ismcts, ...opts.ismcts }, seed, opts.remembered ?? []);
  return decisionFromStats(result.stats, result.iterations, result.ms);
}
