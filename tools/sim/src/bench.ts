/**
 * Bot benchmark across many deck pairs (paired seeds, seats swapped, worker threads).
 *
 *   pnpm bench --a ismcts-fast --b masterful --pairs 8 --games 4
 *   pnpm bench --a ismcts-fast --b ismcts-fast --opts-b '{"playout":{"evaluator":"board"}}' --pairs 8 --games 4
 *   pnpm bench ... --md docs/BENCHMARK.md --title "ISMCTS 300 vs Hard"   (appends a results table)
 *
 * --games = games per deck pair (even; each seed is played twice with seats swapped).
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { checkDeckLegality, type Deck } from "@cpai/core";
import { STRATEGIES } from "@cpai/ai";
import type { MatchOutcome, MatchSpec } from "./match.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) args[a.slice(2)] = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true";
  }
  return args;
}

function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function sideOpts(args: Record<string, string>, s: "a" | "b") {
  const extra = args[`opts-${s}`] ? (JSON.parse(args[`opts-${s}`]!) as Record<string, unknown>) : {};
  const iters = args[`iters-${s}`] ? { iterations: Number(args[`iters-${s}`]) } : {};
  // Benchmarks use iteration budgets only (no time cap) so results do not depend on machine load.
  return { timeMs: undefined, ...iters, ...extra };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const a = args.a ?? "ismcts-fast";
  const b = args.b ?? "masterful";
  for (const s of [a, b]) if (!STRATEGIES[s]) throw new Error(`Unknown bot ${s}`);
  const decks = readdirSync(join(root, "data/decks"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(root, "data/decks", f), "utf8")) as Deck)
    .filter((d) => checkDeckLegality(d).length === 0);
  const nPairs = Number(args.pairs ?? 8);
  const perPair = Math.max(2, Math.floor(Number(args.games ?? 4) / 2) * 2);
  // Deterministic spread of pairs over the deck list (different decks each side).
  const pairs: [Deck, Deck][] = [];
  for (let i = 0; pairs.length < nPairs && i < decks.length * decks.length; i++) {
    const x = decks[(i * 5) % decks.length]!;
    const y = decks[(i * 11 + 3) % decks.length]!;
    if (x.id !== y.id && !pairs.some(([p, q]) => p.id === x.id && q.id === y.id)) pairs.push([x, y]);
  }
  const ismctsA = STRATEGIES[a]!.kind === "ismcts" ? sideOpts(args, "a") : undefined;
  const ismctsB = STRATEGIES[b]!.kind === "ismcts" ? sideOpts(args, "b") : undefined;
  const seed = args.seed ?? "bench";
  const specs: (MatchSpec & { pair: number })[] = [];
  pairs.forEach(([deckA, deckB], p) => {
    for (let g = 0; g < perPair; g++)
      specs.push({ pair: p, deckA, deckB, strategyA: a, strategyB: b, ismctsA, ismctsB, seed: `${seed}-${p}-${Math.floor(g / 2)}`, aSeat: g % 2 === 0 ? "p1" : "p2" });
  });
  const workers = Math.max(1, Math.min(Number(args.workers ?? Math.max(1, cpus().length - 1)), specs.length));
  const chunks: MatchSpec[][] = Array.from({ length: workers }, () => []);
  specs.forEach((s, i) => chunks[i % workers]!.push(s));

  console.log(`A=${a} ${ismctsA ? JSON.stringify(ismctsA) : ""}  vs  B=${b} ${ismctsB ? JSON.stringify(ismctsB) : ""}`);
  console.log(`${pairs.length} deck pairs x ${perPair} games = ${specs.length} games, ${workers} threads`);
  const outcomes: (MatchOutcome & { pair: number })[] = [];
  const errors: string[] = [];
  const t0 = Date.now();
  await Promise.all(
    chunks.filter((c) => c.length).map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: chunk, execArgv: process.execArgv });
          w.on("message", (m: { ok: boolean; outcome?: MatchOutcome; error?: string; seed?: string }) => {
            if (m.ok) {
              const spec = specs.find((s) => s.seed === m.outcome!.seed && s.aSeat === m.outcome!.aSeat)!;
              outcomes.push({ ...m.outcome!, pair: spec.pair });
              process.stdout.write(m.outcome!.winner === "A" ? "A" : m.outcome!.winner === "B" ? "b" : ".");
            } else errors.push(`${m.seed}: ${m.error}`);
          });
          w.on("error", reject);
          w.on("exit", () => resolve());
        }),
    ),
  );
  process.stdout.write("\n");
  const n = outcomes.length;
  const winsA = outcomes.filter((o) => o.winner === "A").length;
  const [lo, hi] = wilson(winsA, n);
  const sum = (f: (o: MatchOutcome) => number) => outcomes.reduce((s, o) => s + f(o), 0);
  const msA = sum((o) => o.thinkMsA) / Math.max(1, sum((o) => o.decisionsA));
  const msB = sum((o) => o.thinkMsB) / Math.max(1, sum((o) => o.decisionsB));
  const rows = pairs.map(([x, y], p) => {
    const os = outcomes.filter((o) => o.pair === p);
    return { pair: `${x.name} vs ${y.name}`, games: os.length, winsA: os.filter((o) => o.winner === "A").length };
  });
  for (const r of rows) console.log(`  ${r.winsA}/${r.games}  ${r.pair}`);
  const line = `A wins ${winsA}/${n} = ${((winsA / Math.max(1, n)) * 100).toFixed(1)}% (95% CI ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%)  draws ${n - winsA - outcomes.filter((o) => o.winner === "B").length}  ms/decision A ${msA.toFixed(0)} B ${msB.toFixed(0)}  rejected ${sum((o) => o.rejected)}  errors ${errors.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`;
  console.log(line);
  if (errors.length) console.log(errors.slice(0, 3).join("\n"));
  if (args.md) {
    const path = join(root, args.md);
    if (!existsSync(path)) writeFileSync(path, "# Benchmark botów\n\nGenerowane przez `pnpm bench` (ziarna parami, zamiana miejsc, budżety w iteracjach — wynik nie zależy od obciążenia komputera).\n");
    const md = [
      `\n## ${args.title ?? `${a} vs ${b}`} (${new Date().toISOString().slice(0, 10)})`,
      `A = \`${a}\`${ismctsA ? ` \`${JSON.stringify(ismctsA)}\`` : ""}, B = \`${b}\`${ismctsB ? ` \`${JSON.stringify(ismctsB)}\`` : ""}`,
      "",
      `**A wygrywa ${winsA}/${n} = ${((winsA / Math.max(1, n)) * 100).toFixed(1)}%** (95% CI ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%), czas decyzji A ${msA.toFixed(0)} ms, B ${msB.toFixed(0)} ms (1 wątek na partię, ${workers} partii naraz).`,
      "",
      "| Para talii (A vs B) | wygrane A |",
      "|---|---|",
      ...rows.map((r) => `| ${r.pair} | ${r.winsA}/${r.games} |`),
      "",
    ].join("\n");
    appendFileSync(path, md);
    console.log(`appended to ${args.md}`);
  }
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
