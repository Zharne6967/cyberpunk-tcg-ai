import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalEngine, SeededRNG, createMatchState, createPlayerId, type MatchState } from "@tcg/cyberpunk-engine";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { coachKey } from "@cpai/core/protocol";
import { decideBotCommand, ensureRegistry } from "./decide.ts";
import { actorOf, legalActions } from "./ismcts/actions.ts";
import { determinize, informationSet } from "./ismcts/determinize.ts";
import { coachAdvice, coachWorld } from "./coach.ts";

ensureRegistry();
const p1 = createPlayerId("p1");
const p2 = createPlayerId("p2");
const deck = (id: string) => JSON.parse(readFileSync(new URL(`../../../data/decks/${id}.json`, import.meta.url), "utf8")) as Deck;

/** A mid-game position (greedy self-play) with p2 — the coached player here — to act. */
function midGame(seed: string): MatchState {
  const engine = new LocalEngine(
    createMatchState({
      players: [
        { id: p1, name: "p1" },
        { id: p2, name: "p2" },
      ],
      catalog: getCatalog().engineCatalog,
      deckLists: [toEngineDeckList(deck("starter-the-heist"), "p1"), toEngineDeckList(deck("starter-embracing-power"), "p2")],
      seed,
    }),
  );
  for (let i = 0; i < 400; i++) {
    const s = engine.getState();
    const t = actorOf(s)!;
    if (i > 40 && t.pid === p2 && s.G.gamePhase === "main" && t.prompt.status === "action") return s;
    const d = decideBotCommand(s, t.pid, "greedy", `${seed}:${i}`)!;
    engine.processCommand({ commandID: `c${i}`, move: d.move as never, input: d.args ? { args: d.args } : undefined }, t.pid);
  }
  throw new Error("no mid-game position");
}

describe("coach (the player's browser only gets what the player knows)", () => {
  const real = midGame("coach-1");
  const info = informationSet(real, p2);
  const other = determinize(real, info, new SeededRNG("another-hidden-truth"));

  it("the world sent to the browser depends only on the player's information", () => {
    expect(JSON.stringify(coachWorld(other, p2, [], "s").world)).toBe(JSON.stringify(coachWorld(real, p2, [], "s").world));
  });

  it("hidden cards get shuffled ids (ids follow the deck list and would give the order away)", () => {
    const w = coachWorld(real, p2, [], "s").world;
    for (const pid of ["p1", "p2"]) {
      const a = real.G.players[pid]!.zones.deck;
      const b = w.G.players[pid]!.zones.deck;
      expect(b).toHaveLength(a.length);
      const same = a.filter((id, i) => b[i] === id).length;
      expect(same / a.length).toBeLessThan(0.25);
    }
    // Hidden ids keep their owner: every renamed id still belongs to the same player.
    for (const [id, card] of Object.entries(w.G.cardIndex)) expect(real.G.cardIndex[id]!.ownerId).toBe(card.ownerId);
  });

  it("the player's own hand and the board keep their ids and cards", () => {
    const w = coachWorld(real, p2, [], "s").world;
    for (const id of [...real.G.players.p2!.zones.hand, ...real.G.players.p1!.zones.field, ...real.G.players.p2!.zones.field])
      expect(w.G.cardIndex[id]!.definitionId).toBe(real.G.cardIndex[id]!.definitionId);
  });

  it("recommends moves that are legal in the real game, best first, with a label", () => {
    const advice = coachAdvice(coachWorld(real, p2, [], "s"), { iterations: 80, timeMs: 20_000, seed: "c" });
    const legal = new Set(legalActions(real, p2).map((a) => coachKey(a.move, a.args)));
    expect(advice.moves.length).toBeGreaterThan(0);
    for (const m of advice.moves) {
      expect(legal.has(m.key)).toBe(true);
      expect(m.label).not.toBe(m.move);
      expect(m.winRate).toBeGreaterThanOrEqual(0);
    }
    expect(advice.moves[0]!.visits).toBeGreaterThanOrEqual(advice.moves.at(-1)!.visits);
    expect(advice.iterations).toBe(80);
  }, 60_000);
});
