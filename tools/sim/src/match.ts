import { LocalEngine, createMatchState, createPlayerId, filterMatchView, type PlayerId } from "@tcg/cyberpunk-engine";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { KnowledgeTracker, actorOf, decideBotCommand, ensureRegistry, getBot, type IsmctsOptions } from "@cpai/ai";

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
}

/**
 * Bot vs bot match driven exactly like the game server drives the bot: every decision goes through
 * `decideBotCommand` on a copy of the state, fair bots get only their seat's remembered identities.
 */
export function playMatch(spec: MatchSpec): MatchOutcome {
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
  const seen = new Map<string, number>();
  const maxSteps = spec.maxSteps ?? 3000;
  let rejected = 0;
  let reason: EndReason | null = null;
  let loser: PlayerId | null = null;
  const t0 = performance.now();
  let step = 0;

  for (; step < maxSteps; step++) {
    const state = engine.getState();
    if (state.G.gameEnded) break;
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
    let ok = false;
    for (const d of tries) {
      const r = engine.processCommand({ commandID: `${turn.pid}-${step}`, move: d.move as never, input: d.args ? { args: d.args } : undefined }, turn.pid);
      if (r.success) {
        ok = true;
        break;
      }
      rejected++;
    }
    if (!ok) {
      const fb = decideBotCommand(state, turn.pid, "greedy", `${seed}:fb`);
      ok = !!fb && engine.processCommand({ commandID: `${turn.pid}-${step}-fb`, move: fb.move as never, input: fb.args ? { args: fb.args } : undefined }, turn.pid).success;
    }
    if (!ok) {
      reason = decision ? "illegal" : "stuck";
      loser = turn.pid;
      break;
    }
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
  };
}
