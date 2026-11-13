import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import { shapeOf } from "./lab.ts";
import { answerMessage, readMessage, type DeckAnswer, type DeckRequest } from "./deck-request.ts";
import { archetypeKey } from "./meta-stats.ts";

const decksDir = join(dirname(fileURLToPath(import.meta.url)), "../../../data/decks");
const pool = readdirSync(decksDir)
  .filter((f) => /^(meta|rogue-ai)-/.test(f))
  .map((f) => JSON.parse(readFileSync(join(decksDir, f), "utf8")) as Deck);
const catalog = getCatalog();
const slugOf = (name: string) => catalog.cards.find((c) => c.name === name && c.type !== "legend")!.slug;
const legendNames = (a: DeckAnswer) => a.build!.deck.legends.map((s) => catalog.bySlug(s)!.name);

/** A conversation: each message builds on the previous answer. */
function talk(...lines: string[]): DeckAnswer[] {
  let prev: DeckRequest | null = null;
  let shown: string | null = null;
  return lines.map((t) => {
    const a = answerMessage(t, prev, pool, shown);
    prev = a.request;
    shown = a.build?.archetype.key ?? null;
    return a;
  });
}

describe("deck chat: reading messages", () => {
  it("reads Legends, cards in and out, colours and wishes in Polish", () => {
    const { request: r } = readMessage("Zrób mi agresywny deck 4 czerwone 2 zielone z Padre, 3 Mantis Blades i bez Satori, 15 jednostek");
    expect(r.colors).toEqual({ red: 4, green: 2 });
    expect(r.legends.map((l) => l.name)).toEqual(["Padre"]);
    expect(r.include).toEqual([{ slug: slugOf("Mantis Blades"), copies: 3 }]);
    expect(r.exclude).toEqual([slugOf("Satori")]);
    expect(r.curve).toBe("low");
    expect(r.units).toEqual({ min: 15, max: 15 });
  });

  it("reads the same in English", () => {
    const { request: r } = readMessage("aggressive red deck with V and 3 Mantis Blades, no Satori, 15 units");
    expect(r.colors).toEqual({ red: 0 });
    expect(r.legends.map((l) => l.name)).toEqual(["V"]);
    expect(r.include.map((x) => x.slug)).toEqual([slugOf("Mantis Blades")]);
    expect(r.exclude).toEqual([slugOf("Satori")]);
    expect(r.curve).toBe("low");
  });

  it("carries a negation over a list of names", () => {
    const { request: r } = readMessage("nie chcę Corpo Security i MaxTac Squadron");
    expect(r.exclude.sort()).toEqual([slugOf("Corpo Security"), slugOf("MaxTac Squadron")].sort());
    expect(r.include).toEqual([]);
  });

  it("tells the deck to beat from the deck to build", () => {
    const { request: r } = readMessage("deck z Padre który pokona 4 yellow 2 red");
    expect(r.legends.map((l) => l.name)).toEqual(["Padre"]);
    expect(r.beat?.colors).toEqual({ yellow: 4, red: 2 });
    expect(r.colors).toEqual({});
    expect(readMessage("lepszy niż Rogue AI").request.beat?.rogueAi).toBe(true);
    expect(readMessage("lepszy niż Rogue AI").request.legends).toEqual([]);
  });

  it("does not read wishes out of card names, nor 'kontrolny' as 'kontra'", () => {
    const r = readMessage("Take Control i Safety Override").request;
    expect(r.curve).toBeNull();
    expect(r.goal).toBe("winRate");
    const k = readMessage("kontrolny niebieski deck").request;
    expect(k.beat).toBeNull();
    expect(k.colors).toEqual({ blue: 0 });
    expect(k.curve).toBe("high");
  });

  it("reads GGR shorthand and percent of sellable cards", () => {
    expect(readMessage("GGR").request.colors).toEqual({ green: 4, red: 2 });
    expect(readMessage("60% kart na sprzedaż").request.units).toEqual({ min: 16, max: 16 });
  });
});

describe("deck chat: building", () => {
  it("builds what was asked for, legal and in the meta shape", () => {
    const [a] = talk("aggressive red deck with Padre and 3 Mantis Blades, no Satori");
    const d = a!.build!.deck;
    expect(isDeckLegal(d)).toBe(true);
    expect(legendNames(a!)).toContain("Padre");
    expect(archetypeKey(d.legends)).toContain("red");
    expect(d.main[slugOf("Mantis Blades")]).toBe(3);
    expect(d.main[slugOf("Satori")]).toBeUndefined();
    expect(shapeOf(d.main).heavy).toBeLessThanOrEqual(6);
  });

  it("follows up on the previous message", () => {
    const [first, second, third, fourth] = talk("Zrób mi najlepszy deck z Padre", "bez Satori", "15 jednostek", "inny");
    expect(legendNames(first!)).toContain("Padre");
    expect(second!.build!.deck.main[slugOf("Satori")]).toBeUndefined();
    expect(legendNames(second!)).toContain("Padre");
    expect(shapeOf(third!.build!.deck.main).units).toBe(15);
    expect(fourth!.build!.archetype.key).not.toBe(third!.build!.archetype.key);
    expect(legendNames(fourth!)).toContain("Padre");
    expect(fourth!.build!.deck.main[slugOf("Satori")]).toBeUndefined();
  });

  it("says what it had to drop when nothing fits", () => {
    const [a] = talk("4 czerwone 2 zielone z Viktorem");
    expect(a!.build!.archetype.key).toBe("4-red-2-green");
    expect(a!.reply.join(" ")).toMatch(/Viktor Vektor is Yellow/);
    expect(a!.request.legends).toEqual([]);
  });

  it("offers candidates and the meta decks to test for a deck to beat", () => {
    const [a] = talk("deck który pokona 4 yellow 2 red");
    expect(a!.beat!.decks.length).toBeGreaterThan(0);
    expect(a!.beat!.decks.every((d) => archetypeKey(d.legends) === "4-yellow-2-red")).toBe(true);
    expect(a!.beat!.candidates.length).toBe(3);
    expect(a!.beat!.candidates.every((b) => b.archetype.key !== "4-yellow-2-red")).toBe(true);
  });

  it("builds the most played deck when asked", () => {
    const [a] = talk("najpopularniejszy deck");
    expect(a!.build!.archetype.key).toBe("4-yellow-2-red");
  });
});
