/**
 * The coach box on cyberpunk-tcg-sim.online: small (two lines), in a corner, details on click.
 * Shown only while the coach is switched on (extension button); works only where the site's terms
 * allow outside help (see simCoachAllowed) and only for your own decisions.
 */
import { simCoachAllowed, type SimSnapshot } from "../../packages/ai/src/external/ctcg-sim-rules.ts";

declare const chrome: any;

interface Move {
  label: string;
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
.box { position: fixed; z-index: 2147483000; width: 240px; font: 12px/1.35 "Segoe UI", system-ui, sans-serif; color: #ececf2;
  background: #0b0d12ee; border: 1px solid #3dff9a88; border-radius: 6px; box-shadow: 0 6px 20px #000a; user-select: none; }
.head { display: flex; align-items: center; gap: 6px; padding: 5px 8px 2px; cursor: grab; }
.badge { color: #3dff9a; font-weight: 800; letter-spacing: .1em; font-size: 10px; }
.badge.paused { color: #8a8a9c; }
.pct { margin-left: auto; color: #3dff9a; font-weight: 700; font-variant-numeric: tabular-nums; }
.toggle { color: #8a8a9c; cursor: pointer; padding: 0 2px; }
.line { padding: 0 8px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.muted { color: #8a8a9c; }
.more { border-top: 1px solid #262630; padding: 6px 8px; max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 3px; }
.row { display: flex; gap: 6px; } .row span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .row b { color: #8a8a9c; font-weight: 600; }
.good { color: #3dff9a; } .cost { color: #ff8aa8; } .sub { color: #8a8a9c; margin-top: 3px; }
`;

let enabled = false;
let expanded = false;
let pos = { x: 12, y: 12 };
let snapshot: SimSnapshot | null = null;
let view: { kind: "hidden" } | { kind: "paused" | "waiting" | "thinking" | "note"; text: string } | { kind: "advice"; advice: Advice } = { kind: "hidden" };
let seq = 0;

const host = document.createElement("div");
const root = host.attachShadow({ mode: "closed" });
root.innerHTML = `<style>${CSS}</style><div class="box" hidden></div>`;
const box = root.querySelector(".box") as HTMLDivElement;
document.documentElement.appendChild(host);

const pct = (x: number | null) => (x === null ? "" : `${Math.round(x * 100)}%`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render() {
  if (!enabled || view.kind === "hidden" || !snapshot) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.style.left = `${pos.x}px`;
  box.style.top = `${pos.y}px`;
  const paused = view.kind === "paused";
  let head = `<span class="badge ${paused ? "paused" : ""}">${paused ? "COACH PAUSED" : "COACH ON"}</span>`;
  let line = "";
  let more = "";
  if (view.kind === "advice") {
    const [best, ...rest] = view.advice.moves;
    head += `<span class="pct">${best ? pct(best.winRate) : ""}</span><span class="toggle" data-t>${expanded ? "▴" : "▾"}</span>`;
    line = `<div class="line" data-t title="${esc(best?.label ?? "")}">${esc(best?.label ?? "-")}</div>`;
    if (expanded) {
      const a = view.advice;
      more = `<div class="more">${rest.map((m) => `<div class="row"><span>${esc(m.label)}</span><b>${pct(m.winRate)}</b></div>`).join("")}${
        a.why.length ? `<div class="sub">By your next turn: this move (with ${esc(a.whyVs ?? "")})</div>${a.why.map((w) => `<div class="${w.good ? "good" : "cost"}">${w.good ? "+" : "−"} ${esc(w.text)}</div>`).join("")}` : ""
      }${a.plan.length ? `<div class="sub">Then: ${esc(a.plan.join(" → "))}</div>` : ""}${a.iterations ? `<div class="sub">${a.iterations} simulations</div>` : ""}</div>`;
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

function myDecision(s: SimSnapshot): boolean {
  const g = s.game ?? {};
  return g.stage === "player_turn" && g.activePlayerId === s.self?.playerId && (g.turnStep === "play" || g.turnStep === "ready_roll") && !s.controls?.pending && !g.winnerId;
}

let timer: ReturnType<typeof setTimeout> | undefined;
function update() {
  clearTimeout(timer);
  if (!enabled || !snapshot) {
    view = { kind: "hidden" };
    return render();
  }
  const gate = simCoachAllowed(snapshot);
  if (!gate.allowed) {
    view = { kind: "paused", text: gate.reason ?? "Not available here" };
    return render();
  }
  if (!myDecision(snapshot)) {
    view = { kind: "waiting", text: "Waiting for your turn" };
    return render();
  }
  view = { kind: "thinking", text: "Thinking…" };
  render();
  const id = ++seq;
  const snap = snapshot;
  // Short pause: the site sends several updates in a row after each move.
  timer = setTimeout(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: "advise", snapshot: snap });
      if (id !== seq) return;
      view = r?.ok ? { kind: "advice", advice: r.advice } : { kind: "note", text: r?.reason ?? "No advice" };
    } catch {
      if (id !== seq) return;
      view = { kind: "note", text: "Reload the page to use the coach" };
    }
    render();
  }, 300);
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "cpai-coach-page") return;
  snapshot = e.data.snapshot as SimSnapshot | null;
  update();
});

chrome.storage.local.get({ enabled: false, pos: { x: 12, y: 12 } }).then((v: { enabled: boolean; pos: { x: number; y: number } }) => {
  enabled = v.enabled;
  pos = v.pos;
  update();
});
chrome.storage.onChanged.addListener((changes: Record<string, { newValue: unknown }>) => {
  if (changes.enabled) {
    enabled = changes.enabled.newValue === true;
    seq++;
    update();
  }
});
