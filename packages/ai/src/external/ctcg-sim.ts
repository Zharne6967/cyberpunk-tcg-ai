/**
 * cyberpunk-tcg-sim.online → our engine (browser extension coach).
 *
 * The site keeps the current game in `window.__cyberpunkTcgApp.snapshot` (per-viewer: the rival's hand
 * and every face-down card are hidden, both deck lists are in the room). We rebuild a complete engine
 * state from it: a real game is set up with both deck lists, then zones, Gig dice and turn flags are
 * overwritten from the snapshot. Cards the viewer cannot see get arbitrary copies from the rest of that
 * player's list — the coach's search re-deals all of them from the viewer's information set anyway.
 */
import { LocalEngine, createMatchState, createPlayerId, recomputeActiveEffects, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import { coachKey } from "@cpai/core/protocol";
import { decideBotCommand, ensureRegistry } from "../decide.ts";
import { actorOf, applyAction, legalActions, type Action } from "../ismcts/actions.ts";

export * from "./ctcg-sim-rules.ts";
import { simDecision, type SimCard, type SimPending, type SimSnapshot } from "./ctcg-sim-rules.ts";

// ---- conversion

export type SimConversion =
  /** only: the coach ranks just these moves (coachKey) — the site asks which of them, e.g. the attack's target. */
  | { ok: true; state: MatchState; viewer: PlayerId; simIdOf: Map<string, string>; only?: string[] }
  | { ok: false; reason: string };

const catalog = () => getCatalog();

/** The site's card id (`dexter_deshawn_one_last_chance`) → our slug. */
export function simSlug(id: string): string | undefined {
  const c = catalog();
  const direct = c.bySlug(id.replace(/_/g, "-"));
  if (direct) return direct.slug;
  const compact = id.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return c.cards.find((x) => x.slug.replace(/[^a-z0-9]/g, "") === compact)?.slug;
}

function deckFrom(sel: { deckLegendIds?: string[]; deckCardQuantities?: Record<string, number> } | undefined, id: string): Deck | null {
  if (!sel?.deckLegendIds?.length || !sel.deckCardQuantities) return null;
  const legends = sel.deckLegendIds.map(simSlug);
  if (legends.some((l) => !l)) return null;
  const main: Record<string, number> = {};
  for (const [k, n] of Object.entries(sel.deckCardQuantities)) {
    const slug = simSlug(k);
    if (!slug) return null;
    main[slug] = (main[slug] ?? 0) + n;
  }
  return { id, name: id, legends: legends as string[], main };
}

/** A fresh game with both lists, stopped at the first-player choice — made by p1 (you): the engine picks the chooser from the seed. */
function freshState(d1: Deck, d2: Deck, seed: string): LocalEngine {
  let engine: LocalEngine | null = null;
  for (let k = 0; k < 32; k++) {
    engine = new LocalEngine(
      createMatchState({
        players: [
          { id: createPlayerId("p1"), name: "p1" },
          { id: createPlayerId("p2"), name: "p2" },
        ],
        catalog: catalog().engineCatalog,
        deckLists: [toEngineDeckList(d1, "p1"), toEngineDeckList(d2, "p2")],
        seed: k ? `${seed}-${k}` : seed,
      }),
    );
    if ((actorOf(engine.getState())?.pid as string | undefined) === "p1") break;
  }
  return engine!;
}

const run = (engine: LocalEngine, pid: string, a: Action, n: number) =>
  engine.processCommand({ commandID: `conv-${n}`, move: a.move as never, input: a.args ? { args: a.args } : undefined }, pid as PlayerId).success;

/**
 * The opening-hand decision: first player as on the site, the rival's decision made if it came first,
 * your hand exactly as the site shows it (the rest of your list is the deck, in any order).
 */
function setupState(snap: SimSnapshot, d1: Deck, d2: Deck, me: string, rival: string, seed: string): SimConversion {
  const engine = freshState(d1, d2, seed);
  const viewer = createPlayerId("p1");
  const goFirst = snap.game?.firstPlayerId === me;
  const order = legalActions(engine.getState(), viewer).find((a) => a.move === "resolveFirstPlayer" && (a.args as { goFirst?: boolean } | undefined)?.goFirst === goFirst);
  if (!order || !run(engine, "p1", order, 0)) return { ok: false, reason: "Could not set up the game" };
  // The rival went first and has decided: keep (their hand is hidden either way).
  if (!goFirst) {
    const keep = legalActions(engine.getState(), createPlayerId("p2")).find((a) => a.move === "keepHand");
    if (!keep || !run(engine, "p2", keep, 1)) return { ok: false, reason: "Could not set up the game" };
  }
  const st = structuredClone(engine.getState());
  const ps = st.G.players.p1!;
  const mine = [...ps.zones.hand, ...ps.zones.deck] as string[];
  const hand: string[] = [];
  const simIdOf = new Map<string, string>();
  for (const c of snap.players?.[me]?.hand ?? []) {
    const slug = c.cardId ? simSlug(c.cardId) : undefined;
    const def = slug ? catalog().bySlug(slug) : undefined;
    const id = def ? mine.find((x) => !hand.includes(x) && st.G.cardIndex[x]!.definitionId === def.id) : undefined;
    if (!id) return { ok: false, reason: "Unknown card in your hand" };
    hand.push(id);
    if (c.id) simIdOf.set(id, c.id);
  }
  const deck = mine.filter((x) => !hand.includes(x));
  for (const id of hand) st.G.cardIndex[id]!.zone = "hand" as never;
  for (const id of deck) st.G.cardIndex[id]!.zone = "deck" as never;
  ps.zones.hand = hand as never;
  ps.zones.deck = deck as never;
  const turn = actorOf(st);
  if (!turn || (turn.pid as string) !== "p1") return { ok: false, reason: "Rival decides on the opening hand" };
  void rival;
  return { ok: true, state: st, viewer, simIdOf };
}

/**
 * A rival attack you answer (React Step): the rival's Main Phase is rebuilt with the attacker still ready,
 * the same attack is declared in our engine, and the rival's own steps run until it is your response.
 */
function defenseState(snap: SimSnapshot, pending: SimPending, rivalSim: string, seed: string): SimConversion | null {
  const ctx = pending.attackContext!;
  const rewound = structuredClone(snap);
  const attacker = rewound.players?.[rivalSim]?.field?.find((c) => c.id === ctx.attackerId);
  if (!attacker) return null;
  attacker.exhausted = false;
  if (attacker.effects) attacker.effects = attacker.effects.filter((e) => e !== "spent");
  rewound.controls = { pending: null, primaryActions: [] };
  const conv = convertSimSnapshot(rewound, seed, [], rivalSim);
  if (!conv.ok) return null;
  const engineOf = (sim: string | null | undefined) => (sim ? [...conv.simIdOf].find(([, x]) => x === sim)?.[0] : undefined);
  const attackerId = engineOf(ctx.attackerId);
  if (!attackerId) return null;
  const rivalPid = createPlayerId("p2");
  const targetId = engineOf(ctx.targetId);
  const declare = legalActions(conv.state, rivalPid).find((a) =>
    ctx.targetType === "player" || !targetId ? a.move === "attackRival" && mentions(a, attackerId) : a.move === "attackUnit" && mentions(a, attackerId) && mentions(a, targetId),
  );
  if (!declare) return null;
  let next = applyAction(conv.state, rivalPid, declare);
  for (let step = 0; next && step < 8; step++) {
    const turn = actorOf(next);
    if (!turn) return null;
    if (turn.pid === conv.viewer) return legalActions(next, conv.viewer).length > 1 ? { ok: true, state: next, viewer: conv.viewer, simIdOf: conv.simIdOf } : null;
    // The rival's own steps of the attack (its {Attack} effects): the first option (the site already went past them).
    const options = legalActions(next, turn.pid);
    if (!options.length) return null;
    next = applyAction(next, turn.pid, options[0]!);
  }
  return null;
}

/** Rival moves that would change the attack (a Blocker, a Quick card): never assumed. */
const PLAYS = new Set(["useBlocker", "playCard", "activateAbility", "callLegend", "sellCard", "goSolo"]);

/** Does this action name the engine card (in any argument)? */
const mentions = (a: Action, id: string) => JSON.stringify(a.args ?? {}).includes(`"${id}"`);

/**
 * A choice from a card effect: the site does not say how it was reached, so the move is replayed from
 * the last decision before it — the same card, played or used in our engine, must open a choice of
 * yours. Earlier snapshots are tried too (the site may send a few updates in between).
 */
function choiceState(pending: SimPending, previous: SimSnapshot[], seed: string): SimConversion | null {
  const source = pending.sourceCard?.id;
  if (!source) return null;
  // The site splits one of our moves in two (attack → its target, Gear → its host): rank those moves.
  const splitMove = /attack_target|equip|attach|host/i.test(pending.type ?? "");
  let fallback: SimConversion | null = null;
  for (const prev of previous) {
    const conv = convertSimSnapshot(prev, seed);
    if (!conv.ok) continue;
    const engineId = [...conv.simIdOf].find(([, sim]) => sim === source)?.[0];
    if (!engineId) continue;
    const candidates = legalActions(conv.state, conv.viewer).filter((x) => mentions(x, engineId));
    const asRoot = candidates.length > 1 ? { ...conv, only: candidates.map((a) => coachKey(a.move, a.args)) } : null;
    if (splitMove && asRoot) return asRoot;
    fallback ??= asRoot;
    for (const a of candidates) {
      let next = applyAction(conv.state, conv.viewer, a);
      // Up to the choice: your forced steps, and the rival letting an attack through (the site shows
      // your choice, so the attack went on — e.g. which Gig to steal).
      for (let step = 0; next && step < 8; step++) {
        const turn = actorOf(next);
        if (!turn) break;
        const options = legalActions(next, turn.pid);
        if (turn.pid === conv.viewer) {
          if (next.G.turnMetadata.pendingChoice && options.length > 1) return { ok: true, state: next, viewer: conv.viewer, simIdOf: conv.simIdOf };
          if (options.length !== 1 || !next.G.attackState) break;
          next = applyAction(next, turn.pid, options[0]!);
        } else {
          const pass = options.find((o) => o.move === "passPhase") ?? options.find((o) => o.move === "resolveAttack") ?? options.find((o) => !PLAYS.has(o.move));
          if (!pass || !next.G.attackState) break;
          next = applyAction(next, turn.pid, pass);
        }
      }
    }
  }
  return fallback;
}

/** Set a game up with both lists and play the setup with the greedy bot (any finished setup will do). */
function baseState(d1: Deck, d2: Deck, seed: string): MatchState | null {
  const p1 = createPlayerId("p1");
  const p2 = createPlayerId("p2");
  const engine = new LocalEngine(
    createMatchState({
      players: [
        { id: p1, name: "p1" },
        { id: p2, name: "p2" },
      ],
      catalog: catalog().engineCatalog,
      deckLists: [toEngineDeckList(d1, "p1"), toEngineDeckList(d2, "p2")],
      seed,
    }),
  );
  for (let i = 0; i < 60 && engine.getState().G.gamePhase === "setup"; i++) {
    const s = engine.getState();
    const t = actorOf(s);
    if (!t) return null;
    const d = decideBotCommand(s, t.pid, "greedy", `${seed}:setup:${i}`);
    if (!d || !engine.processCommand({ commandID: `setup-${i}`, move: d.move as never, input: d.args ? { args: d.args } : undefined }, t.pid).success) return null;
  }
  return engine.getState().G.gamePhase === "setup" ? null : structuredClone(engine.getState());
}

const defaultMeta = () => ({
  spent: false,
  faceDown: false,
  revealed: false,
  damage: 0,
  powerModifier: 0,
  powerMultiplier: 1,
  counters: {},
  attachedGearIds: [] as string[],
  attachedToId: null as string | null,
  hasLag: false,
  hasAttackedThisTurn: false,
  hasStolenGigThisTurn: false,
});

/**
 * Rebuild the viewer's decision point in our engine. Supported: the viewer's Main Phase (no choice or
 * attack in progress) and the Start Phase Gig roll. Anything else returns a reason instead.
 */
/**
 * Rebuild the viewer's decision point. `previous`: the viewer's last Main/Start Phase positions (a choice
 * is replayed from them). `activeSim` (internal): rebuild the rival's Main Phase instead (React Step).
 */
export function convertSimSnapshot(snap: SimSnapshot, seed = "ctcg-sim", previous: SimSnapshot[] = [], activeSim?: string): SimConversion {
  ensureRegistry();
  const me = snap.self?.playerId ?? undefined;
  const game = snap.game ?? {};
  const players = snap.players ?? {};
  const order = game.playerOrder?.length === 2 ? game.playerOrder : Object.keys(players);
  const rival = order.find((p) => p !== me);
  if (!me || !rival || !players[me] || !players[rival]) return { ok: false, reason: "No game in progress" };
  const decision: ReturnType<typeof simDecision> = activeSim ? { kind: "main" } : simDecision(snap);
  if (decision.kind === "wait") return { ok: false, reason: decision.reason };
  if (decision.kind === "choice") {
    const pending = (typeof snap.controls?.pending === "object" ? snap.controls.pending : null) ?? {};
    const attack = pending.attackContext;
    if (attack?.attackerId && attack.attackerPlayerId && attack.attackerPlayerId !== me)
      return defenseState(snap, pending, attack.attackerPlayerId, seed) ?? { ok: false, reason: `Your choice: ${decision.label}` };
    return choiceState(pending, previous, seed) ?? { ok: false, reason: `Your choice: ${decision.label}` };
  }

  const d1 = deckFrom(snap.room?.deckSelections?.[me], "you");
  const d2 = deckFrom(snap.room?.deckSelections?.[rival], "rival");
  if (!d1 || !d2) return { ok: false, reason: "Deck lists are not visible in this game" };
  if (decision.kind === "order") return { ok: true, state: structuredClone(freshState(d1, d2, seed).getState()), viewer: createPlayerId("p1"), simIdOf: new Map() };
  if (decision.kind === "mulligan") return setupState(snap, d1, d2, me, rival, seed);
  const phase = decision.kind;
  const activePid = activeSim && activeSim !== me ? "p2" : "p1";
  const s = baseState(d1, d2, seed);
  if (!s) return { ok: false, reason: "Could not set up the game" };

  const pidOf: Record<string, string> = { [me]: "p1", [rival]: "p2" };
  const simIdOf = new Map<string, string>();
  const engineCat = catalog().engineCatalog;
  const typeOf = (defId: string) => engineCat.get(defId)?.type;

  for (const [simPid, pid] of Object.entries(pidOf)) {
    const sp = players[simPid]!;
    const ps = s.G.players[pid]!;
    // Every card of this player, by definition (legends separately: they only ever sit in the Legend area or the field).
    const pools = new Map<string, string[]>();
    const legendPool: string[] = [];
    for (const card of Object.values(s.G.cardIndex)) {
      if ((card.ownerId as string) !== pid) continue;
      card.meta = defaultMeta() as never;
      card.controllerId = card.ownerId;
      if (typeOf(card.definitionId) === "legend") legendPool.push(card.instanceId as string);
      else {
        const list = pools.get(card.definitionId) ?? [];
        list.push(card.instanceId as string);
        pools.set(card.definitionId, list);
      }
    }
    const takeKnown = (c: SimCard): string | null => {
      const slug = c.cardId ? simSlug(c.cardId) : undefined;
      const def = slug ? catalog().bySlug(slug) : undefined;
      if (!def) return null;
      if (def.type === "legend") {
        const i = legendPool.findIndex((id) => s.G.cardIndex[id]!.definitionId === def.id);
        return i >= 0 ? legendPool.splice(i, 1)[0]! : null;
      }
      return pools.get(def.id)?.pop() ?? null;
    };
    const takeAny = (): string | null => {
      for (const list of pools.values()) if (list.length) return list.pop()!;
      return null;
    };
    const zones: Record<string, string[]> = { legendArea: [], hand: [], deck: [], eddieArea: [], field: [], trash: [], removedFromGame: [] };
    const place = (id: string | null, zone: string, c?: SimCard) => {
      if (!id) return null;
      const card = s.G.cardIndex[id]!;
      card.zone = zone as never;
      zones[zone]!.push(id);
      if (c?.id) simIdOf.set(id, c.id);
      return card;
    };

    // Field (Units, played Legends, Gear attached under them).
    for (const c of sp.field ?? []) {
      const card = place(takeKnown(c), "field", c);
      if (!card) continue;
      card.meta.spent = !!c.exhausted;
      // A Unit of yours that is ready but cannot attack was played this turn (Lag).
      // Lag: the site marks it (status "lag"); older snapshots: a ready Unit of yours that cannot attack.
      if (c.effects) card.meta.hasLag = c.effects.includes("lag");
      else if (pid === activePid && phase === "main" && !c.exhausted && c.canDeclareAttackThisTurn === false && c.type !== "Gear") card.meta.hasLag = true;
      for (const a of c.attachments ?? []) {
        const ac = typeof a === "string" ? { id: a } : a;
        const gear = place(takeKnown(ac), "field", ac);
        if (!gear) continue;
        gear.meta.attachedToId = card.instanceId as never;
        card.meta.attachedGearIds.push(gear.instanceId as never);
      }
    }
    // Legend area in slot order: known (face-up) ones first by identity, face-down ones from what is left.
    const legends = [...(sp.legends ?? [])].sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
    const legendIds = legends.map((c) => (c.cardId ? takeKnown(c) : null));
    legends.forEach((c, i) => {
      const id = legendIds[i] ?? legendPool.shift() ?? null;
      const card = place(id, "legendArea", c);
      if (!card) return;
      card.meta.faceDown = !!c.faceDown;
      card.meta.spent = !!c.exhausted;
    });
    for (const c of sp.trash ?? []) place(takeKnown(c), "trash", c);
    // Hand: yours by identity; the rival's only as a count.
    const hand = sp.hand ?? [];
    for (const c of hand) place(c.cardId ? takeKnown(c) : takeAny(), "hand", c);
    for (let i = hand.length; i < (sp.handCount ?? hand.length); i++) place(takeAny(), "hand");
    // Eddies: face-down cards (identity unknown unless shown).
    let ready = 0;
    let spent = 0;
    for (const c of sp.eddies ?? []) {
      const card = place(c.cardId && !c.faceDown ? takeKnown(c) : takeAny(), "eddieArea", c);
      if (!card) continue;
      card.meta.faceDown = c.faceDown !== false;
      card.meta.spent = !!c.exhausted;
      if (c.exhausted) spent++;
      else ready++;
    }
    // Deck: everything else (its order is unknown to the viewer anyway).
    for (const list of pools.values()) for (const id of list) place(id, "deck");
    for (const id of legendPool) place(id, "deck");

    ps.zones = zones as never;
    ps.eddieCardIds = [...zones.eddieArea!] as never;
    ps.eddies = ready;
    ps.spentEddies = spent;
    ps.soldThisTurn = pid === activePid ? !!sp.soldCardThisTurn : false;
    ps.calledLegendThisTurn = pid === activePid ? !!sp.calledLegendThisTurn : false;
    ps.calledLegendThisRivalTurn = false;
    ps.firstPlayer = game.firstPlayerId === simPid;
    ps.mulliganDone = true;
  }

  // Gig dice: back to their owners' Fixer areas, then the snapshot's Gigs (with values and stolen dice).
  const diceByOwner = new Map<string, string[]>();
  for (const die of Object.values(s.G.gigDice)) {
    die.location = "fixerArea";
    die.faceValue = 0;
    const list = diceByOwner.get(die.ownerId as string) ?? [];
    list.push(die.id as string);
    diceByOwner.set(die.ownerId as string, list);
  }
  for (const pid of ["p1", "p2"]) {
    s.G.players[pid]!.gigArea = [];
    s.G.players[pid]!.fixerArea = [...(diceByOwner.get(pid) ?? [])] as never;
  }
  for (const [simPid, pid] of Object.entries(pidOf)) {
    for (const d of players[simPid]!.gigDice ?? []) {
      const owner = pidOf[d.originalOwnerId ?? simPid] ?? pid;
      const type = (d.label ?? `d${d.sides ?? 0}`).toLowerCase();
      const fixer = s.G.players[owner]!.fixerArea as string[];
      const dieId = fixer.find((id) => (s.G.gigDice[id]!.dieType as string).toLowerCase() === type);
      if (!dieId) return { ok: false, reason: `Unknown Gig die ${type}` };
      fixer.splice(fixer.indexOf(dieId), 1);
      const die = s.G.gigDice[dieId]!;
      die.location = "gigArea";
      die.faceValue = d.value ?? 1;
      (s.G.players[pid]!.gigArea as string[]).push(dieId);
    }
  }

  // Turn.
  const viewer = createPlayerId("p1");
  const tm = s.G.turnMetadata;
  tm.activePlayerId = activePid as PlayerId;
  tm.turnNumber = game.turnNumber ?? tm.turnNumber;
  tm.overtimeActive = !!game.overtime;
  tm.gigTakenThisTurn = phase === "main";
  tm.playedCardTypesThisTurn = {};
  tm.pendingChoice = undefined;
  tm.abilityFiredThisTurn = [];
  tm.firstTimeEventsThisTurn = [];
  tm.triggerQueue = [];
  tm.currentTrigger = undefined;
  tm.suspendedEndTurn = undefined;
  s.G.overtime = !!game.overtime;
  s.G.gamePhase = phase;
  s.G.attackState = null;
  s.G.gameEnded = false;
  s.G.winnerId = null;
  s.G.winReason = null;
  s.G.effectBag = [];
  s.G.activeEffects = [];
  if (phase === "start") {
    // Start Phase: roll one of your Fixer dice (CR 8.6.5).
    // Only the dice the site lets you roll now (e.g. not the d20 early on).
    const rollable = new Set((players[me]!.dicePool ?? []).filter((d) => d.canRoll).map((d) => (d.label ?? `d${d.sides}`).toLowerCase()));
    const allowed = (s.G.players.p1!.fixerArea as string[]).filter((id) => !rollable.size || rollable.has((s.G.gigDice[id]!.dieType as string).toLowerCase()));
    if (!allowed.length) return { ok: false, reason: "No Fixer die to roll" };
    tm.pendingChoice = { type: "gainGig", chooserId: viewer, effectId: "start-phase", payload: { allowedDieIds: [...allowed] } } as never;
  }
  recomputeActiveEffects(s);
  if (!legalActions(s, activePid as PlayerId).length) return { ok: false, reason: "No move found" };
  return { ok: true, state: s, viewer, simIdOf };
}
