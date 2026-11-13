/**
 * The Deck Lab's chat: what a player writes (English or Polish) → what they want of a deck → the deck from
 * the ladder data, with the reasons. No language model: words are matched to colours, Legends, cards and a
 * few wishes (curve, Units, sellable cards, popular or less played, a deck to beat); every pick comes from
 * ChoomBattler's numbers (meta-stats.ts), and the reply says what was understood so the player can correct it.
 * Each message builds on the previous request ("without Satori", "more Units", "another one").
 */
import { getCatalog, type Deck } from "@cpai/core";
import { META_SHAPE, shapeOf, type DeckShape } from "./lab.ts";
import { archetypeKey, bestLegends, legendsFit, metaBuild, metaData, trustedLift, type ArchetypeStats, type MetaBuild } from "./meta-stats.ts";

export type Color = "red" | "blue" | "green" | "yellow";
const COLOR_NAME: Record<Color, string> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };

export interface DeckRequest {
  /** RAM per colour asked for; 0 = the colour in any amount. */
  colors: Partial<Record<Color, number>>;
  avoidColors: Color[];
  /** Legends by name ("Padre", "V"); `slug` when the player named one version. */
  legends: { name: string; slug: string | null }[];
  avoidLegends: string[];
  include: { slug: string; copies: number | null }[];
  exclude: string[];
  units: { min: number; max: number } | null;
  curve: "low" | "high" | null;
  sellable: "more" | "fewer" | null;
  goal: "winRate" | "popular" | "rare";
  /** Archetypes already shown that the player wants something else than. */
  skip: string[];
  beat: { colors: Partial<Record<Color, number>>; legends: string[]; rogueAi?: boolean } | null;
}

export const emptyRequest = (): DeckRequest => ({
  colors: {},
  avoidColors: [],
  legends: [],
  avoidLegends: [],
  include: [],
  exclude: [],
  units: null,
  curve: null,
  sellable: null,
  goal: "winRate",
  skip: [],
  beat: null,
});

// ---- reading the message

const normalize = (t: string) =>
  t
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();

function colorOf(t: string): Color | null {
  if (t === "red" || t === "reds" || t.startsWith("czerw")) return "red";
  if (t === "blue" || t === "blues" || t.startsWith("niebiesk")) return "blue";
  if (t === "green" || t === "greens" || t.startsWith("zielon")) return "green";
  if (t === "yellow" || t === "yellows" || t.startsWith("zolt")) return "yellow";
  return null;
}

const NEG = new Set(["bez", "without", "except", "oprocz", "procz", "unikaj", "avoid", "not", "nie", "no", "dont", "zero", "wywal", "wyrzuc", "usun", "remove", "cut", "minus", "zamiast", "instead"]);
const STOP = new Set(["z", "ze", "with", "ale", "but", "plus", "dodaj", "add", "using", "uzywajac", "for", "dla", "daj", "give", "put", "wstaw", "wrzuc", "wloz", "dorzuc"]);
const BEAT = (t: string) =>
  t === "kontra" || t === "vs" || ["pokon", "kontruj", "kontrow", "przeciw", "bije", "bic", "beat", "against", "counter", "versus", "wygryw", "lepsz", "better"].some((s) => t.startsWith(s));
/** Before "z" / "with": "wygrywa z X", "nie przegrywa z X", "radzi sobie z X". */
const BEAT_Z = (t: string) => ["wygryw", "przegryw", "radz", "walcz", "beat", "win", "lose"].some((s) => t.startsWith(s));
const NUMBER: Record<string, number> = { "1": 1, "2": 2, "3": 3, "1x": 1, "2x": 2, "3x": 3, x1: 1, x2: 2, x3: 3, one: 1, two: 2, three: 3, jedna: 1, jeden: 1, dwie: 2, dwa: 2, trzy: 3 };

interface Alias {
  tokens: string[];
  kind: "legend" | "card";
  /** Legend name or card slugs. */
  name: string;
  slugs: string[];
  /** The player named one version ("V: Streetkid"). */
  exact?: boolean;
}

