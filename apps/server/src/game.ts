import { randomUUID } from "node:crypto";
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
import { STRATEGIES, decideBotCommand } from "@cpai/ai";
import { getCatalog, toEngineDeckList, type Deck } from "@cpai/core";
import type { GameStateMessage, LogLine, MatchView, ServerMessage, UiAction } from "@cpai/core/protocol";
import { BotWorker } from "./bot-pool.ts";
import { LOG_MESSAGES, LOG_MESSAGES_EN, buildNameIndex, labelAction } from "./labels.ts";
import { GAMES_DIR } from "./paths.ts";

const HUMAN = createPlayerId("p1");

interface AtomicGigChoice {
  type: string;
  payload: {
    type?: string;
    targetKind?: string;
    eligibleIds?: string[];
    adjustGig?: { direction?: string; maxAmount?: number; chooseUpTo?: boolean };
    min?: number;
    canDecline?: boolean;
  };
}

/**
 * "Adjust a Gig by up to N" effects must be answered with die + value in one command (resolveAdjustGig).
 * The bots' enumeration only knows the two-step form, so expand every (die, value) pair here.
 */
function expandAtomicGigAdjust(choice: AtomicGigChoice, view: MatchView): { move: string; args?: Record<string, unknown> }[] {
  const p = choice.payload;
  if (choice.type !== "chooseTarget" || p.targetKind !== "gig" || !p.adjustGig) return [];
  const dice = new Map<string, { value: number; max: number }>();
  for (const pl of Object.values(view.players)) {
    const area = pl.zones.gigArea;
    if (Array.isArray(area)) for (const d of area) dice.set(d.instanceId, { value: d.power, max: Number(String(d.definitionId).replace(/\D/g, "")) || 20 });
  }
  const amount = p.adjustGig.maxAmount ?? 1;
  const dir = p.adjustGig.direction ?? "either";
  const out: { move: string; args?: Record<string, unknown> }[] = [];
  for (const dieId of p.eligibleIds ?? []) {
    const die = dice.get(dieId);
    if (!die) continue;
    for (let v = Math.max(1, die.value - amount); v <= Math.min(die.max, die.value + amount); v++) {
      if (v === die.value) continue;
      if (dir === "increase" && v < die.value) continue;
      if (dir === "decrease" && v > die.value) continue;
      out.push({ move: "resolveAdjustGig", args: { kind: "adjust", dieId, value: v } });
    }
  }
  if (p.adjustGig.chooseUpTo || p.canDecline || (p.min ?? 1) === 0) out.push({ move: "resolveAdjustGig", args: { kind: "noAdjustment" } });
  return out;
}
const BOT = createPlayerId("p2");

type Listener = (msg: ServerMessage) => void;

