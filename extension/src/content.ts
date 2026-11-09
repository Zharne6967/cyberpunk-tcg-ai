/**
 * The coach box on cyberpunk-tcg-sim.online: small (two lines), in a corner, details on click.
 * Shown only while the coach is switched on (extension button); works only where the site's terms
 * allow outside help (see simCoachAllowed) and only for your own decisions.
 */
import { simCoachAllowed, simDecision, siteButton, type SimPending, type SimSnapshot } from "../../packages/ai/src/external/ctcg-sim-rules.ts";

declare const chrome: any;

interface Move {
  label: string;
  move?: string;
  winRate: number | null;
}
interface Advice {
  moves: Move[];
  plan: string[];
  why: { text: string; good: boolean }[];
  whyVs: string | null;
  iterations: number;
}

const CSS = `
:host { all: initial; }
.box { position: fixed; z-index: 2147483000; width: 264px; font: 12px/1.35 "Segoe UI", system-ui, sans-serif; color: #ececf2;
  background: #0b0d12ee; border: 1px solid #3dff9a88; border-radius: 6px; box-shadow: 0 6px 20px #000a; user-select: none; }
.head { display: flex; align-items: center; gap: 6px; padding: 5px 8px 2px; cursor: grab; }
.badge { color: #3dff9a; font-weight: 800; letter-spacing: .1em; font-size: 10px; }
.badge.paused { color: #8a8a9c; }
.pct { margin-left: auto; color: #3dff9a; font-weight: 700; font-variant-numeric: tabular-nums; }
.toggle { color: #8a8a9c; cursor: pointer; padding: 0 2px; }
.line { padding: 0 8px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.do { padding: 1px 8px 0; font-weight: 700; font-size: 13px; color: #fff; cursor: pointer; }
.what { padding: 0 8px; color: #8a8a9c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.why { padding: 2px 8px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plan { padding: 2px 8px 6px; color: #b9b9c8; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.steps { margin: 2px 0 0; padding-left: 18px; } .steps li { margin: 1px 0; }
.btn { color: #3dff9a; }
.muted { color: #8a8a9c; }
.more { border-top: 1px solid #262630; padding: 6px 8px; max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 3px; }
.row { display: flex; gap: 6px; } .row span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .row b { color: #8a8a9c; font-weight: 600; }
.good { color: #3dff9a; } .cost { color: #ff8aa8; } .sub { color: #8a8a9c; margin-top: 3px; }
`;

let enabled = false;
let expanded = false;
/** Details always open (setting in the extension button). */
let details = false;
let pos = { x: 12, y: 12 };
let snapshot: SimSnapshot | null = null;
/** The site's game state was found (false: the site changed and the coach cannot read it). */
let appFound: boolean | null = null;
let view: { kind: "hidden" } | { kind: "paused" | "waiting" | "thinking" | "note"; text: string } | { kind: "advice"; advice: Advice } = { kind: "hidden" };

const host = document.createElement("div");
const root = host.attachShadow({ mode: "closed" });
root.innerHTML = `<style>${CSS}</style><div class="box" hidden></div>`;
const box = root.querySelector(".box") as HTMLDivElement;
document.documentElement.appendChild(host);