let aliases: Alias[] | null = null;
function allAliases(): Alias[] {
  if (aliases) return aliases;
  const catalog = getCatalog();
  const out: Alias[] = [];
  const legends = catalog.cards.filter((c) => c.type === "legend");
  const people = (token: string, at: "first" | "last") => new Set(legends.filter((l) => { const t = normalize(l.name).split(" "); return (at === "first" ? t[0] : t.at(-1)) === token; }).map((l) => l.name));
  for (const l of legends) {
    const t = normalize(l.name).split(" ");
    const all = legends.filter((x) => x.name === l.name).map((x) => x.slug);
    out.push({ tokens: t, kind: "legend", name: l.name, slugs: all });
    out.push({ tokens: normalize(l.displayName).split(" "), kind: "legend", name: l.name, slugs: [l.slug], exact: true });
    if (t.length > 1 && t[0]!.length >= 3 && people(t[0]!, "first").size === 1) out.push({ tokens: [t[0]!], kind: "legend", name: l.name, slugs: all });
    if (t.length > 1 && t.at(-1)!.length >= 4 && people(t.at(-1)!, "last").size === 1) out.push({ tokens: [t.at(-1)!], kind: "legend", name: l.name, slugs: all });
  }
  const byName = new Map<string, string[]>();
  for (const c of catalog.cards) {
    if (c.type === "legend") continue;
    for (const n of [c.name, c.displayName]) {
      const k = normalize(n);
      if (!k) continue;
      byName.set(k, [...new Set([...(byName.get(k) ?? []), c.slug])]);
    }
  }
  for (const [k, slugs] of byName) out.push({ tokens: k.split(" "), kind: "card", name: k, slugs });
  // Longer names first, so "Dexter DeShawn: One Last Chance" wins over "Dexter".
  out.sort((a, b) => b.tokens.length - a.tokens.length);
  aliases = out;
  return out;
}

function matchAt(tokens: string[], i: number, alias: string[]): boolean {
  for (let k = 0; k < alias.length; k++) {
    const t = tokens[i + k];
    const a = alias[k]!;
    if (!t) return false;
    if (t === a) continue;
    // Polish endings: "Padrem", "Viktorem", "Satori" stays.
    if (k === alias.length - 1 && a.length >= 4 && t.startsWith(a) && t.length - a.length <= 3) continue;
    return false;
  }
  return true;
}

type Context = "want" | "avoid" | "beat";
/** Up to 4 words back: a negation, a "beat" word, or a positive word that ends the search. Names are "§". */
function contextOf(tokens: string[], start: number): Context {
  for (let j = start - 1; j >= Math.max(0, start - 4); j--) {
    const t = tokens[j]!;
    if (t === "§") continue;
    if (BEAT(t)) return "beat";
    if (STOP.has(t)) return j > 0 && BEAT_Z(tokens[j - 1]!) ? "beat" : "want";
    if (NEG.has(t)) return "avoid";
  }
  return "want";
}

/** The variant of a card the ladder plays most (several cards share a name, e.g. Units named after Legends). */
export function mainVariant(slugs: string[]): string {
  if (slugs.length === 1) return slugs[0]!;
  const score = (s: string) => metaData().archetypes.reduce((n, a) => n + (a.cards.find((c) => c.slug === s)?.popularity ?? 0) * a.games, 0);
  return [...slugs].sort((a, b) => score(b) - score(a))[0]!;
}

export interface ReadMessage {
  request: DeckRequest;
  /** What was read from this message, for the reply ("Legend: Padre", "Without: Satori"). */
  understood: string[];
}

