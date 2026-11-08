import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import type { MatchState } from "@tcg/cyberpunk-engine";
import { decisionFromStats, getBot, mergeStats, type BotDecision, type SearchResult } from "@cpai/ai";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

class PoolWorker {
  readonly worker: Worker;
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
    this.worker.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
    this.worker.unref();
  }

  call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }
}

/**
 * Worker threads shared by all games, so bot search never blocks the HTTP/WebSocket event loop.
 * Engine bots use one worker; ISMCTS bots split their iteration budget over all workers
 * (root parallelisation) and the root statistics are merged here.
 */
export class BotPool {
  private workers: PoolWorker[] = [];
  private next = 0;
  readonly size = Math.max(1, Math.min(6, cpus().length - 2));

  private ensure() {
    while (this.workers.length < this.size) this.workers.push(new PoolWorker());
  }

  /** Start the threads early (loading the card catalog takes a moment per thread). */
  warmUp() {
    this.ensure();
  }

  async decide(state: MatchState, botId: string, strategy: string, seed: string, remembered: string[]): Promise<BotDecision | null> {
    this.ensure();
    const bot = getBot(strategy);
    if (bot.kind !== "ismcts" || state.G.gamePhase === "setup") {
      const w = this.workers[this.next++ % this.workers.length]!;
      return w.call<BotDecision | null>({ kind: "decide", state, botId, strategy, seed, remembered });
    }
    const opts = bot.ismcts ?? {};
    const total = opts.iterations ?? 400;
    // "Bardzo trudny" uses two threads, "Mistrz" all of them.
    const n = total >= 1000 ? this.workers.length : Math.min(2, this.workers.length);
    const per = Math.ceil(total / n);
    const t0 = performance.now();
    const results = await Promise.all(
      this.workers.slice(0, n).map((w, i) =>
        w.call<SearchResult>({ kind: "search", state, botId, strategy, seed: `${seed}:w${i}`, remembered, ismcts: { ...opts, iterations: per } }),
      ),
    );
    const iterations = results.reduce((s, r) => s + r.iterations, 0);
    return decisionFromStats(mergeStats(results.map((r) => r.stats)), iterations, performance.now() - t0);
  }
}

export const botPool = new BotPool();
