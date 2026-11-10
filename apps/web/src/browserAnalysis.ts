import type { AnalysisReport, DeckData } from "@cpai/core/protocol";
import { confirmDecks, doctorLoop, isMetaDeck, type Confirmation, type DoctorOptions, type DoctorReport } from "../../../packages/ai/src/doctor-loop.ts";
import { labLoop, opponentsOf, wilsonCi, type LabOptions, type LabReport, type Matchup } from "../../../packages/ai/src/lab-loop.ts";

export { isMetaDeck };
export type { Confirmation, DoctorOptions, DoctorReport, LabOptions, LabReport, Matchup };

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
  bot = "greedy",
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
              w.postMessage({ type: "play", target, pool, perMatchup, shard, shards: threads, bot });
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
        w0.postMessage({ type: "report", target, pool, perMatchup, outcomes, ms: performance.now() - t0, bot });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}

// ---- Deck Doctor: card swaps tested in simulations on this device (same workers for the whole run).

type Outcome = { winner: "A" | "B" | "draw"; cardsA: { played: string[] } };
type DoctorMsg = { type: string; job?: number; total?: number; index?: number; outcome?: Outcome | null; proposal?: { variants: { out: string; in: string; copies: number; deck: DeckData }[]; kept: { slug: string; share: number | null }[] }; opponents?: DeckData[]; decks?: DeckData[]; message?: string };

/** Workers kept for a whole job: single answers (`ask`) and gauntlets split over all of them (`play`). */
function workerPool(signal: AbortSignal) {
  if (typeof Worker === "undefined") throw new Error("Web Workers are not available");
  const threads = browserThreads();
  const workers = Array.from({ length: threads }, () => new Worker(new URL("../../../packages/ai/src/browser-worker.ts", import.meta.url), { type: "module" }));
  const terminate = () => workers.forEach((w) => w.terminate());
  signal.addEventListener("abort", terminate);
  let job = 0;
  const failed = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    for (const w of workers) w.addEventListener("error", (e) => reject(new Error(e.message || "The analysis worker failed")));
  });
  failed.catch(() => {});
  /** One answer from the first worker. */
  const ask = <T>(msg: Record<string, unknown>, pick: (d: DoctorMsg) => T | undefined): Promise<T> => {
    const id = ++job;
    const w = workers[0]!;
    return Promise.race([
      failed,
      new Promise<T>((resolve, reject) => {
        const on = ({ data }: MessageEvent<DoctorMsg>) => {
          if (data.job !== id) return;
          if (data.type === "error") return reject(new Error(data.message));
          const v = pick(data);
          if (v !== undefined) {
            w.removeEventListener("message", on);
            resolve(v);
          }
        };
        w.addEventListener("message", on);
        w.postMessage({ ...msg, job: id });
      }),
    ]);
  };
  /** A gauntlet split over all workers; `onGame` after every finished game. */
  const play = (target: DeckData, opponents: DeckData[], perMatchup: number, seed: string, bot = "greedy", onGame?: (done: number, total: number) => void): Promise<(Outcome | null)[]> => {
    const id = ++job;
    const outcomes: (Outcome | null)[] = [];
    let done = 0;
    return Promise.race([
      failed,
      Promise.all(
        workers.map(
          (w, shard) =>
            new Promise<void>((resolve, reject) => {
              const on = ({ data }: MessageEvent<DoctorMsg>) => {
                if (data.job !== id) return;
                if (data.type === "plan" && !outcomes.length) outcomes.push(...new Array<Outcome | null>(data.total ?? 0).fill(null));
                else if (data.type === "outcome") {
                  outcomes[data.index!] = data.outcome ?? null;
                  onGame?.(++done, outcomes.length);
                } else if (data.type === "error") reject(new Error(data.message));
                else if (data.type === "done") {
                  w.removeEventListener("message", on);
                  resolve();
                }
              };
              w.addEventListener("message", on);
              w.postMessage({ type: "play", job: id, target, pool: opponents, perMatchup, shard, shards: threads, seed, bot });
            }),
        ),
      ).then(() => outcomes),
    ]);
  };
  const stop = () => {
    signal.removeEventListener("abort", terminate);
    terminate();
  };
  return { ask, play, stop };
}

/** Deck Doctor on this device: weak cards, candidate swaps raced in simulations, the best kept. */
export async function doctorInBrowser(
  deck: DeckData,
  pool: DeckData[],
  options: Partial<DoctorOptions>,
  onProgress: (text: string, done: number, total: number) => void,
  signal: AbortSignal,
): Promise<DoctorReport<DeckData>> {
  const { ask, play, stop } = workerPool(signal);
  try {
    const opponents = await ask({ type: "opponents", target: deck, pool }, (d) => (d.type === "opponents" ? d.opponents : undefined));
    return await doctorLoop<DeckData, Outcome>(
      deck,
      opponents,
      (d, opp, per, seed, bot) => play(d, opp, per, seed, bot),
      (d, opp, outcomes, cuts, adds, keep) => ask({ type: "propose", deck: d, opponents: opp, outcomes, cuts, adds, keep }, (m) => (m.type === "proposed" ? m.proposal : undefined)),
      options,
      onProgress,
    );
  } finally {
    stop();
  }
}

