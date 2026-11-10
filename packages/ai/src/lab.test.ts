import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import { buildMain, eligibleCards, isLegalTrio, labBreed, labSeed, mutateTrio, randomTrio, seededRandom } from "./lab.ts";
import { labLoop, learnCardValues, opponentsOf, type LabDeck, type LabOutcome } from "./lab-loop.ts";
import { isMetaDeck } from "./doctor-loop.ts";

const decksDir = join(dirname(fileURLToPath(import.meta.url)), "../../../data/decks");
const pool = readdirSync(decksDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(decksDir, f), "utf8")) as Deck)
  .filter((d) => isDeckLegal(d) && isMetaDeck(d));

describe("deck lab: building decks", () => {
  it("builds legal 40-card decks from Legends alone", () => {
    const rng = seededRandom("t1");
    for (let i = 0; i < 25; i++) {
      const trio = randomTrio(rng);
      expect(isLegalTrio(trio)).toBe(true);
      const main = buildMain(trio, { pool, rng, temperature: 0.2 });
      expect(main).not.toBeNull();
      const deck = { id: "t", name: "t", legends: trio, main: main! };
      expect(Object.values(main!).reduce((a, b) => a + b, 0)).toBe(40);
      expect(Object.values(main!).every((n) => n >= 1 && n <= 3)).toBe(true);
      expect(isDeckLegal(deck)).toBe(true);
      const allowed = new Set(eligibleCards(trio).map((c) => c.slug));
      expect(Object.keys(main!).every((s) => allowed.has(s))).toBe(true);
    }
  });

  it("never pairs two Legends with the same name, keeps the chosen Legend", () => {
    const rng = seededRandom("t2");
    const catalog = getCatalog();
    for (let i = 0; i < 40; i++) {
      const trio = randomTrio(rng, ["v-streetkid"]);
      expect(trio).toContain("v-streetkid");
      expect(new Set(trio.map((s) => catalog.bySlug(s)!.name)).size).toBe(3);
      const next = mutateTrio(trio, rng, ["v-streetkid"]);
      expect(next).toContain("v-streetkid");
      expect(isLegalTrio(next)).toBe(true);
    }
  });

  it("seeds and breeds legal, distinct decks", () => {
    const seeded = labSeed({ pool, count: 12, seed: "s" });
    expect(seeded.length).toBe(12);
    const kids = labBreed({ parents: seeded.slice(0, 4), pool, count: 10, seed: "b" });
    expect(kids.length).toBeGreaterThan(5);
    for (const d of [...seeded, ...kids]) expect(isDeckLegal(d)).toBe(true);
    expect(new Set(kids.map((d) => JSON.stringify([d.legends, d.main]))).size).toBe(kids.length);
  });
});

describe("deck lab: search loop", () => {
  // Toy world: a deck's strength is the number of "good" copies; games are decided by strength.
  const strength = (d: LabDeck) => (d.main.good ?? 0) / 10;
  const run = async (d: LabDeck, opps: LabDeck[], per: number, seed: string): Promise<LabOutcome[]> => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return opps.flatMap((o, j) =>
      Array.from({ length: per }, (_, i) => {
        const p = 0.5 + strength(d) - strength(o);
        const win = ((i + j) * 0.618 + h / 997) % 1 < p;
        return { winner: win ? "A" : "B", cardsA: { played: Object.keys(d.main).filter((_, k) => (i + k) % 2 === 0) } } as LabOutcome;
      }),
    );
  };
  const toyPool: LabDeck[] = [0, 1, 2].map((g) => ({ id: `p${g}`, name: `P${g}`, legends: ["a", "b", "c"], main: { good: g, filler: 40 - g } }));
  let n = 0;
  const make = (good: number): LabDeck => ({ id: `lab-${n++}`, name: `L${good}`, legends: ["x", "y", "z"], main: { good, filler: 40 - good } });
  const source = {
    seed: async (count: number) => Array.from({ length: count }, (_, i) => make(i % 3)),
    breed: async (parents: LabDeck[], count: number) => Array.from({ length: count }, (_, i) => make(Math.min(3, (parents[i % parents.length]!.main.good ?? 0) + 1))),
  };

  it("breeds better decks and reports every matchup", async () => {
    const report = await labLoop(toyPool, run, source, { generations: 4, population: 8, survivors: 3, screen: 24, finalists: 2, final: 48 });
    expect(report.finalists.length).toBe(2);
    expect(report.finalists[0]!.deck.main.good).toBe(3);
    // Against the same opponent the Lab deck does better than the best pool deck.
    const vs = (e: { matchups: { opponent: string; rate: number }[] }, id: string) => e.matchups.find((m) => m.opponent === id)!.rate;
    expect(report.bestPool!.deck.id).toBe("p2");
    expect(vs(report.finalists[0]!, "p1")).toBeGreaterThan(vs(report.bestPool!, "p1"));
    for (const f of report.finalists) expect(f.matchups.map((m) => m.opponent).sort()).toEqual(opponentsOf(f.deck, toyPool).map((o) => o.id).sort());
    expect(report.history).toHaveLength(4);
  });

  it("learns that cards played in won games are worth more", () => {
    const deck = { id: "d", name: "d", legends: [], main: { a: 3, b: 3 } };
    const outcomes: LabOutcome[] = Array.from({ length: 40 }, (_, i) => ({ winner: i % 2 ? "A" : "B", cardsA: { played: i % 2 ? ["a"] : ["b"] } }));
    const v = learnCardValues([{ deck, outcomes }]);
    expect(v.a!).toBeGreaterThan(0);
    expect(v.b!).toBeLessThan(0);
  });
});

describe("deck lab: decks built the way players build them", () => {
  it("new and bred decks keep the meta shape: about 15 Units, mostly sellable Gear and Programs", async () => {
    const { poolShape, shapeOf } = await import("./lab.ts");
    const shape = poolShape(pool);
    expect(shape.minUnits).toBeGreaterThanOrEqual(11);
    expect(shape.maxUnits).toBeLessThanOrEqual(19);
    const seeded = labSeed({ pool, count: 20, seed: "shape" });
    const kids = labBreed({ parents: seeded.slice(0, 6), pool, count: 20, seed: "shape-b" });
    for (const d of [...seeded, ...kids]) {
      const x = shapeOf(d.main);
      expect(x.units).toBeGreaterThanOrEqual(shape.minUnits);
      expect(x.units).toBeLessThanOrEqual(shape.maxUnits);
      expect(x.sellable).toBeGreaterThanOrEqual(shape.minSellable);
      expect(x.heavy).toBeLessThanOrEqual(shape.maxHeavy);
    }
  });
});
