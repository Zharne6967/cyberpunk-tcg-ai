import { extractBoardFeatures, filterMatchView, type FilteredMatchView, type MatchState, type PlayerId } from "@tcg/cyberpunk-engine";
import model from "./eval-model.json" with { type: "json" };

/**
 * Learned position evaluation for ISMCTS playouts: P(win) = sigmoid(w · standardized features).
 * Features are the engine's board features for both players, taken at the start of the evaluating
 * player's turn (exactly where playouts stop). The weights are fitted by logistic regression on
 * self-play games — `pnpm calibrate` regenerates eval-model.json.
 */
export const FEATURE_NAMES = [
  "gigRace",
  "streetCred",
  "fieldMaterial",
  "readyPower",
  "blockerCoverage",
  "attackPressure",
  "handSize",
  "availableEddies",
  "deckSafety",
  "gigSetup",
] as const;

export interface EvalModel {
  features: string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
  /** Held-out quality, for reference. */
  heldOut?: { logLoss: number; accuracy: number; samples: number };
}

export function positionFeatures(view: FilteredMatchView, pid: string): number[] {
  const rivalId = Object.keys(view.players).find((id) => id !== pid) ?? pid;
  const own = extractBoardFeatures(view, pid) as unknown as Record<string, number>;
  const rival = extractBoardFeatures(view, rivalId) as unknown as Record<string, number>;
  return [...FEATURE_NAMES.map((f) => own[f] ?? 0), ...FEATURE_NAMES.map((f) => rival[f] ?? 0), view.turnNumber];
}

export function featureLabels(): string[] {
  return [...FEATURE_NAMES.map((f) => `own.${f}`), ...FEATURE_NAMES.map((f) => `rival.${f}`), "turn"];
}

export function predict(m: EvalModel, x: number[]): number {
  let z = m.bias;
  for (let i = 0; i < m.weights.length; i++) z += m.weights[i]! * ((x[i]! - m.mean[i]!) / (m.std[i]! || 1));
  return 1 / (1 + Math.exp(-z));
}

const DEFAULT_MODEL = model as EvalModel;

/** Learned win probability for `pid` (terminal states are exact). */
export function learnedWinProbability(state: MatchState, pid: PlayerId, m: EvalModel = DEFAULT_MODEL): number {
  if (state.G.gameEnded) {
    const w = state.G.winnerId as string | null;
    return w === null ? 0.5 : w === pid ? 1 : 0;
  }
  return predict(m, positionFeatures(filterMatchView(state, pid), pid as string));
}

/** The view with every hand reduced to its card count: only what lies openly on the table. */
export function publicView(view: FilteredMatchView): FilteredMatchView {
  return {
    ...view,
    players: Object.fromEntries(
      Object.entries(view.players).map(([id, p]) => {
        const hand = p.zones.hand;
        return [id, { ...p, zones: { ...p.zones, hand: Array.isArray(hand) ? hand.length : (hand ?? 0) } }];
      }),
    ),
  };
}

/**
 * Chance that `pid` wins the game, from public table information only (no hand contents, no deck
 * order). The model is evaluated from both players' perspectives and averaged, so it does not
 * depend on whose turn it is being scored for.
 */
export function publicWinChance(view: FilteredMatchView, pid: string, m: EvalModel = DEFAULT_MODEL): number {
  if (view.gameEnded) return view.winnerId === pid ? 1 : view.winnerId ? 0 : 0.5;
  const pv = publicView(view);
  const rival = Object.keys(pv.players).find((id) => id !== pid) ?? pid;
  const mine = predict(m, positionFeatures(pv, pid));
  const theirs = predict(m, positionFeatures(pv, rival));
  return (mine + (1 - theirs)) / 2;
}

/** Fit a logistic regression (standardized features, L2, full-batch gradient descent). */
export function fitLogistic(xs: number[][], ys: number[], opts: { iterations?: number; lr?: number; l2?: number } = {}): EvalModel {
  const n = xs.length;
  const d = xs[0]!.length;
  const mean = Array.from({ length: d }, (_, j) => xs.reduce((s, x) => s + x[j]!, 0) / n);
  const std = Array.from({ length: d }, (_, j) => Math.sqrt(xs.reduce((s, x) => s + (x[j]! - mean[j]!) ** 2, 0) / n) || 1);
  const z = xs.map((x) => x.map((v, j) => (v - mean[j]!) / std[j]!));
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const iterations = opts.iterations ?? 3000;
  const lr = opts.lr ?? 0.2;
  const l2 = opts.l2 ?? 1e-3;
  for (let it = 0; it < iterations; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let s = b;
      const zi = z[i]!;
      for (let j = 0; j < d; j++) s += w[j]! * zi[j]!;
      const err = 1 / (1 + Math.exp(-s)) - ys[i]!;
      gb += err;
      for (let j = 0; j < d; j++) gw[j]! += err * zi[j]!;
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < d; j++) w[j] = w[j]! - lr * (gw[j]! / n + l2 * w[j]!);
  }
  return { features: featureLabels(), mean, std, weights: w, bias: b };
}
