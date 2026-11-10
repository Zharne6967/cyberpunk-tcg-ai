/**
 * Deck Doctor: improve a deck by card swaps tested in simulations.
 *
 * 1. Baseline: the deck plays its gauntlet against the pool (fixed opponents and seeds).
 * 2. Cuts: main-deck cards that help least (results when played vs not; cards that rarely get played).
 * 3. Adds: cards that fit the Legends' colours and RAM — what pool decks of those colours play, and the
 *    rival cards the deck struggles against — never above 3 copies, every variant passes the official
 *    legality check.
 * 4. Every "−1 cut, +1 add" variant plays the same games as the baseline; the best clear gain is kept
 *    and the search goes on from the improved deck (a few rounds).
 * 5. Confirmation on a fresh set of games, baseline vs final (the chosen swaps are not graded on the
 *    games that picked them).
 * Running the games is the caller's job (worker threads, browser workers).
 */
import { getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import type { MatchOutcome } from "./match.ts";
import { legendRamBudget, planGauntlet } from "./analysis.ts";
import { doctorLoop, type DoctorOptions, type DoctorReport, type RunGauntlet } from "./doctor-loop.ts";
import { poolShape, shapeDistance } from "./lab.ts";

export * from "./doctor-loop.ts";

const winRate = (outcomes: (MatchOutcome | null)[]) => {
  const played = outcomes.filter((o): o is MatchOutcome => !!o);
  return played.length ? played.filter((o) => o.winner === "A").length / played.length : 0;
};

/** One copy out, one copy in; null when the result is not a legal deck. */
export function swapCard(deck: Deck, out: string, inn: string): { deck: Deck; copies: number } | null {
  if (out === inn || !deck.main[out]) return null;
  // All copies of the cut card for as many copies of the new one as fit (max 3): a change big enough to measure.
  const copies = Math.min(deck.main[out]!, 3 - (deck.main[inn] ?? 0));
  if (copies <= 0) return null;
  const main = { ...deck.main };
  main[out]! -= copies;
  if (main[out] === 0) delete main[out];
  main[inn] = (main[inn] ?? 0) + copies;
  const next = { ...deck, main };
  return isDeckLegal(next) ? { deck: next, copies } : null;
}

/**
 * The deck's core: cards that at least half of the pool's decks with the same colours play (the
 * archetype's backbone — players found them essential, whatever the bots make of them).
 */
export function coreCards(deck: Deck, pool: Deck[]): { slug: string; share: number }[] {
  const catalog = getCatalog();
  const colors = new Set(Object.keys(legendRamBudget(deck)));
  const others = pool.filter((d) => d.id !== deck.id);
  const similar = others.filter((d) => {
    const c = Object.keys(legendRamBudget(d));
    return c.filter((x) => colors.has(x)).length >= Math.min(2, colors.size) && c.length <= colors.size + 1;
  });
  const budgets = others.map((d) => ({ d, budget: legendRamBudget(d) }));
  const out: { slug: string; share: number }[] = [];
  for (const slug of Object.keys(deck.main)) {
    // 1. Decks with the same colours: the archetype's backbone.
    const archetype = similar.length >= 2 ? similar.filter((d) => (d.main[slug] ?? 0) > 0).length / similar.length : 0;
    // 2. Every deck that could play the card (its colour, enough RAM): a staple of that colour.
    const c = catalog.bySlug(slug);
    const able = c ? budgets.filter((x) => (x.budget[c.color] ?? -1) >= (c.ram ?? 0)) : [];
    const staple = able.length >= 3 ? able.filter((x) => (x.d.main[slug] ?? 0) > 0).length / able.length : 0;
    const share = Math.max(archetype, staple);
    if (share >= 0.5) out.push({ slug, share });
  }
  return out.sort((a, b) => b.share - a.share);
}

/** Main-deck cards ranked from least to most useful in these games (never the protected ones). */
export function weakCards(deck: Deck, outcomes: (MatchOutcome | null)[], n: number, protect: Set<string> = new Set()): string[] {
  const games = outcomes.filter((o): o is MatchOutcome => !!o);
  const overall = winRate(games);
  const scored = Object.keys(deck.main).filter((slug) => !protect.has(slug)).map((slug) => {
    const played = games.filter((o) => o.cardsA.played.includes(slug));
    const notPlayed = games.length - played.length;
    const wp = played.length ? played.filter((o) => o.winner === "A").length / played.length : overall;
    const wn = notPlayed ? games.filter((o) => !o.cardsA.played.includes(slug)).filter((o) => o.winner === "A").length / notPlayed : overall;
    // Few games either way: pull the difference towards 0 (k = 8 pseudo-games).
    const shrink = (played.length * notPlayed) / ((played.length + 8) * (notPlayed + 8));
    const impact = (wp - wn) * shrink;
    // Rarely played at all (stuck in hand, too expensive): also a cut candidate.
    const usage = played.length / Math.max(1, games.length);
    return { slug, score: impact + 0.15 * usage };
  });
  return scored.sort((a, b) => a.score - b.score).slice(0, n).map((x) => x.slug);
}

/** Cards worth trying: fit the colours/RAM, popular in pool decks of those colours, or troublesome for this deck. */
export function candidateCards(deck: Deck, pool: Deck[], outcomes: (MatchOutcome | null)[], n: number): string[] {
  const catalog = getCatalog();
  const budget = legendRamBudget(deck);
  const fits = (slug: string) => {
    const c = catalog.bySlug(slug);
    if (!c || c.type === "legend") return false;
    const b = budget[c.color];
    return b !== undefined && (c.ram ?? 0) <= b && (deck.main[slug] ?? 0) < 3;
  };
  const colors = new Set(Object.keys(budget));
  const score = new Map<string, number>();
  const add = (slug: string, x: number) => fits(slug) && score.set(slug, (score.get(slug) ?? 0) + x);
  for (const other of pool) {
    const shared = new Set(Object.keys(legendRamBudget(other)).filter((c) => colors.has(c))).size;
    if (!shared) continue;
    for (const [slug, copies] of Object.entries(other.main)) add(slug, copies * shared);
  }
  // Rival cards the deck loses to: if they fit, they may be the answer.
  const games = outcomes.filter((o): o is MatchOutcome => !!o);
  const overall = winRate(games);
  const seen = new Map<string, { n: number; wins: number }>();
  for (const o of games) for (const slug of o.cardsB.played) {
    const s = seen.get(slug) ?? { n: 0, wins: 0 };
    s.n++;
    if (o.winner === "A") s.wins++;
    seen.set(slug, s);
  }
  for (const [slug, s] of seen) if (s.n >= 6 && s.wins / s.n < overall - 0.08) add(slug, 6);
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([slug]) => slug);
}