const pct = (x: number | null) => (x === null ? "" : `${Math.round(x * 100)}%`);
const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const SETUP: Record<string, string> = { keepHand: "KEEP", mulligan: "MULLIGAN" };
/** The site's button for a move: from the open choice, or the setup buttons. */
function buttonFor(m: Move): string | null {
  const pending = snapshot?.controls?.pending;
  const p = typeof pending === "object" && pending ? (pending as SimPending) : null;
  if (m.move && SETUP[m.move]) return SETUP[m.move]!;
  if (m.move === "resolveFirstPlayer") return norm(m.label);
  return m.move ? siteButton(m.move, m.label, p) : null;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render() {
  if (!enabled || view.kind === "hidden" || !snapshot) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  // Never outside the window (a place saved on a bigger screen would hide the box).
  box.style.left = `${Math.max(0, Math.min(window.innerWidth - 262, pos.x))}px`;
  box.style.top = `${Math.max(0, Math.min(window.innerHeight - 64, pos.y))}px`;
  const paused = view.kind === "paused";
  let head = `<span class="badge ${paused ? "paused" : ""}">${paused ? "COACH PAUSED" : "COACH ON"}</span>`;
  let line = "";
  let more = "";
  if (view.kind === "advice") {
    const a = view.advice;
    const [best, ...rest] = a.moves;
    const open = expanded || details;
    head += `<span class="pct">${best ? pct(best.winRate) : ""}</span><span class="toggle" data-t>${open ? "▴" : "▾"}</span>`;
    // What to do: the site's own button when the site asks (a choice), otherwise the move.
    const button = best ? buttonFor(best) : null;
    line = `<div class="do" data-t title="${esc(best?.label ?? "")}">▶ ${button ? `Click <span class="btn">${esc(button)}</span>` : esc(best?.label ?? "-")}</div>`;
    if (button && best && norm(button) !== norm(best.label)) line += `<div class="what">${esc(best.label)}</div>`;
    // Why, in one line: the clearest gain over the next option, or the two win chances.
    const reason = a.why[0];
    if (reason) line += `<div class="why ${reason.good ? "good" : "cost"}">${reason.good ? "+" : "−"} ${esc(reason.text)}</div>`;
    else if (best && rest[0] && best.winRate !== null && rest[0].winRate !== null)
      line += `<div class="why muted">${pct(best.winRate)} vs ${pct(rest[0].winRate)}: ${esc(rest[0].label)}</div>`;
    line += a.plan.length && !open ? `<div class="plan">Then: ${esc(a.plan.join(" → "))}</div>` : `<div class="plan"></div>`;
    if (open) {
      const steps = best ? [best.label, ...a.plan] : [];
      more = `<div class="more">${
        steps.length > 1 ? `<div class="sub">This turn, step by step:</div><ol class="steps">${steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""
      }${
        a.why.length ? `<div class="sub">By your next turn: this move (with ${esc(a.whyVs ?? "")})</div>${a.why.map((w) => `<div class="${w.good ? "good" : "cost"}">${w.good ? "+" : "−"} ${esc(w.text)}</div>`).join("")}` : ""
      }${rest.length ? `<div class="sub">Other options:</div>` : ""}${rest
        .map((m) => {
          const b = buttonFor(m);
          return `<div class="row"><span>${esc(b ? `${b} · ${m.label}` : m.label)}</span><b>${pct(m.winRate)}</b></div>`;
        })
        .join("")}${a.iterations ? `<div class="sub">${a.iterations} simulations from what you can see</div>` : ""}</div>`;
    }
  } else {
    line = `<div class="line muted">${esc(view.text)}</div>`;
  }
  box.innerHTML = `<div class="head">${head}</div>${line}${more}`;
}

box.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-t]") && view.kind === "advice") {
    expanded = !expanded;
    render();
  }
});
// Drag by the header; the place is remembered.
box.addEventListener("pointerdown", (e) => {
  if (!(e.target as HTMLElement).closest(".head") || (e.target as HTMLElement).closest("[data-t]")) return;
  const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  const move = (m: PointerEvent) => {
    pos = { x: Math.max(0, Math.min(window.innerWidth - 60, m.clientX - start.x)), y: Math.max(0, Math.min(window.innerHeight - 30, m.clientY - start.y)) };
    render();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    chrome.storage.local.set({ pos });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

// ---- asking the coach: one search at a time; a newer position is searched right after the running one.
/** The position the box should show advice for ("" when it is not your decision). */
let wanted = "";
/** The position whose result is on screen. */
let shown = "";
let running = false;
let queued: { key: string; snap: SimSnapshot } | null = null;

/** Your last Main Phase / Start Phase positions, newest first: a choice from a card effect is replayed from them. */
let history: SimSnapshot[] = [];

async function ask(key: string, snap: SimSnapshot) {
  if (running) {
    queued = { key, snap };
    return;
  }
  running = true;
  let r: { ok?: boolean; advice?: Advice; reason?: string } | undefined;
  const previous = simDecision(snap).kind === "choice" ? history : [];
  try {
    r = await chrome.runtime.sendMessage({ type: "advise", snapshot: snap, previous });
  } catch {
    r = { ok: false, reason: "Reload the page to use the coach" };
  }
  running = false;
  if (key === wanted) {
    shown = key;
    view = r?.ok && r.advice ? { kind: "advice", advice: r.advice } : { kind: "note", text: r?.reason ?? "No advice" };
    render();
  }
  const next = queued;
  queued = null;
  if (next && next.key === wanted && next.key !== shown) void ask(next.key, next.snap);
}

let timer: ReturnType<typeof setTimeout> | undefined;
function update() {
  clearTimeout(timer);
  if (!enabled || !snapshot) {
    wanted = "";
    view = { kind: "hidden" };
    return render();
  }
  const gate = simCoachAllowed(snapshot);
  if (!gate.allowed) {
    wanted = "";
    view = { kind: "paused", text: gate.reason ?? "Not available here" };
    return render();
  }
  const decision = simDecision(snapshot);
  if (decision.kind === "main" || decision.kind === "start") history = [snapshot, ...history.filter((h) => h !== snapshot)].slice(0, 4);
  else if (decision.kind !== "choice") history = [];
  if (decision.kind === "wait") {
    wanted = "";
    view = { kind: "waiting", text: decision.reason };
    return render();
  }
  const key = JSON.stringify(snapshot);
  wanted = key;
  if (key === shown && view.kind !== "waiting") return render();
  view = { kind: "thinking", text: "Thinking…" };
  render();
  const snap = snapshot;
  // Short pause: the site sends several updates in a row after each move.
  timer = setTimeout(() => void ask(key, snap), 250);
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "cpai-coach-page") return;
  snapshot = e.data.snapshot as SimSnapshot | null;
  appFound = e.data.app !== false;
  update();
});
window.addEventListener("resize", () => render());

/** What the extension button shows about this page. */
chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender: unknown, sendResponse: (r: unknown) => void) => {
  if (msg?.type !== "status") return;
  const text =
    appFound === false
      ? "The coach cannot read this page (the site may have changed)"
      : !snapshot
        ? "No game on this page yet"
        : !enabled
          ? "Coach is off"
          : view.kind === "advice"
            ? "Showing advice"
            : "text" in view
              ? view.text
              : "Waiting for your decision";
  sendResponse({ text, mode: snapshot?.room?.mode ?? null });
});

chrome.storage.local.get({ enabled: true, pos: { x: 12, y: 12 }, details: false }).then((v: { enabled: boolean; pos: { x: number; y: number }; details: boolean }) => {
  enabled = v.enabled;
  details = v.details === true;
  pos = v.pos;
  update();
});
chrome.storage.onChanged.addListener((changes: Record<string, { newValue: unknown }>) => {
  if (changes.enabled) {
    enabled = changes.enabled.newValue !== false;
    shown = "";
    update();
  }
  if (changes.details) {
    details = changes.details.newValue === true;
    render();
  }
  if (changes.pos?.newValue) {
    pos = changes.pos.newValue as { x: number; y: number };
    render();
  }
});
