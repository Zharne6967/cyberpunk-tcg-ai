/**
 * What the ladder knows: ChoomBattler's ranked statistics per colour archetype (data/meta/
 * choombattler-archetypes.json — popularity, average copies, win rate and lift of every top card and
 * Legend over thousands of games). The deck builder and the Deck Doctor use it the way an expert does:
 * build from the cards winning lists play, cut what drags lists down, keep what lifts them.
 * Simulations only check the result (Strong bots); they never pick the cards.
 */
import raw from "../../../data/meta/choombattler-archetypes.json" with { type: "json" };
import { getCatalog, isDeckLegal, type Deck } from "@cpai/core";
import { legendRamBudget } from "./analysis.ts";
import { META_SHAPE, isLegalTrio, shapeOf, trioName, type DeckShape } from "./lab.ts";

export interface LegendStat {
  slug: string;
  name: string;
  popularity: number;
  winRate: number;
  games: number;
  /** Win rate of lists with it minus the archetype's (points). */
  lift: number;
}
export interface CardStat extends LegendStat {
  type: "unit" | "gear" | "program";
  copies: number;
}
export interface ArchetypeStats {
  key: string;
  /** "4 Red / 2 Green". */
  name: string;
  games: number;
  share: number;
  winRate: number;
  legends: LegendStat[];
  cards: CardStat[];
}
export interface MetaData {
  source: string;
  date: string;
  archetypes: ArchetypeStats[];
}