/** The pool without the deck itself (same id or the same list). */
export function doctorOpponents(deck: Deck, pool: Deck[]): Deck[] {
  return planGauntlet(deck, pool, 2).opponents;
}

/**
 * Legal swaps for this deck and these results (the worker side of the loop), and the cards kept out
 * of them: the deck's core (share of similar pool decks playing it) and the ones you chose (share null).
 */
export function proposeSwaps(
  deck: Deck,
  opponents: Deck[],
  outcomes: (MatchOutcome | null)[],
  cuts: number,
  adds: number,
  keep: string[] = [],
): { variants: { out: string; in: string; copies: number; deck: Deck }[]; kept: { slug: string; share: number | null }[] } {
  const out: { out: string; in: string; copies: number; deck: Deck }[] = [];
  const core = coreCards(deck, opponents);
  const kept = [...keep.filter((k) => deck.main[k]).map((slug) => ({ slug, share: null as number | null })), ...core.filter((c) => !keep.includes(c.slug))];
  const protect = new Set(kept.map((k) => k.slug));
  const add = candidateCards(deck, opponents, outcomes, adds);
  // Never further from how the pool's decks are built (Units vs sellable Gear and Programs, 5+ cards).
  const shape = poolShape(opponents);
  const now = shapeDistance(deck.main, shape);
  for (const cut of weakCards(deck, outcomes, cuts, protect))
    for (const inn of add) {
      const next = swapCard(deck, cut, inn);
      if (next && shapeDistance(next.deck.main, shape) <= now) out.push({ out: cut, in: inn, copies: next.copies, deck: next.deck });
    }
  return { variants: out, kept };
}

/** The whole Doctor in one process (CLI): cards from the catalog, games from the given runner. */
export function deckDoctor(deck: Deck, pool: Deck[], run: RunGauntlet<Deck, MatchOutcome>, options: Partial<DoctorOptions> = {}, onProgress?: (text: string, done: number, total: number) => void): Promise<DoctorReport<Deck>> {
  return doctorLoop(deck, doctorOpponents(deck, pool), run, async (d, o, r, c, a, k) => proposeSwaps(d, o, r, c, a, k), options, onProgress);
}
