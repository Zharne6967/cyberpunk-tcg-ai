/**
 * Deck Lab, card side: new decks from scratch (Legends + Main Deck) and their mutations. The search loop
 * (lab-loop.ts) plays them against the pool and keeps the best; this file only builds legal decks.
 *
 * Main Deck from Legends: the cards their colours and RAM allow, scored by
 * - how often the pool's decks of those colours play them (what players found good),
 * - what the games taught so far (`values`: win-rate impact when the card was played, see lab-loop.ts),
 * - a small heuristic (cheap Units, sellable cards) and some randomness (variety between decks);
 * filled 3 copies at a time with a sane shape (Units, cost curve). Every deck passes the official check.
 */
import { getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import { legendRamBudget } from "./analysis.ts";

type Card = NonNullable<ReturnType<ReturnType<typeof getCatalog>["bySlug"]>>;

/** Deterministic random numbers from a text seed (mulberry32 over a string hash). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const playable = (c: Card) => !("legality" in c) || (c as { legality?: string }).legality !== "banned";

export function allLegends(): Card[] {
  return getCatalog().cards.filter((c) => c.type === "legend" && playable(c));
}

/** Three Legends with different names (the deck rules). */
export function isLegalTrio(legends: string[]): boolean {
  const catalog = getCatalog();
  const cards = legends.map((s) => catalog.bySlug(s));
  if (cards.length !== 3 || cards.some((c) => !c || c.type !== "legend")) return false;
  return new Set(cards.map((c) => c!.name)).size === 3;
}

export const trioKey = (legends: string[]) => [...legends].sort().join("+");

/** Main-deck cards these Legends can pay for (colour and RAM). */
export function eligibleCards(legends: string[]): Card[] {
  const budget = legendRamBudget({ id: "", name: "", legends, main: {} });
  return getCatalog().cards.filter((c) => c.type !== "legend" && playable(c) && budget[c.color] !== undefined && (c.ram ?? 0) <= budget[c.color]!);
}

/** "Adam Smasher / Dum Dum / V" (the names players use for a Legend trio). */
export function trioName(legends: string[]): string {
  const catalog = getCatalog();
  return legends.map((s) => catalog.bySlug(s)?.name ?? s).join(" / ");
}

/** Copies of each card across the pool, counted for decks that share colours with these Legends. */
export function poolPopularity(legends: string[], pool: Deck[]): Record<string, number> {
  const colors = new Set(Object.keys(legendRamBudget({ id: "", name: "", legends, main: {} })));
  const out: Record<string, number> = {};
  for (const d of pool) {
    const shared = Object.keys(legendRamBudget(d)).filter((c) => colors.has(c)).length;
    if (!shared) continue;
    for (const [slug, n] of Object.entries(d.main)) out[slug] = (out[slug] ?? 0) + n * shared;
  }
  return out;
}

export interface BuildContext {
  pool: Deck[];
  /** Learned card values (win-rate impact, about −0.2…0.2). */
  values?: Record<string, number>;
  rng?: () => number;
  /** Randomness of the card choice (0 = always the same deck for these Legends). */
  temperature?: number;
}

function cardScore(c: Card, pop: number, maxPop: number, ctx: BuildContext): number {
  const popN = maxPop > 0 ? pop / maxPop : 0;
  const cost = c.cost ?? 0;
  let q = 0;
  if (c.type === "unit") q += 0.04 * ((c.power ?? 0) - cost);
  if ("sellTag" in c && c.sellTag) q += 0.05;
  if (cost >= 6) q -= 0.1;
  const v = ctx.values?.[c.slug] ?? 0;
  const noise = (ctx.rng?.() ?? 0.5) * (ctx.temperature ?? 0);
  return 0.6 * popN + q + 2 * v + noise;
}

/** A 40-card Main Deck for these Legends (null if they cannot make a legal deck). */
export function buildMain(legends: string[], ctx: BuildContext): Record<string, number> | null {
  if (!isLegalTrio(legends)) return null;
  const cards = eligibleCards(legends);
  const pop = poolPopularity(legends, ctx.pool);
  const maxPop = Math.max(0, ...cards.map((c) => pop[c.slug] ?? 0));
  const ranked = cards.map((c) => ({ c, s: cardScore(c, pop[c.slug] ?? 0, maxPop, ctx) })).sort((a, b) => b.s - a.s);
  const main: Record<string, number> = {};
  let size = 0, units = 0, heavy = 0, cheap = 0;
  const SIZE = 40, MAX_UNITS = 24, MAX_HEAVY = 9;
  const add = (c: Card, n: number) => {
    main[c.slug] = (main[c.slug] ?? 0) + n;
    size += n;
    if (c.type === "unit") units += n;
    if ((c.cost ?? 0) >= 5) heavy += n;
    if ((c.cost ?? 0) <= 2) cheap += n;
  };
  // Pass 1: the best cards within the shape limits; pass 2: anything left (small pools).
  for (const pass of [1, 2]) {
    for (const { c } of ranked) {
      if (size >= SIZE) break;
      const room = Math.min(3 - (main[c.slug] ?? 0), SIZE - size);
      if (room <= 0) continue;
      if (pass === 1) {
        if (c.type === "unit" && units + room > MAX_UNITS) continue;
        if (c.type !== "unit" && SIZE - size - room < Math.max(0, 15 - units)) continue;
        if ((c.cost ?? 0) >= 5 && heavy + room > MAX_HEAVY) continue;
      }
      add(c, room);
    }
  }
  void cheap;
  return size === SIZE ? main : null;
}

export function makeDeck(legends: string[], main: Record<string, number>, tag: string): Deck {
  return { id: `lab-${tag}`, name: trioName(legends), legends: [...legends], main };
}

/** A random legal Legend trio (optionally containing `keep`). */
export function randomTrio(rng: () => number, keep: string[] = []): string[] {
  const legends = allLegends();
  for (let tries = 0; tries < 200; tries++) {
    const trio = [...keep];
    while (trio.length < 3) {
      const pick = legends[Math.floor(rng() * legends.length)]!.slug;
      if (!trio.includes(pick)) trio.push(pick);
    }
    if (isLegalTrio(trio)) return trio;
  }
  return [];
}

/** One Legend replaced (never one of `keep`). */
export function mutateTrio(legends: string[], rng: () => number, keep: string[] = []): string[] {
  const all = allLegends();
  const free = legends.map((s, i) => ({ s, i })).filter((x) => !keep.includes(x.s));
  for (let tries = 0; tries < 100 && free.length; tries++) {
    const { i } = free[Math.floor(rng() * free.length)]!;
    const next = [...legends];
    next[i] = all[Math.floor(rng() * all.length)]!.slug;
    if (trioKey(next) !== trioKey(legends) && isLegalTrio(next)) return next;
  }
  return legends;
}

/** All copies of one card swapped for another eligible card (picked by score with randomness). */
export function mutateMain(deck: Deck, ctx: BuildContext): Record<string, number> | null {
  const rng = ctx.rng ?? Math.random;
  const cards = eligibleCards(deck.legends);
  const pop = poolPopularity(deck.legends, ctx.pool);
  const maxPop = Math.max(0, ...cards.map((c) => pop[c.slug] ?? 0));
  const catalog = getCatalog();
  const inDeck = Object.keys(deck.main);
  // Cut: lower value more likely.
  const cutScores = inDeck.map((s) => ({ s, v: (ctx.values?.[s] ?? 0) + rng() * 0.15 })).sort((a, b) => a.v - b.v);
  const out = cutScores[0]?.s;
  const outCard = out ? catalog.bySlug(out) : undefined;
  if (!out || !outCard) return null;
  const options = cards
    .filter((c) => !deck.main[c.slug] && c.slug !== out)
    .map((c) => ({ c, s: cardScore(c, pop[c.slug] ?? 0, maxPop, { ...ctx, temperature: 0.3 }) + (c.type === outCard.type ? 0.1 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  const pick = options[Math.floor(rng() * options.length)]?.c;
  if (!pick) return null;
  const n = deck.main[out]!;
  const main = { ...deck.main };
  delete main[out];
  main[pick.slug] = Math.min(3, n);
  // A single copy can not take three slots: the rest goes to the best card already in the deck.
  let missing = n - main[pick.slug]!;
  for (const s of inDeck) {
    if (missing <= 0) break;
    if (s === out) continue;
    const room = 3 - (main[s] ?? 0);
    const k = Math.min(room, missing);
    if (k > 0) (main[s] = (main[s] ?? 0) + k), (missing -= k);
  }
  return missing === 0 ? main : null;
}

/** New Legends + Main Deck, checked by the official rules (null when nothing legal came out). */
export function newDeck(legends: string[], ctx: BuildContext, tag: string): Deck | null {
  const main = buildMain(legends, ctx);
  if (!main) return null;
  const deck = makeDeck(legends, main, tag);
  return isDeckLegal(deck) ? deck : null;
}

export interface LabSeedRequest {
  pool: Deck[];
  count: number;
  seed: string;
  keep?: string[];
  values?: Record<string, number>;
}

/** Generation 0: the pool's own Legend trios rebuilt by the Lab, then random trios. */
export function labSeed(req: LabSeedRequest): Deck[] {
  const rng = seededRandom(req.seed);
  const keep = req.keep ?? [];
  const out: Deck[] = [];
  const seen = new Set<string>();
  const push = (legends: string[], temperature: number) => {
    if (!legends.length || !keep.every((k) => legends.includes(k))) return;
    const d = newDeck(legends, { pool: req.pool, values: req.values, rng, temperature }, `${req.seed}-${out.length}`);
    if (!d) return;
    const key = JSON.stringify([trioKey(d.legends), Object.entries(d.main).sort()]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };
  for (const d of req.pool) if (out.length < Math.ceil(req.count / 3)) push(d.legends, 0.15);
  for (let tries = 0; out.length < req.count && tries < req.count * 20; tries++) push(randomTrio(rng, keep), 0.25);
  return out;
}

export interface LabBreedRequest {
  parents: Deck[];
  pool: Deck[];
  count: number;
  seed: string;
  keep?: string[];
  values?: Record<string, number>;
}

/** Children of the best decks: other cards (most), another Legend (some), or a fresh build. */
export function labBreed(req: LabBreedRequest): Deck[] {
  const rng = seededRandom(req.seed);
  const keep = req.keep ?? [];
  const out: Deck[] = [];
  const ctx = { pool: req.pool, values: req.values, rng };
  for (let tries = 0; out.length < req.count && tries < req.count * 20 && req.parents.length; tries++) {
    const parent = req.parents[Math.min(req.parents.length - 1, Math.floor(rng() * rng() * req.parents.length))]!;
    const r = rng();
    let deck: Deck | null = null;
    const tag = `${req.seed}-${out.length}`;
    if (r < 0.6) {
      const main = mutateMain(parent, ctx);
      deck = main ? makeDeck(parent.legends, main, tag) : null;
    } else if (r < 0.9) deck = newDeck(mutateTrio(parent.legends, rng, keep), { ...ctx, temperature: 0.15 }, tag);
    else deck = newDeck(parent.legends, { ...ctx, temperature: 0.3 }, tag);
    if (deck && isDeckLegal(deck) && !out.some((d) => JSON.stringify(d.main) === JSON.stringify(deck!.main) && trioKey(d.legends) === trioKey(deck!.legends))) out.push(deck);
  }
  return out;
}
