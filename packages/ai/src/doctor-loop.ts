/**
 * Deck Doctor search loop, without card data (the browser page imports it; card choices come from
 * `propose`, games from `run`). See doctor.ts for the card side.
 *
 * A round: the current deck's results → proposed swaps (all copies of a weak card for the same number of
 * a candidate) → racing: every swap on a few games, the better ones on more, the best few on more again
 * (same opponents and seeds as the current deck) → the finalists and the current deck play a fresh set of
 * games; a swap is kept only when it wins clearly more there too (racing alone picks lucky swaps).
 * The end result is confirmed on fresh games; a stronger bot can re-check it (`confirmDecks`).
 */

/** What the loop needs of a deck and of a game result (no imports: the browser page uses this file). */
export interface DoctorDeck {
  id: string;
  name: string;
  legends: string[];
  main: Record<string, number>;
}
export interface DoctorOutcome {
  winner: "A" | "B" | "draw";
}

export interface DoctorOptions {
  /** Games at each racing stage (cumulative, all opponents together), e.g. [64, 128, 256]. */
  stages: number[];
  /** How many swaps survive each stage (after stage i, keep[i]); the last value = finalists. */
  keep: number[];
  /** Fresh games for each finalist and the current deck. */
  check: number;
  rounds: number;
  cuts: number;
  adds: number;
  /** Smallest win-rate gain (0..1) on the fresh games that counts as an improvement. */
  minGain: number;
  /** How sure the fresh games must be (one-sided z: 1.28 ≈ 90%). */
  z: number;
  /** Fresh games for the final confirmation, original vs improved. */
  confirm: number;
  /** Cards never cut (your choice; the deck's core is kept anyway). */
  protect: string[];
}

export const DEFAULT_DOCTOR: DoctorOptions = { stages: [64, 128, 256], keep: [6, 2, 2], check: 400, rounds: 2, cuts: 4, adds: 6, minGain: 0.03, z: 1.28, confirm: 400, protect: [] };

export interface DoctorSwap {
  out: string;
  in: string;
  copies: number;
  /** Win rate on the racing games it reached, the games, the gain over the current deck on them. */
  rate: number;
  games: number;
  delta: number;
  /** Finalists: gain on the fresh games and their number. */
  checkDelta?: number;
  checkGames?: number;
}

export interface DoctorRound {
  base: number;
  tried: DoctorSwap[];
  accepted: DoctorSwap | null;
}

export interface Confirmation {
  games: number;
  before: number;
  after: number;
  beforeCi: [number, number];
  afterCi: [number, number];
  bot: string;
}

export interface DoctorReport<D extends DoctorDeck = DoctorDeck> {
  original: D;
  improved: D;
  /** The decks it was tested against (for a re-check with stronger bots). */
  opponents: D[];
  rounds: DoctorRound[];
  /** Fresh games: original vs improved (same opponents and seeds). */
  confirm: Confirmation;
  changes: { out: string; in: string; copies: number }[];
  /** Cards that were never cut: the deck's core (share of similar decks playing them) and yours (share null). */
  kept: { slug: string; share: number | null }[];
  /** Games played in all. */
  games: number;
  ms: number;
}

/** Plays a deck's gauntlet against fixed opponents; outcomes in plan order (null = a failed game). */
export type RunGauntlet<D extends DoctorDeck = DoctorDeck, O extends DoctorOutcome = DoctorOutcome> = (deck: D, opponents: D[], perMatchup: number, seed: string, bot?: string) => Promise<(O | null)[]>;
/** Legal swaps worth testing for this deck and these results. */
export type ProposeSwaps<D extends DoctorDeck = DoctorDeck, O extends DoctorOutcome = DoctorOutcome> = (
  deck: D,
  opponents: D[],
  outcomes: (O | null)[],
  cuts: number,
  adds: number,
  keep: string[],
) => Promise<{ variants: { out: string; in: string; copies: number; deck: D }[]; kept: { slug: string; share: number | null }[] }>;