/** Original vs improved deck on the same new games with stronger bots (slow: seconds per game). */
export async function confirmInBrowser(
  original: DeckData,
  improved: DeckData,
  opponents: DeckData[],
  perMatchup: number,
  bot: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Confirmation> {
  const { play, stop } = workerPool(signal);
  try {
    let first = 0;
    return await confirmDecks<DeckData, Outcome>(
      original,
      improved,
      opponents,
      (d, opp, per, seed, b) =>
        play(d, opp, per, seed, b, (done, total) => {
          if (d === original) first = total;
          onProgress((d === original ? 0 : first) + done, first ? first * 2 : total * 2);
        }),
      perMatchup,
      bot,
      "verify",
    );
  } finally {
    stop();
  }
}

// ---- Deck Lab: new decks from scratch, raced against the pool on this device.

export async function labInBrowser(
  pool: DeckData[],
  options: Partial<LabOptions>,
  onProgress: (text: string, done: number, total: number) => void,
  signal: AbortSignal,
): Promise<LabReport<DeckData>> {
  const { ask, play, stop } = workerPool(signal);
  const keep = options.keep ?? [];
  try {
    return await labLoop<DeckData, Outcome>(
      pool,
      (d, opp, per, seed) => play(d, opp, per, seed),
      {
        seed: (count, seed, values) => ask({ type: "labSeed", pool, count, seed, keep, values }, (m) => (m.type === "decks" ? m.decks : undefined)),
        breed: (parents, count, seed, values) => ask({ type: "labBreed", parents, pool, count, seed, keep, values }, (m) => (m.type === "decks" ? m.decks : undefined)),
      },
      options,
      onProgress,
    );
  } finally {
    stop();
  }
}

export interface Checked {
  deckId: string;
  wins: number;
  games: number;
  rate: number;
  ci: [number, number];
  matchups: Matchup[];
}

/** Decks against the pool with another bot (e.g. the Strong simulation bot): slow, seconds per game. */
export async function checkInBrowser(
  decks: DeckData[],
  pool: DeckData[],
  perMatchup: number,
  bot: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Checked[]> {
  const { play, stop } = workerPool(signal);
  const per = Math.max(2, Math.floor(perMatchup / 2) * 2);
  const total = decks.reduce((s, d) => s + opponentsOf(d, pool).length * per, 0);
  let before = 0;
  try {
    const out: Checked[] = [];
    for (const d of decks) {
      const opps = opponentsOf(d, pool);
      const games = await play(d, opps, per, "check", bot, (done) => onProgress(before + done, total));
      before += games.length;
      const matchups = opps.map((o, i) => {
        const slice = games.slice(i * per, (i + 1) * per).filter((g): g is Outcome => !!g);
        const wins = slice.filter((g) => g.winner === "A").length;
        return { opponent: o.id, name: o.name, legends: o.legends, wins, games: slice.length, rate: slice.length ? wins / slice.length : 0, ci: wilsonCi(wins, slice.length) };
      });
      const wins = matchups.reduce((s, m) => s + m.wins, 0);
      const n = matchups.reduce((s, m) => s + m.games, 0);
      out.push({ deckId: d.id, wins, games: n, rate: n ? wins / n : 0, ci: wilsonCi(wins, n), matchups });
    }
    return out;
  } finally {
    stop();
  }
}

// ---- The ladder: ChoomBattler statistics per colour archetype (packages/ai/src/meta-stats.ts).

export interface LegendStat {
  slug: string;
  name: string;
  popularity: number;
  winRate: number;
  games: number;
  lift: number;
}
export interface CardStat extends LegendStat {
  type: "unit" | "gear" | "program";
  copies: number;
}
export interface ArchetypeStats {
  key: string;
  name: string;
  games: number;
  share: number;
  winRate: number;
  legends: LegendStat[];
  cards: CardStat[];
}
export type ArchetypeSummary = Pick<ArchetypeStats, "key" | "name" | "games" | "share" | "winRate">;
export interface MetaBuild {
  archetype: ArchetypeStats;
  deck: DeckData;
  legends: LegendStat[];
  cards: { slug: string; copies: number; stat: CardStat | null }[];
}
export interface MetaAdvice {
  archetype: ArchetypeStats | null;
  cards: { slug: string; copies: number; stat: CardStat | null }[];
  swaps: { out: string; in: string; copies: number; outStat: CardStat | null; inStat: CardStat }[];
  legendSwaps: { out: string; in: string; outStat: LegendStat | null; inStat: LegendStat }[];
  improved: DeckData;
}

/** One answer from a short-lived worker (the ladder data lives there with the card catalog). */
function askOnce<T>(msg: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const w = new Worker(new URL("../../../packages/ai/src/browser-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = ({ data }: MessageEvent<{ type: string; result?: unknown; message?: string }>) => {
      if (data.type === "meta") resolve(data.result as T);
      else if (data.type === "error") reject(new Error(data.message));
      else return;
      w.terminate();
    };
    w.onerror = (e) => (reject(new Error(e.message || "The worker failed")), w.terminate());
    w.postMessage({ ...msg, job: 1 });
  });
}

export const metaList = () => askOnce<{ source: string; date: string; archetypes: ArchetypeSummary[] }>({ type: "metaList" });
export const metaBuilds = (keys?: string[], legends?: string[]) => askOnce<MetaBuild[]>({ type: "metaBuild", keys, legends });
export const metaAdviceFor = (deck: DeckData, keep: string[] = []) => askOnce<MetaAdvice>({ type: "metaAdvice", deck, keep });
