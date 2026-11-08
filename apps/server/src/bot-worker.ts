import { parentPort } from "node:worker_threads";
import { decideBotCommand } from "@cpai/ai";

parentPort!.on("message", (m: { id: number; state: never; botId: string; strategy: string; seed: string }) => {
  try {
    const decision = decideBotCommand(m.state, m.botId, m.strategy, m.seed);
    parentPort!.postMessage({ id: m.id, decision });
  } catch (err) {
    parentPort!.postMessage({ id: m.id, error: String((err as Error)?.stack ?? err) });
  }
});
