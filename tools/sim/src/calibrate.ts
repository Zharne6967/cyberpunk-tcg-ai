/**
 * Fit the ISMCTS position evaluation from self-play.
 * Plays bot-vs-bot games on all legal deck pairs, records the board features of the player whose
 * turn just started (exactly where ISMCTS playouts stop), labels them with the final winner and fits
 * a logistic regression. Reports held-out log loss/accuracy next to the engine's hand-tuned
 * `evaluateBoard`, then writes packages/ai/src/ismcts/eval-model.json (fitted on all games).
 *
 *   pnpm calibrate [games=1000] [bot=greedy]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalEngine, createMatchState, createPlayerId, evaluateBoard, filterMatchView, type PlayerId } from "@tcg/cyberpunk-engine";
import { checkDeckLegality, getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { actorOf, decideBotCommand, ensureRegistry, fitLogistic, positionFeatures, predict } from "@cpai/ai";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const decks = readdirSync(join(root, "data/decks"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(root, "data/decks", f), "utf8")) as Deck)
  .filter((d) => checkDeckLegality(d).length === 0);

ensureRegistry();
const catalog = getCatalog();
const games = Number(process.argv[2] ?? 1000);
const bot = process.argv[3] ?? "greedy";
interface Sample {
  game: number;
  x: number[];
  board: number;
  won: number;
}
const samples: Sample[] = [];
const t0 = Date.now();

for (let g = 0; g < games; g++) {
  const d1 = decks[g % decks.length]!;
  const d2 = decks[(g * 7 + 3) % decks.length]!;
  const p1 = createPlayerId("p1");
  const p2 = createPlayerId("p2");
  const engine = new LocalEngine(
    createMatchState({
      players: [
        { id: p1, name: "p1" },
        { id: p2, name: "p2" },
      ],
      catalog: catalog.engineCatalog,
      deckLists: [toEngineDeckList(d1, "p1"), toEngineDeckList(d2, "p2")],
      seed: `cal-${g}`,
    }),
  );
  const pending: { pid: string; x: number[]; board: number }[] = [];
  let lastActive = "";
  for (let step = 0; step < 3000; step++) {
    const s = engine.getState();
    if (s.G.gameEnded) break;
    const active = s.G.turnMetadata.activePlayerId as string;
    if (active !== lastActive && s.G.gamePhase !== "setup") {
      lastActive = active;
      const view = filterMatchView(s, active as PlayerId);
      pending.push({ pid: active, x: positionFeatures(view, active), board: evaluateBoard(view, active) });
    }
    const t = actorOf(s);
    if (!t) break;
    // A little randomness widens the positions seen (otherwise mirror games repeat).
    const d = decideBotCommand(s, t.pid, Math.random() < 0.1 ? "random" : bot, `cal-${g}-${step}`);
    if (!d || !engine.processCommand({ commandID: `c${step}`, move: d.move as never, input: d.args ? { args: d.args } : undefined }, t.pid).success) break;
  }
  const w = engine.getState().G.winnerId as string | null;
  if (!w) continue;
  for (const p of pending) samples.push({ game: g, x: p.x, board: p.board, won: p.pid === w ? 1 : 0 });
  if ((g + 1) % 100 === 0) process.stdout.write(`  ${g + 1}/${games} games, ${samples.length} positions, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}

const train = samples.filter((s) => s.game % 5 !== 0);
const test = samples.filter((s) => s.game % 5 === 0);
const loss = (ps: number[], ys: number[]) => -ps.reduce((acc, p, i) => acc + (ys[i] ? Math.log(Math.max(1e-6, p)) : Math.log(Math.max(1e-6, 1 - p))), 0) / ps.length;
const accuracy = (ps: number[], ys: number[]) => ps.filter((p, i) => (p > 0.5 ? 1 : 0) === ys[i]).length / ps.length;

// Baseline: the engine's evaluateBoard with its best logistic scale on the training set.
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const clampBoard = (b: number) => Math.max(-50_000, Math.min(50_000, b));
let bestK = 160;
let bestLoss = Infinity;
for (let k = 20; k <= 3000; k += 10) {
  const l = loss(train.map((s) => sig(clampBoard(s.board) / k)), train.map((s) => s.won));
  if (l < bestLoss) (bestLoss = l), (bestK = k);
}
const yTest = test.map((s) => s.won);
const boardP = test.map((s) => sig(clampBoard(s.board) / bestK));
const model = fitLogistic(train.map((s) => s.x), train.map((s) => s.won));
const learnedP = test.map((s) => predict(model, s.x));
console.log(`\n${samples.length} positions from ${games} games (${decks.length} decks); held-out ${test.length}`);
console.log(`evaluateBoard (scale ${bestK}): log loss ${loss(boardP, yTest).toFixed(4)}, accuracy ${(accuracy(boardP, yTest) * 100).toFixed(1)}%`);
console.log(`learned model:            log loss ${loss(learnedP, yTest).toFixed(4)}, accuracy ${(accuracy(learnedP, yTest) * 100).toFixed(1)}%   (coin 0.6931)`);

const final = fitLogistic(samples.map((s) => s.x), samples.map((s) => s.won));
final.heldOut = { logLoss: Number(loss(learnedP, yTest).toFixed(4)), accuracy: Number(accuracy(learnedP, yTest).toFixed(4)), samples: test.length };
const out = join(root, "packages/ai/src/ismcts/eval-model.json");
writeFileSync(out, JSON.stringify(final, (_, v) => (typeof v === "number" ? Number(v.toPrecision(6)) : v), 1));
console.log("weights:", final.features.map((f, i) => `${f}=${final.weights[i]!.toFixed(2)}`).join(" "));
console.log(`written ${out}`);
