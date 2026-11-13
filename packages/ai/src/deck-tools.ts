/**
 * Tools for Claude in the Deck Lab's chat (the player's own API key, called from the browser): the ladder
 * data and the deck builder behind one function per tool. Each returns text for the model and, when it made
 * or checked a whole deck, that deck for the page to show. Same numbers as the built-in chat and Deck Doctor.
 */
import { checkDeckLegality, getCatalog, normalizeCardName, type Deck } from "@cpai/core";
import { shapeOf } from "./lab.ts";
import { answerRequest, emptyRequest, mainVariant, type Color, type DeckRequest } from "./deck-request.ts";
import { archetypeOf, metaAdvice, metaData, type ArchetypeStats, type CardStat, type MetaBuild } from "./meta-stats.ts";

export interface ToolAnswer {
  content: string;
  build?: MetaBuild;
}

const COLORS = ["red", "blue", "green", "yellow"] as const;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} pts`;

function cardText(slug: string): string {
  const c = getCatalog().bySlug(slug) as unknown as { abilities?: { text?: string }[]; attachment?: { text?: string } } | undefined;
  return [...(c?.abilities ?? []).map((a) => a.text), c?.attachment?.text].filter(Boolean).join(" ");
}

function cardLine(slug: string): string {
  const c = getCatalog().bySlug(slug);
  if (!c) return slug;
  const power = (c as unknown as { power?: number | null }).power;
  return `${c.displayName} [${c.type}, ${c.color}, cost ${c.cost ?? 0}, RAM ${c.ram ?? 0}${power != null ? `, power ${power}` : ""}${c.hasSellTag ? ", sell tag" : ""}]`;
}

const statLine = (s: CardStat | null | undefined) =>
  s ? `in ${s.popularity}% of the lists, ${s.copies} copies on average, ${pts(s.lift)} over ${s.games} games` : "not among this archetype's top cards";

/** A card or Legend by name: full name, or a bare name that is unambiguous (Units named after Legends: the one the ladder plays). */
function resolve(name: string, legend: boolean): { slug: string } | { error: string } {
  const catalog = getCatalog();
  const pool = catalog.cards.filter((c) => (c.type === "legend") === legend);
  const n = normalizeCardName(name);
  const full = pool.filter((c) => normalizeCardName(c.displayName) === n);
  if (full.length) return { slug: full[0]!.slug };
  const bare = pool.filter((c) => normalizeCardName(c.name) === n);
  if (bare.length === 1) return { slug: bare[0]!.slug };
  if (bare.length > 1) {
    if (!legend) return { slug: mainVariant(bare.map((c) => c.slug)) };
    return { error: `${name} has ${bare.length} versions: ${bare.map((c) => `${c.displayName} (${c.color})`).join(", ")}. Use the full name.` };
  }
  const starts = pool.filter((c) => normalizeCardName(c.displayName).startsWith(n));
  if (starts.length === 1) return { slug: starts[0]!.slug };
  return { error: `No ${legend ? "Legend" : "card"} named "${name}"${starts.length ? `; did you mean ${starts.slice(0, 5).map((c) => c.displayName).join(", ")}?` : "; use search_cards."}` };
}

function deckText(b: MetaBuild): string {
  const catalog = getCatalog();
  const a = b.archetype;
  const s = shapeOf(b.deck.main);
  const legends = b.deck.legends.map((slug) => {
    const st = a.legends.find((l) => l.slug === slug);
    return `${cardLine(slug)} — ${st ? `in ${st.popularity}% of the lists, ${pts(st.lift)}` : "rarely played in this archetype"}`;
  });
  const order = { unit: 0, gear: 1, program: 2 } as Record<string, number>;
  const cards = [...b.cards].sort((x, y) => (order[catalog.bySlug(x.slug)!.type] ?? 3) - (order[catalog.bySlug(y.slug)!.type] ?? 3) || (catalog.bySlug(x.slug)!.cost ?? 0) - (catalog.bySlug(y.slug)!.cost ?? 0));
  return [
    `${a.name} (ladder: ${a.winRate}% win rate over ${a.games} games, ${a.share}% of the field)`,
    `Legends:`,
    ...legends.map((l) => `- ${l}`),
    `Main Deck (${s.size} cards: ${s.units} Units, ${Math.round(s.sellable * 100)}% sellable, ${s.heavy} costing 5+):`,
    ...cards.map((c) => `- ${c.copies} × ${cardLine(c.slug)} — ${c.asked ? "asked for; " : ""}${statLine(c.stat)}`),
  ].join("\n");
}

export function listArchetypes(): ToolAnswer {
  const m = metaData();
  const lines = m.archetypes.map((a) => {
    const legends = [...a.legends]
      .filter((l) => l.popularity >= 5)
      .sort((x, y) => y.popularity - x.popularity)
      .slice(0, 6)
      .map((l) => `${l.name} ${l.popularity}% ${pts(l.lift)}`)
      .join("; ");
    return `- ${a.key} "${a.name}": ${a.winRate}% win rate, ${a.games} games, ${a.share}% of the field. Legends: ${legends}`;
  });
  return { content: [`ChoomBattler ranked games, Core BO1, last 30 days (read on ${m.date}). Archetypes by colour (RAM per colour from the Legends):`, ...lines].join("\n") };
}

export function archetypeCards(key: string): ToolAnswer {
  const a = metaData().archetypes.find((x) => x.key === key || x.name.toLowerCase() === key.toLowerCase());
  if (!a) return { content: `No archetype "${key}". Keys: ${metaData().archetypes.map((x) => x.key).join(", ")}` };
  const legends = [...a.legends].sort((x, y) => y.popularity - x.popularity).map((l) => `- ${cardLine(l.slug)} — in ${l.popularity}% of the lists, ${pts(l.lift)} over ${l.games} games`);
  const cards = [...a.cards].sort((x, y) => y.popularity - x.popularity).map((c) => `- ${cardLine(c.slug)} — ${statLine(c)}`);
  return {
    content: [
      `${a.name} (${a.key}): ${a.winRate}% win rate over ${a.games} games, ${a.share}% of the field.`,
      `Lift: the win rate of lists with the card minus the archetype's; trust it more with more games.`,
      `Legends:`,
      ...legends,
      `Cards:`,
      ...cards,
    ].join("\n"),
  };
}

