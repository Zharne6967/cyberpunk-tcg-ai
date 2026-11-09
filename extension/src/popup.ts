/** The extension button: switch the coach on or off, see whether it works on this page. */
declare const chrome: any;

const box = document.getElementById("on") as HTMLInputElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const engine = document.getElementById("engine") as HTMLParagraphElement;
const version = document.getElementById("version") as HTMLSpanElement;
version.textContent = chrome.runtime.getManifest().version;
chrome.storage.local.get({ enabled: true }).then((v: { enabled: boolean }) => (box.checked = v.enabled !== false));
box.addEventListener("change", () => chrome.storage.local.set({ enabled: box.checked }));
const details = document.getElementById("details") as HTMLInputElement;
chrome.storage.local.get({ details: false }).then((v: { details: boolean }) => (details.checked = v.details === true));
details.addEventListener("change", () => chrome.storage.local.set({ details: details.checked }));
document.getElementById("reset")!.addEventListener("click", () => chrome.storage.local.set({ pos: { x: 12, y: 12 } }));

chrome.runtime
  .sendMessage({ type: "ping" })
  .then((r: { ok?: boolean } | undefined) => (engine.textContent = r?.ok ? "Coach engine: ready" : "Coach engine: not answering. Reload the extension."))
  .catch(() => (engine.textContent = "Coach engine: not answering. Reload the extension."));

chrome.tabs
  .query({ active: true, currentWindow: true })
  .then(async (tabs: { id?: number }[]) => {
    const id = tabs[0]?.id;
    if (id === undefined) throw new Error("no tab");
    const r = (await chrome.tabs.sendMessage(id, { type: "status" })) as { text?: string; mode?: string | null } | undefined;
    status.textContent = r?.text ? `This page: ${r.text}${r.mode ? ` (${r.mode})` : ""}` : "This page: no answer";
  })
  .catch(() => (status.textContent = "This page: open cyberpunk-tcg-sim.online (after installing or updating the coach, reload the page with F5)"));
