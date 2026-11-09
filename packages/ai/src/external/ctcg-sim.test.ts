import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPlayerPrompt, filterMatchView } from "@tcg/cyberpunk-engine";
import { getCatalog } from "@cpai/core";
import { legalActions } from "../ismcts/actions.ts";
import { coachAdvice } from "../coach.ts";
import { convertSimSnapshot, simCoachAllowed, simDecision, type SimSnapshot } from "./ctcg-sim.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as SimSnapshot;

describe("cyberpunk-tcg-sim.online snapshot → engine (extension coach)", () => {
  const snap = fixture("tutorial-main-t1");

  it("works only where the site allows it", () => {
    expect(simCoachAllowed(snap).allowed).toBe(true);
    const net = (room: Record<string, unknown>) => simCoachAllowed({ ...snap, room: { ...snap.room, mode: "network", ...room } });
    expect(net({ joinCode: "ABC123" }).allowed).toBe(true);
    expect(net({ joinCode: "ABC123", isQuickPlayRoom: true }).allowed).toBe(false);
    expect(net({ joinCode: "ABC123", isPublicLobby: true }).allowed).toBe(false);
    expect(net({ joinCode: "ABC123", rankedMatchId: "x" }).allowed).toBe(false);
    expect(net({ joinCode: "ABC123", tournamentId: "t" }).allowed).toBe(false);
    expect(net({ joinCode: null }).allowed).toBe(false);
    expect(net({ joinCode: "ABC123", matchCategory: "private", ranked: null, tournament: null, preRelease: null }).allowed).toBe(true);
    expect(net({ joinCode: "ABC123", matchCategory: "casual" }).allowed).toBe(false);
    expect(net({ joinCode: "ABC123", ranked: { season: 1 } }).allowed).toBe(false);
    expect(net({ joinCode: "ABC123", preRelease: { set: "x" } }).allowed).toBe(false);
    expect(simCoachAllowed({ ...snap, self: { playerId: "player1", role: "spectator" } }).allowed).toBe(false);
  });

  it("rebuilds the table: zones, Eddies, spent Legends, the rolled Gig", () => {
    const r = convertSimSnapshot(snap);
    if (!r.ok) throw new Error(r.reason);
    const s = r.state;
    const p1 = s.G.players.p1!;
    const p2 = s.G.players.p2!;
    expect(p1.zones.hand).toHaveLength(6);
    expect(p2.zones.hand).toHaveLength(6);
    expect(p1.zones.deck).toHaveLength(33);
    expect(p2.zones.deck).toHaveLength(34);
    expect(p1.zones.eddieArea).toHaveLength(1);
    expect(p1.eddies).toBe(1);
    expect(p1.soldThisTurn).toBe(true);
    expect(p1.zones.legendArea.map((id) => s.G.cardIndex[id as string]!.meta.spent)).toEqual([true, true, false]);
    expect(p1.gigArea).toHaveLength(1);
    expect(s.G.gigDice[p1.gigArea[0] as string]!.faceValue).toBe(3);
    expect(p1.fixerArea).toHaveLength(5);
    expect(s.G.gamePhase).toBe("main");
    // Our hand = the site's hand, card by card.
    const view = filterMatchView(s, r.viewer);
    const hand = (view.players.p1!.zones.hand as { cardName: string }[]).map((c) => c.cardName).sort();
    expect(hand).toEqual(snap.players!.player1!.hand!.map((c) => c.name!.split(":")[0]).sort());
    // Every card is somewhere exactly once.
    const all = Object.values(s.G.players).flatMap((p) => Object.values(p.zones).flat());
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(Object.keys(s.G.cardIndex).length);
  });

  it("the moves our engine allows match the site's (2 €$ available: Bombus yes, Dexter no)", () => {
    const r = convertSimSnapshot(snap);
    if (!r.ok) throw new Error(r.reason);
    const prompt = buildPlayerPrompt(r.state, r.viewer);
    expect(prompt.status).toBe("action");
    const nameOf = (id: unknown) => getCatalog().engineCatalog.get(r.state.G.cardIndex[id as string]!.definitionId)!.name;
    const plays = new Set(
      legalActions(r.state, r.viewer)
        .filter((a) => a.move === "playCard" && !a.args!.attachToId)
        .map((a) => nameOf(a.args!.cardId)),
    );
    expect(plays.has("Secondhand Bombus")).toBe(true);
    expect(plays.has("Dexter DeShawn")).toBe(false);
    // Sold already this turn: no Sell a Card.
    expect(legalActions(r.state, r.viewer).some((a) => a.move === "sellCard")).toBe(false);
  });

  it("the coach gives advice for the converted position", () => {
    const r = convertSimSnapshot(snap);
    if (!r.ok) throw new Error(r.reason);
    const advice = coachAdvice({ stateID: 0, viewer: r.viewer as string, world: r.state, remembered: [] }, { iterations: 60, timeMs: 20_000, seed: "x" });
    expect(advice.moves.length).toBeGreaterThan(0);
    expect(advice.moves[0]!.label).toMatch(/Play a Card|Call a Legend|Pass Turn|Attack/);
  }, 60_000);

  // Real states from a Solo game against the site's AI (turn 3; turn 5 right after an attack).
  for (const name of ["solo-main-t3", "solo-after-attack-t5"]) {
    it(`${name}: our engine offers exactly the site's actions for every card in hand`, () => {
      const s = fixture(name);
      const hand = s.players!.player1!.hand as unknown as { name: string; actions?: string[] }[];
      expect(simDecision(s)).toEqual({ kind: "main" });
      const r = convertSimSnapshot(s);
      if (!r.ok) throw new Error(r.reason);
      const cat = getCatalog().engineCatalog;
      const nameOf = (id: unknown) => cat.get(r.state.G.cardIndex[id as string]!.definitionId)!.name;
      const legal = legalActions(r.state, r.viewer);
      const ours = (move: string) => new Set(legal.filter((a) => a.move === move).map((a) => nameOf(a.args!.cardId)));
      const site = (type: string) => new Set(hand.filter((c) => c.actions?.includes(type)).map((c) => c.name.split(":")[0]!));
      expect(ours("playCard")).toEqual(site("play_card"));
      expect(ours("sellCard")).toEqual(site("sell_card"));
      expect(legal.some((a) => a.move === "passPhase")).toBe(true);
    });
  }

  it("after an attack the site keeps turnStep \"attack\": still your Main Phase (the coach used to stop here)", () => {
    const s = fixture("solo-after-attack-t5");
    expect(s.game!.turnStep).toBe("attack");
    const r = convertSimSnapshot(s);
    if (!r.ok) throw new Error(r.reason);
    // Dexter already attacked (spent), the stolen d4 counts as your Gig.
    expect(r.state.G.players.p1!.gigArea).toHaveLength(4);
    const advice = coachAdvice({ stateID: 0, viewer: "p1", world: r.state, remembered: [] }, { iterations: 60, timeMs: 20_000, seed: "y" });
    expect(advice.moves.length).toBeGreaterThan(0);
  }, 60_000);

  it("Start Phase: only the dice the site lets you roll", () => {
    const s = fixture("solo-main-t3");
    const start: SimSnapshot = {
      ...s,
      game: { ...s.game, turnStep: "ready_roll", turnStepLabel: "Start Phase" },
      players: { ...s.players, player1: { ...s.players!.player1!, dicePool: s.players!.player1!.dicePool!.map((d) => ({ ...d, canRoll: d.label === "d4" || d.label === "d6" })) } },
    };
    expect(simDecision(start)).toEqual({ kind: "start" });
    const r = convertSimSnapshot(start);
    if (!r.ok) throw new Error(r.reason);
    const allowed = (r.state.G.turnMetadata.pendingChoice as { payload: { allowedDieIds: string[] } }).payload.allowedDieIds;
    expect(allowed.map((id) => r.state.G.gigDice[id]!.dieType).sort()).toEqual(["d4", "d6"]);
  });

  it("choices on the site: says whose choice it is instead of advising", () => {
    const s = fixture("solo-main-t3");
    expect(simDecision({ ...s, controls: { pending: { type: "gig_increase_choice", stepLabel: "CHOOSE GIG", actorId: "player1" } } })).toEqual({ kind: "wait", reason: "Your choice: Choose gig" });
    expect(simDecision({ ...s, controls: { pending: { type: "defense", stepLabel: "CHOOSE RESPONSE", actorId: "player2" } } })).toEqual({ kind: "wait", reason: "Rival is choosing" });
  });

  it("explains when it cannot help", () => {
    expect(convertSimSnapshot({ ...snap, game: { ...snap.game, activePlayerId: "player2" } })).toEqual({ ok: false, reason: "Rival's turn" });
    expect(convertSimSnapshot({ ...snap, room: { ...snap.room, deckSelections: {} } })).toEqual({ ok: false, reason: "Deck lists are not visible in this game" });
  });
});
