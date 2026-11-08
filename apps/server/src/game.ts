import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LocalEngine,
  buildDecisionContext,
  createMatchState,
  defaultChoiceResolvers,
  createPlayerId,
  enumerateCandidateActions,
  enumerateChoiceActions,
  formatActionLog,
  stripPrivateFields,
  type GameEvent,
  type PlayerId,
} from "@tcg/cyberpunk-engine";
import { KnowledgeTracker, STRATEGIES, decideBotCommand, expandAtomicGigAdjust, publicWinChance } from "@cpai/ai";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import type { GameStateMessage, Intent, LogLine, MatchView, ServerMessage, UiAction } from "@cpai/core/protocol";
import { botPool } from "./bot-pool.ts";
import { LOG_MESSAGES, buildNameIndex, labelAction } from "./labels.ts";
import { GAMES_DIR } from "./paths.ts";

export type SeatId = "p1" | "p2";
const SEATS: SeatId[] = ["p1", "p2"];
const other = (s: SeatId): SeatId => (s === "p1" ? "p2" : "p1");
const pid = (s: SeatId) => createPlayerId(s);
const secret = () => randomBytes(18).toString("base64url");

export interface SeatInfo {
  kind: "human" | "bot";
  name: string;
  /** Secret that lets a browser act for this seat (never sent to the other seat). */
  token: string;
  deck: Deck | null;
  /** Bot seats: STRATEGIES id. */
  strategy?: string;
}

type Listener = (msg: ServerMessage) => void;

interface RecordedCommand {
  seat: SeatId;
  move: string;
  args?: Record<string, unknown>;
  turn: number;
  ms?: number;
}

interface RawLog {
  seq: number;
  turn: number;
  seat: SeatId | "system";
  text: string;
  cards: LogLine["cards"];
  key?: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One table. Two seats, each a human (identified by a secret token) or a bot. Every human sees the
 * game only through their own seat's filtered view. A friend room waits for the second human (invite
 * code) before the match state is created.
 */
export class GameSession {
  readonly id = randomUUID().slice(0, 8);
  readonly createdAt = new Date().toISOString();
  readonly seed: string;
  readonly mode: "bot" | "friend";
  readonly seats: Record<SeatId, SeatInfo>;
  /** Friend rooms: code in the invite link, valid until the second player joins. */
  readonly invite: string | null;
  private engine: LocalEngine | null = null;
  private listeners = new Map<Listener, SeatId>();
  private log: RawLog[] = [];
  private logSeq = 0;
  private commands: RecordedCommand[] = [];
  private actions: Record<SeatId, UiAction[]> = { p1: [], p2: [] };
  private lastMove: { seat: SeatId; cardIds: string[] } | null = null;
  private botThinking = false;
  private pumping = false;
  /** What the bot's seat has been shown so far (the only hidden-card knowledge fair bots get). */
  private botKnowledge: KnowledgeTracker | null = null;
  private botInfo: GameStateMessage["botInfo"] = null;
  botDelayMs = 700;
  lastActivity = Date.now();

  private constructor(opts: { mode: "bot" | "friend"; seats: Record<SeatId, SeatInfo>; seed?: string; invite?: string }) {
    this.mode = opts.mode;
    this.seats = opts.seats;
    this.seed = opts.seed ?? randomUUID();
    this.invite = opts.invite ?? null;
    if (this.seats.p1.deck && this.seats.p2.deck) this.start();
  }

  /** You (p1) against a bot (p2). */
  static vsBot(yourDeck: Deck, botDeck: Deck, strategy: string, seed?: string, yourName = "You"): GameSession {
    if (!STRATEGIES[strategy]) throw new Error(`Unknown bot: ${strategy}`);
    return new GameSession({
      mode: "bot",
      seed,
      seats: {
        p1: { kind: "human", name: yourName, token: secret(), deck: yourDeck },
        p2: { kind: "bot", name: STRATEGIES[strategy]!.label, token: secret(), deck: botDeck, strategy },
      },
    });
  }

  /** A room for two humans; the host sits in p1, the invited friend joins as p2. */
  static friendRoom(hostDeck: Deck, hostName: string): GameSession {
    return new GameSession({
      mode: "friend",
      invite: secret().slice(0, 10),
      seats: {
        p1: { kind: "human", name: hostName, token: secret(), deck: hostDeck },
        p2: { kind: "human", name: "", token: secret(), deck: null },
      },
    });
  }

  get started(): boolean {
    return this.engine !== null;
  }

  seatForToken(token: string | null | undefined): SeatId | null {
    if (!token) return null;
    return SEATS.find((s) => this.seats[s].kind === "human" && this.seats[s].token === token) ?? null;
  }

