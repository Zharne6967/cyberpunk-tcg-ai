import { parentPort, workerData } from "node:worker_threads";
import { playMatch, type MatchSpec } from "@cpai/ai";

/** Plays its share of a deck-analysis gauntlet; posts every result as soon as the game ends. */
const specs = workerData as { index: number; spec: MatchSpec }[];
for (const { index, spec } of specs) {
  try {
    parentPort!.postMessage({ index, outcome: playMatch(spec) });
  } catch (err) {
    parentPort!.postMessage({ index, error: String((err as Error)?.message ?? err) });
  }
}
