import { Worker } from "node:worker_threads";
import type { MatchState } from "@tcg/cyberpunk-engine";
import type { BotDecision } from "@cpai/ai";

interface Pending {
  resolve: (d: BotDecision | null) => void;
  reject: (e: Error) => void;
}

/**
 * One worker thread per game: bot search never blocks the HTTP/WebSocket event loop.
 * The worker gets a copy of the authoritative state and answers with a command.
 */
export class BotWorker {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./bot-worker.ts", import.meta.url), { execArgv: process.execArgv });
    this.worker.on("message", (m: { id: number; decision?: BotDecision | null; error?: string }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.decision ?? null);
    });
    this.worker.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
    this.worker.unref();
  }

  decide(state: MatchState, botId: string, strategy: string, seed: string): Promise<BotDecision | null> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, state, botId, strategy, seed });
    });
  }

  terminate() {
    void this.worker.terminate();
  }
}
