import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isDeckLegal, type Deck } from "@cpai/core";
import { planGauntlet } from "./analysis.ts";
import { candidateCards, proposeSwaps, swapCard, weakCards } from "./doctor.ts";
import { clearlyBetter, doctorBudget, doctorLoop, isMetaDeck, perOpponent, type DoctorDeck, type DoctorOutcome } from "./doctor-loop.ts";
import { playMatch } from "./match.ts";

const decksDir = join(dirname(fileURLToPath(import.meta.url)), "../../../data/decks");
const load = (id: string) => JSON.parse(readFileSync(join(decksDir, `${id}.json`), "utf8")) as Deck;
const all = readdirSync(decksDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => load(f.slice(0, -5)))
  .filter((d) => isDeckLegal(d));
const size = (d: Deck) => Object.values(d.main).reduce((a, b) => a + b, 0);

describe("deck doctor: cards", () => {
  const deck = load("rogue-ai-ggr-jackie-padre-v-40");
  const pool = all.filter(isMetaDeck);

  it("swaps every copy of a card and keeps the deck legal", () => {
    const [out] = Object.entries(deck.main).find(([, n]) => n >= 2)!;
    const add = candidateCards(deck, pool, [], 6).find((s) => !deck.main[s])!;
    expect(add).toBeDefined();
    const next = swapCard(deck, out, add)!;
    expect(next.copies).toBe(Math.min(deck.main[out]!, 3));
    expect(next.deck.main[out] ?? 0).toBe(deck.main[out]! - next.copies);
    expect(next.deck.main[add]).toBe(next.copies);
    expect(isDeckLegal(next.deck)).toBe(true);
    expect(swapCard(deck, out, out)).toBeNull();
  });

  it("proposes legal swaps of the same deck size, never above 3 copies", () => {
    const { specs, opponents } = planGauntlet(deck, pool, 2, "greedy", "doctor-test");
    const outcomes = specs.map((s) => playMatch(s));
    expect(weakCards(deck, outcomes, 3)).toHaveLength(3);
    const { variants } = proposeSwaps(deck, opponents, outcomes, 3, 4);
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      expect(isDeckLegal(v.deck)).toBe(true);
      expect(Object.values(v.deck.main).every((n) => n <= 3)).toBe(true);
      expect(size(v.deck)).toBe(size(deck));
      expect(v.deck.main[v.in]).toBeGreaterThanOrEqual(v.copies);
    }
  }, 120_000);
});

describe("deck doctor: search loop", () => {
  // A toy game: the win rate grows with copies of "good" and falls with copies of "bad".
  const strength = (d: DoctorDeck) => 0.5 + 0.1 * (d.main.good ?? 0) - 0.1 * (d.main.bad ?? 0);
  const run = async (d: DoctorDeck, opponents: DoctorDeck[], per: number, seed: string): Promise<DoctorOutcome[]> => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return Array.from({ length: per * opponents.length }, (_, i) => ({ winner: (i * 0.618 + h / 997) % 1 < strength(d) ? "A" : "B" }));
  };
  const swap = (d: DoctorDeck, out: string, inn: string) => {
    const copies = d.main[out] ?? 0;
    const main = { ...d.main, [inn]: (d.main[inn] ?? 0) + copies };
    delete main[out];
    return { out, in: inn, copies, deck: { ...d, main } };
  };
  const propose = async (d: DoctorDeck) => ({
    variants: Object.keys(d.main)
      .filter((s) => s !== "good" && s !== "filler")
      .flatMap((out) => ["good", "meh"].filter((inn) => inn !== out).map((inn) => swap(d, out, inn))),
    kept: [],
  });
  const deck: DoctorDeck = { id: "toy", name: "Toy", legends: [], main: { bad: 2, meh: 3, filler: 35 } };
  const opponents: DoctorDeck[] = [1, 2, 3].map((i) => ({ id: `o${i}`, name: `O${i}`, legends: [], main: {} }));
  const small = { stages: [24, 48], keep: [3, 2], check: 120, confirm: 120, minGain: 0.05 };

  it("keeps a swap only after it wins more on new games, then stops when nothing helps", async () => {
    const report = await doctorLoop(deck, opponents, run, propose, { ...small, rounds: 4 });
    expect(report.changes.length).toBeGreaterThan(0);
    expect(report.changes.every((c) => c.in === "good")).toBe(true);
    expect(report.improved.main.bad ?? 0).toBe(0);
    expect(report.confirm.after).toBeGreaterThan(report.confirm.before);
    expect(report.opponents).toBe(opponents);
    for (const r of report.rounds) if (r.accepted) expect(r.accepted.checkDelta!).toBeGreaterThanOrEqual(0.05);
    // The last round found nothing better (the deck has only "good", "meh" swaps left at best).
    expect(report.rounds.at(-1)!.accepted).toBeNull();
    expect(report.games).toBeLessThanOrEqual(doctorBudget({ ...small, rounds: 4 }, opponents.length, 4));
  });

  it("changes nothing when no swap clears the minimum gain", async () => {
    const flat = async (_d: DoctorDeck, opponents: DoctorDeck[], per: number): Promise<DoctorOutcome[]> => Array.from({ length: per * opponents.length }, (_, i) => ({ winner: i % 2 ? "A" : "B" }));
    const report = await doctorLoop(deck, opponents, flat, propose, { ...small, rounds: 2 });
    expect(report.changes).toEqual([]);
    expect(report.improved).toBe(deck);
    expect(report.rounds).toHaveLength(1);
    expect(report.confirm.before).toBe(report.confirm.after);
  });

  it("needs a clear gain, not a lucky one", () => {
    const games = (w: number, n: number): DoctorOutcome[] => Array.from({ length: n }, (_, i) => ({ winner: i < w ? "A" : "B" }));
    expect(clearlyBetter(games(50, 100), games(56, 100), 0.03, 1.28)).toBe(false);
    expect(clearlyBetter(games(500, 1000), games(560, 1000), 0.03, 1.28)).toBe(true);
    expect(perOpponent(256, 6)).toBe(42);
    expect(perOpponent(10, 20)).toBe(2);
  });
});

describe("deck doctor: the deck's core stays", () => {
  const meta = all.filter(isMetaDeck);
  const deck = load("rogue-ai-ggr-jackie-padre-v-40");

  it("finds the cards most decks with these colours play", async () => {
    const { coreCards } = await import("./doctor.ts");
    const core = coreCards(deck, meta).map((c) => c.slug);
    expect(core).toContain("mantis-blades");
    expect(core).toContain("satori-sword-of-saburo");
  });

  it("never proposes cutting a core card or a card you keep", () => {
    const { specs, opponents } = planGauntlet(deck, meta, 2, "greedy", "core");
    const outcomes = specs.map((s) => playMatch(s));
    const { variants, kept } = proposeSwaps(deck, opponents, outcomes, 4, 4, ["riot-shield"]);
    const protectedCards = new Set(kept.map((k) => k.slug));
    expect(protectedCards.has("riot-shield")).toBe(true);
    expect(protectedCards.has("mantis-blades")).toBe(true);
    for (const v of variants) expect(protectedCards.has(v.out)).toBe(false);
  }, 120_000);
});
