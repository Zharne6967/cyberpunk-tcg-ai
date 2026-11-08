/**
 * Exports the card database, rules and reference decks to plain JSON/Markdown under data/,
 * so the web UI, the coach (rules Q&A) and external tools don't need to import the engine.
 *
 *   pnpm export-data
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { starterDeckLists } from "@tcg/cyberpunk-cards";
import { authoredBotLabDeckSpecs } from "@tcg/cyberpunk-utils";
import { checkDeckLegality, deckFromText, getCatalog, type Deck } from "@cpai/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = join(root, "data");
const upstream = readFileSync(join(root, "vendor/UPSTREAM.md"), "utf8").match(/commit:\s*`?([0-9a-f]{7,40})/)?.[1] ?? "unknown";

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// ---------- cards ----------
const catalog = getCatalog();
const cards = catalog.cards
  .map((c) => {
    const card = c as typeof c & { rulesText?: string; reminderText?: string; printings?: { setCode: string; collectorNumber: string; rarity: string; imageUrl: string }[] };
    const [, subtitle] = card.displayName.includes(":") ? card.displayName.split(/:\s*/, 2) : [card.displayName, null];
    return {
      id: card.id,
      slug: card.slug,
      name: card.name,
      subtitle: subtitle ?? null,
      displayName: card.displayName,
      type: card.type,
      color: card.color,
      cost: card.cost ?? null,
      power: card.power ?? null,
      ram: card.ram ?? null,
      sellTag: card.hasSellTag ?? false,
      tags: card.classifications ?? [],
      keywords: card.keywords ?? [],
      timing: card.timingTriggers ?? [],
      text: card.rulesText ?? card.abilities?.map((a) => ("text" in a ? a.text : "")).filter(Boolean).join("\n") ?? "",
      reminderText: card.reminderText ?? null,
      rarity: card.rarity,
      set: card.set,
      printNumber: card.printNumber,
      legality: card.legality,
      imageUrl: card.imageUrl,
      printings: (card.printings ?? []).map((p) => ({ set: p.setCode, number: p.collectorNumber, rarity: p.rarity, imageUrl: p.imageUrl })),
      rulings: catalog.rulings(card.slug),
    };
  })
  .sort((a, b) => a.type.localeCompare(b.type) || a.displayName.localeCompare(b.displayName));

writeJson(join(dataDir, "cards.json"), {
  schema: "cpai.cards.v1",
  generatedAt: new Date().toISOString(),
  source: { engine: "thecardgoat/tcg-engines (MIT)", commit: upstream, official: "https://cyberpunktcg.com/cards" },
  count: cards.length,
  cards,
});
const byType = cards.reduce<Record<string, number>>((acc, c) => ((acc[c.type] = (acc[c.type] ?? 0) + 1), acc), {});
console.log(`cards.json: ${cards.length} kart`, byType, `rulings: ${cards.reduce((n, c) => n + c.rulings.length, 0)}`);

// ---------- decks ----------
const decks: Deck[] = [];
for (const text of starterDeckLists) {
  const title = text.split(/\r?\n/)[0]!.trim();
  const id = "starter-" + title.toLowerCase().replace(/starter deck/i, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  const d = deckFromText(text, { id, name: title, source: { kind: "starter", url: "https://cyberpunktcg.com/blog/wnc-starter-decks" } });
  if (d.unresolved.length) console.warn(`  ! ${id}: nierozpoznane`, d.unresolved);
  const { unresolved: _u, ...deck } = d;
  decks.push(deck);
}
for (const spec of authoredBotLabDeckSpecs) {
  const legends = spec.legends.map((n) => catalog.byName(n)?.slug ?? `?${n}`);
  const main: Record<string, number> = {};
  for (const [n, k] of Object.entries(spec.mainDeck)) main[catalog.byName(n)?.slug ?? `?${n}`] = k;
  decks.push({ id: spec.id.replace(/^authored-/, "botlab-"), name: spec.title, source: { kind: "authored-botlab", note: "Talia testowa z repozytorium silnika" }, legends, main });
}
for (const deck of decks) {
  const problems = checkDeckLegality(deck);
  const status = problems.length ? `NIELEGALNA: ${problems.map((p) => p.message).join("; ")}` : "ok";
  console.log(`  deck ${deck.id.padEnd(48)} ${status}`);
  writeJson(join(dataDir, "decks", `${deck.id}.json`), deck);
}
console.log(`decks: ${decks.length}`);
