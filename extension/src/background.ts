/**
 * The coach itself, on your computer (extension service worker): rebuilds the game from the site's
 * snapshot in our rules engine and runs the same fair search as the app's Coach. Nothing is sent anywhere.
 */
import { coachAdvice } from "../../packages/ai/src/coach.ts";
import { convertSimSnapshot } from "../../packages/ai/src/external/ctcg-sim.ts";

declare const chrome: any;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ enabled: null }).then((v: { enabled: boolean | null }) => {
    if (v.enabled === null) chrome.storage.local.set({ enabled: true });
  });
});

let n = 0;
chrome.runtime.onMessage.addListener((msg: { type?: string; snapshot?: unknown }, _sender: unknown, sendResponse: (r: unknown) => void) => {
  if (msg?.type === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (msg?.type !== "advise") return;
  try {
    const r = convertSimSnapshot(msg.snapshot as never, "ext");
    if (!r.ok) {
      sendResponse({ ok: false, reason: r.reason });
      return;
    }
    const advice = coachAdvice({ stateID: 0, viewer: r.viewer as string, world: r.state, remembered: [] }, { iterations: 1000, timeMs: 2500, seed: `ext-${++n}` });
    sendResponse({ ok: true, advice });
  } catch (err) {
    sendResponse({ ok: false, reason: "The coach could not read this position" });
    console.error("[coach]", err);
  }
});
