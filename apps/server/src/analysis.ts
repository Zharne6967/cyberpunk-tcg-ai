import { randomBytes } from "node:crypto";
import { Worker } from "node:worker_threads";
import { isDeckLegal, type Deck } from "@cpai/core";
import type { AnalysisJob } from "@cpai/core/protocol";
import { buildReport, planGauntlet, playMatchAsync, type GauntletSpec, type MatchOutcome } from "@cpai/ai";
import { botPool } from "./bot-pool.ts";
import { loadBuiltinDecks } from "./decks.ts";

/**
 * Deck analysis jobs: the deck plays every built-in deck (bot vs bot), one job at a time, results are
 * polled by the page. At home the games run on worker threads; online (BOT_THREADS=0, a fraction of one
 * core) they run in the main process in short slices so live games stay responsive.
 */

export const GAMES_PER_MATCHUP = [4, 8, 16] as const;
const MAX_QUEUE = 4;
const KEEP_MS = 30 * 60_000;

interface Job extends AnalysisJob {
  deck: Deck;
  perMatchup: number;
  owner: string;
  finishedAt?: number;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running: Job | null = null;

export class AnalysisBusy extends Error {}

function view(j: Job): AnalysisJob {
  const i = queue.indexOf(j);
  return { id: j.id, status: j.status, done: j.done, total: j.total, ...(i >= 0 ? { position: i + (running ? 1 : 0) } : {}), ...(j.report ? { report: j.report } : {}), ...(j.error ? { error: j.error } : {}) };
}

function cleanup() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > KEEP_MS) jobs.delete(id);
}

export function startAnalysis(deck: Deck, perMatchup: number, owner: string): AnalysisJob {
  cleanup();
  const mine = [...jobs.values()].find((j) => j.owner === owner && (j.status === "queued" || j.status === "running"));
  if (mine) return view(mine);
  if (queue.length >= MAX_QUEUE) throw new AnalysisBusy("The server is busy with other analyses. Try again in a few minutes.");
  const job: Job = { id: randomBytes(6).toString("hex"), status: "queued", done: 0, total: 0, deck, perMatchup, owner };
  jobs.set(job.id, job);
  queue.push(job);
  void pump();
  return view(job);
}

export function analysisJob(id: string): AnalysisJob | undefined {
  const j = jobs.get(id);
  return j && view(j);
}

async function pump() {
  if (running || !queue.length) return;
  const job = (running = queue.shift()!);
  job.status = "running";
  try {
    await run(job);
    job.status = "done";
  } catch (err) {
    console.error("[analysis] failed:", (err as Error).message);
    job.status = "error";
    job.error = "The analysis failed. Try again.";
  } finally {
    job.finishedAt = Date.now();
    running = null;
    void pump();
  }
}

async function run(job: Job) {
  const pool = loadBuiltinDecks().filter((d) => isDeckLegal(d));
  const { opponents, specs } = planGauntlet(job.deck, pool, job.perMatchup);
  job.total = specs.length;
  const outcomes: (MatchOutcome | null)[] = specs.map(() => null);
  const finished = new Set<number>();
  const record = (i: number, o: MatchOutcome | null) => {
    if (finished.has(i)) return;
    finished.add(i);
    outcomes[i] = o;
    job.done = finished.size;
  };
  const t0 = performance.now();
  const threads = Math.min(botPool.size, 4);
  if (threads > 0) {
    try {
      await runInThreads(specs, threads, record);
    } catch (err) {
      console.error("[analysis] threads failed, finishing in-process:", (err as Error).message);
    }
  }
  for (let i = 0; i < specs.length; i++) {
    if (finished.has(i)) continue;
    record(i, await playMatchAsync(specs[i]!).catch(() => null));
  }
  job.report = buildReport(job.deck, opponents, specs, outcomes, performance.now() - t0);
}

function runInThreads(specs: GauntletSpec[], threads: number, record: (i: number, o: MatchOutcome | null) => void): Promise<void> {
  const chunks: { index: number; spec: GauntletSpec }[][] = Array.from({ length: threads }, () => []);
  specs.forEach((spec, index) => chunks[index % threads]!.push({ index, spec }));
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL("./analysis-worker.ts", import.meta.url), { workerData: chunk, execArgv: process.execArgv });
          // A silent thread must not hold the job: stop it, the rest is played in-process.
          let stall = setTimeout(() => void w.terminate(), 60_000);
          w.on("message", (m: { index: number; outcome?: MatchOutcome; error?: string }) => {
            clearTimeout(stall);
            stall = setTimeout(() => void w.terminate(), 60_000);
            record(m.index, m.outcome ?? null);
          });
          w.on("error", (e) => (clearTimeout(stall), reject(e)));
          w.on("exit", () => (clearTimeout(stall), resolve()));
        }),
    ),
  ).then(() => undefined);
}
