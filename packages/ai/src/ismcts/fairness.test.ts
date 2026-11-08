import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalEngine, SeededRNG, createMatchState, createPlayerId, filterMatchView, type MatchState } from "@tcg/cyberpunk-engine";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { decideBotCommand, ensureRegistry } from "../decide.ts";
import { actorOf } from "./actions.ts";
import { determinize, informationSet } from "./determinize.ts";
import { ismctsSearch } from "./search.ts";

ensureRegistry();
const p1 = createPlayerId("p1");
const p2 = createPlayerId("p2");
const deck = (id: string) => JSON.parse(readFileSync(new URL(`../../../../data/decks/${id}.json`, import.meta.url), "utf8")) as Deck;

/** A mid-game position reached by greedy self-play, with p2 (the bot) to act. */
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

describe("ISMCTS fairness (decisions depend only on the bot's information set)", () => {
  const real = midGame("fair-1");
  const info = informationSet(real, p2);
  // Another world the bot cannot tell apart: rival hand, both deck orders, face-down cards and RNG differ.
  const other = determinize(real, info, new SeededRNG("another-hidden-truth"));

  it("the alternative world really hides different cards", () => {
    const hidden = (s: MatchState) => [...s.G.players.p1!.zones.hand, ...s.G.players.p2!.zones.deck].map((id) => s.G.cardIndex[id]!.definitionId).join();
    expect(hidden(other)).not.toBe(hidden(real));
    expect(other.ctx.rngState).not.toEqual(real.ctx.rngState);
  });

  it("the bot's view is identical in both worlds", () => {
    const strip = (s: MatchState) => JSON.stringify({ ...filterMatchView(s, p2), stateID: 0 });
    expect(strip(other)).toBe(strip(real));
  });

  it("determinization never copies hidden identities from the real state", () => {
    const a = determinize(real, info, new SeededRNG("same"));
    const b = determinize(other, informationSet(other, p2), new SeededRNG("same"));
    expect(JSON.stringify(b.G.cardIndex)).toBe(JSON.stringify(a.G.cardIndex));
  });

  it("the bot's own hand and the board never change", () => {
    const w = determinize(real, info, new SeededRNG("x"));
    for (const id of [...real.G.players.p2!.zones.hand, ...real.G.players.p1!.zones.field, ...real.G.players.p2!.zones.field])
      expect(w.G.cardIndex[id]!.definitionId).toBe(real.G.cardIndex[id]!.definitionId);
  });

  it("search statistics are identical whatever the hidden truth is", () => {
    const a = ismctsSearch(real, p2, { iterations: 60 }, "seed", []);
    const b = ismctsSearch(other, p2, { iterations: 60 }, "seed", []);
    expect(a.trivial).toBe(false);
    expect(b.stats).toEqual(a.stats);
  });

  it("returns a move the engine accepts", () => {
    const d = decideBotCommand(real, "p2", "ismcts-fast", "s", { ismcts: { iterations: 40, timeMs: undefined } })!;
    const r = new LocalEngine(real).processCommand({ commandID: "t", move: d.move as never, input: d.args ? { args: d.args } : undefined }, p2);
    expect(r.success).toBe(true);
  });
});
