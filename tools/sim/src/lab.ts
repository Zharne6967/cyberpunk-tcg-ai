/**
 * Deck Lab from the command line (same search as the app): new decks from scratch, tested against
 * the pool, the best kept and refined.
 *
 *   pnpm lab [--opponents meta|all] [--objective average|worst] [--generations 6] [--population 24]
 *            [--keep slug,slug] [--workers 15] [--bot greedy|ismcts-sim] [--verify ismcts-sim --verify-games 4] [--out decks.json]
 *   pnpm lab --check decks.json [--with deck-id,deck-id] [--verify ismcts-sim] [--verify-games 4]
 *            (only the check: these decks against the pool with another bot)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { deckToText, isDeckLegal, type Deck } from "@cpai/core";
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

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const keep = args.keep ? args.keep.split(",") : [];

/** Decks against the pool with another bot; prints every matchup. */
async function check(decks: Deck[], bot: string, per: number) {
  const ism = bot.startsWith("ismcts") && bot !== "ismcts-sim" ? { iterations: Number(args["verify-iters"] ?? 40), timeMs: undefined } : undefined;
  const rows: { name: string; rate: number; ci: [number, number]; n: number }[] = [];
  for (const d of decks) {
    const opps = opponentsOf(d, pool);
    const out = await run(d, opps, per, "verify", bot, ism);
    const each = Math.max(2, Math.floor(per / 2) * 2);
    const wins = out.filter((o) => o?.winner === "A").length;
    const n = out.filter(Boolean).length;
    const ci = wilsonCi(wins, n);
    console.log(`\nCheck with ${bot}: ${d.name}  ${pct(wins / Math.max(1, n))} [${pct(ci[0])}–${pct(ci[1])}] over ${n} games`);
    opps.forEach((o, i) => {
      const slice = out.slice(i * each, (i + 1) * each).filter(Boolean);
      console.log(`   ${slice.filter((g) => g!.winner === "A").length}/${slice.length}  vs ${o.name}`);
    });
    rows.push({ name: d.name, rate: wins / Math.max(1, n), ci, n });
  }
  console.log(`\nRanking with ${bot}:`);
  for (const r of rows.sort((a, b) => b.rate - a.rate)) console.log(`  ${pct(r.rate).padStart(4)} [${pct(r.ci[0])}–${pct(r.ci[1])}] ${r.n} games  ${r.name}`);
}

if (args.check) {
  const decks = (JSON.parse(readFileSync(args.check, "utf8")) as Deck[]).map((d, i) => ({ ...d, name: `Lab #${i + 1}: ${d.name}` }));
  const extra = (args.with ?? "").split(",").filter(Boolean).map((id) => all.find((d) => d.id === id)!).filter(Boolean);
  await check([...decks, ...extra], args.verify ?? "ismcts-sim", Number(args["verify-games"] ?? 4));
  process.exit(0);
}
const report = await labLoop(
  pool,
  (d, o, per, seed) => run(d, o, per, seed, args.bot ?? "greedy"),
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
  if (args.verify) await check([...report.finalists.map((f) => f.deck), ...(report.bestPool ? [report.bestPool.deck] : [])], args.verify, Number(args["verify-games"] ?? 4));
}
