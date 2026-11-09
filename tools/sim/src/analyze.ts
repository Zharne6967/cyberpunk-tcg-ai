/**
 * Deck analysis from the command line (same code as the "Deck Analysis" screen).
 *
 *   pnpm analyze --deck botlab-johnny-fight-ready-steal --games 8
 *   pnpm analyze --deck my-deck.json --games 16 --json report.json
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeckLegal, type Deck } from "@cpai/core";
import { buildReport, planGauntlet, playMatch } from "@cpai/ai";

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
  .filter((d) => isDeckLegal(d));
const id = args.deck ?? "starter-the-heist";
const target = id.endsWith(".json") ? load(id) : load(join(decksDir, `${id}.json`));
const { opponents, specs } = planGauntlet(target, pool, Number(args.games ?? 8), args.bot ?? "greedy");
const t0 = performance.now();
const outcomes = specs.map((s, i) => {
  const o = playMatch(s);
  if (i % 10 === 9) process.stdout.write(".");
  return o;
});
process.stdout.write("\n");
const r = buildReport(target, opponents, specs, outcomes, performance.now() - t0, args.bot ?? "greedy");
const pct = (x: number) => `${Math.round(x * 100)}%`;
console.log(`${r.deck.name}: ${r.overall.wins}/${r.overall.games} = ${pct(r.overall.rate)} (${pct(r.overall.ci[0])}-${pct(r.overall.ci[1])}), ${(r.ms / 1000).toFixed(1)} s`);
console.log("\nMatchups:");
for (const m of r.matchups) console.log(`  ${pct(m.rate).padStart(4)}  ${m.wins}/${m.games}  ${m.deckName}  (${m.averageTurns} turns)`);
console.log("\nFindings:");
for (const f of r.findings) console.log(`  [${f.kind}] ${f.text}`);
console.log("\nHow to beat it:");
for (const f of r.plan) console.log(`  - ${f.text}`);
console.log("\nCounters:");
for (const c of r.counters) console.log(`  ${c.deckName}: ${c.wins}/${c.games}  tech: ${c.techCards.join(", ") || "-"}`);
console.log(`\nfirst ${pct(r.goingFirst.rate)} (${r.goingFirst.games}) second ${pct(r.goingSecond.rate)} (${r.goingSecond.games}); median ${r.medianTurns} turns`);
if (args.json) writeFileSync(args.json, JSON.stringify(r, null, 2));
