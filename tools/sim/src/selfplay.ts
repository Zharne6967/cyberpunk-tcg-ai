/**
 * Self-play training of the position evaluation (stage 6): the search bot plays itself on every deck
 * pair, the board at each turn start is labelled with the final winner, and a new logistic model is
 * fitted. The shipped model was fitted on Easy-bot games; positions from search games are closer to
 * what the search meets. Writes a candidate next to the shipped model; `pnpm bench` with
 * `--opts-a '{"playout":{"model":…}}'` (see --gate) decides whether it replaces it.
 *
 *   pnpm selfplay --games 600 --iters 40 --workers 15 [--samples path.json] [--gate 64]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { isDeckLegal, type Deck } from "@cpai/core";
import { fitLogistic, predict, type EvalModel, type MatchOutcome, type MatchSpec } from "@cpai/ai";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
}
const decks = readdirSync(join(root, "data/decks"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(root, "data/decks", f), "utf8")) as Deck)
  .filter((d) => isDeckLegal(d));
const games = Number(args.games ?? 600);
const iters = Number(args.iters ?? 40);
const threads = Math.max(1, Number(args.workers ?? Math.max(1, cpus().length - 1)));
const samplesPath = args.samples ?? join(root, "tools/sim/selfplay-samples.json");
const modelPath = join(root, "packages/ai/src/ismcts/eval-model.json");
const candidatePath = join(root, "packages/ai/src/ismcts/eval-model.candidate.json");

type Sample = { game: number; x: number[]; won: number };

async function play(): Promise<Sample[]> {
  const specs: (MatchSpec & { game: number })[] = [];
  for (let g = 0; g < games; g++) {
    const a = decks[g % decks.length]!;
    const b = decks[(g * 7 + 3) % decks.length]!;
    const ismcts = { iterations: iters, timeMs: undefined };
    specs.push({ game: g, deckA: a, deckB: b, strategyA: "ismcts-fast", strategyB: "ismcts-fast", ismctsA: ismcts, ismctsB: ismcts, seed: `self-${g}`, aSeat: g % 2 ? "p2" : "p1", record: true });
  }
  const chunks = Array.from({ length: Math.min(threads, specs.length) }, (_, w) => specs.map((spec, index) => ({ index, spec })).filter((x) => x.index % threads === w));
  const samples: Sample[] = [];
  let done = 0;
  const t0 = Date.now();
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL("../../../apps/server/src/analysis-worker.ts", import.meta.url), { workerData: chunk, execArgv: process.execArgv });
          w.on("message", (m: { index: number; outcome?: MatchOutcome }) => {
            for (const p of m.outcome?.positions ?? []) samples.push({ game: specs[m.index]!.game, x: p.x, won: p.won });
            done++;
            if (done % 20 === 0) process.stdout.write(`  ${done}/${games} games, ${samples.length} positions, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
          });
          w.on("error", reject);
          w.on("exit", () => resolve());
        }),
    ),
  );
  return samples;
}

const samples: Sample[] = args.samples && existsSync(samplesPath) && !args.games ? (JSON.parse(readFileSync(samplesPath, "utf8")) as Sample[]) : await play();
if (!args.samples || args.games) writeFileSync(samplesPath, JSON.stringify(samples));

const loss = (ps: number[], ys: number[]) => -ps.reduce((acc, p, i) => acc + (ys[i] ? Math.log(Math.max(1e-6, p)) : Math.log(Math.max(1e-6, 1 - p))), 0) / ps.length;
const accuracy = (ps: number[], ys: number[]) => ps.filter((p, i) => (p > 0.5 ? 1 : 0) === ys[i]).length / ps.length;
const train = samples.filter((s) => s.game % 5 !== 0);
const test = samples.filter((s) => s.game % 5 === 0);
const shipped = JSON.parse(readFileSync(modelPath, "utf8")) as EvalModel;
const fitted = fitLogistic(train.map((s) => s.x), train.map((s) => s.won));
const ys = test.map((s) => s.won);
const pOld = test.map((s) => predict(shipped, s.x));
const pNew = test.map((s) => predict(fitted, s.x));
console.log(`\n${samples.length} positions from ${new Set(samples.map((s) => s.game)).size} search games; held-out ${test.length}`);
console.log(`shipped model:   log loss ${loss(pOld, ys).toFixed(4)}, accuracy ${(accuracy(pOld, ys) * 100).toFixed(1)}%`);
console.log(`self-play model: log loss ${loss(pNew, ys).toFixed(4)}, accuracy ${(accuracy(pNew, ys) * 100).toFixed(1)}%`);
const final = fitLogistic(samples.map((s) => s.x), samples.map((s) => s.won));
final.heldOut = { logLoss: Number(loss(pNew, ys).toFixed(4)), accuracy: Number(accuracy(pNew, ys).toFixed(4)), samples: test.length };
writeFileSync(candidatePath, JSON.stringify(final, (_, v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v), 1));
console.log(`candidate written to ${candidatePath}`);