interface RecordedCommand {
  seat: "p1" | "p2";
  move: string;
  args?: Record<string, unknown>;
  turn: number;
  ms?: number;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GameSession {
  readonly id = randomUUID().slice(0, 8);
  readonly createdAt = new Date().toISOString();
  readonly seed: string;
  private engine: LocalEngine;
  private listeners = new Set<Listener>();
  private log: LogLine[] = [];
  private logSeq = 0;
  private commands: RecordedCommand[] = [];
  private actions: UiAction[] = [];
  private botThinking = false;
  private botLastCardIds: string[] = [];
  private pumping = false;
  private worker = new BotWorker();
  botDelayMs = 700;
  lastActivity = Date.now();

  constructor(
    readonly yourDeck: Deck,
    readonly botDeck: Deck,
    readonly botStrategy: string,
    seed?: string,
  ) {
    if (!STRATEGIES[botStrategy]) throw new Error(`Nieznany bot: ${botStrategy}`);
    this.seed = seed ?? randomUUID();
    const catalog = getCatalog();
    const state = createMatchState({
      players: [
        { id: HUMAN, name: "Ty" },
        { id: BOT, name: "Bot" },
      ],
      catalog: catalog.engineCatalog,
      deckLists: [toEngineDeckList(yourDeck, "p1", "Ty"), toEngineDeckList(botDeck, "p2", "Bot")],
      seed: this.seed,
      matchId: this.id,
    });
    this.engine = new LocalEngine(state);
    this.pushSystem(`Nowa partia: ${yourDeck.name} (Ty) vs ${botDeck.name} (bot: ${STRATEGIES[botStrategy]!.label}).`);
    this.refreshActions();
    void this.pump();
  }

  // ---------------------------------------------------------------- subscriptions
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private broadcast() {
    const msg = this.snapshot();
    for (const fn of this.listeners) fn(msg);
  }

  private notify(msg: ServerMessage) {
    for (const fn of this.listeners) fn(msg);
  }

  // ---------------------------------------------------------------- view
  private view(): MatchView {
    return this.engine.getFilteredView(HUMAN) as unknown as MatchView;
  }

  snapshot(): GameStateMessage {
    const view = this.view();
    const prompt = this.engine.getPrompt(HUMAN);
    const result = view.gameEnded
      ? { winner: (view.winnerId === HUMAN ? "you" : view.winnerId === BOT ? "bot" : "draw") as "you" | "bot" | "draw", reason: view.winReason }
      : null;
    return {
      type: "state",
      gameId: this.id,
      you: "p1",
      bot: "p2",
      botLabel: STRATEGIES[this.botStrategy]!.label,
      yourDeck: this.yourDeck.name,
      botDeck: this.botDeck.name,
      view,
      promptStatus: prompt.status,
      choice: prompt.choice && prompt.choice.chooserId === HUMAN ? (prompt.choice as never) : null,
      actions: this.actions,
      log: this.log,
      botThinking: this.botThinking,
      botLastCardIds: this.botLastCardIds,
      result,
    };
  }

  private refreshActions() {
    const view = this.view();
    const prompt = this.engine.getPrompt(HUMAN);
    const idx = buildNameIndex(view);
    const decisions: { move: string; args?: Record<string, unknown> }[] = [];
    let autoChoice: { move: string; args?: Record<string, unknown> } | undefined;
    if (prompt.choice && prompt.choice.chooserId === HUMAN) {
      const enumerated = [...expandAtomicGigAdjust(prompt.choice as never, view), ...enumerateChoiceActions(prompt.choice)];
      decisions.push(...enumerated);
      if (enumerated.length === 0) {
        // e.g. scry: the UI offers a custom picker, this is the never-stuck fallback.
        const resolver = defaultChoiceResolvers[prompt.choice.type] as (c: unknown, ctx: unknown) => { kind: string; move?: string; args?: Record<string, unknown> };
        const d = resolver(prompt.choice, buildDecisionContext(this.engine, HUMAN, Math.random));
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
    this.actions = [];
    for (const d of decisions) {
      const key = JSON.stringify([d.move, d.args ?? {}]);
      if (seen.has(key)) continue;
      seen.add(key);
      // Offer only what the engine really accepts (enumeration can over-approximate, e.g. the d20 rule).
      if (!this.accepts(d.move, d.args)) continue;
      const l = labelAction(d.move, d.args, idx, view);
      this.actions.push({ id: `${sid}.${this.actions.length}`, move: d.move, args: d.args, ...l });
    }
    if (autoChoice) {
      this.actions.push({ id: `${sid}.${this.actions.length}`, move: autoChoice.move, args: autoChoice.args, label: "Rozpatrz automatycznie (domyślny wybór)", group: "choice" });
    }
  }

  /** Dry-run a human command on a throwaway copy of the engine. */
  private accepts(move: string, args: Record<string, unknown> | undefined): boolean {
    if (move === "passPhase" || move === "concede") return true;
    const probe = this.engine.fork();
    const r = probe.processCommand({ commandID: "probe", move: move as never, input: args ? { args } : undefined } as never, HUMAN);
    return r.success;
  }

  // ---------------------------------------------------------------- log
  private pushSystem(text: string) {
    this.log.push({ seq: ++this.logSeq, turn: this.view().turnNumber ?? 0, actor: "system", text, cards: [] });
  }

  private appendEvents(events: GameEvent[]) {
    const view = this.view();
    const idx = buildNameIndex(view);
    for (const raw of events) {
      if ((raw as { type?: string }).type !== "actionLog") continue;
      const ev = stripPrivateFields(raw, HUMAN) as Extract<GameEvent, { type: "actionLog" }>;
      const key = ev.messageKey as string;
      const actor: LogLine["actor"] = key.startsWith("game.") || key === "move.turnEnded" ? "system" : ev.playerId === HUMAN ? "you" : "bot";
      const cards = (ev.cardIds ?? [])
        .map((id) => idx.card(id))
        .filter((c): c is NonNullable<typeof c> => !!c && !!c.cardName && !!c.definitionId)
        .map((c) => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
      if (key === "setup.firstPlayerChoice") {
        const order = String((ev.params as Record<string, unknown>).order ?? "");
        (ev.params as Record<string, unknown>).order = order === "first" ? "pierwszy" : order === "second" ? "drugi" : order;
      }
      // Use the Polish template only when every placeholder it needs is present in this event.
      const tpl = LOG_MESSAGES[key as keyof typeof LOG_MESSAGES] ?? "";
      const params = ev.params as Record<string, unknown>;
      const complete = [...tpl.matchAll(/\{(\w+)\}/g)].every((m) => m[1] === "playerId" || params[m[1]!] !== undefined);
      const text = formatActionLog(ev, complete ? LOG_MESSAGES : LOG_MESSAGES_EN);
      this.log.push({ seq: ++this.logSeq, turn: view.turnNumber, actor, text, cards });
    }
    if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
  }

  // ---------------------------------------------------------------- commands
  private apply(seat: PlayerId, move: string, args: Record<string, unknown> | undefined, ms?: number) {
    const turnBefore = this.view().turnNumber;
    const result = this.engine.processCommand(
      { commandID: `${seat}-${this.commands.length}`, move: move as never, input: args ? { args } : undefined } as never,
      seat,
    );
    if (!result.success) return result;
    this.commands.push({ seat: seat as "p1" | "p2", move, args, turn: turnBefore, ms });
    this.appendEvents(result.gameEvents);
    this.lastActivity = Date.now();
    const view = this.view();
    if (view.turnNumber !== turnBefore || view.gameEnded) this.save();
    if (view.gameEnded) {
      const who = view.winnerId === HUMAN ? "Wygrywasz!" : view.winnerId === BOT ? "Wygrywa bot." : "Remis.";
      this.pushSystem(`Koniec gry — ${who} (${view.winReason ?? "?"})`);
    }
    return result;
  }

  handleAction(actionId: string, stateID: number) {
    const a = this.actions.find((x) => x.id === actionId);
    if (!a) {
      this.broadcast();
      return this.notify({ type: "error", message: "Ta akcja jest już nieaktualna — wybierz ponownie." });
    }
    this.handleCommand(a.move, a.args, stateID);
  }

  handleCommand(move: string, args: Record<string, unknown> | undefined, stateID: number) {
    if (this.pumping && this.engine.getPrompt(HUMAN).status === "waiting") {
      return this.notify({ type: "error", message: "Poczekaj — teraz ruch bota." });
    }
    if (stateID !== this.view().stateID) {
      this.broadcast();
      return this.notify({ type: "error", message: "Stan gry się zmienił — wybierz akcję jeszcze raz." });
    }
    const result = this.apply(HUMAN, move, args);
    if (!result.success) {
      this.notify({ type: "error", message: `Ruch odrzucony przez silnik: ${(result as { error?: string }).error ?? "?"}` });
      return;
    }
    this.botLastCardIds = [];
    this.refreshActions();
    this.broadcast();
    void this.pump();
  }

  concede() {
    this.apply(HUMAN, "concede", undefined);
    this.refreshActions();
    this.broadcast();
  }

  // ---------------------------------------------------------------- bot loop
  private botHasPriority(): boolean {
    if (this.view().gameEnded) return false;
    const st = this.engine.getPrompt(BOT).status;
    return st === "action" || st === "choice";
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      let guard = 0;
      while (this.botHasPriority() && guard++ < 500) {
        this.botThinking = true;
        this.broadcast();
        const started = Date.now();
        const seed = `${this.seed}:${this.commands.length}`;
        let decision = await this.worker
          .decide(this.engine.getState(), BOT, this.botStrategy, seed)
          .catch((err: Error) => {
            console.error("[bot] worker error:", err.message);
            return null;
          });
        if (!decision) decision = decideBotCommand(this.engine.getState(), BOT, "greedy", seed);
        if (!decision) {
          this.pushSystem("Bot utknął (brak legalnego ruchu) — zgłoś to jako błąd.");
          break;
        }
        const wait = this.botDelayMs - (Date.now() - started);
        if (wait > 0) await delay(wait);
        const res = this.apply(BOT, decision.move, decision.args, decision.ms);
        if (!res.success) {
          console.error("[bot] rejected", decision, (res as { error?: string }).error);
          const fallback = decideBotCommand(this.engine.getState(), BOT, "greedy", seed + ":fb");
          if (!fallback || !this.apply(BOT, fallback.move, fallback.args).success) {
            this.pushSystem("Bot wykonał nielegalny ruch — partia wstrzymana. Zgłoś to jako błąd.");
            break;
          }
        }
        const a = decision.args ?? {};
        this.botLastCardIds = ["cardId", "attackerId", "defenderId", "legendId", "attachToId", "blockerId"]
          .map((k) => a[k])
          .filter((v): v is string => typeof v === "string");
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
    const view = this.view();
    const record = {
      schema: "cpai.game.v1",
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      seed: this.seed,
      bot: this.botStrategy,
      seats: { p1: "human", p2: "bot" },
      decks: { p1: this.yourDeck, p2: this.botDeck },
      turns: view.turnNumber,
      result: view.gameEnded ? { winner: view.winnerId, reason: view.winReason } : null,
      commands: this.commands,
    };
    try {
      writeFileSync(join(GAMES_DIR, `${this.createdAt.slice(0, 10)}_${this.id}.json`), JSON.stringify(record));
    } catch (err) {
      console.error("[game] save failed", err);
    }
  }

  dispose() {
    this.worker.terminate();
    this.listeners.clear();
  }
}

export const games = new Map<string, GameSession>();

/** Drop games nobody touched for 6 hours. */
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [id, g] of games) if (g.lastActivity < cutoff) (g.dispose(), games.delete(id));
}, 600_000).unref();
