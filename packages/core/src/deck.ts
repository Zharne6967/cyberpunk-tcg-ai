import type { DeckList } from "@tcg/cyberpunk-engine";
import type { CardDefinition } from "@tcg/cyberpunk-types";
import { validateDeck } from "@tcg/cyberpunk-utils";
import { getCatalog } from "./catalog.ts";

/** Our on-disk deck format (data/decks/*.json). Card references are slugs. */
export interface Deck {
  id: string;
  name: string;
  /** Where the list came from (starter, authored-botlab, tcgcontender, user, generated...). */
  source?: { kind: string; url?: string; author?: string; date?: string; note?: string };
  legends: string[];
  /** slug -> copies */
  main: Record<string, number>;
  /** Tournament sideboard (Tournament Rules 3.4.4: 7 main-deck cards, no Legends). Not used in games. */
  sideboard?: Record<string, number>;
}

export interface DeckProblem {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface ParsedDeckText {
  name?: string;
  legends: string[];
  main: Record<string, number>;
  sideboard: Record<string, number>;
  unresolved: { line: string; name: string }[];
}

const COUNT_LINE = /^\s*(\d+)\s*[xX×]?\s+(.+?)\s*$/;
const TRAILING_COUNT_LINE = /^\s*(.+?)\s+[xX×]\s*(\d+)\s*$/;
const SECTION = /^\s*(legends?|main\s*deck|main|deck|sideboard|side\s*deck)\s*(\(\d+\))?\s*:?\s*$/i;

/**
 * Parse a plain-text deck list as shared on deck sites, e.g.
 *   Legends
 *   1 Dum Dum: Maelstrom Triggerman
 *   Main Deck (40)
 *   3x 6th Street Recruits
 * Legends are detected by card type as well, so lists without section headers work too.
 */
export function parseDeckText(text: string): ParsedDeckText {
  const catalog = getCatalog();
  const out: ParsedDeckText = { legends: [], main: {}, sideboard: {}, unresolved: [] };
  let section: "legends" | "main" | "side" | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[-*•]\s*/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const sec = SECTION.exec(line);
    if (sec) {
      const s = sec[1]!.toLowerCase();
      section = s.startsWith("legend") ? "legends" : s.startsWith("side") ? "side" : "main";
      continue;
    }
    let count: number | undefined;
    let name: string | undefined;
    const m1 = COUNT_LINE.exec(line);
    const m2 = TRAILING_COUNT_LINE.exec(line);
    if (m1) {
      count = Number(m1[1]);
      name = m1[2];
    } else if (m2) {
      count = Number(m2[2]);
      name = m2[1];
    } else if (out.legends.length === 0 && Object.keys(out.main).length === 0 && !out.name) {
      out.name = line; // first free-text line = deck title
      continue;
    } else {
      out.unresolved.push({ line: rawLine, name: line });
      continue;
    }
    const card = catalog.byName(name!);
    if (!card) {
      out.unresolved.push({ line: rawLine, name: name! });
      continue;
    }
    if (section === "side") {
      out.sideboard[card.slug] = (out.sideboard[card.slug] ?? 0) + count!;
    } else if (card.type === "legend" && section !== "main") {
      for (let i = 0; i < count!; i++) out.legends.push(card.slug);
    } else {
      out.main[card.slug] = (out.main[card.slug] ?? 0) + count!;
    }
  }
  return out;
}

export function deckFromText(text: string, meta: Pick<Deck, "id"> & Partial<Deck>): Deck & { unresolved: ParsedDeckText["unresolved"] } {
  const parsed = parseDeckText(text);
  return {
    id: meta.id,
    name: meta.name ?? parsed.name ?? meta.id,
    source: meta.source,
    legends: parsed.legends,
    main: parsed.main,
    ...(Object.keys(parsed.sideboard).length ? { sideboard: parsed.sideboard } : {}),
    unresolved: parsed.unresolved,
  };
}

export function deckSize(deck: Deck): number {
  return Object.values(deck.main).reduce((a, b) => a + b, 0);
}

export function expandMain(deck: Deck): string[] {
  const out: string[] = [];
  for (const [slug, n] of Object.entries(deck.main)) for (let i = 0; i < n; i++) out.push(slug);
  return out;
}

export function resolveDeckCards(deck: Deck): { legends: CardDefinition[]; main: CardDefinition[]; missing: string[] } {
  const catalog = getCatalog();
  const missing: string[] = [];
  const pick = (slug: string) => {
    const c = catalog.bySlug(slug);
    if (!c) missing.push(slug);
    return c;
  };
  return {
    legends: deck.legends.map(pick).filter((c): c is CardDefinition => !!c),
    main: expandMain(deck).map(pick).filter((c): c is CardDefinition => !!c),
    missing,
  };
}

/** Official deck-construction checks (3 Legends, 40-50 cards, max 3 copies, RAM per colour). */
export function checkDeckLegality(deck: Deck): DeckProblem[] {
  const { legends, main, missing } = resolveDeckCards(deck);
  const problems: DeckProblem[] = missing.map((slug) => ({
    severity: "error" as const,
    code: "UNKNOWN_CARD",
    message: `Unknown card: ${slug}`,
  }));
  for (const e of validateDeck(legends, main)) {
    problems.push({ severity: "error", code: e.code, message: e.message });
  }
  // Tournament Rules 3.4.4: a sideboard holds 7 main-deck cards and no Legends.
  const side = Object.entries(deck.sideboard ?? {});
  const sideCount = side.reduce((s, [, n]) => s + n, 0);
  if (sideCount > 7) problems.push({ severity: "error", code: "SIDEBOARD_SIZE", message: `Sideboard must have 7 cards, got ${sideCount}` });
  else if (sideCount > 0 && sideCount < 7) problems.push({ severity: "warning", code: "SIDEBOARD_SIZE", message: `Sideboard must have 7 cards, got ${sideCount}` });
  const catalog = getCatalog();
  for (const [slug] of side) {
    const c = catalog.bySlug(slug);
    if (c?.type === "legend") problems.push({ severity: "error", code: "SIDEBOARD_LEGEND", message: `Legend "${c.displayName}" cannot be in the sideboard` });
  }
  return problems;
}

/** Legal for play: no errors (warnings such as an incomplete sideboard do not block games). */
export function isDeckLegal(deck: Deck): boolean {
  return checkDeckLegality(deck).every((p) => p.severity !== "error");
}

export function toEngineDeckList(deck: Deck, playerId: string, playerName = playerId): DeckList {
  return { playerId, playerName, legends: [...deck.legends], mainDeck: expandMain(deck) };
}

export function deckToText(deck: Deck): string {
  const catalog = getCatalog();
  const name = (slug: string) => catalog.bySlug(slug)?.displayName ?? slug;
  const lines = [deck.name, "", "Legends"];
  for (const slug of deck.legends) lines.push(`1 ${name(slug)}`);
  lines.push("", `Main Deck (${deckSize(deck)})`);
  for (const [slug, n] of Object.entries(deck.main)) lines.push(`${n} ${name(slug)}`);
  const side = Object.entries(deck.sideboard ?? {});
  if (side.length) {
    lines.push("", `Sideboard (${side.reduce((s, [, n]) => s + n, 0)})`);
    for (const [slug, n] of side) lines.push(`${n} ${name(slug)}`);
  }
  return lines.join("\n");
}
