import type { CoachAdvice } from "@cpai/core/protocol";

/**
 * The coach searches in this browser (Web Worker with the rules engine, packages/ai/src/coach-worker.ts)
 * on a world the server sampled from what you know. One search at a time: a newer position stops the
 * running one.
 */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (a: CoachAdvice) => void; reject: (e: Error) => void }>();

function rejectAll(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function start(): Worker {
  const w = new Worker(new URL("../../../packages/ai/src/coach-worker.ts", import.meta.url), { type: "module" });
  w.onmessage = ({ data }: MessageEvent<{ id: number; advice?: CoachAdvice; error?: string }>) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.advice) p.resolve(data.advice);
    else p.reject(new Error(data.error ?? "The coach failed"));
  };
  w.onerror = (e) => {
    rejectAll(new Error(e.message || "The coach failed"));
    stopCoach();
  };
  return w;
}

/** Search time per position: shorter on devices with few cores or little memory (phones). */
function budget() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const small = (navigator.hardwareConcurrency || 4) <= 4 || (memory !== undefined && memory <= 4);
  return small ? { iterations: 600, timeMs: 2000 } : { iterations: 1000, timeMs: 2500 };
}

export function askCoach(world: unknown): Promise<CoachAdvice> {
  if (pending.size) {
    // The running search is for an older position.
    stopCoach();
    rejectAll(new DOMException("Superseded", "AbortError"));
  }
  worker ??= start();
  const id = ++seq;
  const w = worker;
  return new Promise<CoachAdvice>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, world, opts: { ...budget(), seed: `coach-${id}` } });
  });
}

export function stopCoach() {
  worker?.terminate();
  worker = null;
}
