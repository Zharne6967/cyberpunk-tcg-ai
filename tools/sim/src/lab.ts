/**
 * Deck Lab from the command line (same search as the app): new decks from scratch, tested against
 * the pool, the best kept and refined.
 *
 *   pnpm lab [--opponents meta|all] [--objective average|worst] [--generations 6] [--population 24]
 *            [--keep slug,slug] [--workers 15] [--verify ismcts-fast --verify-games 4 --verify-iters 40]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { deckToText, getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import { isMetaDeck, labBreed, labLoop, labSeed, opponentsOf, planGauntlet, wilsonCi, type LabEntry, type MatchOutcome } from "@cpai/ai";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
}
const all = readdirSync(join(root, "data/decks"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(root, "data/decks", f), "utf8")) as Deck)
  .filter((d) => isDeckLegal(d));
const pool = args.opponents === "all" ? all : all.filter(isMetaDeck);
const threads = Math.max(1, Number(args.workers ?? Math.max(1, cpus().length - 1)));

function run(target: Deck, opponents: Deck[], perMatchup: number, seed: string, bot = "greedy", ismcts?: Record<string, unknown>): Promise<(MatchOutcome | null)[]> {
  const { specs } = planGauntlet(target, opponents, perMatchup, bot, seed);
  if (ismcts) for (const s of specs) (s.ismctsA = ismcts), (s.ismctsB = ismcts);
  const outcomes: (MatchOutcome | null)[] = specs.map(() => null);
  const chunks = Array.from({ length: Math.min(threads, specs.length) }, (_, w) => specs.map((spec, index) => ({ index, spec })).filter((x) => x.index % threads === w));
  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL("../../../apps/server/src/analysis-worker.ts", import.meta.url), { workerData: chunk, execArgv: process.execArgv });
          w.on("message", (m: { index: number; outcome?: MatchOutcome }) => (outcomes[m.index] = m.outcome ?? null));
          w.on("error", reject);
          w.on("exit", () => resolve());
        }),
    ),
  ).then(() => outcomes);
}

const name = (slug: string) => getCatalog().bySlug(slug)?.displayName ?? slug;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const keep = args.keep ? args.keep.split(",") : [];
const report = await labLoop(
  pool,
  (d, o, per, seed) => run(d, o, per, seed),
  {
    seed: async (count, seed, values) => labSeed({ pool, count, seed, keep, values }),
    breed: async (parents, count, seed, values) => labBreed({ parents, pool, count, seed, keep, values }),
  },
  {
    objective: args.objective === "worst" ? "worst" : "average",
    keep,
    ...(args.generations ? { generations: Number(args.generations) } : {}),
    ...(args.population ? { population: Number(args.population) } : {}),
    ...(args.screen ? { screen: Number(args.screen) } : {}),
    ...(args.final ? { final: Number(args.final) } : {}),
  },
  (text, done, total) => process.stdout.write(`\r${done}/${total} ${text.padEnd(60)}`),
);
process.stdout.write("\n");
console.log(`Pool: ${pool.length} decks · ${report.games} games · ${(report.ms / 1000).toFixed(0)} s · objective ${report.objective}`);
for (const h of report.history) console.log(`  generation ${h.generation}: best ${pct(h.best)}, mean ${pct(h.mean)} (${h.decks} decks so far)`);
const show = (e: LabEntry<Deck>, title: string) => {
  console.log(`\n${title}: ${e.deck.name}  ${pct(e.rate)} [${pct(e.ci[0])}–${pct(e.ci[1])}] over ${e.games} games`);
  for (const m of [...e.matchups].sort((a, b) => b.rate - a.rate)) console.log(`   ${pct(m.rate).padStart(4)} [${pct(m.ci[0])}–${pct(m.ci[1])}]  vs ${m.name}`);
};
report.finalists.forEach((e, i) => show(e, `#${i + 1}`));
if (report.bestPool) show(report.bestPool, "Best pool deck");
const best = report.finalists[0];
if (best) {
  console.log("\n" + deckToText(best.deck));
  if (args.out) writeFileSync(args.out, JSON.stringify(report.finalists.map((f) => f.deck), null, 1));
  if (args.verify) {
    const iters = Number(args["verify-iters"] ?? 40);
    const per = Number(args["verify-games"] ?? 4);
    const ism = { iterations: iters, timeMs: undefined };
    for (const d of [best.deck, ...(report.bestPool ? [report.bestPool.deck] : [])]) {
      const opps = opponentsOf(d, pool);
      const out = await run(d, opps, per, "verify", args.verify, args.verify.startsWith("ismcts") ? ism : undefined);
      const wins = out.filter((o) => o?.winner === "A").length;
      const n = out.filter(Boolean).length;
      const ci = wilsonCi(wins, n);
      console.log(`Check with ${args.verify}${args.verify.startsWith("ismcts") ? ` ${iters}` : ""}: ${d.name} ${pct(wins / Math.max(1, n))} [${pct(ci[0])}–${pct(ci[1])}] over ${n} games`);
    }
  }
}