export function searchCards(input: { text?: string; color?: string; type?: string; max_cost?: number; sellable?: boolean }): ToolAnswer {
  const words = normalizeCardName(input.text ?? "").split(" ").filter(Boolean);
  const hits = getCatalog()
    .cards.filter((c) => c.legality === "legal" || c.legality === undefined)
    .filter((c) => !input.color || c.color === input.color)
    .filter((c) => !input.type || c.type === input.type)
    .filter((c) => input.max_cost === undefined || (c.cost ?? 0) <= input.max_cost)
    .filter((c) => input.sellable === undefined || !!c.hasSellTag === input.sellable)
    .filter((c) => {
      const hay = normalizeCardName(`${c.displayName} ${cardText(c.slug)} ${(c.classifications ?? []).join(" ")}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, 30);
  if (!hits.length) return { content: "No cards found." };
  return { content: hits.map((c) => `- ${cardLine(c.slug)}: ${cardText(c.slug).slice(0, 220) || "(no text)"}`).join("\n") };
}

export interface BuildInput {
  archetype?: string;
  legends?: string[];
  include?: { card: string; copies?: number }[];
  exclude?: string[];
  units_min?: number;
  units_max?: number;
  curve?: "low" | "high";
  goal?: "winRate" | "popular" | "rare";
  avoid_colors?: string[];
}

export function buildDeck(input: BuildInput, pool: Deck[] = []): ToolAnswer {
  const req: DeckRequest = emptyRequest();
  const errors: string[] = [];
  if (input.archetype) {
    const a = metaData().archetypes.find((x) => x.key === input.archetype || x.name.toLowerCase() === input.archetype!.toLowerCase());
    if (!a) errors.push(`No archetype "${input.archetype}" (keys: ${metaData().archetypes.map((x) => x.key).join(", ")}).`);
    else for (const m of a.key.matchAll(/(\d)-([a-z]+)/g)) req.colors[m[2] as Color] = Number(m[1]);
  }
  for (const name of input.legends ?? []) {
    const r = resolve(name, true);
    const bare = getCatalog().cards.filter((c) => c.type === "legend" && normalizeCardName(c.name) === normalizeCardName(name));
    if (bare.length) req.legends.push({ name: bare[0]!.name, slug: null });
    else if ("slug" in r) req.legends.push({ name: getCatalog().bySlug(r.slug)!.name, slug: r.slug });
    else errors.push(r.error);
  }
  for (const inc of input.include ?? []) {
    const r = resolve(inc.card, false);
    if ("slug" in r) req.include.push({ slug: r.slug, copies: inc.copies ? Math.max(1, Math.min(3, inc.copies)) : null });
    else errors.push(r.error);
  }
  for (const name of input.exclude ?? []) {
    const r = resolve(name, false);
    if ("slug" in r) req.exclude.push(r.slug);
    else errors.push(r.error);
  }
  if (input.units_min !== undefined || input.units_max !== undefined) {
    const min = Math.max(6, Math.min(30, input.units_min ?? input.units_max ?? 15));
    req.units = { min, max: Math.max(min, Math.min(30, input.units_max ?? min)) };
  }
  req.curve = input.curve ?? null;
  req.goal = input.goal ?? "winRate";
  req.avoidColors = (input.avoid_colors ?? []).filter((c): c is Color => (COLORS as readonly string[]).includes(c));
  if (errors.length) return { content: `Not built:\n${errors.join("\n")}` };
  const answer = answerRequest(req, [], pool);
  if (!answer.build) return { content: answer.reply.join("\n") };
  const notes = answer.reply.filter((r) => /^No deck on the ladder|does not fit|no room for that/.test(r));
  return {
    content: [
      deckText(answer.build),
      ...(notes.length ? ["Notes:", ...notes.map((n) => `- ${n}`)] : []),
      answer.alternatives.length ? `Other archetypes that fit: ${answer.alternatives.map((x) => `${x.name} (${x.key}, ${x.winRate}%)`).join(", ")}` : "",
      "The page now shows this deck to the player.",
    ]
      .filter(Boolean)
      .join("\n"),
    build: answer.build,
  };
}

export interface CheckInput {
  legends: string[];
  cards: { card: string; copies: number }[];
}

export function checkDeckList(input: CheckInput): ToolAnswer {
  const errors: string[] = [];
  const legends: string[] = [];
  for (const name of input.legends ?? []) {
    const r = resolve(name, true);
    if ("slug" in r) legends.push(r.slug);
    else errors.push(r.error);
  }
  const main: Record<string, number> = {};
  for (const c of input.cards ?? []) {
    const r = resolve(c.card, false);
    if ("slug" in r) main[r.slug] = (main[r.slug] ?? 0) + Math.max(1, Math.round(c.copies));
    else errors.push(r.error);
  }
  if (errors.length) return { content: `Not checked:\n${errors.join("\n")}` };
  const deck: Deck = { id: `claude-${Date.now().toString(36)}`, name: legends.map((s) => getCatalog().bySlug(s)!.name).join(" / "), legends, main };
  const problems = checkDeckLegality(deck).filter((p) => p.severity === "error").map((p) => `- ${p.message}`);
  const check = { legal: problems.length === 0 };
  const a: ArchetypeStats | null = legends.length === 3 ? archetypeOf(legends) : null;
  const advice = metaAdvice(deck);
  const s = shapeOf(main);
  const lines = [
    check.legal ? "The deck is legal." : `The deck is not legal:\n${problems.join("\n")}`,
    `${s.size} cards: ${s.units} Units, ${Math.round(s.sellable * 100)}% sellable, ${s.heavy} costing 5+.`,
  ];
  if (!a) lines.push("The ladder data has no lists with these Legends' colours.");
  else {
    lines.push(`${a.name}: ${a.winRate}% win rate over ${a.games} games, ${a.share}% of the field.`);
    lines.push("Cards on the ladder:", ...advice.cards.map((c) => `- ${c.copies} × ${cardLine(c.slug)} — ${statLine(c.stat)}`));
    if (advice.swaps.length)
      lines.push("Deck Doctor (what the winning lists play instead):", ...advice.swaps.map((w) => `- −${w.copies} ${cardLine(w.out)} → +${w.copies} ${cardLine(w.in)} (${statLine(w.inStat)})`));
  }
  if (!check.legal || !a) return { content: lines.join("\n") };
  const build: MetaBuild = {
    archetype: a,
    deck,
    legends: legends.map((slug) => a.legends.find((l) => l.slug === slug)).filter((l): l is NonNullable<typeof l> => !!l),
    cards: advice.cards.map((c) => ({ slug: c.slug, copies: c.copies, stat: c.stat })),
  };
  lines.push("The page now shows this deck to the player.");
  return { content: lines.join("\n"), build };
}

/** One tool call from Claude. */
export function runDeckTool(name: string, input: unknown, pool: Deck[] = []): ToolAnswer {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "list_archetypes":
      return listArchetypes();
    case "archetype_cards":
      return archetypeCards(String(i.archetype ?? ""));
    case "search_cards":
      return searchCards(i as Parameters<typeof searchCards>[0]);
    case "build_deck":
      return buildDeck(i as BuildInput, pool);
    case "check_deck":
      return checkDeckList(i as unknown as CheckInput);
    default:
      return { content: `Unknown tool ${name}.` };
  }
}


