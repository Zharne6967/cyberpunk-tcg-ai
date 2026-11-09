import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Deck } from "@cpai/core";
import { buildReport, deckProfile, planGauntlet } from "./analysis.ts";
import { playMatch } from "./match.ts";

const decksDir = join(dirname(fileURLToPath(import.meta.url)), "../../../data/decks");
const load = (id: string) => JSON.parse(readFileSync(join(decksDir, `${id}.json`), "utf8")) as Deck;

describe("deck analysis", () => {
  const target = load("starter-the-heist");
  const pool = [load("starter-the-heist"), load("starter-embracing-power"), load("botlab-johnny-fight-ready-steal")];

  it("profiles a deck from its cards", () => {
    const p = deckProfile(target);
    expect(p.size).toBe(40);
    expect(p.units + p.gears + p.programs).toBe(40);
    expect(p.curve.reduce((s, n) => s + n, 0)).toBe(40);
    expect(p.colors.length).toBeGreaterThan(0);
  });

  it("never plays the deck against itself (also a renamed copy) and swaps seats", () => {
    const copy = { ...target, id: "user-copy", name: "My copy" };
    const { opponents, specs } = planGauntlet(copy, pool, 4);
    expect(opponents.map((d) => d.id)).toEqual(["starter-embracing-power", "botlab-johnny-fight-ready-steal"]);
    expect(specs).toHaveLength(8);
    expect(specs.filter((s) => s.aSeat === "p1")).toHaveLength(4);
  });

  it("builds a consistent report from played games", () => {
    const { opponents, specs } = planGauntlet(target, pool, 2);
    const outcomes = specs.map((s) => playMatch(s));
    for (const o of outcomes) expect(o.cardsA.played.length + o.cardsB.played.length).toBeGreaterThan(0);
    const r = buildReport(target, opponents, specs, outcomes, 1);
    expect(r.overall.games).toBe(specs.length);
    expect(r.matchups.reduce((s, m) => s + m.games, 0)).toBe(specs.length);
    expect(r.matchups[0]!.rate).toBeLessThanOrEqual(r.matchups[1]!.rate);
    expect(r.counters[0]!.deckId).toBe(r.matchups[0]!.deckId);
    expect(r.deck.main).toEqual(target.main);
  }, 60_000);
});
