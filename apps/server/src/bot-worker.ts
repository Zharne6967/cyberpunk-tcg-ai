import { parentPort } from "node:worker_threads";
import { decideBotCommand, ensureRegistry, ismctsSearch, type IsmctsOptions } from "@cpai/ai";

interface Msg {
  id: number;
  kind: "decide" | "search";
  state: never;
  botId: string;
  strategy: string;
  seed: string;
  remembered?: string[];
  ismcts?: Partial<IsmctsOptions>;
}

ensureRegistry();
parentPort!.on("message", (m: Msg) => {
  try {
    if (m.kind === "search") {
      // One slice of a root-parallel ISMCTS search; the main thread merges the root statistics.
      const r = ismctsSearch(m.state, m.botId as never, m.ismcts ?? {}, m.seed, m.remembered ?? []);
      parentPort!.postMessage({ id: m.id, result: r });
    } else {
      parentPort!.postMessage({ id: m.id, decision: decideBotCommand(m.state, m.botId, m.strategy, m.seed, { remembered: m.remembered }) });
    }
  } catch (err) {
    parentPort!.postMessage({ id: m.id, error: String((err as Error)?.stack ?? err) });
  }
});
parentPort!.postMessage({ ready: true });
