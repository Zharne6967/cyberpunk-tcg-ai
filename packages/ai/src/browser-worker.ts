/**
 * Deck analysis in the player's browser (Web Worker). The free online server has a fraction of one
 * core; the player's device has several. Every worker plans the same gauntlet (deterministic), plays the
 * games of its shard and posts each result; one worker then builds the report from all results.
 */
import type { Deck } from "@cpai/core";
import type { AnalysisReport } from "@cpai/core/protocol";
import { buildReport, planGauntlet } from "./analysis.ts";
import { playMatch, type MatchOutcome } from "./match.ts";

export type AnalysisWorkerIn =
  | { type: "play"; target: Deck; pool: Deck[]; perMatchup: number; shard: number; shards: number }
  | { type: "report"; target: Deck; pool: Deck[]; perMatchup: number; outcomes: (MatchOutcome | null)[]; ms: number };

export type AnalysisWorkerOut =
  | { type: "plan"; total: number }
  | { type: "outcome"; index: number; outcome: MatchOutcome | null }
  | { type: "done" }
  | { type: "report"; report: AnalysisReport }
  | { type: "error"; message: string };

const ctx = self as unknown as { onmessage: ((e: { data: AnalysisWorkerIn }) => void) | null; postMessage(m: AnalysisWorkerOut): void };

ctx.onmessage = ({ data }) => {
  try {
    const { specs, opponents } = planGauntlet(data.target, data.pool, data.perMatchup);
    if (data.type === "report") {
      ctx.postMessage({ type: "report", report: buildReport(data.target, opponents, specs, data.outcomes, data.ms) });
      return;
    }
    ctx.postMessage({ type: "plan", total: specs.length });
    for (let i = data.shard; i < specs.length; i += data.shards) {
      let outcome: MatchOutcome | null = null;
      try {
        outcome = playMatch(specs[i]!);
      } catch {
        /* one broken game must not stop the analysis */
      }
      ctx.postMessage({ type: "outcome", index: i, outcome });
    }
    ctx.postMessage({ type: "done" });
  } catch (err) {
    ctx.postMessage({ type: "error", message: String((err as Error)?.message ?? err) });
  }
};