/** Reads one message on top of the previous request. */
export function readMessage(text: string, previous: DeckRequest | null = null): ReadMessage {
  const catalog = getCatalog();
  const norm = normalize(text);
  const tokens = norm.split(" ").filter(Boolean);
  const understood: string[] = [];
  const has = (re: RegExp) => re.test(norm);
  const fresh = has(/\b(od nowa|nowy deck|nowa talia|new deck|start over|reset|zacznij)\b/);
  const req: DeckRequest = fresh || !previous ? emptyRequest() : structuredClone(previous);
  if (fresh && previous) understood.push("New deck");

  // Names: Legends and cards (longest first, no overlaps).
  const taken = new Array<boolean>(tokens.length).fill(false);
  const hits: { start: number; end: number; alias: Alias }[] = [];
  for (const alias of allAliases()) {
    for (let i = 0; i + alias.tokens.length <= tokens.length; i++) {
      if (taken.slice(i, i + alias.tokens.length).some(Boolean)) continue;
      if (alias.tokens.length === 1 && alias.tokens[0]!.length <= 2 && alias.tokens[0] !== "v") continue;
      if (!matchAt(tokens, i, alias.tokens)) continue;
      // "Rogue AI" is ChoomBattler's bot, not the Legend Rogue.
      if (alias.tokens.length === 1 && alias.tokens[0] === "rogue" && tokens[i + 1] === "ai") continue;
      hits.push({ start: i, end: i + alias.tokens.length, alias });
      for (let k = i; k < i + alias.tokens.length; k++) taken[k] = true;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const compact: string[] = [];
  const pos: number[] = [];
  for (let i = 0; i < tokens.length; ) {
    const h = hits.find((x) => x.start === i);
    if (h) {
      for (let k = h.start; k < h.end; k++) pos[k] = compact.length;
      compact.push("§");
      i = h.end;
    } else {
      pos[i] = compact.length;
      compact.push(tokens[i]!);
      i++;
    }
  }
  const ctxAt = (i: number) => contextOf(compact, pos[i]!);
  const copiesAt = (start: number, end: number) => NUMBER[tokens[start - 1] ?? ""] ?? (/^x[123]$/.test(tokens[end] ?? "") ? NUMBER[tokens[end]!]! : null);

  // Colours: "4 red 2 green", "6 yellow", "mono yellow", "red", "GGR".
  const wantColors: Partial<Record<Color, number>> = {};
  const beatColors: Partial<Record<Color, number>> = {};
  const avoidColors: Color[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (taken[i]) continue;
    const c = colorOf(tokens[i]!);
    if (!c) continue;
    const before = tokens[i - 1] ?? "";
    const ram = ["2", "4", "6"].includes(before) ? Number(before) : ["mono", "czysto", "czysty", "pure", "only", "tylko", "full"].includes(before) ? 6 : 0;
    const ctx = ctxAt(ram && before ? i - 1 : i);
    if (ctx === "avoid") avoidColors.push(c);
    else (ctx === "beat" ? beatColors : wantColors)[c] = ram;
  }
  for (const m of text.matchAll(/\b([RGBY])([RGBY])([RGBY])?\b/g)) {
    const letters = [m[1], m[2], m[3]].filter(Boolean) as string[];
    const of: Record<string, Color> = { R: "red", G: "green", B: "blue", Y: "yellow" };
    for (const l of letters) wantColors[of[l]!] = letters.length === 3 ? (wantColors[of[l]!] ?? 0) + 2 : 0;
  }

  // Legends and cards by context.
  const newLegends: DeckRequest["legends"] = [];
  const beatLegends: string[] = [];
  for (const h of hits) {
    const ctx = ctxAt(h.start);
    const copies = copiesAt(h.start, h.end);
    const asCard = h.alias.kind === "card" || (copies !== null && catalog.cards.some((c) => c.type !== "legend" && normalize(c.name) === h.alias.tokens.join(" ")));
    if (!asCard) {
      if (ctx === "beat") beatLegends.push(h.alias.name);
      else if (ctx === "avoid") {
        if (!req.avoidLegends.includes(h.alias.name)) req.avoidLegends.push(h.alias.name);
        req.legends = req.legends.filter((l) => l.name !== h.alias.name);
        understood.push(`Without: ${h.alias.name}`);
      } else {
        newLegends.push({ name: h.alias.name, slug: h.alias.exact ? h.alias.slugs[0]! : null });
        req.avoidLegends = req.avoidLegends.filter((n) => n !== h.alias.name);
      }
      continue;
    }
    const slugs = h.alias.kind === "card" ? h.alias.slugs : catalog.cards.filter((c) => c.type !== "legend" && normalize(c.name) === h.alias.tokens.join(" ")).map((c) => c.slug);
    if (!slugs.length) continue;
    const slug = mainVariant(slugs);
    const name = catalog.bySlug(slug)!.displayName;
    if (ctx === "avoid") {
      if (!req.exclude.includes(slug)) req.exclude.push(slug);
      req.include = req.include.filter((x) => x.slug !== slug);
      understood.push(`Without: ${name}`);
    } else if (ctx === "want") {
      req.include = [...req.include.filter((x) => x.slug !== slug), { slug, copies }];
      req.exclude = req.exclude.filter((x) => x !== slug);
      understood.push(`With: ${copies ? `${copies} × ` : ""}${name}`);
    }
  }

  // Colours and Legends replace the previous ones (the player changed direction), unless they fit together.
  const named = Object.keys(wantColors) as Color[];
  if (named.length) {
    req.colors = wantColors;
    req.skip = [];
    req.legends = req.legends.filter((l) => legendColors(l).some((c) => named.includes(c)));
    understood.push(`Colours: ${colorsLabel(wantColors)}`);
  }
  if (avoidColors.length) {
    req.avoidColors = [...new Set([...req.avoidColors, ...avoidColors])];
    for (const c of avoidColors) delete req.colors[c];
    understood.push(`Without: ${avoidColors.map((c) => COLOR_NAME[c]).join(", ")}`);
  }
  if (newLegends.length) {
    const fitsColors = (l: DeckRequest["legends"][number]) => !Object.keys(req.colors).length || legendColors(l).some((c) => c in req.colors);
    if (!named.length && !newLegends.every(fitsColors)) req.colors = {};
    req.legends = [...req.legends.filter((l) => !newLegends.some((n) => n.name === l.name)), ...newLegends].slice(-3);
    req.skip = [];
    understood.push(`Legend${newLegends.length > 1 ? "s" : ""}: ${newLegends.map((l) => (l.slug ? catalog.bySlug(l.slug)!.displayName : l.name)).join(", ")}`);
  }
  const rogueAi = /\brogue ai\b/.test(norm);
  if (Object.keys(beatColors).length || beatLegends.length || rogueAi) {
    req.beat = { colors: beatColors, legends: beatLegends, ...(rogueAi ? { rogueAi: true } : {}) };
    understood.push(`Beat: ${beatLabel(req.beat)}`);
  }

  // Wishes, from the words that are not names of cards or Legends.
  const free = tokens.filter((_, i) => !taken[i]);
  const rest = free.join(" ");
  const wish = (re: RegExp) => re.test(rest);
  const range = /\b(\d{1,2}) (\d{1,2}) (jednost|unit)/.exec(rest);
  const units = /\b(\d{1,2}) ?(jednost|unit)/.exec(rest);
  const sellPct = /\b(\d{2}) ?(%|procent\w*|percent) ?(\w+ ){0,3}(sprzeda|sell)/.exec(rest);
  if (range) {
    const lo = Math.max(8, Math.min(Number(range[1]), Number(range[2])));
    const hi = Math.min(24, Math.max(Number(range[1]), Number(range[2])));
    req.units = { min: lo, max: hi };
    understood.push(`${lo}–${hi} Units`);
  } else if (units) {
    const n = Math.max(8, Math.min(24, Number(units[1])));
    req.units = { min: n, max: n };
    understood.push(`${n} Units`);
  } else if (wish(/\b(wiecej|duzo|more|many|lots|mnostwo)( \w+)? (jednost|unit)/)) {
    req.units = { min: 17, max: 20 };
    understood.push("More Units");
  } else if (wish(/\b(mniej|malo|fewer|less|few)( \w+)? (jednost|unit)/)) {
    req.units = { min: 10, max: 13 };
    understood.push("Fewer Units");
  }
  if (sellPct && Number(sellPct[1]) >= 30 && Number(sellPct[1]) <= 90) {
    const u = Math.round(40 * (1 - Number(sellPct[1]) / 100));
    req.units = { min: u, max: u };
    req.sellable = null;
    understood.push(`${sellPct[1]}% sellable`);
  } else if (wish(/\b(wiecej|duzo|more|lots|max\w*|wysoki|high)( \w+){0,3} (sprzeda|sell)/)) {
    req.sellable = "more";
    understood.push("More sellable cards");
  } else if (wish(/\b(mniej|malo|fewer|less|niski|low)( \w+){0,3} (sprzeda|sell)/)) {
    req.sellable = "fewer";
    understood.push("Fewer sellable cards");
  }
  const word = (...stems: string[]) => free.some((t) => stems.some((s) => t.startsWith(s)));
  if (word("aggro", "agres", "aggres", "szybk", "fast", "rush", "tani", "cheap") || wish(/\b(low curve|low cost|niska krzywa|niskiej krzywej)\b/)) {
    req.curve = "low";
    understood.push("Low curve");
  } else if (word("control", "kontrol", "late", "pozn", "wolny", "wolna", "slow", "drog", "expensive", "ramp") || wish(/\b(high curve|wysoka krzywa|duze karty|big cards)\b/)) {
    req.curve = "high";
    understood.push("High curve");
  }
  if (word("popularn", "najpopular", "najczesciej", "czest", "popular", "bezpieczn", "safe", "standard") || wish(/\bmost played\b/)) {
    req.goal = "popular";
    understood.push("Most played");
  } else if (word("nietypow", "offmeta", "zaskocz", "surprise", "niszow", "unusual", "oryginaln", "original", "rzadk") || wish(/\boff meta\b/)) {
    req.goal = "rare";
    understood.push("Less played");
  } else if (word("najlepsz", "najmocniejsz", "best", "strongest", "winrate") || wish(/\bwin rate\b/)) {
    req.goal = "winRate";
    understood.push("Best win rate");
  }
  if (!fresh && previous && (word("inny", "inna", "inne", "another", "different", "else") || wish(/\bcos innego\b/))) understood.push("Another archetype");
  return { request: req, understood };
}

function legendColors(l: { name: string; slug: string | null }): Color[] {
  const catalog = getCatalog();
  const cards = l.slug ? [catalog.bySlug(l.slug)!] : catalog.cards.filter((c) => c.type === "legend" && c.name === l.name);
  return [...new Set(cards.map((c) => c.color as Color))];
}

const colorsLabel = (c: Partial<Record<Color, number>>) =>
  (Object.entries(c) as [Color, number][])
    .sort(([, a], [, b]) => b - a)
    .map(([color, n]) => (n ? `${n} ${COLOR_NAME[color]}` : COLOR_NAME[color]))
    .join(" / ");
const beatLabel = (b: NonNullable<DeckRequest["beat"]>) => [b.rogueAi ? "Rogue AI" : "", colorsLabel(b.colors), ...b.legends].filter(Boolean).join(", ");

// ---- answering

export interface DeckAnswer {
  request: DeckRequest;
  /** What this message added. */
  understood: string[];
  /** The whole request so far. */
  summary: string[];
  reply: string[];
  build: MetaBuild | null;
  /** Other archetypes that fit the request (best first). */
  alternatives: { key: string; name: string; winRate: number; games: number; share: number }[];
  /** For "a deck that beats X": the meta decks of X and the candidate decks to test against them. */
  beat: { label: string; decks: Deck[]; candidates: MetaBuild[] } | null;
}

const ramOf = (a: ArchetypeStats) => new Map(a.key.match(/\d-[a-z]+/g)!.map((p) => [p.split("-")[1] as Color, Number(p.split("-")[0])]));

function colorsMatch(want: Partial<Record<Color, number>>, ram: Map<Color, number>): boolean {
  const entries = Object.entries(want) as [Color, number][];
  for (const [c, n] of entries) if (!ram.has(c) || (n > 0 && ram.get(c) !== n)) return false;
  return true;
}

/** The archetype's Legends for the request (the named ones, the best others), or why not. */
function trioFor(a: ArchetypeStats, req: DeckRequest): string[] | null {
  const catalog = getCatalog();
  const ram = ramOf(a);
  if (!colorsMatch(req.colors, ram) || req.avoidColors.some((c) => ram.has(c)) || req.skip.includes(a.key)) return null;
  const fixed: string[] = [];
  for (const l of req.legends) {
    const versions = l.slug ? [l.slug] : catalog.cards.filter((c) => c.type === "legend" && c.name === l.name).map((c) => c.slug);
    const fit = versions.filter((s) => ram.has(catalog.bySlug(s)!.color as Color));
    if (!fit.length) return null;
    const lift = (s: string) => {
      const st = a.legends.find((x) => x.slug === s);
      return st ? trustedLift(st) : -99;
    };
    fixed.push(fit.sort((x, y) => lift(y) - lift(x))[0]!);
  }
  const avoid = catalog.cards.filter((c) => c.type === "legend" && req.avoidLegends.includes(c.name)).map((c) => c.slug);
  const trio = bestLegends(a, fixed, avoid);
  if (!trio) return null;
  if (req.include.some((x) => !legendsFit(trio, x.slug))) return null;
  return trio;
}

function shapeFor(req: DeckRequest): DeckShape {
  const s = { ...META_SHAPE };
  if (req.units) Object.assign(s, { minUnits: req.units.min, maxUnits: req.units.max });
  else if (req.sellable === "more") Object.assign(s, { minUnits: 11, maxUnits: 14 });
  else if (req.sellable === "fewer") Object.assign(s, { minUnits: 17, maxUnits: 20 });
  if (req.curve === "low") s.maxHeavy = 6;
  if (req.curve === "high") s.maxHeavy = 15;
  return s;
}

function rank(list: ArchetypeStats[], goal: DeckRequest["goal"]): ArchetypeStats[] {
  if (goal === "popular") return [...list].sort((a, b) => b.games - a.games);
  if (goal === "rare") return [...list].filter((a) => a.share < 8).sort((a, b) => b.winRate - a.winRate);
  return [...list].sort((a, b) => b.winRate - a.winRate);
}

/** Archetypes for the request, best first; ones whose lists rarely play the Legends asked for go last. */
function candidates(req: DeckRequest): ArchetypeStats[] {
  const catalog = getCatalog();
  const plays = (a: ArchetypeStats) =>
    req.legends.every((l) => a.legends.some((x) => x.popularity >= 5 && (l.slug ? x.slug === l.slug : catalog.bySlug(x.slug)?.name === l.name)));
  const ranked = rank(metaData().archetypes, req.goal);
  return [...ranked.filter(plays), ...ranked.filter((a) => !plays(a))];
}

function buildsFor(req: DeckRequest, limit: number, without: string[] = []): MetaBuild[] {
  const out: MetaBuild[] = [];
  for (const a of candidates(req)) {
    if (out.length >= limit) break;
    if (without.includes(a.key)) continue;
    const trio = trioFor(a, req);
    if (!trio) continue;
    const b = metaBuild(a, trio, shapeFor(req), { include: req.include, exclude: req.exclude, curve: req.curve });
    if (b) out.push(b);
  }
  return out;
}

const lift = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} pts`;

/** The beat target's meta decks from the pool (at most 3). */
function beatDecks(beat: NonNullable<DeckRequest["beat"]>, pool: Deck[]): Deck[] {
  const catalog = getCatalog();
  const b = (d: Deck) => !!beat.rogueAi && !d.id.startsWith("rogue-ai-");
  return pool
    .filter((d) => {
      if (b(d)) return false;
      const key = archetypeKey(d.legends);
      const ram = new Map(key.match(/\d-[a-z]+/g)!.map((p) => [p.split("-")[1] as Color, Number(p.split("-")[0])]));
      if (!colorsMatch(beat.colors, ram)) return false;
      return beat.legends.every((n) => d.legends.some((s) => catalog.bySlug(s)?.name === n));
    })
    .slice(0, 3);
}

/** Reads the message and builds the deck it asks for. `pool`: the meta decks (for "a deck that beats X"). */
export function answerMessage(text: string, previous: DeckRequest | null = null, pool: Deck[] = [], shown: string | null = null): DeckAnswer {
  const read = readMessage(text, previous);
  if (read.understood.includes("Another archetype") && shown && !read.request.skip.includes(shown)) read.request.skip.push(shown);
  return answerRequest(read.request, read.understood, pool);
}

/** Builds the deck a request asks for (from the chat, or from Claude through a tool). */
export function answerRequest(req: DeckRequest, understood: string[] = [], pool: Deck[] = []): DeckAnswer {
  const catalog = getCatalog();
  const read = { understood };
  const name = (s: string) => catalog.bySlug(s)?.displayName ?? s;
  const reply: string[] = [];

  // Everything asked for, or step by step less of it.
  const relax: [string, (r: DeckRequest) => boolean, (r: DeckRequest) => void][] = [
    ["the number of Units", (r) => !!(r.units || r.sellable), (r) => ((r.units = null), (r.sellable = null))],
    ["the curve", (r) => !!r.curve, (r) => (r.curve = null)],
    ["the cards you asked for", (r) => r.include.length > 0, (r) => (r.include = [])],
    ["the archetypes already shown", (r) => r.skip.length > 0, (r) => (r.skip = [])],
    ["the Legends", (r) => r.legends.length + r.avoidLegends.length > 0, (r) => ((r.legends = []), (r.avoidLegends = []))],
    ["the colours", (r) => Object.keys(r.colors).length + r.avoidColors.length > 0, (r) => ((r.colors = {}), (r.avoidColors = []))],
  ];
  let use = req;
  let builds = buildsFor(use, 3);
  const dropped: string[] = [];
  for (const [what, active, drop] of relax) {
    if (builds.length) break;
    if (!active(use)) continue;
    use = structuredClone(use);
    drop(use);
    dropped.push(what);
    builds = buildsFor(use, 3);
  }
  const build = builds[0] ?? null;
  if (!build) return { request: req, understood: read.understood, summary: requestSummary(req), reply: ["The ladder data has no deck for this."], build: null, alternatives: [], beat: null };
  const a = build.archetype;
  const fits = candidates(use).filter((x) => trioFor(x, use));

  if (dropped.length) reply.push(`No deck on the ladder fits all of it. Without ${dropped.join(", ")}:`);
  const legendNames = build.deck.legends.map((s) => catalog.bySlug(s)!.name).join(" / ");
  reply.push(`${a.name}: ${legendNames}.`);
  if (fits.length <= 1) reply.push(`${a.name} on the ladder: ${a.winRate}% win rate over ${a.games} games, ${a.share}% of the field.`);
  else if (use.goal === "popular") reply.push(`The most played of the ${fits.length} archetypes that fit: ${a.share}% of the field, ${a.winRate}% win rate over ${a.games} games.`);
  else if (use.goal === "rare") reply.push(`A less played archetype that still wins: ${a.share}% of the field, ${a.winRate}% win rate over ${a.games} games.`);
  else reply.push(`The best ladder win rate of the ${fits.length} archetypes that fit: ${a.winRate}% over ${a.games} games (${a.share}% of the field).`);
  for (const l of req.legends.filter((x) => !build.deck.legends.some((s) => catalog.bySlug(s)!.name === x.name))) {
    reply.push(`${l.name} is ${legendColors(l).map((c) => COLOR_NAME[c]).join(" or ")}: no room for that in ${a.name}.`);
  }
  for (const l of use.legends) {
    const slug = build.deck.legends.find((s) => catalog.bySlug(s)!.name === l.name);
    const st = slug ? a.legends.find((x) => x.slug === slug) : undefined;
    if (slug) reply.push(st ? `${name(slug)} — in ${st.popularity}% of these lists, ${lift(st.lift)}.` : `${name(slug)} — rarely played in this archetype, so the ladder says little about it.`);
  }
  for (const inc of use.include) {
    const c = build.cards.find((x) => x.slug === inc.slug);
    if (!c) continue;
    reply.push(c.stat ? `${c.copies} × ${name(c.slug)} — in ${c.stat.popularity}% of these lists, ${lift(c.stat.lift)}.` : `${c.copies} × ${name(c.slug)} — not among this archetype's usual cards.`);
  }
  for (const inc of req.include.filter((x) => !build.cards.some((c) => c.slug === x.slug))) {
    const card = catalog.bySlug(inc.slug)!;
    reply.push(`${card.displayName} does not fit these Legends (${COLOR_NAME[card.color as Color]}, RAM ${card.ram ?? 0}).`);
  }
  for (const ex of use.exclude) {
    const st = a.cards.find((x) => x.slug === ex);
    if (st) reply.push(`Without ${name(ex)} (in ${st.popularity}% of these lists, ${lift(st.lift)}).`);
  }
  const s = shapeOf(build.deck.main);
  reply.push(`${s.units} Units, ${Math.round(s.sellable * 100)}% sellable, ${s.heavy} costing 5+.`);

  let beat: DeckAnswer["beat"] = null;
  if (req.beat) {
    const label = beatLabel(req.beat);
    const decks = beatDecks(req.beat, pool);
    const targetKeys = new Set(decks.map((d) => archetypeKey(d.legends)));
    const tests = buildsFor(use, 3, [...targetKeys]);
    beat = { label, decks, candidates: tests.length ? tests : builds };
    reply.push(
      decks.length
        ? `To find which deck beats ${label}: "Test" plays ${beat.candidates.length} deck${beat.candidates.length > 1 ? "s" : ""} against ${decks.length} meta deck${decks.length > 1 ? "s" : ""} of ${label} with Strong bots.`
        : `The meta pool has no deck of ${label} to test against: add one under "Meta pool".`,
    );
  }
  const alternatives = fits
    .filter((x) => x.key !== a.key)
    .slice(0, 3)
    .map(({ key, name: n, winRate, games, share }) => ({ key, name: n, winRate, games, share }));
  return { request: use, understood: read.understood, summary: requestSummary(use), reply, build, alternatives, beat };
}

