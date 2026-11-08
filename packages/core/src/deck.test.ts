import { describe, expect, it } from "vitest";
import { checkDeckLegality, deckFromText, deckSize, deckToText, getCatalog, isDeckLegal, normalizeCardName, parseDeckText } from "./index.ts";

// Real tournament list as published on tcgcontender.com (Top 16, Standard).
const TCGCONTENDER = `
Legends (3)
1x Dexter DeShawn: Off the Grid
1x Dum Dum: Maelstrom Triggerman
1x River Ward: Detective on the Hunt
Main Deck (41)
3x 6th Street Recruits
3x Adrenaline Converter
3x Gorilla Arms
3x Johnny Silverhand: Never Stop Fighting
3x Kiroshi Optics
3x Mandibular Upgrade
3x Mantis Blades
3x Safety Override
3x Satori: Sword of Saburo
3x Secondhand Bombus
3x Sketchy Ripper
3x Viktor Vektor: You Might Feel a Little Pinch
3x Zetatech Faceplate
2x Arasaka Emergency Radioport
Sideboard (0)
`;

describe("card names", () => {
  it("normalizes punctuation, dashes and accents", () => {
    expect(normalizeCardName("Judy Álvarez — Braindance Maestro")).toBe(normalizeCardName("judy alvarez: braindance maestro"));
  });
  it("resolves names written in different site styles", () => {
    const c = getCatalog();
    for (const n of ["Goro Takemura: Hands Unclean", "Goro Takemura — Hands Unclean", "Goro Takemura - Hands Unclean", "goro-takemura-hands-unclean"]) {
      expect(c.byName(n)?.slug).toBe("goro-takemura-hands-unclean");
    }
    expect(c.byName("Satori")?.slug).toBe("satori-sword-of-saburo");
  });
  it("does not guess between same-named Legends", () => {
    expect(getCatalog().byName("V")).toBeUndefined();
  });
});

describe("deck text parsing", () => {
  it("parses a tcgcontender list into a legal deck", () => {
    const parsed = parseDeckText(TCGCONTENDER);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.legends).toHaveLength(3);
    const deck = deckFromText(TCGCONTENDER, { id: "t" });
    expect(deckSize(deck)).toBe(41);
    expect(checkDeckLegality(deck)).toEqual([]);
  });
  it("round-trips through deckToText", () => {
    const deck = deckFromText(TCGCONTENDER, { id: "t", name: "Test" });
    const again = deckFromText(deckToText(deck), { id: "t" });
    expect(again.main).toEqual(deck.main);
    expect(again.legends).toEqual(deck.legends);
  });
  it("reports cards it cannot resolve instead of dropping them silently", () => {
    const parsed = parseDeckText("Legends\n1 Nobody Special\nMain Deck\n3 Mantis Blades");
    expect(parsed.unresolved.map((u) => u.name)).toEqual(["Nobody Special"]);
  });
});

describe("sideboard (Tournament Rules 3.4.4)", () => {
  const base = `Legends
1 Dexter DeShawn: Off the Grid
1 Dum Dum: Maelstrom Triggerman
1 River Ward: Detective on the Hunt
Main Deck
3x 6th Street Recruits
3x Adrenaline Converter
3x Gorilla Arms
3x Johnny Silverhand: Never Stop Fighting
3x Kiroshi Optics
3x Mandibular Upgrade
3x Mantis Blades
3x Safety Override
3x Satori: Sword of Saburo
3x Secondhand Bombus
3x Sketchy Ripper
3x Viktor Vektor: You Might Feel a Little Pinch
3x Zetatech Faceplate
2x Arasaka Emergency Radioport
`;
  it("parses, exports and checks a sideboard", () => {
    const deck = deckFromText(`${base}Sideboard\n3x Floor It\n2x Les Elemens\n`, { id: "sb" });
    expect(deck.unresolved).toEqual([]);
    expect(Object.values(deck.sideboard ?? {}).reduce((a, b) => a + b, 0)).toBe(5);
    expect(deckToText(deck)).toContain("Sideboard (5)");
    // 5 cards: allowed for play, but a tournament sideboard needs 7 (warning only).
    expect(checkDeckLegality(deck).map((p) => [p.code, p.severity])).toContainEqual(["SIDEBOARD_SIZE", "warning"]);
    const main = checkDeckLegality(deck).filter((p) => p.severity === "error");
    expect(isDeckLegal(deck)).toBe(main.length === 0);
  });
  it("rejects Legends and more than 7 cards", () => {
    const deck = deckFromText(`${base}Sideboard\n3x Floor It\n3x Les Elemens\n2x Gorilla Arms\n`, { id: "sb2" });
    deck.sideboard = { ...deck.sideboard, [getCatalog().byName("Goro Takemura: Hands Unclean")!.slug]: 1 };
    const codes = checkDeckLegality(deck).filter((p) => p.severity === "error").map((p) => p.code);
    expect(codes).toContain("SIDEBOARD_SIZE");
    expect(codes).toContain("SIDEBOARD_LEGEND");
  });
});