function interval(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const played = <O extends DoctorOutcome>(o: (O | null)[]) => o.filter((x): x is O => !!x);
const wins = <O extends DoctorOutcome>(o: (O | null)[]) => played(o).filter((x) => x.winner === "A").length;
export const winRateOf = <O extends DoctorOutcome>(o: (O | null)[]) => (played(o).length ? wins(o) / played(o).length : 0);

/** Decks from tournament and online play (data/decks meta-*, rogue-ai-*). */
export const isMetaDeck = (d: { id: string }) => /^(meta|rogue-ai)-/.test(d.id);

/** Games per opponent for about `total` games in all (even: both seats equally often). */
export const perOpponent = (total: number, opponents: number) => Math.max(2, 2 * Math.round(total / Math.max(1, opponents) / 2));

/** Is b better than a by at least `min`, with one-sided confidence z (two independent samples)? */
export function clearlyBetter<O extends DoctorOutcome>(a: (O | null)[], b: (O | null)[], min: number, z: number): boolean {
  const na = played(a).length, nb = played(b).length;
  if (!na || !nb) return false;
  const pa = wins(a) / na, pb = wins(b) / nb;
  const se = Math.sqrt((pa * (1 - pa)) / na + (pb * (1 - pb)) / nb) || 1 / Math.sqrt(Math.min(na, nb));
  return pb - pa >= min && pb - pa >= z * se;
}

/** Original vs improved on the same fresh games (optionally with another bot). */
export async function confirmDecks<D extends DoctorDeck, O extends DoctorOutcome>(
  original: D,
  improved: D,
  opponents: D[],
  run: RunGauntlet<D, O>,
  perMatchup: number,
  bot: string,
  seed = "confirm",
): Promise<Confirmation> {
  const before = await run(original, opponents, perMatchup, seed, bot);
  const after = improved === original ? before : await run(improved, opponents, perMatchup, seed, bot);
  return {
    games: played(before).length,
    before: winRateOf(before),
    after: winRateOf(after),
    beforeCi: interval(wins(before), played(before).length),
    afterCi: interval(wins(after), played(after).length),
    bot,
  };
}

/** Games the loop plays at most (for the progress bar). */
export function doctorBudget(options: Partial<DoctorOptions>, opponents: number, variants: number): number {
  const o = { ...DEFAULT_DOCTOR, ...options };
  const per = o.stages.map((s) => perOpponent(s, opponents) * opponents);
  let racing = 0;
  per.forEach((g, i) => (racing += (g - (per[i - 1] ?? 0)) * (i === 0 ? variants : Math.min(variants, o.keep[i - 1] ?? variants))));
  const finalists = Math.min(variants, o.keep[o.stages.length - 1] ?? 1);
  const check = perOpponent(o.check, opponents) * opponents * (1 + finalists);
  return o.rounds * (per[per.length - 1]! + racing + check) + 2 * perOpponent(o.confirm, opponents) * opponents;
}

export async function doctorLoop<D extends DoctorDeck, O extends DoctorOutcome>(
  deck: D,
  opponents: D[],
  run: RunGauntlet<D, O>,
  propose: ProposeSwaps<D, O>,
  options: Partial<DoctorOptions> = {},
  onProgress?: (text: string, done: number, total: number) => void,
): Promise<DoctorReport<D>> {
  const opts = { ...DEFAULT_DOCTOR, ...options };
  const t0 = performance.now();
  const rounds: DoctorRound[] = [];
  const changes: { out: string; in: string; copies: number }[] = [];
  const stagePer = opts.stages.map((s) => perOpponent(s, opponents.length));
  const lastStage = stagePer[stagePer.length - 1]! * opponents.length;
  let current = deck;
  let kept: DoctorReport<D>["kept"] = [];
  let total = doctorBudget(opts, opponents.length, opts.cuts * opts.adds);
  let games = 0;
  /** One gauntlet, counted for the progress bar. */
  const play = async (d: D, per: number, seed: string, text: string) => {
    onProgress?.(text, games, total);
    const out = await run(d, opponents, per, seed);
    games += out.length;
    onProgress?.(text, games, total);
    return out;
  };
  for (let r = 0; r < opts.rounds; r++) {
    const label = `Round ${r + 1}:`;
    // The current deck on every stage's games (stage seeds are separate batches, results add up).
    const baseRuns: (O | null)[][] = [];
    let prev = 0;
    for (const [i, per] of stagePer.entries()) {
      baseRuns.push(await play(current, per - prev, `doctor-r${r}-s${i}`, `${label} the deck as it is`));
      prev = per;
    }
    const baseAll = baseRuns.flat();
    const proposal = await propose(current, opponents, baseAll, opts.cuts, opts.adds, opts.protect);
    const variants = proposal.variants;
    if (r === 0) kept = proposal.kept;
    // The estimate assumed cuts × adds swaps: correct it with the real number.
    total = games - lastStage + doctorBudget({ ...opts, rounds: opts.rounds - r }, opponents.length, variants.length);
    type Entry = { v: (typeof variants)[number]; runs: (O | null)[][] };
    const entries: Entry[] = variants.map((v) => ({ v, runs: [] }));
    /** A swap against the current deck on exactly the same games (the stages it reached). */
    const swapOf = (e: Entry): DoctorSwap => {
      const flat = e.runs.flat();
      const base = baseRuns.slice(0, e.runs.length).flat();
      return { out: e.v.out, in: e.v.in, copies: e.v.copies, rate: winRateOf(flat), games: played(flat).length, delta: winRateOf(flat) - winRateOf(base) };
    };
    // Racing.
    let field = entries;
    prev = 0;
    for (const [i, per] of stagePer.entries()) {
      for (const e of field) e.runs.push(await play(e.v.deck, per - prev, `doctor-r${r}-s${i}`, `${label} testing swaps`));
      prev = per;
      field = [...field].sort((x, y) => swapOf(y).delta - swapOf(x).delta).slice(0, opts.keep[i] ?? field.length);
    }
    // Finalists and the current deck on fresh games: the gain must hold there too.
    const finalists = field.filter((e) => e.runs.length === stagePer.length && swapOf(e).delta > 0);
    const checkPer = perOpponent(opts.check, opponents.length);
    const checkText = `${label} checking the best swaps on new games`;
    const fresh = finalists.length ? await play(current, checkPer, `doctor-r${r}-check`, checkText) : [];
    const checked = new Map<Entry, (O | null)[]>();
    for (const e of finalists) checked.set(e, await play(e.v.deck, checkPer, `doctor-r${r}-check`, checkText));
    const withCheck = (e: Entry): DoctorSwap => {
      const s = swapOf(e);
      const c = checked.get(e);
      return c ? { ...s, checkDelta: winRateOf(c) - winRateOf(fresh), checkGames: played(c).length } : s;
    };
    const best = [...checked.keys()].sort((x, y) => winRateOf(checked.get(y)!) - winRateOf(checked.get(x)!))[0];
    const accepted = best && clearlyBetter(fresh, checked.get(best)!, opts.minGain, opts.z) ? withCheck(best) : null;
    const tried = entries
      .map(withCheck)
      .sort((x, y) => (y.checkGames ?? 0) - (x.checkGames ?? 0) || y.games - x.games || (y.checkDelta ?? y.delta) - (x.checkDelta ?? x.delta));
    rounds.push({ base: winRateOf(baseAll), tried, accepted });
    if (!accepted || !best) break;
    current = best.v.deck;
    changes.push({ out: accepted.out, in: accepted.in, copies: accepted.copies });
  }
  const confirmPer = perOpponent(opts.confirm, opponents.length);
  total = games + (current === deck ? 1 : 2) * confirmPer * opponents.length;
  const text = "Confirming on new games";
  onProgress?.(text, games, total);
  const counted: RunGauntlet<D, O> = async (d, o, per, seed, bot) => {
    const out = await run(d, o, per, seed, bot);
    games += out.length;
    onProgress?.(text, games, total);
    return out;
  };
  const confirm = await confirmDecks(deck, current, opponents, counted, confirmPer, "greedy");
  return { original: deck, improved: current, opponents, rounds, confirm, changes, kept, games, ms: performance.now() - t0 };
}
