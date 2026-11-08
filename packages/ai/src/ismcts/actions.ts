import {
  buildPlayerPrompt,
  defaultChoiceResolvers,
  enumerateCandidateActions,
  enumerateChoiceActions,
  filterMatchView,
  processCommandLean,
  type FilteredMatchView,
  type MatchState,
  type MoveDecision,
  type PlayerId,
  type PlayerPrompt,
} from "@tcg/cyberpunk-engine";

/** A concrete engine command (what the server applies / what search branches on). */
export interface Action {
  move: string;
  args?: Record<string, unknown>;
}

/** Moves that never change the game (preferences) or that a search must not consider. */
const NEVER_SEARCH = new Set(["setCombatPriority", "concede", "cancelPendingResolution"]);

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
 * "Adjust a Gig by up to N" effects must be answered with die + value in one command
 * (`resolveAdjustGig`). The engine's enumeration only knows the two-step form, so expand every
 * (die, value) pair here. Shared by the game server (human actions) and the bots.
 */
export function expandAtomicGigAdjust(choice: unknown, view: FilteredMatchView | { players: Record<string, { zones: Record<string, unknown> }> }): Action[] {
  const c = choice as AtomicGigChoice;
  const p = c.payload;
  if (c.type !== "chooseTarget" || p.targetKind !== "gig" || !p.adjustGig) return [];
  const dice = new Map<string, { value: number; max: number }>();
  for (const pl of Object.values(view.players)) {
    const area = pl.zones.gigArea;
    if (Array.isArray(area))
      for (const d of area as { instanceId: string; power: number; definitionId: string }[])
        dice.set(d.instanceId, { value: d.power, max: Number(String(d.definitionId).replace(/\D/g, "")) || 20 });
  }
  const amount = p.adjustGig.maxAmount ?? 1;
  const dir = p.adjustGig.direction ?? "either";
  const out: Action[] = [];
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

const strip = (d: MoveDecision & { kind: "command" }): Action => (d.args ? { move: d.move, args: d.args } : { move: d.move });

function dedupe(actions: Action[]): Action[] {
  const seen = new Set<string>();
  const out: Action[] = [];
  for (const a of actions) {
    const k = rawKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * Every command `pid` may try right now. Pending choices are answered only through resolve moves
 * (like the engine's AIPlayer); choices the enumeration cannot express (scry) fall back to the
 * engine's default resolver as a single forced answer. May over-approximate: the engine is the
 * final judge, callers must handle a rejected command.
 */
export function legalActions(state: MatchState, pid: PlayerId, prompt: PlayerPrompt = buildPlayerPrompt(state, pid), rng: () => number = Math.random): Action[] {
  if (prompt.status === "choice" && prompt.choice) {
    const choice = prompt.choice;
    const needsView = choice.type === "chooseTarget" && (choice.payload as { targetKind?: string }).targetKind === "gig";
    const list = dedupe([
      ...(needsView ? expandAtomicGigAdjust(choice, filterMatchView(state, pid)) : []),
      ...enumerateChoiceActions(choice).map(strip),
    ]);
    if (list.length) return list;
    const forced = resolveChoiceByDefault(state, pid, prompt, rng);
    if (forced) return [forced];
    return prompt.availableMoves.some((m) => m.moveId === "cancelPendingResolution") ? [{ move: "cancelPendingResolution" }] : [];
  }
  if (prompt.status === "action") {
    const all = enumerateCandidateActions(prompt).map(strip);
    const list = all.filter((a) => !NEVER_SEARCH.has(a.move));
    return dedupe(list.length ? list : all);
  }
  return [];
}

/** The engine's default resolver for a pending choice (used for scry and as a fallback). */
export function resolveChoiceByDefault(state: MatchState, pid: PlayerId, prompt: PlayerPrompt, rng: () => number): Action | null {
  const choice = prompt.choice;
  if (!choice) return null;
  const resolver = defaultChoiceResolvers[choice.type] as (c: unknown, ctx: unknown) => MoveDecision;
  const d = resolver(choice, { view: filterMatchView(state, pid), playerId: pid, prompt, rng });
  return d.kind === "command" ? strip(d) : null;
}

/** Who must act next (active player first), or null when the game is over / nobody is prompted. */
export function actorOf(state: MatchState): { pid: PlayerId; prompt: PlayerPrompt } | null {
  if (state.G.gameEnded) return null;
  const active = state.G.turnMetadata.activePlayerId as string;
  const ids = [...state.ctx.playerIds].sort((a, b) => (a === active ? -1 : b === active ? 1 : 0));
  for (const pid of ids) {
    const prompt = buildPlayerPrompt(state, pid);
    if (prompt.status === "action" || prompt.status === "choice") return { pid, prompt };
  }
  return null;
}

let commandSeq = 0;

/**
 * Apply a command to an immutable state (search only — the lean engine path without undo patches,
 * logs or animations). Returns the next state, or null when the engine rejects the command.
 */
export function applyAction(state: MatchState, pid: PlayerId, action: Action): MatchState | null {
  try {
    return processCommandLean(state, { commandID: `s${++commandSeq}`, move: action.move as never, input: action.args ? { args: action.args } : undefined }, pid);
  } catch {
    return null;
  }
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Exact identity of a command. */
export function rawKey(a: Action): string {
  return a.args ? `${a.move}${sortedJson(a.args)}` : a.move;
}

/**
 * Identity of a command *as the searching player perceives it*: every card instance whose identity
 * differs between determinizations (rival hand, any deck card, ...) is replaced by its card
 * definition, so "rival plays Card X" is one tree edge across all sampled worlds.
 */
export function perceivedKey(a: Action, state: MatchState, stableIds: ReadonlySet<string>): string {
  if (!a.args) return a.move;
  const index = state.G.cardIndex;
  const canon = (v: unknown): unknown => {
    if (typeof v === "string") {
      const card = index[v];
      return card && !stableIds.has(v) ? `def:${card.definitionId}` : v;
    }
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x)]));
    return v;
  };
  return `${a.move}${sortedJson(canon(a.args))}`;
}
