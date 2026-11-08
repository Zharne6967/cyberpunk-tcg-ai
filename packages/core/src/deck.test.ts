import { describe, expect, it } from "vitest";
import { checkDeckLegality, deckFromText, deckSize, deckToText, getCatalog, normalizeCardName, parseDeckText } from "./index.ts";

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
