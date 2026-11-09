import { getCatalog, type Deck } from "@cpai/core";
import type { AnalysisFinding, AnalysisReport, CounterDeck, DeckProfile, KeyCard, MatchupResult, ThreatCard, WinRate } from "@cpai/core/protocol";
import type { MatchOutcome, MatchSpec } from "./match.ts";
import { getBot } from "./strategies.ts";

/**
 * Deck analysis (stage 5c): the deck plays a gauntlet against a pool of decks (bot vs bot, seats
 * swapped), then the results are turned into a report — matchups, weaknesses, how to beat it and
 * the best counter deck from the pool. Running the games is up to the caller (threads or in-process).
 */

export function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function winRate(wins: number, games: number): WinRate {
  return { games, wins, rate: games ? wins / games : 0, ci: wilson(wins, games) };
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function deckProfile(deck: Deck): DeckProfile {
  const catalog = getCatalog();
  const p: DeckProfile = { size: 0, units: 0, gears: 0, programs: 0, averageCost: 0, curve: [0, 0, 0, 0, 0, 0, 0, 0], sellable: 0, earlyUnits: 0, highCost: 0, blockers: 0, goSolo: 0, averageUnitPower: 0, colors: [] };
  let costSum = 0;
  let powerSum = 0;
  for (const [slug, n] of Object.entries(deck.main)) {
    const c = catalog.bySlug(slug);
    if (!c) continue;
    const cost = typeof c.cost === "number" ? c.cost : 0;
    p.size += n;
    costSum += cost * n;
    p.curve[Math.min(7, Math.max(0, cost))]! += n;
    if (c.hasSellTag) p.sellable += n;
    if (cost >= 5) p.highCost += n;
    if (c.type === "unit") {
      p.units += n;
      powerSum += (c.power ?? 0) * n;
      if (cost <= 2) p.earlyUnits += n;
      if (c.keywords.includes("blocker")) p.blockers += n;
      if (c.keywords.includes("goSolo")) p.goSolo += n;
    } else if (c.type === "gear") p.gears += n;
    else if (c.type === "program") p.programs += n;
  }
  p.averageCost = round(p.size ? costSum / p.size : 0);
  p.averageUnitPower = round(p.units ? powerSum / p.units : 0, 1);
  p.colors = [...new Set(deck.legends.map((s) => catalog.bySlug(s)?.color).filter((c): c is NonNullable<typeof c> => !!c))];
  return p;
}

function averageProfile(profiles: DeckProfile[]): DeckProfile {
  const n = Math.max(1, profiles.length);
  const avg = (f: (p: DeckProfile) => number, d = 1) => round(profiles.reduce((s, p) => s + f(p), 0) / n, d);
  return {
    size: avg((p) => p.size),
    units: avg((p) => p.units),
    gears: avg((p) => p.gears),
    programs: avg((p) => p.programs),
    averageCost: avg((p) => p.averageCost, 2),
    curve: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => avg((p) => p.curve[i] ?? 0)),
    sellable: avg((p) => p.sellable),
    earlyUnits: avg((p) => p.earlyUnits),
    highCost: avg((p) => p.highCost),
    blockers: avg((p) => p.blockers),
    goSolo: avg((p) => p.goSolo),
    averageUnitPower: avg((p) => p.averageUnitPower),
    colors: [],
  };
}

/** Same card list (ignores id/name), so a pasted copy of a pool deck does not play itself. */
function sameList(a: Deck, b: Deck): boolean {
  const key = (d: Deck) => JSON.stringify([[...d.legends].sort(), Object.entries(d.main).sort(([x], [y]) => x.localeCompare(y))]);
  return key(a) === key(b);
}

export interface GauntletSpec extends MatchSpec {
  /** Index into the opponent list. */
  opponent: number;
}

