import { describe, expect, it } from "vitest";
import model from "./eval-model.json" with { type: "json" };
import { FEATURE_NAMES, fitLogistic, predict, type EvalModel } from "./evaluation.ts";

describe("learned position evaluation", () => {
  it("fits a logistic regression on separable data", () => {
    const xs: number[][] = [];
    const ys: number[] = [];
    for (let i = 0; i < 400; i++) {
      const a = (i % 20) - 10;
      const b = Math.floor(i / 20) - 10;
      xs.push([a, b]);
      ys.push(a - b > 0 ? 1 : 0);
    }
    const m = fitLogistic(xs, ys, { iterations: 1500 });
    expect(predict(m, [8, -8])).toBeGreaterThan(0.9);
    expect(predict(m, [-8, 8])).toBeLessThan(0.1);
    expect(m.weights[0]!).toBeGreaterThan(0);
    expect(m.weights[1]!).toBeLessThan(0);
  });

  it("the shipped model has one weight per feature and sensible signs", () => {
    const m = model as EvalModel;
    expect(m.weights).toHaveLength(FEATURE_NAMES.length * 2 + 1);
    const w = (name: string) => m.weights[m.features.indexOf(name)]!;
    // More of your own Gigs is good, more rival Gigs is bad.
    expect(w("own.gigRace")).toBeGreaterThan(0);
    expect(w("rival.gigRace")).toBeLessThan(0);
    expect(w("rival.fieldMaterial")).toBeLessThan(0);
    expect(m.heldOut!.logLoss).toBeLessThan(0.6931); // better than a coin flip
  });
});