  /** The invited friend takes p2 with their deck; the game starts. Returns p2's token. */
  join(invite: string, deck: Deck, name: string): string {
    if (this.mode !== "friend" || !this.invite || invite !== this.invite) throw new Error("This invite link is not valid.");
    if (this.started) throw new Error("This game has already started.");
    this.seats.p2.deck = deck;
    this.seats.p2.name = name.trim().slice(0, 24) || "Player 2";
    this.start();
    this.broadcast();
    return this.seats.p2.token;
  }

  private start() {
    const catalog = getCatalog();
    const p1 = this.seats.p1;
    const p2 = this.seats.p2;
    const state = createMatchState({
      players: [
        { id: pid("p1"), name: p1.name },
        { id: pid("p2"), name: p2.name },
      ],
      catalog: catalog.engineCatalog,
      deckLists: [toEngineDeckList(p1.deck!, "p1", p1.name), toEngineDeckList(p2.deck!, "p2", p2.name)],
      seed: this.seed,
      matchId: this.id,
    });
    this.engine = new LocalEngine(state);
    const bot = this.botSeat();
    if (bot) {
      this.botKnowledge = new KnowledgeTracker(pid(bot));
      this.botKnowledge.observe(this.engine.getState());
    }
    this.pushSystem(`${p1.deck!.name} vs ${p2.deck!.name}`);
    this.refreshActions();
    void this.pump();
  }

  private botSeat(): SeatId | null {
    return SEATS.find((s) => this.seats[s].kind === "bot") ?? null;
  }

  // ---------------------------------------------------------------- subscriptions
  subscribe(seat: SeatId, fn: Listener): () => void {
    this.listeners.set(fn, seat);
    fn(this.snapshotFor(seat));
    return () => this.listeners.delete(fn);
  }

  private broadcast() {
    for (const [fn, seat] of this.listeners) fn(this.snapshotFor(seat));
  }

  private notify(seat: SeatId, msg: ServerMessage) {
    for (const [fn, s] of this.listeners) if (s === seat) fn(msg);
  }

  // ---------------------------------------------------------------- view
  private view(seat: SeatId): MatchView {
    return this.engine!.getFilteredView(pid(seat)) as unknown as MatchView;
  }

  private snapshotFor(seat: SeatId): ServerMessage {
    if (!this.engine) {
      return { type: "waiting", gameId: this.id, you: seat, hostName: this.seats.p1.name, hostDeck: this.seats.p1.deck?.name ?? "" };
    }
    return this.snapshot(seat);
  }

  snapshot(seat: SeatId): GameStateMessage {
    const rival = other(seat);
    const view = this.view(seat);
    const prompt = this.engine!.getPrompt(pid(seat));
    const result = view.gameEnded
      ? { winner: (view.winnerId === seat ? "you" : view.winnerId === rival ? "rival" : "draw") as "you" | "rival" | "draw", reason: view.winReason }
      : null;
    const rivalSeat = this.seats[rival];
    return {
      type: "state",
      gameId: this.id,
      mode: this.mode,
      you: seat,
      rival,
      yourName: this.seats[seat].name,
      rivalLabel: rivalSeat.name,
      yourDeck: this.seats[seat].deck!.name,
      rivalDeck: rivalSeat.deck!.name,
      view,
      promptStatus: prompt.status,
      choice: prompt.choice && prompt.choice.chooserId === seat ? (prompt.choice as never) : null,
      actions: this.actions[seat],
      log: this.log.map((l) => ({ seq: l.seq, turn: l.turn, actor: l.seat === "system" ? "system" : l.seat === seat ? "you" : "rival", text: l.text, cards: l.cards, key: l.key })),
      rivalThinking: this.botThinking && rivalSeat.kind === "bot",
      rivalLastCardIds: this.lastMove && this.lastMove.seat === rival ? this.lastMove.cardIds : [],
      botInfo: rivalSeat.kind === "bot" ? this.botInfo : null,
      winChance: view.gamePhase === "setup" ? null : publicWinChance(view as never, seat),
      result,
    };
  }

  private refreshActions() {
    for (const seat of SEATS) this.actions[seat] = this.seats[seat].kind === "human" ? this.computeActions(seat) : [];
  }

