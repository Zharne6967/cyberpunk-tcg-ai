/**
 * Deck Lab search loop, without card data (the browser page imports it; decks come from `seed`/`breed`,
 * games from `run`). An evolutionary search with racing:
 *
 * 1. Generation 0: the pool's Legend trios rebuilt by the Lab plus random trios (lab.ts).
 * 2. Every deck plays `screen` games against the pool; decks that survive keep playing in later
 *    generations, so their results add up (the best are the most measured).
 * 3. After each generation the card values are re-learned from every game so far (win rate when the
 *    card was played vs not, inside the same deck), and the best decks breed: other cards, another
 *    Legend, a fresh build — the new decks use what was learned.
 * 4. Finalists play `final` more games each; the report has every matchup with its interval.
 *
 * Objective "average": the mean win rate over the pool. "worst": the weakest matchup (a deck that
 * beats every other deck), measured with the matchups' lower bounds so luck does not win.
 */

export interface LabDeck {
  id: string;
  name: string;
  legends: string[];
  main: Record<string, number>;
}
export interface LabOutcome {
  winner: "A" | "B" | "draw";
  cardsA: { played: string[] };
}

export interface LabOptions {
  generations: number;
  population: number;
  /** Decks kept from one generation to the next. */
  survivors: number;
  /** Games per deck and generation (all opponents together). */
  screen: number;
  finalists: number;
  /** Extra games per finalist. */
  final: number;
  objective: "average" | "worst";
  /** Legends every deck must use (1–3), e.g. the player's favourites. */
  keep: string[];
}

export const DEFAULT_LAB: LabOptions = { generations: 6, population: 24, survivors: 8, screen: 48, finalists: 3, final: 240, objective: "average", keep: [] };

export interface Matchup {
  opponent: string;
  name: string;
  legends: string[];
  wins: number;
  games: number;
  rate: number;
  ci: [number, number];
}

export interface LabEntry<D extends LabDeck = LabDeck> {
  deck: D;
  /** "pool" = a deck from the pool as it is, "lab" = made by the Lab. */
  origin: "pool" | "lab";
  generation: number;
  wins: number;
  games: number;
  rate: number;
  ci: [number, number];
  /** Objective value (average or weakest-matchup lower bound). */
  score: number;
  matchups: Matchup[];
}

export interface LabReport<D extends LabDeck = LabDeck> {
  /** Best first; the pool's own decks are measured the same way for comparison. */
  finalists: LabEntry<D>[];
  /** Best pool deck after the same games (what the Lab has to beat). */
  bestPool: LabEntry<D> | null;
  opponents: D[];
  history: { generation: number; best: number; mean: number; decks: number }[];
  values: Record<string, number>;
  objective: LabOptions["objective"];
  games: number;
  ms: number;
}

export type LabRun<D extends LabDeck, O extends LabOutcome> = (deck: D, opponents: D[], perMatchup: number, seed: string) => Promise<(O | null)[]>;
export interface LabSource<D extends LabDeck> {
  seed(count: number, seed: string, values: Record<string, number>): Promise<D[]>;
  breed(parents: D[], count: number, seed: string, values: Record<string, number>): Promise<D[]>;
}

