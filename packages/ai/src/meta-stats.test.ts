import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import { shapeOf } from "./lab.ts";
import { archetypeKey, archetypeOf, bestLegends, metaAdvice, metaBuild, metaData, trustedLift } from "./meta-stats.ts";

const decksDir = join(dirname(fileURLToPath(import.meta.url)), "../../../data/decks");
const decks = readdirSync(decksDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(decksDir, f), "utf8")) as Deck)
  .filter((d) => isDeckLegal(d));
const catalog = getCatalog();

describe("ladder data", () => {
  it("resolves every Legend and card to the catalog", () => {
    const m = metaData();
    expect(m.archetypes.length).toBeGreaterThanOrEqual(10);
    for (const a of m.archetypes) {
      expect(a.legends.length).toBeGreaterThan(0);
      expect(a.cards.length).toBeGreaterThan(10);
      for (const l of a.legends) expect(catalog.bySlug(l.slug)?.type).toBe("legend");
      for (const c of a.cards) expect(catalog.bySlug(c.slug)?.type).toBe(c.type);
    }
  });

  it("names a deck's archetype by its Legends' colours", () => {
    const deck = decks.find((d) => d.id === "meta-cb-4r2g-adam-padre-v")!;
    expect(archetypeKey(deck.legends)).toBe("4-red-2-green");
    expect(archetypeOf(deck.legends)?.name).toBe("4 Red / 2 Green");
  });
});

describe("deck lab: decks from the ladder", () => {
  it("builds a legal deck in the meta shape for every archetype", () => {
    for (const a of metaData().archetypes) {
      const b = metaBuild(a);
      expect(b, a.key).not.toBeNull();
      expect(isDeckLegal(b!.deck)).toBe(true);
      expect(archetypeKey(b!.deck.legends)).toBe(a.key);
      const s = shapeOf(b!.deck.main);
      expect(s.size).toBe(40);
      expect(s.units, a.key).toBeGreaterThanOrEqual(13);
      expect(s.units, a.key).toBeLessThanOrEqual(17);
      expect(s.heavy, a.key).toBeLessThanOrEqual(11);
      expect(s.sellable, a.key).toBeGreaterThanOrEqual(0.55);
      // Almost every card comes from what the archetype's lists play.
      expect(b!.cards.filter((c) => !c.stat).length, a.key).toBeLessThanOrEqual(2);
    }
  });

  it("builds around a chosen Legend", () => {
    const a = metaData().archetypes.find((x) => x.key === "4-red-2-green")!;
    const adam = a.legends.find((l) => catalog.bySlug(l.slug)?.name === "Adam Smasher")!;
    const trio = bestLegends(a, [adam.slug])!;
    expect(trio).toContain(adam.slug);
    const b = metaBuild(a, trio)!;
    expect(b.deck.legends).toEqual(trio);
    expect(isDeckLegal(b.deck)).toBe(true);
    // A Legend of a colour the archetype does not play gives no deck.
    const blue = catalog.cards.find((c) => c.type === "legend" && c.color === "blue")!;
    expect(bestLegends(a, [blue.slug])).toBeNull();
  });
});

describe("deck doctor from the ladder", () => {
  it("leaves the ladder's own lists alone", () => {
    for (const d of decks.filter((x) => x.id.startsWith("meta-cb-"))) expect(metaAdvice(d).swaps, d.id).toEqual([]);
  });

  it("only suggests cards the archetype's lists play, Unit for Unit, with a legal result", () => {
    for (const d of decks) {
      const adv = metaAdvice(d);
      if (!adv.archetype) continue;
      for (const s of adv.swaps) {
        expect(adv.archetype.cards.some((c) => c.slug === s.in)).toBe(true);
        expect(trustedLift(s.inStat)).toBeGreaterThan(-0.5);
        expect(catalog.bySlug(s.in)!.type === "unit").toBe(catalog.bySlug(s.out)!.type === "unit");
        expect(d.main[s.in]).toBeUndefined();
      }
      expect(isDeckLegal(adv.improved)).toBe(true);
      const ins = adv.legendSwaps.map((l) => l.in);
      expect(new Set(ins).size).toBe(ins.length);
    }
  });

  it("never cuts a card you keep", () => {
    const d = decks.find((x) => x.id === "rogue-ai-ggr-jackie-padre-v-40")!;
    const first = metaAdvice(d);
    expect(first.swaps.length).toBeGreaterThan(0);
    const kept = first.swaps[0]!.out;
    expect(metaAdvice(d, [kept]).swaps.some((s) => s.out === kept)).toBe(false);
  });
});
