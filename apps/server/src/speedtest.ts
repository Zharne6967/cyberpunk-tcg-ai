/**
 * How long the bot thinks per move in the real server setup (shared worker pool, root-parallel ISMCTS).
 *   pnpm --filter @cpai/server exec tsx src/speedtest.ts [bot=ismcts] [positions=8]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalEngine, createMatchState, createPlayerId } from "@tcg/cyberpunk-engine";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { actorOf, decideBotCommand, ensureRegistry } from "@cpai/ai";
import { BotPool } from "./bot-pool.ts";
import { DATA_DIR } from "./paths.ts";

const bot = process.argv[2] ?? "ismcts";
const positions = Number(process.argv[3] ?? 8);
ensureRegistry();
const load = (id: string) => JSON.parse(readFileSync(join(DATA_DIR, "decks", `${id}.json`), "utf8")) as Deck;
const p1 = createPlayerId("p1");
const p2 = createPlayerId("p2");
const engine = new LocalEngine(
  createMatchState({
    players: [
      { id: p1, name: "p1" },
      { id: p2, name: "p2" },
    ],
    catalog: getCatalog().engineCatalog,
    deckLists: [toEngineDeckList(load("starter-the-heist"), "p1"), toEngineDeckList(load("starter-embracing-power"), "p2")],
    seed: "speed",
  }),
);
const pool = new BotPool();
pool.warmUp();
await new Promise((r) => setTimeout(r, 4000)); // threads load the card catalog
const times: number[] = [];
for (let step = 0; step < 400 && times.length < positions; step++) {
  const s = engine.getState();
  if (s.G.gameEnded) break;
  const t = actorOf(s)!;
  let d = decideBotCommand(s, t.pid, "greedy", `g${step}`)!;
  if (t.pid === p2 && s.G.gamePhase === "main" && t.prompt.status === "action" && step % 3 === 0) {
    const t0 = performance.now();
    const r = await pool.decide(s, "p2", bot, `s${step}`, []);
    const ms = performance.now() - t0;
    if (r?.info?.iterations) {
      times.push(ms);
      console.log(`turn ${s.G.turnMetadata.turnNumber}: ${(ms / 1000).toFixed(2)} s, ${r.info.iterations} iterations, ${r.move}`);
      d = r;
    }
  }
  engine.processCommand({ commandID: `c${step}`, move: d.move as never, input: d.args ? { args: d.args } : undefined }, t.pid);
}
times.sort((a, b) => a - b);
console.log(`${bot}: median ${(times[Math.floor(times.length / 2)]! / 1000).toFixed(2)} s, max ${(times.at(-1)! / 1000).toFixed(2)} s over ${times.length} decisions (${pool.size} threads)`);
process.exit(0);