/** Every game of the gauntlet: `perMatchup` games against each opponent, seats swapped in pairs. */
export function planGauntlet(target: Deck, pool: Deck[], perMatchup: number, bot = "greedy", seed = "analysis"): { opponents: Deck[]; specs: GauntletSpec[] } {
  const opponents = pool.filter((d) => d.id !== target.id && !sameList(d, target));
  const per = Math.max(2, Math.floor(perMatchup / 2) * 2);
  const specs: GauntletSpec[] = [];
  opponents.forEach((deckB, opponent) => {
    for (let g = 0; g < per; g++)
      specs.push({ opponent, deckA: target, deckB, strategyA: bot, strategyB: bot, seed: `${seed}-${opponent}-${g >> 1}`, aSeat: g % 2 === 0 ? "p1" : "p2" });
  });
  return { opponents, specs };
}

const isWin = (o: MatchOutcome) => (o.winner === "A" ? 1 : 0);

/** RAM per colour from the Legends (cards of a colour may cost up to that much RAM). */
export function legendRamBudget(deck: Deck): Record<string, number> {
  const catalog = getCatalog();
  const out: Record<string, number> = {};
  for (const slug of deck.legends) {
    const c = catalog.bySlug(slug);
    if (c) out[c.color] = (out[c.color] ?? 0) + (c.ram ?? 0);
  }
  return out;
}

