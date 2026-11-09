import type { AnalysisReport, DeckData } from "@cpai/core/protocol";

/** Messages of packages/ai/src/browser-worker.ts (kept here so the page does not type-check the engine). */
type WorkerOut =
  | { type: "plan"; total: number }
  | { type: "outcome"; index: number; outcome: unknown }
  | { type: "done" }
  | { type: "report"; report: AnalysisReport }
  | { type: "error"; message: string };

/** Every worker holds its own engine and card data: at most 4, 2 on devices with little memory (phones). */
export function browserThreads(): number {
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory !== undefined && memory <= 4 ? Math.min(2, n) : n;
}

/**
 * Plays the analysis gauntlet on this device (Web Workers running the rules engine) and builds the report.
 * Much faster than the free online server; the caller falls back to the server when this fails.
 */
export async function analyzeInBrowser(
  target: DeckData,
  pool: DeckData[],
  perMatchup: number,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<AnalysisReport> {
  if (typeof Worker === "undefined") throw new Error("Web Workers are not available");
  const threads = browserThreads();
  const workers = Array.from({ length: threads }, () => new Worker(new URL("../../../packages/ai/src/browser-worker.ts", import.meta.url), { type: "module" }));
  const stop = () => workers.forEach((w) => w.terminate());
  signal.addEventListener("abort", stop);
  const t0 = performance.now();
  let total = 0;
  let done = 0;
  let outcomes: unknown[] = [];
  const aborted = () => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  try {
    await Promise.race([
      aborted(),
      Promise.all(
        workers.map(
          (w, shard) =>
            new Promise<void>((resolve, reject) => {
              w.onmessage = ({ data }: MessageEvent<WorkerOut>) => {
                if (data.type === "plan") {
                  total = data.total;
                  if (!outcomes.length) outcomes = new Array(total).fill(null);
                  onProgress(done, total);
                } else if (data.type === "outcome") {
                  outcomes[data.index] = data.outcome;
                  onProgress(++done, total);
                } else if (data.type === "done") resolve();
                else if (data.type === "error") reject(new Error(data.message));
              };
              w.onerror = (e) => reject(new Error(e.message || "The analysis worker failed"));
              w.postMessage({ type: "play", target, pool, perMatchup, shard, shards: threads });
            }),
        ),
      ),
    ]);
    const w0 = workers[0]!;
    return await Promise.race([
      aborted(),
      new Promise<AnalysisReport>((resolve, reject) => {
        w0.onmessage = ({ data }: MessageEvent<WorkerOut>) => {
          if (data.type === "report") resolve(data.report);
          else if (data.type === "error") reject(new Error(data.message));
        };
        w0.postMessage({ type: "report", target, pool, perMatchup, outcomes, ms: performance.now() - t0 });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