type RawRow = [string, number, number, number, number];
type RawCard = [string, string, number, number, number, number, number];
const TYPES: Record<string, CardStat["type"]> = { U: "unit", G: "gear", P: "program" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let cached: MetaData | null = null;

/** The ladder data with card names resolved to our slugs (rows we do not know are left out). */
export function metaData(): MetaData {
  if (cached) return cached;
  const catalog = getCatalog();
  const bySlugName = new Map(catalog.cards.map((c) => [c.displayName.toLowerCase(), c.slug]));
  const archetypes: ArchetypeStats[] = [];
  for (const [key, a] of Object.entries(raw.archetypes as unknown as Record<string, { g: number; s: number; w: number; L: RawRow[]; C: RawCard[] }>)) {
    const legends = a.L.flatMap(([name, popularity, winRate, games, lift]) => {
      const slug = bySlugName.get(name.toLowerCase());
      return slug ? [{ slug, name, popularity, winRate, games, lift }] : [];
    });
    const cards = a.C.flatMap(([name, t, copies, popularity, winRate, games, lift]) => {
      const slug = bySlugName.get(name.toLowerCase());
      return slug ? [{ slug, name, type: TYPES[t] ?? "unit", copies, popularity, winRate, games, lift }] : [];
    });
    const name = key.replace(/(\d)-([a-z]+)/g, (_, n: string, c: string) => `${n} ${cap(c)}`).replace(/-(?=\d)/g, " / ");
    archetypes.push({ key, name, games: a.g, share: a.s, winRate: a.w, legends, cards });
  }
  archetypes.sort((x, y) => y.games - x.games);
  cached = { source: raw.source, date: raw.date, archetypes };
  return cached;
}

/** "4-red-2-green": RAM per colour, most first (the ladder's archetype names). */
export function archetypeKey(legends: string[]): string {
  const budget = legendRamBudget({ id: "", name: "", legends, main: {} });
  return Object.entries(budget)
    .sort(([ca, a], [cb, b]) => b - a || ca.localeCompare(cb))
    .map(([color, ram]) => `${ram}-${color}`)
    .join("-");
}

export function archetypeOf(legends: string[]): ArchetypeStats | null {
  const key = archetypeKey(legends);
  return metaData().archetypes.find((a) => a.key === key) ?? null;
}

/** A lift measured on few games says little: pull it towards 0 (300 pseudo-games). */
export const trustedLift = (s: { lift: number; games: number }) => (s.lift * s.games) / (s.games + 300);

/** How much a card is worth in this archetype: what players chose (popularity) and what wins (lift). */
export const cardValue = (s: CardStat) => s.popularity / 100 + trustedLift(s) / 3;

// ---- the deck builder

export interface BuiltCard {
  slug: string;
  copies: number;
  /** Why: the card's ladder numbers in this archetype (null for a filler card). */
  stat: CardStat | null;
  /** The player asked for this card. */
  asked?: boolean;
}
export interface MetaBuild {
  archetype: ArchetypeStats;
  deck: Deck;
  legends: LegendStat[];
  cards: BuiltCard[];
}

/** What a player can ask of a build besides the archetype (the Deck Lab's chat). */
export interface BuildOptions {
  /** Cards that must be in the deck (copies: null = the usual number, at least 2). */
  include?: { slug: string; copies: number | null }[];
  /** Cards that must not be in the deck. */
  exclude?: string[];
  /** "low": cheap cards first and few costing 5+; "high": room for and a bonus on cards costing 5+. */
  curve?: "low" | "high" | null;
}

/** The best Legends for an archetype: the colour split it needs, the highest trusted lift among the ones players use. */
export function bestLegends(a: ArchetypeStats, fixed: string[] = [], avoid: string[] = []): string[] | null {
  const catalog = getCatalog();
  const need = new Map<string, number>(a.key.match(/\d-[a-z]+/g)!.map((p) => [p.split("-")[1]!, Number(p.split("-")[0]) / 2]));
  const chosen = [...fixed];
  for (const slug of fixed) {
    const c = catalog.bySlug(slug)?.color;
    if (c && need.has(c)) need.set(c, need.get(c)! - 1);
  }
  const ranked = a.legends
    .filter((l) => l.popularity >= 5 && !chosen.includes(l.slug) && !avoid.includes(l.slug))
    .sort((x, y) => trustedLift(y) - trustedLift(x) || y.popularity - x.popularity);
  for (const l of ranked) {
    const color = catalog.bySlug(l.slug)?.color;
    if (!color || !(need.get(color)! > 0)) continue;
    const next = [...chosen, l.slug];
    const names = next.map((s) => catalog.bySlug(s)!.name);
    if (new Set(names).size !== names.length) continue;
    chosen.push(l.slug);
    need.set(color, need.get(color)! - 1);
    if (chosen.length === 3) break;
  }
  return chosen.length === 3 && isLegalTrio(chosen) && archetypeKey(chosen) === a.key ? chosen : null;
}

/** Can these Legends play the card (its colour and RAM)? */
export function legendsFit(legends: string[], slug: string): boolean {
  const c = getCatalog().bySlug(slug);
  const budget = legendRamBudget({ id: "", name: "", legends, main: {} });
  return !!c && c.type !== "legend" && budget[c.color] !== undefined && (c.ram ?? 0) <= budget[c.color]!;
}

const hashOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/**
 * A 40-card deck from the ladder: the archetype's cards by value (popularity and trusted lift), each at
 * its usual number of copies, within the meta shape (Units, 5+ cards); cards with a clearly negative lift
 * only when nothing better fits. `opts` adds what the player asked for (cards in or out, the curve).
 */
export function metaBuild(a: ArchetypeStats, legends?: string[], shape: DeckShape = META_SHAPE, opts: BuildOptions = {}): MetaBuild | null {
  const catalog = getCatalog();
  const trio = legends ?? bestLegends(a);
  if (!trio || !isLegalTrio(trio)) return null;
  const exclude = new Set(opts.exclude ?? []);
  const fits = (slug: string) => !exclude.has(slug) && legendsFit(trio, slug);
  const cost = (slug: string) => catalog.bySlug(slug)?.cost ?? 0;
  const value = (s: CardStat) =>
    cardValue(s) + (opts.curve === "low" ? 0.04 * (3 - cost(s.slug)) : opts.curve === "high" ? 0.05 * Math.max(0, cost(s.slug) - 4) : 0);
  const ranked = a.cards.filter((s) => fits(s.slug)).sort((x, y) => value(y) - value(x));
  const main: Record<string, number> = {};
  const why = new Map<string, CardStat | null>();
  let size = 0;
  const units = () => Object.entries(main).reduce((n, [s, k]) => n + (catalog.bySlug(s)?.type === "unit" ? k : 0), 0);
  const heavy = () => Object.entries(main).reduce((n, [s, k]) => n + (cost(s) >= 5 ? k : 0), 0);
  const add = (slug: string, n: number, stat: CardStat | null) => {
    const room = Math.min(n, 3 - (main[slug] ?? 0), 40 - size);
    if (room <= 0) return;
    main[slug] = (main[slug] ?? 0) + room;
    size += room;
    if (!why.has(slug)) why.set(slug, stat);
  };
  const ok = (slug: string, n: number) => {
    const c = catalog.bySlug(slug)!;
    if (c.type === "unit" && units() + n > shape.maxUnits) return false;
    if (c.type !== "unit" && 40 - size - n < Math.max(0, shape.minUnits - units())) return false;
    if ((c.cost ?? 0) >= 5 && heavy() + n > shape.maxHeavy) return false;
    return true;
  };
  // 0. What the player asked for, whatever its numbers.
  const asked = new Set<string>();
  for (const inc of opts.include ?? []) {
    if (!legendsFit(trio, inc.slug)) continue;
    const stat = a.cards.find((s) => s.slug === inc.slug) ?? null;
    add(inc.slug, inc.copies ?? Math.max(2, Math.round(stat?.copies ?? 3)), stat);
    asked.add(inc.slug);
  }
  // 1. Cards that do not drag lists down, at their usual copies.
  for (const s of ranked) {
    if (size >= 40) break;
    if (trustedLift(s) < -1 || main[s.slug]) continue;
    const n = Math.max(1, Math.min(3, Math.round(s.copies)));
    if (ok(s.slug, n)) add(s.slug, n, s);
  }
  // 2. Room left: more copies of the best cards, then the rest of the table, then any card that fits
  //    (as many copies as the shape allows).
  const put = (slug: string, want: number, stat: CardStat | null) => {
    for (let n = Math.min(want, 3 - (main[slug] ?? 0), 40 - size); n > 0; n--) if (ok(slug, n)) return add(slug, n, stat);
  };
  for (const s of ranked) if (size < 40 && main[s.slug] && !asked.has(s.slug) && trustedLift(s) >= -1) put(s.slug, 3, s);
  for (const s of ranked) if (size < 40 && !main[s.slug] && trustedLift(s) >= -1) put(s.slug, Math.max(1, Math.round(s.copies)), s);
  for (const s of ranked) if (size < 40 && !main[s.slug]) put(s.slug, Math.max(1, Math.round(s.copies)), s);
  for (const c of catalog.cards) if (size < 40 && fits(c.slug) && !main[c.slug]) put(c.slug, 2, null);
  if (size !== 40) return null;
  const key = JSON.stringify([trio, Object.entries(main).sort()]);
  const deck: Deck = { id: `meta-build-${a.key}-${hashOf(key)}`, name: trioName(trio), legends: trio, main };
  if (!isDeckLegal(deck)) return null;
  const legendStats = trio.map((s) => a.legends.find((l) => l.slug === s)).filter((l): l is LegendStat => !!l);
  const cards = Object.entries(main)
    .map(([slug, copies]) => ({ slug, copies, stat: why.get(slug) ?? null, ...(asked.has(slug) ? { asked: true } : {}) }))
    .sort((x, y) => (y.stat ? cardValue(y.stat) : -1) - (x.stat ? cardValue(x.stat) : -1));
  return { archetype: a, deck, legends: legendStats, cards };
}

// ---- the Deck Doctor from the ladder

export interface MetaSwap {
  out: string;
  in: string;
  copies: number;
  /** Ladder numbers of both cards in this archetype (null: the card is not among the archetype's top cards). */
  outStat: CardStat | null;
  inStat: CardStat;
}
export interface LegendSwap {
  out: string;
  in: string;
  outStat: LegendStat | null;
  inStat: LegendStat;
}
export interface MetaAdvice {
  archetype: ArchetypeStats | null;
  /** Cards of the deck with their ladder numbers (null: not among the top cards of the archetype). */
  cards: { slug: string; copies: number; stat: CardStat | null }[];
  swaps: MetaSwap[];
  legendSwaps: LegendSwap[];
  improved: Deck;
}

/**
 * What the ladder says about this deck: every card with its numbers in the deck's archetype, cuts (cards
 * that drag winning lists down or that the archetype's lists do not play) paired with the strongest
 * missing cards of the same kind (Unit for Unit, Gear/Program for Gear/Program), and Legends with a
 * clearly better alternative of the same colour.
 */
export function metaAdvice(deck: Deck, keep: string[] = []): MetaAdvice {
  const catalog = getCatalog();
  const a = archetypeOf(deck.legends);
  const statOf = (slug: string) => a?.cards.find((c) => c.slug === slug) ?? null;
  const cards = Object.entries(deck.main)
    .map(([slug, copies]) => ({ slug, copies, stat: statOf(slug) }))
    .sort((x, y) => (y.stat ? cardValue(y.stat) : -1) - (x.stat ? cardValue(x.stat) : -1));
  if (!a) return { archetype: null, cards, swaps: [], legendSwaps: [], improved: deck };
  const budget = legendRamBudget(deck);
  const fits = (slug: string) => {
    const c = catalog.bySlug(slug);
    return !!c && budget[c.color] !== undefined && (c.ram ?? 0) <= budget[c.color]!;
  };
  const isUnit = (slug: string) => catalog.bySlug(slug)?.type === "unit";
  // Cuts: not played by the archetype's lists (not in its top cards), or a clearly negative trusted lift.
  const badness = (c: (typeof cards)[number]) => (c.stat ? -trustedLift(c.stat) - c.stat.popularity / 50 : 3);
  const cuts = cards.filter((c) => !keep.includes(c.slug) && (!c.stat || trustedLift(c.stat) <= -1 || c.stat.popularity < 30)).sort((x, y) => badness(y) - badness(x));
  // Adds: the archetype's cards the deck lacks, best first; only ones that do not drag lists down.
  const adds = a.cards.filter((s) => !deck.main[s.slug] && fits(s.slug) && trustedLift(s) > -0.5 && s.popularity >= 30).sort((x, y) => cardValue(y) - cardValue(x));
  const swaps: MetaSwap[] = [];
  const used = new Set<string>();
  const main = { ...deck.main };
  for (const cut of cuts) {
    const pick = adds.find((s) => !used.has(s.slug) && isUnit(s.slug) === isUnit(cut.slug) && (!cut.stat || cardValue(s) > cardValue(cut.stat) + 0.15));
    if (!pick) continue;
    used.add(pick.slug);
    const copies = Math.min(cut.copies, 3);
    swaps.push({ out: cut.slug, in: pick.slug, copies, outStat: cut.stat, inStat: pick });
    delete main[cut.slug];
    main[pick.slug] = copies;
  }
  // Legends: one of the same colour with a clearly higher trusted lift (and enough games).
  // Each suggestion keeps the trio legal together with the ones before it, and no Legend is suggested twice.
  const legendSwaps: LegendSwap[] = [];
  const trio = [...deck.legends];
  for (const slug of deck.legends) {
    if (keep.includes(slug)) continue;
    const color = catalog.bySlug(slug)?.color;
    const mine = a.legends.find((l) => l.slug === slug) ?? null;
    const better = a.legends
      .filter((l) => !trio.includes(l.slug) && catalog.bySlug(l.slug)?.color === color && l.games >= 300)
      .filter((l) => isLegalTrio(trio.map((x) => (x === slug ? l.slug : x))))
      .sort((x, y) => trustedLift(y) - trustedLift(x))[0];
    if (!better || trustedLift(better) < (mine ? trustedLift(mine) : -5) + 3) continue;
    legendSwaps.push({ out: slug, in: better.slug, outStat: mine, inStat: better });
    trio[trio.indexOf(slug)] = better.slug;
  }
  const improved = { ...deck, id: `${deck.id}-ladder`, main };
  return { archetype: a, cards, swaps, legendSwaps, improved: isDeckLegal(improved) ? improved : deck };
}

/** Units and sellable share, for the reports. */
export { shapeOf };
