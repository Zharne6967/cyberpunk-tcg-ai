import { parentPort, workerData } from "node:worker_threads";
import { playMatch, type MatchSpec } from "./match.ts";

const specs = workerData as MatchSpec[];
for (const spec of specs) {
  try {
    parentPort!.postMessage({ ok: true, outcome: playMatch(spec) });
  } catch (err) {
    parentPort!.postMessage({ ok: false, seed: spec.seed, error: String((err as Error)?.stack ?? err) });
  }
}
