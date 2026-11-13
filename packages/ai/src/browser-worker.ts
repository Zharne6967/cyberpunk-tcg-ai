/**
 * Deck analysis and Deck Doctor in the player's browser (Web Worker). The free online server has a
 * fraction of one core; the player's device has several. Every worker plans the same gauntlet
 * (deterministic), plays the games of its shard and posts each result; one worker builds the report or
 * proposes the Doctor's card swaps. `job` ties answers to the request (the workers serve many in a row).
 */
import type { Deck } from "@cpai/core";
import type { AnalysisReport } from "@cpai/core/protocol";
import { buildReport, planGauntlet } from "./analysis.ts";
import { doctorOpponents, proposeSwaps } from "./doctor.ts";
import { labBreed, labSeed } from "./lab.ts";
import { bestLegends, metaAdvice, metaBuild, metaData } from "./meta-stats.ts";
import { answerMessage, type DeckRequest } from "./deck-request.ts";
import { runDeckTool } from "./deck-tools.ts";
import { playMatch, type MatchOutcome } from "./match.ts";

export type AnalysisWorkerIn =
  | { type: "play"; job?: number; target: Deck; pool: Deck[]; perMatchup: number; shard: number; shards: number; seed?: string; bot?: string }
  | { type: "report"; job?: number; target: Deck; pool: Deck[]; perMatchup: number; outcomes: (MatchOutcome | null)[]; ms: number; bot?: string }
  | { type: "propose"; job?: number; deck: Deck; opponents: Deck[]; outcomes: (MatchOutcome | null)[]; cuts: number; adds: number; keep?: string[] }
  | { type: "opponents"; job?: number; target: Deck; pool: Deck[] }
  | { type: "labSeed"; job?: number; pool: Deck[]; count: number; seed: string; keep?: string[]; values?: Record<string, number> }
  | { type: "labBreed"; job?: number; parents: Deck[]; pool: Deck[]; count: number; seed: string; keep?: string[]; values?: Record<string, number> }
  | { type: "metaList"; job?: number }
  | { type: "metaBuild"; job?: number; keys?: string[]; legends?: string[] }
  | { type: "metaAdvice"; job?: number; deck: Deck; keep?: string[] }
  | { type: "deckChat"; job?: number; text: string; previous: DeckRequest | null; pool: Deck[]; shown: string | null }
  | { type: "deckTool"; job?: number; name: string; input: unknown; pool: Deck[] };

export type AnalysisWorkerOut =
  | { type: "plan"; job?: number; total: number }
  | { type: "outcome"; job?: number; index: number; outcome: MatchOutcome | null }
  | { type: "done"; job?: number }
  | { type: "report"; job?: number; report: AnalysisReport }
  | { type: "proposed"; job?: number; proposal: ReturnType<typeof proposeSwaps> }
  | { type: "opponents"; job?: number; opponents: Deck[] }
  | { type: "decks"; job?: number; decks: Deck[] }
  | { type: "meta"; job?: number; result: unknown }
  | { type: "error"; job?: number; message: string };

const ctx = self as unknown as { onmessage: ((e: { data: AnalysisWorkerIn }) => void) | null; postMessage(m: AnalysisWorkerOut): void };

ctx.onmessage = ({ data }) => {
  const job = data.job;
  try {
    if (data.type === "propose") {
      ctx.postMessage({ type: "proposed", job, proposal: proposeSwaps(data.deck, data.opponents, data.outcomes, data.cuts, data.adds, data.keep ?? []) });
      return;
    }
    if (data.type === "metaList") {
      const m = metaData();
      ctx.postMessage({ type: "meta", job, result: { source: m.source, date: m.date, archetypes: m.archetypes.map(({ key, name, games, share, winRate }) => ({ key, name, games, share, winRate })) } });
      return;
    }
    if (data.type === "metaBuild") {
      const all = metaData().archetypes.filter((a) => !data.keys || data.keys.includes(a.key));
      const builds = all.map((a) => metaBuild(a, data.legends?.length ? (bestLegends(a, data.legends) ?? undefined) : undefined)).filter((b) => !!b);
      ctx.postMessage({ type: "meta", job, result: builds });
      return;
    }
    if (data.type === "deckTool") {
      ctx.postMessage({ type: "meta", job, result: runDeckTool(data.name, data.input, data.pool) });
      return;
    }
    if (data.type === "deckChat") {
      ctx.postMessage({ type: "meta", job, result: answerMessage(data.text, data.previous, data.pool, data.shown) });
      return;
    }
    if (data.type === "metaAdvice") {
      ctx.postMessage({ type: "meta", job, result: metaAdvice(data.deck, data.keep ?? []) });
      return;
    }
    if (data.type === "labSeed") {
      ctx.postMessage({ type: "decks", job, decks: labSeed(data) });
      return;
    }
    if (data.type === "labBreed") {
      ctx.postMessage({ type: "decks", job, decks: labBreed(data) });
      return;
    }
    if (data.type === "opponents") {
      ctx.postMessage({ type: "opponents", job, opponents: doctorOpponents(data.target, data.pool) });
      return;
    }
    const bot = data.bot ?? "greedy";
    const { specs, opponents } = planGauntlet(data.target, data.pool, data.perMatchup, bot, data.type === "play" ? (data.seed ?? "analysis") : "analysis");
    if (data.type === "report") {
      ctx.postMessage({ type: "report", job, report: buildReport(data.target, opponents, specs, data.outcomes, data.ms, bot) });
      return;
    }
    ctx.postMessage({ type: "plan", job, total: specs.length });
    for (let i = data.shard; i < specs.length; i += data.shards) {
      let outcome: MatchOutcome | null = null;
      try {
        outcome = playMatch(specs[i]!);
      } catch {
        /* one broken game must not stop the analysis */
      }
      ctx.postMessage({ type: "outcome", job, index: i, outcome });
    }
    ctx.postMessage({ type: "done", job });
  } catch (err) {
    ctx.postMessage({ type: "error", job, message: String((err as Error)?.message ?? err) });
  }
};
