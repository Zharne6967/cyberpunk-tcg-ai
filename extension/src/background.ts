/**
 * The coach itself, on your computer (extension service worker): rebuilds the game from the site's
 * snapshot in our rules engine and runs the same fair search as the app's Coach. Nothing is sent anywhere.
 */
import { coachAdvice } from "../../packages/ai/src/coach.ts";
import { convertSimSnapshot } from "../../packages/ai/src/external/ctcg-sim.ts";

declare const chrome: any;

const SITE = ["https://cyberpunk-tcg-sim.online/*", "https://*.cyberpunk-tcg-sim.online/*"];

chrome.runtime.onInstalled.addListener(async (details: { reason?: string }) => {
  chrome.storage.local.get({ enabled: null }).then((v: { enabled: boolean | null }) => {
    if (v.enabled === null) chrome.storage.local.set({ enabled: true });
  });
  // Game tabs that were already open: the coach starts in them now (no reload needed after installing or updating).
  if (details.reason !== "install" && details.reason !== "update") return;
  try {
    const tabs: { id?: number }[] = await chrome.tabs.query({ url: SITE });
    for (const t of tabs) {
      if (t.id === undefined) continue;
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["page.js"], world: "MAIN" }).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
    }
  } catch (err) {
    console.warn("[coach] could not start in open tabs", err);
  }
});

let n = 0;
chrome.runtime.onMessage.addListener((msg: { type?: string; snapshot?: unknown; previous?: unknown[] }, _sender: unknown, sendResponse: (r: unknown) => void) => {
  if (msg?.type === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (msg?.type !== "advise") return;
  try {
    const r = convertSimSnapshot(msg.snapshot as never, "ext", (msg.previous ?? []) as never);
    if (!r.ok) {
      sendResponse({ ok: false, reason: r.reason });
      return;
    }
    const advice = coachAdvice({ stateID: 0, viewer: r.viewer as string, world: r.state, remembered: [] }, { iterations: 1000, timeMs: 2500, seed: `ext-${++n}`, only: r.only });
    sendResponse({ ok: true, advice });
  } catch (err) {
    sendResponse({ ok: false, reason: "The coach could not read this position" });
    console.error("[coach]", err);
  }
});