export function buildReport(target: Deck, opponents: Deck[], specs: GauntletSpec[], outcomes: (MatchOutcome | null)[], ms: number, bot = "greedy"): AnalysisReport {
  const catalog = getCatalog();
  const nameOf = (slug: string) => catalog.bySlug(slug)?.displayName ?? slug;
  const games = specs.map((spec, i) => ({ spec, o: outcomes[i] })).filter((g): g is { spec: GauntletSpec; o: MatchOutcome } => !!g.o);
  const all = games.map((g) => g.o);
  const overall = winRate(all.reduce((s, o) => s + isWin(o), 0), all.length);
  const avgTurns = (os: MatchOutcome[]) => round(os.length ? os.reduce((s, o) => s + o.turns, 0) / os.length : 0, 1);

  // Matchups (worst first).
  const matchupRate: number[] = [];
  const matchups: MatchupResult[] = opponents.map((d, i) => {
    const os = games.filter((g) => g.spec.opponent === i).map((g) => g.o);
    const r = winRate(os.reduce((s, o) => s + isWin(o), 0), os.length);
    matchupRate[i] = r.rate;
    return { deckId: d.id, deckName: d.name, legends: d.legends, averageTurns: avgTurns(os), ...r };
  });
  matchups.sort((a, b) => a.rate - b.rate || a.deckName.localeCompare(b.deckName));

  const subset = (f: (o: MatchOutcome) => boolean) => {
    const os = all.filter(f);
    return winRate(os.reduce((s, o) => s + isWin(o), 0), os.length);
  };
  const sortedTurns = all.map((o) => o.turns).sort((a, b) => a - b);
  const medianTurns = sortedTurns.length ? sortedTurns[Math.floor(sortedTurns.length / 2)]! : 0;

  // Cards of the analysed deck.
  const mainSlugs = [...new Set([...target.legends, ...Object.keys(target.main)])];
  const keyCards: KeyCard[] = mainSlugs
    .map((slug) => {
      const played = all.filter((o) => o.cardsA.played.includes(slug));
      const notPlayed = all.filter((o) => !o.cardsA.played.includes(slug));
      return {
        slug,
        playedIn: all.length ? played.length / all.length : 0,
        whenPlayed: winRate(played.reduce((s, o) => s + isWin(o), 0), played.length),
        whenNotPlayed: winRate(notPlayed.reduce((s, o) => s + isWin(o), 0), notPlayed.length),
      };
    })
    .filter((k) => k.whenPlayed.games >= 4)
    .sort((a, b) => b.whenPlayed.rate - b.whenNotPlayed.rate - (a.whenPlayed.rate - a.whenNotPlayed.rate));

  // Cards of the opposing decks, compared with the matchup's overall result (controls for deck strength).
  const threatAcc = new Map<string, { wins: number; games: number; expected: number; decks: Set<string> }>();
  for (const { spec, o } of games) {
    for (const slug of o.cardsB.played) {
      const t = threatAcc.get(slug) ?? { wins: 0, games: 0, expected: 0, decks: new Set<string>() };
      t.wins += isWin(o);
      t.games++;
      t.expected += matchupRate[spec.opponent] ?? overall.rate;
      t.decks.add(opponents[spec.opponent]!.id);
      threatAcc.set(slug, t);
    }
  }
  const minThreatGames = Math.max(6, Math.round(all.length * 0.05));
  const threats: ThreatCard[] = [...threatAcc.entries()]
    .filter(([, t]) => t.games >= minThreatGames)
    .map(([slug, t]) => ({ slug, decks: [...t.decks], result: winRate(t.wins, t.games), expected: round(t.expected / t.games, 3) }))
    .filter((t) => t.result.rate <= t.expected - 0.08)
    .sort((a, b) => a.result.rate - a.expected - (b.result.rate - b.expected))
    .slice(0, 8);

  // Clear threats only: the deck loses most of those games and clearly more than expected.
  const strongThreats = threats.filter((t) => t.result.rate <= Math.min(0.5, t.expected - 0.1));
  const profile = deckProfile(target);
  const poolProfile = averageProfile(opponents.map(deckProfile));
  const goingFirst = subset((o) => o.aFirst);
  const goingSecond = subset((o) => !o.aFirst);
  const shortGames = subset((o) => o.turns <= medianTurns);
  const longGames = subset((o) => o.turns > medianTurns);
  const wins = all.filter((o) => o.winner === "A");
  const losses = all.filter((o) => o.winner === "B");
  const averageTurnsWin = avgTurns(wins);
  const averageTurnsLoss = avgTurns(losses);

  // ---- weaknesses and strengths
  const findings: AnalysisFinding[] = [];
  const weak = matchups.filter((m) => m.games >= 4 && m.rate <= 0.35).slice(0, 3);
  for (const m of weak) findings.push({ kind: "weakness", text: `Loses to ${m.deckName}: ${m.wins}/${m.games} (${pct(m.rate)}).`, cards: m.legends });
  if (profile.averageCost >= poolProfile.averageCost + 0.4)
    findings.push({ kind: "weakness", text: `High curve: average cost ${profile.averageCost} (other decks ${poolProfile.averageCost}).` });
  if (profile.sellable <= poolProfile.sellable - 3) findings.push({ kind: "weakness", text: `Few cards to sell: ${profile.sellable} (other decks ${poolProfile.sellable}).` });
  if (profile.earlyUnits <= poolProfile.earlyUnits - 3)
    findings.push({ kind: "weakness", text: `Few Units costing 2 or less: ${profile.earlyUnits} (other decks ${poolProfile.earlyUnits}).` });
  if (profile.blockers === 0 && poolProfile.blockers >= 2) findings.push({ kind: "weakness", text: `No Units with [BLOCKER] (other decks ${poolProfile.blockers}).` });
  const depends = keyCards.filter((k) => k.whenNotPlayed.games >= 6 && k.whenPlayed.rate - k.whenNotPlayed.rate >= 0.2).slice(0, 2);
  for (const k of depends)
    findings.push({ kind: "weakness", text: `Depends on ${nameOf(k.slug)}: wins ${pct(k.whenPlayed.rate)} when it is played, ${pct(k.whenNotPlayed.rate)} without it.`, cards: [k.slug] });
  if (longGames.games >= 8 && shortGames.games >= 8) {
    if (longGames.rate <= shortGames.rate - 0.15)
      findings.push({ kind: "weakness", text: `Weaker in long games: ${pct(longGames.rate)} in games over ${medianTurns} turns, ${pct(shortGames.rate)} in shorter games.` });
    else if (shortGames.rate <= longGames.rate - 0.15)
      findings.push({ kind: "weakness", text: `Weaker in fast games: ${pct(shortGames.rate)} in games of ${medianTurns} turns or less, ${pct(longGames.rate)} in longer games.` });
  }
  if (goingFirst.games >= 8 && goingSecond.games >= 8 && goingSecond.rate <= goingFirst.rate - 0.15)
    findings.push({ kind: "weakness", text: `Weaker going second: ${pct(goingSecond.rate)} (going first ${pct(goingFirst.rate)}).` });
  for (const t of strongThreats.slice(0, 3))
    findings.push({ kind: "weakness", text: `Struggles when the rival plays ${nameOf(t.slug)}: ${pct(t.result.rate)} in those games (${pct(t.expected)} expected).`, cards: [t.slug] });
  const strong = matchups.filter((m) => m.games >= 4 && m.rate >= 0.7).slice(-3).reverse();
  for (const m of strong) findings.push({ kind: "strength", text: `Beats ${m.deckName}: ${m.wins}/${m.games} (${pct(m.rate)}).`, cards: m.legends });
  const carries = keyCards.filter((k) => k.whenPlayed.rate >= overall.rate + 0.1 && k.playedIn >= 0.25).slice(0, 2);
  for (const k of carries) findings.push({ kind: "strength", text: `Strongest card: ${nameOf(k.slug)} (wins ${pct(k.whenPlayed.rate)} when it is played).`, cards: [k.slug] });

  // ---- best decks against it (from the pool) + cards that hurt it and fit their Legends
  const counters: CounterDeck[] = matchups
    .filter((m) => m.games >= 2)
    .slice(0, 3)
    .map((m) => {
      const deck = opponents.find((d) => d.id === m.deckId)!;
      const budget = legendRamBudget(deck);
      const techCards = strongThreats
        .map((t) => t.slug)
        .filter((slug) => {
          const c = catalog.bySlug(slug);
          if (!c || c.type === "legend" || deck.main[slug]) return false;
          const b = budget[c.color];
          return b !== undefined && (c.ram ?? 0) <= b;
        })
        .slice(0, 3);
      // Draws are not wins for either side.
      const draws = games.filter((g) => opponents[g.spec.opponent]!.id === m.deckId && g.o.winner === "draw").length;
      return { deckId: m.deckId, deckName: m.deckName, legends: m.legends, techCards, ...winRate(m.games - m.wins - draws, m.games) };
    });

  // ---- how to beat it
  const plan: AnalysisFinding[] = [];
  const best = counters[0];
  if (best) plan.push({ kind: "weakness", text: `Best deck against it: ${best.deckName} (wins ${pct(best.rate)} of ${best.games} games).`, cards: best.legends });
  if (strongThreats.length) plan.push({ kind: "weakness", text: `Cards it handles badly: ${strongThreats.slice(0, 3).map((t) => nameOf(t.slug)).join(", ")}.`, cards: strongThreats.slice(0, 3).map((t) => t.slug) });
  const answer = keyCards.filter((k) => k.whenPlayed.rate - k.whenNotPlayed.rate >= 0.1 && k.playedIn >= 0.2).slice(0, 3);
  if (answer.length)
    plan.push({ kind: "weakness", text: `Defeat or answer first: ${answer.map((k) => nameOf(k.slug)).join(", ")} (its results drop without them).`, cards: answer.map((k) => k.slug) });
  if (wins.length >= 5 && losses.length >= 5) {
    if (averageTurnsWin <= averageTurnsLoss - 1)
      plan.push({ kind: "weakness", text: `Survive the early turns: its wins come by turn ${averageTurnsWin} on average, its losses take ${averageTurnsLoss} turns.` });
    else if (averageTurnsWin >= averageTurnsLoss + 1)
      plan.push({ kind: "weakness", text: `Close the game early: it loses in ${averageTurnsLoss} turns on average and wins longer games (${averageTurnsWin} turns).` });
  }
  if (goingFirst.games >= 8 && goingSecond.games >= 8 && Math.abs(goingFirst.rate - goingSecond.rate) >= 0.15)
    plan.push({ kind: "weakness", text: goingSecond.rate < goingFirst.rate ? "When you decide who goes first: go first." : "When you decide who goes first: go second." });

  return {
    deck: { id: target.id, name: target.name, legends: target.legends, main: target.main },
    bot: getBot(bot).label,
    gamesPerMatchup: Math.max(2, Math.floor(specs.length / Math.max(1, opponents.length))),
    overall,
    profile,
    poolProfile,
    matchups,
    goingFirst,
    goingSecond,
    medianTurns,
    shortGames,
    longGames,
    averageTurnsWin,
    averageTurnsLoss,
    keyCards: keyCards.slice(0, 10),
    threats,
    findings,
    plan,
    counters,
    ms: Math.round(ms),
  };
}
