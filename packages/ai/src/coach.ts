import { SeededRNG, filterMatchView, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import { coachKey, type CoachAdvice, type CoachMove, type MatchView } from "@cpai/core/protocol";
import { actorOf, applyAction, legalActions, type Action } from "./ismcts/actions.ts";
import { determinize, informationSet } from "./ismcts/determinize.ts";
import { ismctsSearch, rankStats } from "./ismcts/search.ts";
import { decideBotCommand, ensureRegistry } from "./decide.ts";
import { buildNameIndex, labelAction } from "./labels.ts";

/**
 * Coach: the best move for a human seat, found by the same fair ISMCTS search the bots use, from that
 * player's information only. The server hands the player's browser one world sampled from their
 * information set (coachWorld); the browser searches it (coachAdvice) on the player's own processor.
 */

/** A complete game state that carries no more than what `viewer` knows. */
export interface CoachWorld {
  stateID: number;
  viewer: string;
  world: MatchState;
  /** Card instances the player saw earlier (their identities are already in the world). */
  remembered: string[];
}

/**
 * Sample the player's world: hidden identities (rival hand, both decks, face-down cards) are re-dealt
 * from the canonical multisets (determinize), the future randomness is re-seeded, and the instance ids
 * of every hidden card are shuffled among that owner's hidden cards. Ids are created in deck-list order,
 * so without that last step an id (and the real deck order of the id arrays) would give cards away.
 */
export function coachWorld(state: MatchState, viewer: PlayerId, remembered: Iterable<string>, seed: string): CoachWorld {
  const info = informationSet(state, viewer, remembered);
  const rng = new SeededRNG(seed);
  const world = determinize(state, info, rng);
  // Ids the player already sees on the table (also face-down Legends and Eddies) stay: the player's
  // moves refer to them. Only ids that never reach the player (decks, the rival's hand) are shuffled.
  const shown = new Set<string>();
  const scan = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(scan);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.instanceId === "string") shown.add(o.instanceId);
    for (const k in o) if (o[k] && typeof o[k] === "object") scan(o[k]);
  };
  scan(filterMatchView(state, viewer));
  const byOwner = new Map<string, string[]>();
  for (const [id, card] of Object.entries(world.G.cardIndex)) {
    if (info.stableIds.has(id) || info.rememberedInDeck.has(id) || shown.has(id)) continue;
    const list = byOwner.get(card.ownerId as string) ?? [];
    list.push(id);
    byOwner.set(card.ownerId as string, list);
  }
  const rename = new Map<string, string>();
  for (const ids of byOwner.values()) {
    const sorted = [...ids].sort();
    const shuffled = rng.shuffle([...sorted]);
    sorted.forEach((id, i) => rename.set(id, shuffled[i]!));
  }
  const json = JSON.stringify(world).replace(/"([^"\\]*)"/g, (m, s: string) => {
    const r = rename.get(s);
    return r === undefined ? m : `"${r}"`;
  });
  const keep = [...remembered].filter((id) => info.stableIds.has(id) || info.rememberedInDeck.has(id));
  return { stateID: state.ctx.stateID, viewer: viewer as string, world: JSON.parse(json) as MatchState, remembered: keep };
}

const viewOf = (s: MatchState, viewer: PlayerId) => filterMatchView(s, viewer) as unknown as MatchView;

function describe(s: MatchState, viewer: PlayerId, a: Action) {
  const view = viewOf(s, viewer);
  return labelAction(a.move, a.args, buildNameIndex(view), view);
}

/** Apply single-option steps (the search skips them too) until somebody has a real decision. */
function settle(s: MatchState, rand: () => number): MatchState {
  for (let guard = 0; guard < 50; guard++) {
    const turn = actorOf(s);
    if (!turn) return s;
    const actions = legalActions(s, turn.pid, turn.prompt, rand);
    if (actions.length !== 1) return s;
    const next = applyAction(s, turn.pid, actions[0]!);
    if (!next) return s;
    s = next;
  }
  return s;
}

export interface CoachOptions {
  iterations: number;
  timeMs: number;
  seed: string;
}

/** Search the player's world: the 3 best moves with estimated win chances, and the rest of the turn's plan. */
export function coachAdvice(cw: CoachWorld, opts: CoachOptions): CoachAdvice {
  ensureRegistry();
  const viewer = cw.viewer as PlayerId;
  const world = cw.world;
  const t0 = performance.now();
  const move = (a: Action, visits: number, winRate: number | null): CoachMove => {
    const l = describe(world, viewer, a);
    return { key: coachKey(a.move, a.args), move: a.move, ...(a.args ? { args: a.args } : {}), label: l.label, cardId: l.cardId, targetId: l.targetId, visits, winRate };
  };
  // Opening hand and first player: the bots' own heuristics (short playouts say little there).
  if (world.G.gamePhase === "setup") {
    const d = decideBotCommand(world, cw.viewer, "greedy", opts.seed);
    return { stateID: cw.stateID, moves: d ? [move(d, 1, null)] : [], plan: [], iterations: 0, ms: performance.now() - t0 };
  }
  const result = ismctsSearch(world, viewer, { iterations: opts.iterations, timeMs: opts.timeMs }, opts.seed, cw.remembered);
  // Copies of the same card are separate commands with the same label: show each move once.
  const moves: CoachMove[] = [];
  for (const r of rankStats(result.stats)) {
    const m = move(r.action, r.visits, result.trivial ? null : r.visits ? r.value / r.visits : null);
    if (!moves.some((x) => x.label === m.label)) moves.push(m);
    if (moves.length === 3) break;
  }

  // The rest of this turn as the search expects it: the player's own consecutive steps of the most
  // visited line, replayed in this world (a step that does not apply here ends the plan).
  const plan: string[] = [];
  const line = result.line ?? [];
  const rng = new SeededRNG(`${opts.seed}:plan`);
  const rand = () => rng.next();
  if (line.length && moves[0] && coachKey(line[0]!.action.move, line[0]!.action.args) === moves[0].key) {
    let s = applyAction(world, viewer, line[0]!.action);
    for (let i = 1; s && i < line.length && plan.length < 6; i++) {
      const step = line[i]!;
      s = settle(s, rand);
      const turn = actorOf(s);
      if (!turn || turn.pid !== viewer || step.actor !== cw.viewer) break;
      plan.push(describe(s, viewer, step.action).label);
      if (step.action.move === "passPhase" && s.G.gamePhase === "main" && !s.G.attackState) break;
      s = applyAction(s, viewer, step.action);
    }
  }
  return { stateID: cw.stateID, moves, plan, iterations: result.iterations, ms: performance.now() - t0 };
}