/** Everything the request holds now (this message and the earlier ones). */
export function requestSummary(r: DeckRequest): string[] {
  const catalog = getCatalog();
  const name = (s: string) => catalog.bySlug(s)?.displayName ?? s;
  const out: string[] = [];
  if (Object.keys(r.colors).length) out.push(colorsLabel(r.colors));
  if (r.avoidColors.length) out.push(`Without ${r.avoidColors.map((c) => COLOR_NAME[c]).join(", ")}`);
  for (const l of r.legends) out.push(l.slug ? name(l.slug) : l.name);
  for (const n of r.avoidLegends) out.push(`Without ${n}`);
  for (const i of r.include) out.push(`${i.copies ? `${i.copies} × ` : ""}${name(i.slug)}`);
  for (const e of r.exclude) out.push(`Without ${name(e)}`);
  if (r.units) out.push(r.units.min === r.units.max ? `${r.units.min} Units` : `${r.units.min}–${r.units.max} Units`);
  if (r.sellable) out.push(r.sellable === "more" ? "More sellable cards" : "Fewer sellable cards");
  if (r.curve) out.push(r.curve === "low" ? "Low curve" : "High curve");
  if (r.goal !== "winRate") out.push(r.goal === "popular" ? "Most played" : "Less played");
  if (r.beat) out.push(`Beat: ${beatLabel(r.beat)}`);
  return out;
}
