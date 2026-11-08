/**
 * Bot-vs-bot simulator on our deck files.
 *
 *   pnpm sim --a starter-the-heist --b starter-embracing-power --bot-a tactical --bot-b greedy --games 20 --workers 4
 *   pnpm sim --list
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { checkDeckLegality, type Deck } from "@cpai/core";
import type { MatchOutcome, MatchSpec } from "./match.ts";
import { STRATEGIES } from "./strategies.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const decksDir = join(root, "data/decks");

function loadDeck(idOrPath: string): Deck {
  const path = idOrPath.endsWith(".json") ? idOrPath : join(decksDir, `${idOrPath}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Deck;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[a.slice(2)] = true;
    else (args[a.slice(2)] = next), i++;
  }
  return args;
}

/** Wilson 95% interval for a win rate. */
function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    console.log("Talie (data/decks):");
    for (const f of readdirSync(decksDir).filter((f) => f.endsWith(".json")).sort()) {
      const d = loadDeck(join(decksDir, f));
      console.log(`  ${d.id.padEnd(46)} ${d.name}`);
    }
    console.log("\nBoty:");
    for (const [k, v] of Object.entries(STRATEGIES)) console.log(`  ${k.padEnd(14)} ${v.fair ? "uczciwy " : "PODGLĄDA"}  ${v.label}`);
    return;
  }
  const deckA = loadDeck(String(args.a ?? "starter-the-heist"));
  const deckB = loadDeck(String(args.b ?? "starter-embracing-power"));
  for (const d of [deckA, deckB]) {
    const problems = checkDeckLegality(d);
    if (problems.length) throw new Error(`Talia ${d.id} jest nielegalna: ${problems.map((p) => p.message).join("; ")}`);
  }
  const strategyA = String(args["bot-a"] ?? "tactical");
  const strategyB = String(args["bot-b"] ?? "greedy");
  for (const s of [strategyA, strategyB]) if (!STRATEGIES[s]) throw new Error(`Nieznany bot ${s}`);
  const games = Number(args.games ?? 10);
  const workers = Math.max(1, Math.min(Number(args.workers ?? Math.max(1, cpus().length - 1)), games));
  const seedBase = String(args.seed ?? "sim");

  const specs: MatchSpec[] = Array.from({ length: games }, (_, i) => ({
    deckA, deckB, strategyA, strategyB,
    seed: `${seedBase}-${Math.floor(i / 2)}`,
    aSeat: i % 2 === 0 ? "p1" : "p2", // paired seeds: same shuffle, swapped seats
  }));
  const chunks: MatchSpec[][] = Array.from({ length: workers }, () => []);
  specs.forEach((s, i) => chunks[i % workers]!.push(s));

  console.log(`A: ${deckA.name} [${strategyA}]  vs  B: ${deckB.name} [${strategyB}]  —  ${games} gier, ${workers} wątków`);
  const outcomes: MatchOutcome[] = [];
  const errors: string[] = [];
  const t0 = Date.now();
  await Promise.all(
    chunks.filter((c) => c.length).map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL("./worker.ts", import.meta.url), { workerData: chunk, execArgv: process.execArgv });
          w.on("message", (m: { ok: boolean; outcome?: MatchOutcome; error?: string; seed?: string }) => {
            if (m.ok) {
              outcomes.push(m.outcome!);
              const o = m.outcome!;
              if (args.verbose) console.log(`  ${o.seed} A=${o.aSeat} → ${o.winner} (${o.reason}, ${o.turns} tur, ${(o.ms / 1000).toFixed(1)}s)`);
              else process.stdout.write(o.winner === "A" ? "A" : o.winner === "B" ? "b" : ".");
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
  const winsB = outcomes.filter((o) => o.winner === "B").length;
  const [lo, hi] = wilson(winsA, n);
  const firstSeatWins = outcomes.filter((o) => (o.winner === "A" && o.aSeat === "p1") || (o.winner === "B" && o.aSeat === "p2")).length;
  const reasons = outcomes.reduce<Record<string, number>>((acc, o) => ((acc[o.reason] = (acc[o.reason] ?? 0) + 1), acc), {});
  const avg = (f: (o: MatchOutcome) => number) => (n ? outcomes.reduce((s, o) => s + f(o), 0) / n : 0);
  const summary = {
    deckA: deckA.id, deckB: deckB.id, strategyA, strategyB, games: n, errors: errors.length,
    winsA, winsB, draws: n - winsA - winsB,
    winRateA: n ? winsA / n : 0, winRateA95: [lo, hi],
    firstPlayerWinRate: n ? firstSeatWins / n : 0,
    avgTurns: avg((o) => o.turns), avgSecondsPerGame: avg((o) => o.ms) / 1000,
    wallSeconds: (Date.now() - t0) / 1000, reasons,
  };
  console.log(`Wynik A: ${winsA}/${n} = ${(summary.winRateA * 100).toFixed(1)}% (95%: ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%)  remisy: ${summary.draws}`);
  console.log(`Pierwszy gracz wygrywa: ${(summary.firstPlayerWinRate * 100).toFixed(0)}%   śr. tur: ${summary.avgTurns.toFixed(1)}   śr. czas gry: ${summary.avgSecondsPerGame.toFixed(1)}s   łącznie: ${summary.wallSeconds.toFixed(0)}s`);
  console.log(`Zakończenia:`, reasons);
  if (errors.length) console.log(`BŁĘDY (${errors.length}):\n` + errors.slice(0, 3).join("\n"));
  if (args.report) {
    const out = String(args.report);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ summary, outcomes, errors }, null, 2));
    console.log(`Raport: ${out}`);
  }
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