  private computeActions(seat: SeatId): UiAction[] {
    const engine = this.engine!;
    const view = this.view(seat);
    const prompt = engine.getPrompt(pid(seat));
    const idx = buildNameIndex(view);
    const decisions: { move: string; args?: Record<string, unknown> }[] = [];
    let autoChoice: { move: string; args?: Record<string, unknown> } | undefined;
    if (prompt.choice && prompt.choice.chooserId === seat) {
      const enumerated = [...expandAtomicGigAdjust(prompt.choice as never, view), ...enumerateChoiceActions(prompt.choice)];
      decisions.push(...enumerated);
      if (enumerated.length === 0) {
        // e.g. scry: the UI offers a custom picker, this is the never-stuck fallback.
        const resolver = defaultChoiceResolvers[prompt.choice.type] as (c: unknown, ctx: unknown) => { kind: string; move?: string; args?: Record<string, unknown> };
        const d = resolver(prompt.choice, buildDecisionContext(engine, pid(seat), Math.random));
        if (d.kind === "command" && d.move) autoChoice = { move: d.move, args: d.args };
      }
    }
    if (prompt.status === "action" || prompt.status === "choice") {
      for (const d of enumerateCandidateActions(prompt)) {
        if (d.move === "setCombatPriority" || d.move === "concede") continue;
        if (prompt.choice && d.move.startsWith("resolve") && d.move !== "resolveAttack") continue;
        decisions.push(d);
      }
    }
    const seen = new Set<string>();
    const sid = view.stateID;
    const out: UiAction[] = [];
    for (const d of decisions) {
      const key = JSON.stringify([d.move, d.args ?? {}]);
      if (seen.has(key)) continue;
      seen.add(key);
      // Offer only what the engine really accepts (enumeration can over-approximate, e.g. the d20 rule).
      if (!this.accepts(seat, d.move, d.args)) continue;
      const l = labelAction(d.move, d.args, idx, view);
      out.push({ id: `${seat}.${sid}.${out.length}`, move: d.move, args: d.args, ...l });
    }
    if (autoChoice) out.push({ id: `${seat}.${sid}.${out.length}`, move: autoChoice.move, args: autoChoice.args, label: "Resolve", group: "choice" });
    return out;
  }

  /** Dry-run a command on a throwaway copy of the engine. */
  private accepts(seat: SeatId, move: string, args: Record<string, unknown> | undefined): boolean {
    if (move === "passPhase" || move === "concede") return true;
    const r = this.engine!.fork().processCommand({ commandID: "probe", move: move as never, input: args ? { args } : undefined } as never, pid(seat));
    return r.success;
  }

  // ---------------------------------------------------------------- log
  private pushSystem(text: string) {
    this.log.push({ seq: ++this.logSeq, turn: this.engine ? this.view("p1").turnNumber : 0, seat: "system", text, cards: [] });
  }