export function wilsonCi(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const listKey = (d: LabDeck) => JSON.stringify([[...d.legends].sort(), Object.entries(d.main).sort(([a], [b]) => a.localeCompare(b))]);

/** The pool without the deck itself (same id or list): mirror games say nothing. */
export const opponentsOf = <D extends LabDeck>(deck: D, pool: D[]) => pool.filter((o) => o.id !== deck.id && listKey(o) !== listKey(deck));

/** Card values from all games: win rate when played minus when not, inside each deck, shrunk. */
export function learnCardValues<O extends LabOutcome>(games: { deck: LabDeck; outcomes: (O | null)[] }[]): Record<string, number> {
  const sum: Record<string, { d: number; w: number }> = {};
  for (const { deck, outcomes } of games) {
    const os = outcomes.filter((o): o is O => !!o);
    if (os.length < 8) continue;
    for (const slug of Object.keys(deck.main)) {
      const pl = os.filter((o) => o.cardsA.played.includes(slug));
      const np = os.length - pl.length;
      if (!pl.length || !np) continue;
      const wp = pl.filter((o) => o.winner === "A").length / pl.length;
      const wn = os.filter((o) => !o.cardsA.played.includes(slug) && o.winner === "A").length / np;
      const weight = (pl.length * np) / os.length;
      const s = (sum[slug] ??= { d: 0, w: 0 });
      s.d += (wp - wn) * weight;
      s.w += weight;
    }
  }
  const out: Record<string, number> = {};
  for (const [slug, s] of Object.entries(sum)) out[slug] = s.d / (s.w + 10);
  return out;
}

export async function labLoop<D extends LabDeck, O extends LabOutcome>(
  pool: D[],
  run: LabRun<D, O>,
  source: LabSource<D>,
  options: Partial<LabOptions> = {},
  onProgress?: (text: string, done: number, total: number) => void,
): Promise<LabReport<D>> {
  const opts = { ...DEFAULT_LAB, ...options };
  const t0 = performance.now();
  /** Games per opponent for about `total` games (even: seats swap in pairs). */
  const per = (total: number, n: number) => Math.max(2, 2 * Math.round(total / Math.max(1, n) / 2));
  type Entry = { deck: D; origin: "pool" | "lab"; generation: number; byOpp: Map<string, { wins: number; games: number }>; outcomes: (O | null)[]; batches: number };
  const entries: Entry[] = [];
  const known = new Set<string>();
  let games = 0;
  let values: Record<string, number> = {};
  const total =
    opts.generations * opts.population * per(opts.screen, pool.length) * pool.length + opts.finalists * per(opts.final, pool.length) * pool.length;
  const history: LabReport<D>["history"] = [];

  const play = async (e: Entry, perOpp: number, text: string) => {
    const opps = opponentsOf(e.deck, pool);
    const out = await run(e.deck, opps, perOpp, `lab-${e.deck.id}-${e.batches++}`);
    const each = Math.max(2, Math.floor(perOpp / 2) * 2);
    out.forEach((o, i) => {
      const opp = opps[Math.floor(i / each)];
      if (!o || !opp) return;
      const m = e.byOpp.get(opp.id) ?? { wins: 0, games: 0 };
      m.games++;
      if (o.winner === "A") m.wins++;
      e.byOpp.set(opp.id, m);
    });
    e.outcomes.push(...out);
    games += out.length;
    onProgress?.(text, games, total);
  };
  const entryOf = (e: Entry): LabEntry<D> => {
    const matchups: Matchup[] = opponentsOf(e.deck, pool).map((o) => {
      const m = e.byOpp.get(o.id) ?? { wins: 0, games: 0 };
      return { opponent: o.id, name: o.name, legends: o.legends, wins: m.wins, games: m.games, rate: m.games ? m.wins / m.games : 0, ci: wilsonCi(m.wins, m.games) };
    });
    const wins = matchups.reduce((s, m) => s + m.wins, 0);
    const n = matchups.reduce((s, m) => s + m.games, 0);
    // Average: mean of matchups (every opponent counts the same). Worst: the lowest matchup's lower
    // bound, with the average as a small tie-breaker.
    const avg = matchups.length ? matchups.reduce((s, m) => s + m.rate, 0) / matchups.length : 0;
    const worst = matchups.length ? Math.min(...matchups.map((m) => (m.wins + 1) / (m.games + 2))) : 0;
    const score = opts.objective === "worst" ? worst + 0.1 * avg : avg;
    return { deck: e.deck, origin: e.origin, generation: e.generation, wins, games: n, rate: n ? wins / n : 0, ci: wilsonCi(wins, n), score, matchups };
  };
  const add = (deck: D, origin: "pool" | "lab", generation: number) => {
    const key = listKey(deck);
    if (known.has(key)) return null;
    known.add(key);
    const e: Entry = { deck, origin, generation, byOpp: new Map(), outcomes: [], batches: 0 };
    entries.push(e);
    return e;
  };

  // The pool's own decks race too: the Lab's decks are judged against them on equal terms.
  let alive: Entry[] = pool.map((d) => add(d, "pool", 0)).filter((e): e is Entry => !!e && opts.keep.every((k) => e.deck.legends.includes(k)));
  for (const d of await source.seed(Math.max(0, opts.population - alive.length), "lab-g0", values)) {
    const e = add(d, "lab", 0);
    if (e) alive.push(e);
  }
  for (let g = 0; g < opts.generations; g++) {
    const text = `Generation ${g + 1} of ${opts.generations}: playing ${alive.length} decks`;
    for (const e of alive) await play(e, per(opts.screen, pool.length), text);
    values = learnCardValues(entries.map((e) => ({ deck: e.deck, outcomes: e.outcomes })));
    const ranked = [...alive].sort((a, b) => entryOf(b).score - entryOf(a).score);
    const scores = ranked.map((e) => entryOf(e).score);
    history.push({ generation: g + 1, best: scores[0] ?? 0, mean: scores.reduce((s, x) => s + x, 0) / Math.max(1, scores.length), decks: entries.length });
    if (g === opts.generations - 1) {
      alive = ranked;
      break;
    }
    const survivors = ranked.slice(0, opts.survivors);
    // Pool decks breed too: their children are the Lab's versions of decks players already trust.
    const children = await source.breed(
      survivors.map((e) => e.deck),
      opts.population - survivors.length,
      `lab-g${g + 1}`,
      values,
    );
    alive = [...survivors];
    for (const d of children) {
      const e = add(d, "lab", g + 1);
      if (e) alive.push(e);
    }
  }
  // Finals: the best Lab decks and the best pool deck, more games each.
  const finalLab = alive.filter((e) => e.origin === "lab").slice(0, opts.finalists);
  const finalPool = entries.filter((e) => e.origin === "pool" && e.outcomes.length).sort((x, y) => entryOf(y).score - entryOf(x).score)[0] ?? null;
  for (const e of [...finalLab, ...(finalPool ? [finalPool] : [])]) await play(e, per(opts.final, pool.length), "Final games for the best decks");
  const finalists = finalLab.map(entryOf).sort((a, b) => b.score - a.score);
  return {
    finalists,
    bestPool: finalPool ? entryOf(finalPool) : null,
    opponents: pool,
    history,
    values,
    objective: opts.objective,
    games,
    ms: performance.now() - t0,
  };
}
