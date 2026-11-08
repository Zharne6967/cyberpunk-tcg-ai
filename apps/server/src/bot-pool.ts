import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import type { MatchState } from "@tcg/cyberpunk-engine";
import { decideBotCommand, decisionFromStats, getBot, mergeStats, type BotDecision, type SearchResult } from "@cpai/ai";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

class PoolWorker {
  readonly worker: Worker;
  /** Set when the thread failed or exited; the pool replaces it. */
  dead = false;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./bot-worker.ts", import.meta.url), { execArgv: process.execArgv });
    this.worker.on("message", (m: { id?: number; decision?: unknown; result?: unknown; error?: string }) => {
      if (m.id === undefined) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result ?? m.decision ?? null);
    });
    const fail = (err: Error) => {
      this.dead = true;
      console.error("[bot] worker thread failed:", err.message);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    this.worker.on("error", fail);
    // A thread that exits (killed, out of memory…) must not leave a decision waiting forever.
    this.worker.on("exit", (code) => fail(new Error(`worker exited (${code})`)));
    this.worker.unref();
  }

  call<T>(msg: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no answer from the bot thread in ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.worker.postMessage({ ...msg, id });
    });
  }
}

const yieldToEventLoop = () => new Promise((r) => setImmediate(r));

/**
 * Where bots think. With threads (default at home): a pool shared by all games, so bot search never
 * blocks the HTTP/WebSocket event loop; ISMCTS bots split their iteration budget over the threads
 * (root parallelisation). BOT_THREADS=0 (small cloud machines with a fraction of one core, where an
 * extra thread only doubles memory and start-up time): decisions run in the main process.
 * A thread that dies or stays silent never blocks a game: the decision is then made in-process.
 */
export class BotPool {
  private workers: PoolWorker[] = [];
  private next = 0;
  readonly size = (() => {
    const env = process.env.BOT_THREADS;
    if (env !== undefined && env !== "" && Number(env) === 0) return 0;
    return Math.max(1, Math.min(6, Number(env) || cpus().length - 2));
  })();

  private ensure() {
    this.workers = this.workers.filter((w) => !w.dead);
    while (this.workers.length < this.size) this.workers.push(new PoolWorker());
  }

  /** Start the threads early (loading the card catalog takes a moment per thread). */
  warmUp() {
    this.ensure();
  }

  private async inProcess(state: MatchState, botId: string, strategy: string, seed: string, remembered: string[]): Promise<BotDecision | null> {
    await yieldToEventLoop();
    return decideBotCommand(state, botId, strategy, seed, { remembered });
  }

  async decide(state: MatchState, botId: string, strategy: string, seed: string, remembered: string[]): Promise<BotDecision | null> {
    if (this.size === 0) return this.inProcess(state, botId, strategy, seed, remembered);
    this.ensure();
    const bot = getBot(strategy);
    const budget = (bot.ismcts?.timeMs ?? 5000) + 30_000;
    try {
      if (bot.kind !== "ismcts" || state.G.gamePhase === "setup") {
        const w = this.workers[this.next++ % this.workers.length]!;
        return await w.call<BotDecision | null>({ kind: "decide", state, botId, strategy, seed, remembered }, 30_000);
      }
      const opts = bot.ismcts ?? {};
      const total = opts.iterations ?? 400;
      // "Very Hard" uses two threads, "Master" all of them.
      const n = total >= 1000 ? this.workers.length : Math.min(2, this.workers.length);
      const per = Math.ceil(total / n);
      const t0 = performance.now();
      const results = await Promise.all(
        this.workers.slice(0, n).map((w, i) =>
          w.call<SearchResult>({ kind: "search", state, botId, strategy, seed: `${seed}:w${i}`, remembered, ismcts: { ...opts, iterations: per } }, budget),
        ),
      );
      const iterations = results.reduce((s, r) => s + r.iterations, 0);
      return decisionFromStats(mergeStats(results.map((r) => r.stats)), iterations, performance.now() - t0);
    } catch (err) {
      console.error("[bot] falling back to in-process decision:", (err as Error).message);
      return this.inProcess(state, botId, strategy, seed, remembered);
    }
  }
}

export const botPool = new BotPool();
