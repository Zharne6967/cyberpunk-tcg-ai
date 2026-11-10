/**
 * The ladder data at work, without a browser: the deck the Deck Lab builds for every archetype and what the
 * Deck Doctor says about each deck in data/decks.
 *
 *   pnpm ladder            all archetypes and all decks
 *   pnpm ladder meta-cb    only decks whose id starts with meta-cb
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCatalog } from "@cpai/core";
import { metaAdvice, metaBuild, metaData, shapeOf } from "@cpai/ai";

const catalog = getCatalog();
const name = (s: string) => catalog.bySlug(s)?.name ?? s;
const filter = process.argv[2] ?? "";
const dir = join(import.meta.dirname, "../../../data/decks");

console.log(`Ladder data: ${metaData().source}, ${metaData().date}\n`);
for (const a of metaData().archetypes) {
  const b = metaBuild(a);
  if (!b) {
    console.log(`${a.name}: no deck`);
    continue;
  }
  const s = shapeOf(b.deck.main);
  console.log(
    `${a.name} (${a.winRate}%, ${a.games} games): ${b.deck.legends.map(name).join(" / ")} — ${s.units} Units, ${Math.round(s.sellable * 100)}% sellable, ${s.heavy} cost 5+, ${b.cards.filter((c) => !c.stat).length} filler`,
  );
}
console.log();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f.startsWith(filter))) {
  const deck = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const adv = metaAdvice(deck);
  const swaps = adv.swaps.map((s) => `-${s.copies} ${name(s.out)} +${s.copies} ${name(s.in)}`).join("; ");
  const legends = adv.legendSwaps.map((l) => `${name(l.out)} -> ${name(l.in)}`).join("; ");
  console.log(`${deck.id} [${adv.archetype?.name ?? "no data"}]: ${swaps || "no changes"}${legends ? ` | Legends: ${legends}` : ""}`);
}
