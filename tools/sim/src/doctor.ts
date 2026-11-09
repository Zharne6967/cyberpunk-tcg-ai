/**
 * Deck Doctor from the command line (same algorithm as the app): card swaps tested in simulations.
 *
 *   pnpm doctor --deck meta-cb-4g2r-adam-hanako-padre [--opponents meta|all] [--rounds 2] [--workers 6] [--verify masterful]
 */
import { readdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import { confirmDecks, deckDoctor, isMetaDeck, planGauntlet, type MatchOutcome } from "@cpai/ai";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const decksDir = join(root, "data/decks");
const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
}
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Deck;
const pool = readdirSync(decksDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => load(join(decksDir, f)))
  .filter((d) => isDeckLegal(d))
  .filter((d) => args.opponents === "all" || isMetaDeck(d));
const id = args.deck ?? "starter-the-heist";
const deck = id.endsWith(".json") ? load(id) : load(join(decksDir, `${id}.json`));
const threads = Math.max(1, Number(args.workers ?? Math.max(1, cpus().length - 2)));
const bot = args.bot ?? "greedy";

/** Plays the gauntlet on worker threads (each posts its results with their index in the plan). */
function run(target: Deck, opponents: Deck[], perMatchup: number, seed: string, withBot = bot): Promise<(MatchOutcome | null)[]> {
  const { specs } = planGauntlet(target, opponents, perMatchup, withBot, seed);
  const outcomes: (MatchOutcome | null)[] = specs.map(() => null);
  const chunks = Array.from({ length: Math.min(threads, specs.length) }, (_, w) => specs.map((spec, index) => ({ index, spec })).filter((x) => x.index % threads === w));
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL("../../../apps/server/src/analysis-worker.ts", import.meta.url), { workerData: chunk, execArgv: process.execArgv });
          worker.on("message", (m: { index: number; outcome?: MatchOutcome }) => (outcomes[m.index] = m.outcome ?? null));
          worker.on("error", reject);
          worker.on("exit", () => resolve());
        }),
    ),
  ).then(() => outcomes);
}

const name = (slug: string) => getCatalog().bySlug(slug)?.displayName ?? slug;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const report = await deckDoctor(deck, pool, run, {
  rounds: Number(args.rounds ?? 2),
  cuts: Number(args.cuts ?? 4),
  adds: Number(args.adds ?? 6),
  ...(args.stages ? { stages: args.stages.split(",").map(Number) } : {}),
  ...(args.keep ? { keep: args.keep.split(",").map(Number) } : {}),
  ...(args.check ? { check: Number(args.check) } : {}),
  ...(args.confirm ? { confirm: Number(args.confirm) } : {}),
}, (text, done, total) => process.stdout.write(`\r${done}/${total} ${text.slice(0, 70).padEnd(70)}`));
process.stdout.write("\n");
console.log(`${deck.name}  vs ${report.opponents.length} decks (${bot} bots, ${report.games} games, ${(report.ms / 1000).toFixed(0)} s)`);
report.rounds.forEach((r, i) => {
  console.log(`\nRound ${i + 1}: base ${pct(r.base)}`);
  const pts = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pts`;
  for (const t of r.tried.slice(0, 8))
    console.log(`  ${pts(t.delta)} (${t.games} games)${t.checkGames ? `, new games ${pts(t.checkDelta!)} (${t.checkGames})` : ""}  −${t.copies} ${name(t.out)}, +${t.copies} ${name(t.in)}`);
  console.log(r.accepted ? `  kept: −${r.accepted.copies} ${name(r.accepted.out)}, +${r.accepted.copies} ${name(r.accepted.in)}` : "  no clear gain: stop");
});
const c = report.confirm;
console.log(`\nConfirmation on new games (${c.games} games): ${pct(c.before)} [${pct(c.beforeCi[0])}–${pct(c.beforeCi[1])}] → ${pct(c.after)} [${pct(c.afterCi[0])}–${pct(c.afterCi[1])}]`);
console.log("Changes:", report.changes.map((x) => `−${x.copies} ${name(x.out)} +${x.copies} ${name(x.in)}`).join("; ") || "none");
if (args.verify && report.changes.length) {
  const v = await confirmDecks(deck, report.improved, report.opponents, run, Number(args["verify-games"] ?? 4), args.verify, "verify");
  console.log(`Check with ${args.verify} bots (${v.games} games): ${pct(v.before)} [${pct(v.beforeCi[0])}–${pct(v.beforeCi[1])}] → ${pct(v.after)} [${pct(v.afterCi[0])}–${pct(v.afterCi[1])}]`);
}
