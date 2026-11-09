/** Coach in the player's browser (Web Worker): searches the world the server sampled for this player. */
import { coachAdvice, type CoachOptions, type CoachWorld } from "./coach.ts";

const ctx = self as unknown as {
  onmessage: ((e: { data: { id: number; world: CoachWorld; opts: CoachOptions } }) => void) | null;
  postMessage(m: unknown): void;
};

ctx.onmessage = ({ data }) => {
  try {
    ctx.postMessage({ id: data.id, advice: coachAdvice(data.world, data.opts) });
  } catch (err) {
    ctx.postMessage({ id: data.id, error: String((err as Error)?.message ?? err) });
  }
};
