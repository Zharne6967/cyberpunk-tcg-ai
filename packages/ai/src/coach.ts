import { SeededRNG, filterMatchView, getStreetCredForPlayer, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import { getCatalog } from "@cpai/core";
import { coachKey, type CoachAdvice, type CoachMove, type MatchView } from "@cpai/core/protocol";
import { actorOf, applyAction, legalActions, type Action } from "./ismcts/actions.ts";
import { determinize, informationSet } from "./ismcts/determinize.ts";
import { ismctsSearch, rankStats } from "./ismcts/search.ts";
import { ensureRegistry } from "./decide.ts";
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

// ---- Why: the table where the playouts end (the start of your next turn), averaged per first move.

/** What the explanation can talk about, measured on a playout's final position. */
function tableMeasures(viewer: string): (s: MatchState) => number[] {
  const catalog = getCatalog().engineCatalog;
  return (s) => {
    const rival = (s.ctx.playerIds as string[]).find((p) => p !== viewer) ?? viewer;
    const units = (pid: string) =>
      (s.G.players[pid]?.zones.field ?? []).filter((id) => {
        const t = catalog.get(s.G.cardIndex[id as string]?.definitionId ?? "")?.type;
        return t === "unit" || t === "legend";
      }).length;
    const me = s.G.players[viewer]!;
    return [
      me.gigArea.length,
      s.G.players[rival]?.gigArea.length ?? 0,
      getStreetCredForPlayer(s, viewer as PlayerId),
      getStreetCredForPlayer(s, rival as PlayerId),
      units(viewer),
      units(rival),
      me.zones.hand.length,
      me.zones.eddieArea.length,
      s.G.gameEnded && s.G.winnerId === viewer ? 1 : 0,
      s.G.gameEnded && s.G.winnerId === rival ? 1 : 0,
    ];
  };
}

const one = (x: number) => (Math.round(x * 10) / 10).toString();
const percent = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Index into tableMeasures, which direction is good for you, the difference that counts as clear
 * (in the measure's own unit) and how to say it — official terms only.
 */
const WHY: { i: number; good: 1 | -1; clear: number; text: (a: string, b: string) => string; fmt: (x: number) => string }[] = [
  { i: 8, good: 1, clear: 0.06, fmt: percent, text: (a, b) => `You win the game before your next turn: ${a} (${b})` },
  { i: 9, good: -1, clear: 0.06, fmt: percent, text: (a, b) => `Your rival wins the game first: ${a} (${b})` },
  { i: 0, good: 1, clear: 0.35, fmt: one, text: (a, b) => `Your Gigs: ${a} (${b})` },
  { i: 1, good: -1, clear: 0.35, fmt: one, text: (a, b) => `Rival's Gigs: ${a} (${b})` },
  { i: 2, good: 1, clear: 1.5, fmt: one, text: (a, b) => `Your Street Cred: ${a} (${b})` },
  { i: 3, good: -1, clear: 1.5, fmt: one, text: (a, b) => `Rival's Street Cred: ${a} (${b})` },
  { i: 4, good: 1, clear: 0.35, fmt: one, text: (a, b) => `Units on your field: ${a} (${b})` },
  { i: 5, good: -1, clear: 0.35, fmt: one, text: (a, b) => `Units on the rival's field: ${a} (${b})` },
  { i: 6, good: 1, clear: 0.6, fmt: one, text: (a, b) => `Cards in your hand: ${a} (${b})` },
  { i: 7, good: 1, clear: 0.6, fmt: one, text: (a, b) => `Your Eddies: ${a} (${b})` },
];

/**
 * Up to two clear gains of the best move over the next option, and its clearest cost — values are the
 * averages over the simulations of each move (the next option's value in brackets).
 */
function explain(best: number[] | undefined, alt: number[] | undefined): CoachAdvice["why"] {
  if (!best || !alt) return [];
  const all = WHY.map((w) => ({ w, score: (w.good * (best[w.i]! - alt[w.i]!)) / w.clear }));
  let gains = all.filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, 2);
  // No clear gain: the largest smaller one, if any — a cost alone would not explain the choice.
  if (!gains.length) gains = all.filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 1);
  const costs = gains.length ? all.filter((x) => x.score <= -1).sort((a, b) => a.score - b.score).slice(0, 1) : [];
  return [...gains, ...costs].map(({ w, score }) => ({ text: w.text(w.fmt(best[w.i]!), w.fmt(alt[w.i]!)), good: score > 0 }));
}

export interface CoachOptions {
  iterations: number;
  timeMs: number;
  seed: string;
  /** Rank only these moves (coachKey), e.g. the targets of an attack the player already declared on another site. */
  only?: string[];
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
  // Opening hand and first player: every playout plays both players' first two turns (the next turn alone
  // says little about a hand) and only the root options are compared (no deeper tree: more samples each).
  const setup = world.G.gamePhase === "setup";
  const result = ismctsSearch(
    world,
    viewer,
    { iterations: opts.iterations, timeMs: opts.timeMs, ...(setup ? { maxDepth: 1, playout: { turns: 2, maxSteps: 400 } } : {}) },
    opts.seed,
    cw.remembered,
    tableMeasures(cw.viewer),
  );
  // Copies of the same card are separate commands with the same label: show each move once.
  const moves: CoachMove[] = [];
  const measures: (number[] | undefined)[] = [];
  const allowed = opts.only?.length ? new Set(opts.only) : null;
  const ranked = rankStats(result.stats).filter((r) => !allowed || allowed.has(coachKey(r.action.move, r.action.args)));
  for (const r of ranked) {
    const m = move(r.action, r.visits, result.trivial ? null : r.visits ? r.value / r.visits : null);
    if (moves.some((x) => x.label === m.label)) continue;
    moves.push(m);
    measures.push(r.measures);
    if (moves.length === 3) break;
  }
  // Why: compared with the next option, if both were simulated enough to say something.
  const enough = (i: number) => (moves[i]?.visits ?? 0) >= 20;
  const why = !result.trivial && enough(0) && enough(1) ? explain(measures[0], measures[1]) : [];

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
  return { stateID: cw.stateID, moves, plan, why, whyVs: why.length ? moves[1]!.label : null, iterations: result.iterations, ms: performance.now() - t0 };
}
