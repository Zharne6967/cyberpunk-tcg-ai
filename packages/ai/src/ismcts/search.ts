import { SeededRNG, buildPlayerPrompt, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import { actorOf, applyAction, legalActions, perceivedKey, rawKey, type Action } from "./actions.ts";
import { determinize, informationSet, type InformationSet } from "./determinize.ts";
import { DEFAULT_PLAYOUT, playout, policyAction, type PlayoutOptions } from "./playout.ts";

/**
 * Single-Observer Information Set MCTS (Cowling, Powley & Whitehouse 2012).
 *
 * One tree per decision, seen from the bot's seat. Every iteration samples a fresh world from the
 * bot's information set (see determinize.ts), walks the tree restricted to the moves that are legal
 * in that world (UCB with availability counts), expands one move, plays the position out for a
 * couple of turns with a fast policy and backs the result up. Rival moves are tree edges keyed by
 * what the bot would *observe* ("rival plays Card X"), never by hidden instance ids, so statistics
 * are shared across all sampled worlds.
 */
export interface IsmctsOptions {
  /** Iteration budget (per search call). */
  iterations: number;
  /** Optional wall-clock cap in ms; the search stops at whichever limit comes first. */
  timeMs?: number;
  /** UCB exploration constant for rewards in [0, 1]. */
  exploration?: number;
  /** Max tree depth in decision nodes (forced single-option steps don't count). */
  maxDepth?: number;
  playout?: Partial<PlayoutOptions>;
}

export const DEFAULT_ISMCTS: Required<Omit<IsmctsOptions, "timeMs" | "playout">> & { playout: PlayoutOptions } = {
  iterations: 400,
  exploration: 0.7,
  maxDepth: 12,
  playout: DEFAULT_PLAYOUT,
};

/** Statistics of one root move (mergeable across worker threads). */
export interface RootStat {
  key: string;
  action: Action;
  visits: number;
  /** Sum of playout values from the bot's point of view. */
  value: number;
}

/** One step of the most visited line of the tree (who acts, what). */
export interface LineStep {
  actor: string;
  action: Action;
  visits: number;
  value: number;
}

export interface SearchResult {
  stats: RootStat[];
  /** Most visited path from the root (the search's expected continuation; steps with few visits are cut). */
  line?: LineStep[];
  iterations: number;
  ms: number;
  /** Search was skipped: zero or one legal move. */
  trivial: boolean;
}

interface Edge {
  actor: string;
  action: Action;
  visits: number;
  value: number;
  avail: number;
  node: TreeNode;
}

interface TreeNode {
  edges: Map<string, Edge>;
}

const newNode = (): TreeNode => ({ edges: new Map() });

function ucb(edge: Edge, viewer: string, c: number): number {
  if (edge.visits === 0) return Number.POSITIVE_INFINITY;
  const mean = edge.value / edge.visits;
  const own = edge.actor === viewer ? mean : 1 - mean;
  return own + c * Math.sqrt(Math.log(Math.max(1, edge.avail)) / edge.visits);
}

/**
 * Search the bot's decision in `state` (the authoritative state â€” only the bot's information set
 * is used, see determinize.ts). `remembered` are card instances the bot saw earlier in the game.
 */
export function ismctsSearch(
  state: MatchState,
  viewer: PlayerId,
  options: Partial<IsmctsOptions>,
  seed: string,
  remembered: Iterable<string> = [],
): SearchResult {
  const t0 = performance.now();
  const opts = { ...DEFAULT_ISMCTS, ...options, playout: { ...DEFAULT_PLAYOUT, ...options.playout } };
  const rng = new SeededRNG(seed);
  const rand = () => rng.next();
  const info: InformationSet = informationSet(state, viewer, remembered);

  const rootPrompt = buildPlayerPrompt(state, viewer);
  const rootActions = legalActions(state, viewer, rootPrompt, rand);
  if (rootActions.length <= 1) {
    return {
      stats: rootActions.map((a) => ({ key: rawKey(a), action: a, visits: 1, value: 0.5 })),
      iterations: 0,
      ms: performance.now() - t0,
      trivial: true,
    };
  }
  const rootKeys = rootActions.map(rawKey);
  const root = newNode();
  const deadline = opts.timeMs ? t0 + opts.timeMs : Number.POSITIVE_INFINITY;
  const c = opts.exploration;
  let iterations = 0;

  for (; iterations < opts.iterations; iterations++) {
    if ((iterations & 7) === 0 && performance.now() > deadline) break;
    let s = determinize(state, info, rng);
    let previousActive = s.G.turnMetadata.activePlayerId as string;
    let node = root;
    const path: Edge[] = [];
    let depth = 0;
    let expanded = false;

    for (let guard = 0; guard < 200 && !expanded; guard++) {
      const isRoot = node === root && path.length === 0;
      const turn = isRoot ? { pid: viewer, prompt: rootPrompt } : actorOf(s);
      if (!turn) break;
      const actions = isRoot ? rootActions : legalActions(s, turn.pid, turn.prompt, rand);
      if (actions.length === 0) break;
      if (actions.length === 1) {
        // Forced step: follow it without creating a decision node.
        const next = applyAction(s, turn.pid, actions[0]!);
        if (!next) break;
        previousActive = s.G.turnMetadata.activePlayerId as string;
        s = next;
        continue;
      }
      if (depth >= opts.maxDepth) break;
      const actor = turn.pid as string;
      const keyed = actions.map((a, i) => ({ a, key: `${actor}|${isRoot ? rootKeys[i]! : perceivedKey(a, s, info.stableIds)}` }));
      // Several concrete moves can look identical to the bot (two copies of a card): keep one.
      const unique = new Map<string, Action>();
      for (const k of keyed) if (!unique.has(k.key)) unique.set(k.key, k.a);
      for (const key of unique.keys()) {
        const e = node.edges.get(key);
        if (e) e.avail++;
      }
      const fresh = [...unique.keys()].filter((k) => !node.edges.has(k));
      if (fresh.length) {
        // Expansion: try the fast policy's move first, then the rest in random order.
        const preferred = policyAction(s, turn.pid, turn.prompt, rand);
        const prefKey = preferred ? [...unique.entries()].find(([, a]) => rawKey(a) === rawKey(preferred))?.[0] : undefined;
        const order = shuffled(fresh, rand);
        if (prefKey && fresh.includes(prefKey)) order.unshift(...order.splice(order.indexOf(prefKey), 1));
        for (const key of order) {
          const action = unique.get(key)!;
          const next = applyAction(s, turn.pid, action);
          if (!next) continue;
          const edge: Edge = { actor, action, visits: 0, value: 0, avail: 1, node: newNode() };
          node.edges.set(key, edge);
          path.push(edge);
          previousActive = s.G.turnMetadata.activePlayerId as string;
          s = next;
          expanded = true;
          break;
        }
        if (expanded) break;
      }
      // Selection among already-expanded moves that are available in this world.
      const candidates = [...unique.entries()]
        .flatMap(([k, a]) => {
          const edge = node.edges.get(k);
          return edge ? [{ edge, action: a, score: ucb(edge, viewer as string, c) }] : [];
        })
        .sort((x, y) => y.score - x.score);
      let moved = false;
      for (const { edge, action } of candidates) {
        const next = applyAction(s, turn.pid, action);
        if (!next) continue;
        path.push(edge);
        node = edge.node;
        previousActive = s.G.turnMetadata.activePlayerId as string;
        s = next;
        depth++;
        moved = true;
        break;
      }
      if (!moved) break;
    }

    const value = playout(s, viewer, opts.playout, rand, previousActive);
    for (const e of path) {
      e.visits++;
      e.value += value;
    }
  }

  const stats: RootStat[] = [];
  rootActions.forEach((a, i) => {
    const e = root.edges.get(`${viewer as string}|${rootKeys[i]!}`);
    if (e) stats.push({ key: rootKeys[i]!, action: a, visits: e.visits, value: e.value });
  });
  const line: LineStep[] = [];
  for (let node: TreeNode = root; line.length < 10; ) {
    let best: Edge | undefined;
    for (const e of node.edges.values()) if (!best || e.visits > best.visits) best = e;
    if (!best || best.visits < 4) break;
    line.push({ actor: best.actor, action: best.action, visits: best.visits, value: best.value });
    node = best.node;
  }
  return { stats, line, iterations, ms: performance.now() - t0, trivial: false };
}

function shuffled<T>(xs: T[], rand: () => number): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Merge root statistics from several independent searches (root parallelisation). */
export function mergeStats(results: RootStat[][]): RootStat[] {
  const byKey = new Map<string, RootStat>();
  for (const list of results)
    for (const s of list) {
      const cur = byKey.get(s.key);
      if (cur) {
        cur.visits += s.visits;
        cur.value += s.value;
      } else byKey.set(s.key, { ...s });
    }
  return [...byKey.values()];
}

/** Best move first: most visited (robust child), ties by mean value. */
export function rankStats(stats: RootStat[]): RootStat[] {
  return stats.slice().sort((a, b) => b.visits - a.visits || b.value / Math.max(1, b.visits) - a.value / Math.max(1, a.visits) || a.key.localeCompare(b.key));
}