  private appendEvents(events: GameEvent[]) {
    // Log lines are written from p1's public perspective with private fields stripped for both seats.
    const view = this.view("p1");
    const idx = buildNameIndex(view);
    for (const raw of events) {
      if ((raw as { type?: string }).type !== "actionLog") continue;
      const evAll = raw as Extract<GameEvent, { type: "actionLog" }>;
      const ev = stripPrivateFields(stripPrivateFields(evAll, pid("p1")), pid("p2")) as Extract<GameEvent, { type: "actionLog" }>;
      const key = ev.messageKey as string;
      const seat: RawLog["seat"] = key.startsWith("game.") || key === "move.turnEnded" ? "system" : (ev.playerId as SeatId);
      const cards = (ev.cardIds ?? [])
        .map((id) => idx.card(id))
        .filter((c): c is NonNullable<typeof c> => !!c && !!c.cardName && !!c.definitionId && c.zone !== "hand")
        .map((c) => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
      const text = formatActionLog(ev, LOG_MESSAGES);
      this.log.push({ seq: ++this.logSeq, turn: view.turnNumber, seat, text, cards, key });
    }
    if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
  }

  // ---------------------------------------------------------------- commands
  private apply(seat: SeatId, move: string, args: Record<string, unknown> | undefined, ms?: number) {
    const engine = this.engine!;
    const turnBefore = this.view("p1").turnNumber;
    const result = engine.processCommand({ commandID: `${seat}-${this.commands.length}`, move: move as never, input: args ? { args } : undefined } as never, pid(seat));
    if (!result.success) return result;
    this.commands.push({ seat, move, args, turn: turnBefore, ms });
    this.botKnowledge?.observe(engine.getState());
    this.appendEvents(result.gameEvents);
    this.lastActivity = Date.now();
    const a = args ?? {};
    this.lastMove = {
      seat,
      cardIds: ["cardId", "attackerId", "defenderId", "legendId", "attachToId", "blockerId"].map((k) => a[k]).filter((v): v is string => typeof v === "string"),
    };
    const view = this.view("p1");
    if (view.turnNumber !== turnBefore || view.gameEnded) this.save();
    return result;
  }

  handleAction(seat: SeatId, actionId: string, stateID: number) {
    const a = this.actions[seat].find((x) => x.id === actionId);
    if (!a) {
      this.broadcast();
      return this.notify(seat, { type: "error", message: "The game state changed. Try again." });
    }
    this.handleCommand(seat, a.move, a.args, stateID);
  }

  /**
   * A table gesture (drag & drop, click). Map it to the legal command it means; when several fit
   * (two abilities, several targets) let the player pick; when none does, report the engine's reason.
   */
  handleIntent(seat: SeatId, intent: Intent, stateID: number) {
    if (!this.engine) return;
    if (stateID !== this.view(seat).stateID) {
      this.broadcast();
      return this.notify(seat, { type: "error", message: "The game state changed. Try again." });
    }
    const actions = this.actions[seat];
    const arg = (a: UiAction, k: string) => (a.args ?? {})[k];
    const has = (a: UiAction, k: string, id: string) => {
      const v = arg(a, k);
      return v === id || (Array.isArray(v) && v.includes(id));
    };
    let matches: UiAction[];
    let probe: { move: string; args?: Record<string, unknown> } | null = null;
    switch (intent.kind) {
      case "play":
        matches = actions.filter(
          (a) => (a.move === "playCard" || a.move === "resolveCardToPlay") && arg(a, "cardId") === intent.cardId && (intent.targetId ? arg(a, "attachToId") === intent.targetId : true),
        );
        probe = { move: "playCard", args: { cardId: intent.cardId, ...(intent.targetId ? { attachToId: intent.targetId } : {}) } };
        break;
      case "sell":
        matches = actions.filter((a) => a.move === "sellCard" && arg(a, "cardId") === intent.cardId);
        probe = { move: "sellCard", args: { cardId: intent.cardId } };
        break;
      case "call":
        matches = actions.filter((a) => a.move === "callLegend" && arg(a, "legendId") === intent.cardId);
        probe = { move: "callLegend", args: { legendId: intent.cardId } };
        break;
      case "attack":
        matches =
          intent.targetId === "rival"
            ? actions.filter((a) => a.move === "attackRival" && arg(a, "attackerId") === intent.cardId)
            : actions.filter((a) => a.move === "attackUnit" && arg(a, "attackerId") === intent.cardId && arg(a, "defenderId") === intent.targetId);
        probe = intent.targetId === "rival" ? { move: "attackRival", args: { attackerId: intent.cardId } } : { move: "attackUnit", args: { attackerId: intent.cardId, defenderId: intent.targetId } };
        break;
      case "block":
        matches = actions.filter((a) => a.move === "useBlocker" && arg(a, "blockerId") === intent.cardId);
        probe = { move: "useBlocker", args: { blockerId: intent.cardId } };
        break;
      case "activate":
        matches = actions.filter((a) => a.move === "activateAbility" && arg(a, "cardId") === intent.cardId);
        probe = { move: "activateAbility", args: { cardId: intent.cardId, abilityIndex: 0 } };
        break;
      case "goSolo":
        matches = actions.filter((a) => a.move === "goSolo" && arg(a, "cardId") === intent.cardId);
        probe = { move: "goSolo", args: { cardId: intent.cardId } };
        break;
      case "pass":
        // Main Phase: pass the turn. React Step: no reaction (the engine's resolveAttack pass).
        matches = actions.filter((a) => a.move === "passPhase");
        if (!matches.length) matches = actions.filter((a) => a.move === "resolveAttack" && arg(a, "pass") === true);
        break;
      case "select": {
        const keys = ["cardId", "dieId", "targetIds", "cardIds", "dieIds", "legendId", "blockerId"];
        matches = actions.filter((a) => (a.group === "choice" || a.move === "gainGig") && keys.some((k) => has(a, k, intent.id)));
        break;
      }
    }
    if (matches.length === 1) return this.handleCommand(seat, matches[0]!.move, matches[0]!.args, stateID);
    if (matches.length > 1) return this.notify(seat, { type: "options", title: matches[0]!.label.split(":")[0]!, options: matches.map((a) => ({ id: a.id, label: a.label })) });
    if (this.engine.getPrompt(pid(seat)).status === "waiting") return this.notify(seat, { type: "error", message: "It is not your turn." });
    let reason = "Not allowed now.";
    if (probe) {
      const r = this.engine.fork().processCommand({ commandID: "probe", move: probe.move as never, input: probe.args ? { args: probe.args } : undefined } as never, pid(seat));
      if (!r.success) reason = (r as { error?: string }).error ?? reason;
    }
    this.notify(seat, { type: "error", message: reason });
  }

  handleCommand(seat: SeatId, move: string, args: Record<string, unknown> | undefined, stateID: number) {
    if (!this.engine) return;
    if (this.engine.getPrompt(pid(seat)).status === "waiting") return this.notify(seat, { type: "error", message: "It is not your turn." });
    if (stateID !== this.view(seat).stateID) {
      this.broadcast();
      return this.notify(seat, { type: "error", message: "The game state changed. Try again." });
    }
    const result = this.apply(seat, move, args);
    if (!result.success) return this.notify(seat, { type: "error", message: (result as { error?: string }).error ?? "Not allowed now." });
    this.refreshActions();
    this.broadcast();
    void this.pump();
  }

  concede(seat: SeatId) {
    if (!this.engine) return;
    const r = this.apply(seat, "concede", {});
    if (!r.success) this.notify(seat, { type: "error", message: (r as { error?: string }).error ?? "Cannot concede now." });
    this.refreshActions();
    this.broadcast();
  }

  // ---------------------------------------------------------------- bot loop
  private botHasPriority(bot: SeatId): boolean {
    if (this.engine!.getState().G.gameEnded) return false;
    const st = this.engine!.getPrompt(pid(bot)).status;
    return st === "action" || st === "choice";
  }

  private async pump() {
    const bot = this.botSeat();
    if (!bot || !this.engine || this.pumping) return;
    const strategy = this.seats[bot].strategy!;
    this.pumping = true;
    try {
      let guard = 0;
      while (this.botHasPriority(bot) && guard++ < 500) {
        this.botThinking = true;
        this.broadcast();
        const started = Date.now();
        const seed = `${this.seed}:${this.commands.length}`;
        let decision = await botPool.decide(this.engine.getState(), bot, strategy, seed, this.botKnowledge?.ids() ?? []).catch((err: Error) => {
          console.error("[bot] worker error:", err.message);
          return null;
        });
        if (!decision) decision = decideBotCommand(this.engine.getState(), bot, "greedy", seed);
        if (!decision) {
          this.pushSystem("Bot error: no legal move found.");
          break;
        }
        if (decision.info) this.botInfo = { iterations: decision.info.iterations, winRate: decision.info.winRate, ms: Math.round(decision.ms) };
        const wait = this.botDelayMs - (Date.now() - started);
        if (wait > 0) await delay(wait);
        let res = this.apply(bot, decision.move, decision.args, decision.ms);
        // ISMCTS ranks several moves; if the engine rejects the best one, try the next.
        for (const alt of decision.alternatives ?? []) {
          if (res.success) break;
          res = this.apply(bot, alt.move, alt.args, decision.ms);
        }
        if (!res.success) {
          console.error("[bot] rejected", decision, (res as { error?: string }).error);
          const fallback = decideBotCommand(this.engine.getState(), bot, "greedy", seed + ":fb");
          if (!fallback || !this.apply(bot, fallback.move, fallback.args).success) {
            this.pushSystem("Bot error: illegal move, game paused.");
            break;
          }
        }
        this.refreshActions();
      }
    } finally {
      this.botThinking = false;
      this.pumping = false;
      this.refreshActions();
      this.broadcast();
    }
  }

  // ---------------------------------------------------------------- persistence
  private save() {
    const s = this.engine!.getState();
    const record = {
      schema: "cpai.game.v1",
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      seed: this.seed,
      mode: this.mode,
      bot: this.seats.p2.strategy ?? null,
      seats: { p1: this.seats.p1.kind, p2: this.seats.p2.kind },
      names: { p1: this.seats.p1.name, p2: this.seats.p2.name },
      decks: { p1: this.seats.p1.deck, p2: this.seats.p2.deck },
      turns: s.G.turnMetadata.turnNumber,
      result: s.G.gameEnded ? { winner: s.G.winnerId, reason: s.G.winReason } : null,
      commands: this.commands,
    };
    try {
      writeFileSync(join(GAMES_DIR, `${this.createdAt.slice(0, 10)}_${this.id}.json`), JSON.stringify(record));
    } catch (err) {
      console.error("[game] save failed", err);
    }
  }

  dispose() {
    this.listeners.clear();
  }
}

export const games = new Map<string, GameSession>();

/** Drop games nobody touched for 6 hours. */
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [id, g] of games) if (g.lastActivity < cutoff) (g.dispose(), games.delete(id));
}, 600_000).unref();
