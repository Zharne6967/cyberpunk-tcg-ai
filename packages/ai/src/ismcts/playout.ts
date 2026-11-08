import {
  defaultChoiceResolvers,
  evaluateBoard,
  filterMatchView,
  greedyStrategy,
  type MatchState,
  type MoveDecision,
  type PlayerId,
  type PlayerPrompt,
} from "@tcg/cyberpunk-engine";
import { actorOf, applyAction, legalActions, type Action } from "./actions.ts";

export interface PlayoutOptions {
  /**
   * How many rival turns to play to their end. The position is always scored at the start of the
   * bot's own turn (a consistent point, so sibling moves are compared fairly): 1 = finish the
   * current turn(s) and the rival's reply.
   */
  turns: number;
  /** Safety cap on simulated commands. */
  maxSteps: number;
  /** Probability of a uniformly random legal move instead of the greedy one. */
  epsilon: number;
  /** Logistic scale that maps `evaluateBoard` to a win probability. */
  evalScale: number;
}

export const DEFAULT_PLAYOUT: PlayoutOptions = { turns: 1, maxSteps: 80, epsilon: 0.1, evalScale: 160 };

/** Win probability for `pid` from a heuristic board score (engine `evaluateBoard`). */
export function boardWinProbability(state: MatchState, pid: PlayerId, scale: number): number {
  if (state.G.gameEnded) return terminalValue(state, pid);
  const score = evaluateBoard(filterMatchView(state, pid), pid as string);
  return 1 / (1 + Math.exp(-score / scale));
}

export function terminalValue(state: MatchState, pid: PlayerId): number {
  const w = state.G.winnerId as string | null;
  return w === null ? 0.5 : w === pid ? 1 : 0;
}

/** The fast policy used inside playouts: the engine's greedy bot (pure view, ~0.05 ms per move). */
export function policyAction(state: MatchState, pid: PlayerId, prompt: PlayerPrompt, rng: () => number): Action | null {
  const ctx = { view: filterMatchView(state, pid), playerId: pid, prompt, rng };
  let d: MoveDecision;
  if (prompt.status === "choice" && prompt.choice) {
    const resolver = (greedyStrategy.decideChoice?.[prompt.choice.type] ?? defaultChoiceResolvers[prompt.choice.type]) as (c: unknown, x: unknown) => MoveDecision;
    d = resolver(prompt.choice, ctx);
  } else d = greedyStrategy.decideAction(ctx);
  if (d.kind !== "command") return null;
  return d.args ? { move: d.move, args: d.args } : { move: d.move };
}

/**
 * Play the position forward with the fast policy for a few turns and score it for `viewer` in [0, 1].
 * Runs inside one determinized world, so both sides "know" that world's cards — that is the sample.
 */
export function playout(start: MatchState, viewer: PlayerId, opts: PlayoutOptions, rng: () => number, previousActive?: string): number {
  let s = start;
  let rivalTurnsEnded = 0;
  // Active player before the move that produced `start`: a turn that just ended counts.
  let active = previousActive ?? (s.G.turnMetadata.activePlayerId as string);
  for (let step = 0; step < opts.maxSteps; step++) {
    if (s.G.gameEnded) return terminalValue(s, viewer);
    const now = s.G.turnMetadata.activePlayerId as string;
    if (now !== active) {
      if (now === viewer && ++rivalTurnsEnded >= opts.turns) break;
      active = now;
    }
    const next = actorOf(s);
    if (!next) break;
    let action: Action | null = null;
    let legal: Action[] | null = null;
    if (rng() < opts.epsilon) {
      legal = legalActions(s, next.pid, next.prompt, rng);
      if (legal.length) action = legal[Math.floor(rng() * legal.length)]!;
    }
    action ??= policyAction(s, next.pid, next.prompt, rng);
    let after = action ? applyAction(s, next.pid, action) : null;
    if (!after) {
      // Policy picked something the engine rejects: try the remaining legal moves in random order.
      legal ??= legalActions(s, next.pid, next.prompt, rng);
      const order = legal.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      for (const a of order) {
        after = applyAction(s, next.pid, a);
        if (after) break;
      }
    }
    if (!after) break;
    s = after;
  }
  return boardWinProbability(s, viewer, opts.evalScale);
}
