import { LocalEngine, createMatchState, createPlayerId, filterMatchView, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { actorOf } from "./ismcts/actions.ts";
import { KnowledgeTracker } from "./ismcts/determinize.ts";
import type { IsmctsOptions } from "./ismcts/search.ts";
import { decideBotCommand, ensureRegistry } from "./decide.ts";
import { getBot } from "./strategies.ts";

export interface MatchSpec {
  deckA: Deck;
  deckB: Deck;
  strategyA: string;
  strategyB: string;
  seed: string;
  /** Which seat deck A sits in; alternate to cancel the first-player advantage. */
  aSeat: "p1" | "p2";
  maxSteps?: number;
  /** Per-side ISMCTS overrides (benchmarks compare budgets). */
  ismctsA?: Partial<IsmctsOptions>;
  ismctsB?: Partial<IsmctsOptions>;
}

export type EndReason = "winCondition" | "deckOut" | "concede" | "stuck" | "illegal" | "repeatedState" | "maxSteps";

/** Cards one side used during a game (card slugs, each listed once). */
export interface SideCards {
  /** Played from hand (Units, Gear, Programs) or called (Legends). */
  played: string[];
  sold: string[];
}

export interface MatchOutcome {
  seed: string;
  aSeat: "p1" | "p2";
  winner: "A" | "B" | "draw";
  reason: EndReason;
  turns: number;
  steps: number;
  ms: number;
  /** Total thinking time and number of decisions per side. */
  thinkMsA: number;
  thinkMsB: number;
  decisionsA: number;
  decisionsB: number;
  /** Commands the engine rejected (bot bugs) — should stay 0. */
  rejected: number;
  /** Did deck A take the first turn. */
  aFirst: boolean;
  cardsA: SideCards;
  cardsB: SideCards;
}

const PLAY_MOVES: Record<string, string> = { playCard: "cardId", resolveCardToPlay: "cardId", callLegend: "legendId" };

/**
 * Bot vs bot match driven exactly like the game server drives the bot: every decision goes through
 * `decideBotCommand` on a copy of the state, fair bots get only their seat's remembered identities.
 * A generator: it yields after every command, so a server can run games without blocking its event loop.
 */
export function* matchSteps(spec: MatchSpec): Generator<void, MatchOutcome> {
  ensureRegistry();
  const catalog = getCatalog();
  const aIsP1 = spec.aSeat === "p1";
  const p1 = createPlayerId("p1");
  const p2 = createPlayerId("p2");
  const [d1, d2] = aIsP1 ? [spec.deckA, spec.deckB] : [spec.deckB, spec.deckA];
  const strategy: Record<string, string> = aIsP1 ? { p1: spec.strategyA, p2: spec.strategyB } : { p1: spec.strategyB, p2: spec.strategyA };
  const overrides: Record<string, Partial<IsmctsOptions> | undefined> = aIsP1 ? { p1: spec.ismctsA, p2: spec.ismctsB } : { p1: spec.ismctsB, p2: spec.ismctsA };
  const engine = new LocalEngine(
    createMatchState({
      players: [
        { id: p1, name: "p1" },
        { id: p2, name: "p2" },
      ],
      catalog: catalog.engineCatalog,
      deckLists: [toEngineDeckList(d1, "p1"), toEngineDeckList(d2, "p2")],
      seed: spec.seed,
    }),
  );
  const trackers: Record<string, KnowledgeTracker | undefined> = {};
  for (const pid of [p1, p2]) if (getBot(strategy[pid]!).kind === "ismcts") trackers[pid] = new KnowledgeTracker(pid);
  const think: Record<string, number> = { p1: 0, p2: 0 };
  const decisions: Record<string, number> = { p1: 0, p2: 0 };
  const used: Record<string, { played: Set<string>; sold: Set<string> }> = {
    p1: { played: new Set(), sold: new Set() },
    p2: { played: new Set(), sold: new Set() },
  };
  const slugOf = (state: MatchState, id: unknown) => {
    const def = typeof id === "string" ? state.G.cardIndex[id]?.definitionId : undefined;
    return def ? (catalog.engineCatalog.get(def)?.slug ?? def) : undefined;
  };
  const seen = new Map<string, number>();
  const maxSteps = spec.maxSteps ?? 3000;
  let rejected = 0;
  let reason: EndReason | null = null;
  let loser: PlayerId | null = null;
  let firstPlayer: string | null = null;
  const t0 = performance.now();
  let step = 0;

  for (; step < maxSteps; step++) {
    const state = engine.getState();
    if (state.G.gameEnded) break;
    if (!firstPlayer && state.G.gamePhase !== "setup") firstPlayer = state.G.turnMetadata.activePlayerId as string;
    for (const t of Object.values(trackers)) t?.observe(state);
    const turn = actorOf(state);
    if (!turn) {
      reason = "stuck";
      loser = state.G.turnMetadata.activePlayerId;
      break;
    }
    // Same public position over and over = an automation loop; end it like runAutoMatch does.
    const { stateID: _sid, prompt: _p, ...pub } = filterMatchView(state, p1);
    const h = JSON.stringify(pub);
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    if (n > 8) {
      reason = "repeatedState";
      loser = turn.pid;
      break;
    }
    const seed = `${spec.seed}:${step}`;
    const started = performance.now();
    const decision = decideBotCommand(state, turn.pid, strategy[turn.pid]!, seed, {
      remembered: trackers[turn.pid]?.ids(),
      ismcts: overrides[turn.pid],
    });
    think[turn.pid]! += performance.now() - started;
    decisions[turn.pid]!++;
    const tries = decision ? [decision, ...(decision.alternatives ?? [])] : [];
    const fallback = () => decideBotCommand(state, turn.pid, "greedy", `${seed}:fb`);
    let applied: { move: string; args?: Record<string, unknown> } | null = null;
    for (const d of tries) {
      const r = engine.processCommand({ commandID: `${turn.pid}-${step}`, move: d.move as never, input: d.args ? { args: d.args } : undefined }, turn.pid);
      if (r.success) {
        applied = d;
        break;
      }
      rejected++;
    }
    if (!applied) {
      const fb = fallback();
      if (fb && engine.processCommand({ commandID: `${turn.pid}-${step}-fb`, move: fb.move as never, input: fb.args ? { args: fb.args } : undefined }, turn.pid).success) applied = fb;
    }
    if (!applied) {
      reason = decision ? "illegal" : "stuck";
      loser = turn.pid;
      break;
    }
    const playArg = PLAY_MOVES[applied.move];
    if (playArg) {
      const slug = slugOf(state, applied.args?.[playArg]);
      if (slug) used[turn.pid]!.played.add(slug);
    } else if (applied.move === "sellCard") {
      const slug = slugOf(state, applied.args?.cardId);
      if (slug) used[turn.pid]!.sold.add(slug);
    }
    yield;
  }
  if (!reason && !engine.getState().G.gameEnded) {
    reason = "maxSteps";
    loser = engine.getState().G.turnMetadata.activePlayerId;
  }
  if (reason && loser && !engine.getState().G.gameEnded) {
    engine.processCommand({ commandID: "automation-concession", move: "concede" as never, input: { args: {} } }, loser);
  }
  const final = engine.getState();
  const winReason = final.G.winReason;
  reason ??= winReason === "deckOut" ? "deckOut" : winReason === "concede" ? "concede" : "winCondition";
  let winner: MatchOutcome["winner"] = "draw";
  if (final.G.winnerId) winner = (final.G.winnerId === "p1") === aIsP1 ? "A" : "B";
  const [ta, tb] = aIsP1 ? ["p1", "p2"] : ["p2", "p1"];
  const cards = (pid: string): SideCards => ({ played: [...used[pid]!.played], sold: [...used[pid]!.sold] });
  return {
    seed: spec.seed,
    aSeat: spec.aSeat,
    winner,
    reason,
    turns: final.G.turnMetadata.turnNumber,
    steps: step,
    ms: performance.now() - t0,
    thinkMsA: think[ta]!,
    thinkMsB: think[tb]!,
    decisionsA: decisions[ta]!,
    decisionsB: decisions[tb]!,
    rejected,
    aFirst: firstPlayer === ta,
    cardsA: cards(ta),
    cardsB: cards(tb),
  };
}

/** Play a whole match synchronously (simulator threads). */
export function playMatch(spec: MatchSpec): MatchOutcome {
  const steps = matchSteps(spec);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Play a match in slices of `sliceMs`, giving the event loop a turn in between (game server). */
export async function playMatchAsync(spec: MatchSpec, sliceMs = 12): Promise<MatchOutcome> {
  const steps = matchSteps(spec);
  let t = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - t > sliceMs) {
      await new Promise((res) => setImmediate(res));
      t = performance.now();
    }
  }
}
