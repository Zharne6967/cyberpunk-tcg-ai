/**
 * Headless end-to-end check: starts the server in-process, creates games over HTTP and plays human
 * seats over WebSocket with random legal actions (half of them sent as table gestures) until each
 * game ends.
 *   pnpm selftest [games] [bot]       games vs the bot
 *   pnpm selftest [games] friend      friend rooms: two humans join by invite link and play each other
 */
import { WebSocket } from "ws";
import type { GameStateMessage, Intent, SeatTicket, ServerMessage, UiAction } from "@cpai/core/protocol";

process.env.PORT ??= "5199";
await import("./main.ts");
const base = `http://127.0.0.1:${process.env.PORT}`;
const nGames = Number(process.argv[2] ?? 3);
const bot = process.argv[3] ?? "greedy";

/** The gesture a player would make on the table for this action (null = no gesture for it). */
function intentFor(a: UiAction): Intent | null {
  const g = (k: string) => (a.args ?? {})[k] as string;
  switch (a.move) {
    case "playCard":
      return { kind: "play", cardId: g("cardId"), ...(g("attachToId") ? { targetId: g("attachToId") } : {}) };
    case "sellCard":
      return { kind: "sell", cardId: g("cardId") };
    case "callLegend":
      return { kind: "call", cardId: g("legendId") };
    case "attackUnit":
      return { kind: "attack", cardId: g("attackerId"), targetId: g("defenderId") };
    case "attackRival":
      return { kind: "attack", cardId: g("attackerId"), targetId: "rival" };
    case "useBlocker":
      return { kind: "block", cardId: g("blockerId") };
    case "goSolo":
      return { kind: "goSolo", cardId: g("cardId") };
    case "activateAbility":
      return { kind: "activate", cardId: g("cardId") };
    case "passPhase":
      return { kind: "pass" };
    case "resolveAttack":
      return (a.args ?? {}).pass === true ? { kind: "pass" } : null;
    case "gainGig":
      return g("dieId") ? { kind: "select", id: g("dieId") } : null;
    default:
      return null;
  }
}

let intents = 0;
let intentOptions = 0;
const post = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
};

/** Play one seat (identified by its token) with random legal moves until the game ends. */
/** Coach checks: coach on = fetch the sampled world once; coach off = the world must be refused. */
async function checkCoach(gameId: string, token: string, coachOn: boolean): Promise<void> {
  const r = await fetch(`${base}/api/games/${gameId}/coach`, { headers: { "x-seat-token": token } });
  if (!coachOn) {
    if (r.ok) throw new Error("coach world handed out with the coach off");
    return;
  }
  const w = (await r.json()) as { stateID?: number; world?: { G?: unknown }; error?: string };
  if (!r.ok || !w.world?.G || typeof w.stateID !== "number") throw new Error(`coach world failed: ${w.error ?? r.status}`);
  const wrong = await fetch(`${base}/api/games/${gameId}/coach`, { headers: { "x-seat-token": "wrong" } });
  if (wrong.ok) throw new Error("coach world handed out for a wrong token");
}

function playSeat(gameId: string, token: string, label: string, opts: { coach?: boolean } = {}): Promise<{ last: GameStateMessage; moves: number; errors: number; choices: Set<string>; rivalCoachSeen: boolean; coachChecked: boolean }> {
  const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/ws?game=${gameId}&token=${encodeURIComponent(token)}`);
  let moves = 0;
  let errors = 0;
  const choices = new Set<string>();
  let rivalCoachSeen = false;
  let coachChecked = false;
  return new Promise((resolve, reject) => {
    let lastSent = -1;
    let lastMsg: GameStateMessage | undefined;
    const timer = setTimeout(() => {
      const m = lastMsg;
      const info = m ? `sid=${m.view.stateID} phase=${m.view.gamePhase} turn=${m.view.turnNumber} active=${m.view.activePlayerId} status=${m.promptStatus} choice=${m.choice?.type ?? "-"} actions=${JSON.stringify(m.actions).slice(0, 400)} log=${m.log.slice(-3).map((l) => l.text).join(" | ")}` : "no state";
      reject(new Error(`${label} ${gameId} timed out: ${info}`));
    }, Number(process.env.SELFTEST_TIMEOUT ?? 120_000));
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "setBotSpeed", ms: 0 }));
      if (opts.coach) ws.send(JSON.stringify({ type: "coach", on: true }));
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.type === "error") {
        errors++;
        if (!msg.message.includes("changed") && !msg.message.includes("not your turn")) console.log(`  [${gameId} ${label}] error: ${msg.message}`);
        return;
      }
      if (msg.type === "options") {
        const o = msg.options[Math.floor(Math.random() * msg.options.length)]!;
        intentOptions++;
        ws.send(JSON.stringify({ type: "action", actionId: o.id, stateID: lastMsg!.view.stateID }));
        return;
      }
      if (msg.type !== "state") return;
      lastMsg = msg;
      if (msg.coach.rival) rivalCoachSeen = true;
      if (!coachChecked && msg.view.gamePhase !== "setup" && (msg.promptStatus === "action" || msg.promptStatus === "choice") && msg.coach.you === !!opts.coach) {
        coachChecked = true;
        checkCoach(gameId, token, !!opts.coach).catch(reject);
      }
      if (msg.result) {
        clearTimeout(timer);
        ws.close();
        resolve({ last: msg, moves, errors, choices, rivalCoachSeen, coachChecked });
        return;
      }
      if (msg.choice) choices.add(msg.choice.type);
      if ((msg.promptStatus === "action" || msg.promptStatus === "choice") && !msg.rivalThinking && msg.actions.length && lastSent !== msg.view.stateID) {
        lastSent = msg.view.stateID;
        const nonPass = msg.actions.filter((a) => a.move !== "passPhase");
        const pool = nonPass.length && Math.random() < 0.7 ? nonPass : msg.actions;
        const a = pool[Math.floor(Math.random() * pool.length)]!;
        moves++;
        const intent = Math.random() < 0.5 ? intentFor(a) : null;
        if (intent) {
          intents++;
          ws.send(JSON.stringify({ type: "intent", intent, stateID: msg.view.stateID }));
        } else ws.send(JSON.stringify({ type: "action", actionId: a.id, stateID: msg.view.stateID }));
      }
    });
    ws.on("error", reject);
  });
}

async function playOne(i: number) {
  const decks = (await (await fetch(`${base}/api/decks`)).json()) as { id: string; legal: boolean }[];
  const legal = decks.filter((d) => d.legal);
  const yourDeck = legal[i % legal.length]!.id;
  const otherDeck = legal[(i * 7 + 3) % legal.length]!.id;
  if (bot === "friend") {
    // Host opens a room, the friend joins through the invite (the friend's deck is pasted as text).
    const host = await post<SeatTicket>("/api/rooms", { deckId: yourDeck, name: "Host" });
    const otherList = (await post<{ text: string }>("/api/decks/check", { deck: await (await fetch(`${base}/api/decks/${otherDeck}`)).json() })).text;
    // The friend can also find the room by its 6-digit code.
    if (!/^\d{6}$/.test(host.invite ?? "")) throw new Error(`room code is not 6 digits: ${host.invite}`);
    const found = (await (await fetch(`${base}/api/rooms/code/${host.invite}`)).json()) as { gameId?: string };
    if (found.gameId !== host.gameId) throw new Error("room code lookup failed");
    const info = (await (await fetch(`${base}/api/rooms/${host.gameId}?invite=${host.invite}`)).json()) as { status: string };
    if (info.status !== "waiting") throw new Error(`room status ${info.status}`);
    const hostRun = playSeat(host.gameId, host.token, "host", { coach: true });
    const guest = await post<SeatTicket>(`/api/rooms/${host.gameId}/join`, { invite: host.invite, deckText: otherList, name: "Guest" });
    // A wrong invite must not let anyone in.
    const bad = await fetch(`${base}/api/rooms/${host.gameId}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite: "nope", deckId: yourDeck }) });
    if (bad.ok) throw new Error("joined with a wrong invite");
    const [h, g] = await Promise.all([hostRun, playSeat(guest.gameId, guest.token, "guest")]);
    if ((h.last.result!.winner === "you") === (g.last.result!.winner === "you") && h.last.result!.winner !== "draw") throw new Error("both seats report the same winner");
    // The host played with the coach on: the guest saw it, the host got its world, the guest (coach off) did not.
    if (!g.rivalCoachSeen) throw new Error("the guest never saw the host's Coach ON");
    if (!h.coachChecked || !g.coachChecked) throw new Error("coach checks did not run");
    console.log(`friend game ${i + 1} (${host.gameId}): ${yourDeck} vs ${otherDeck} → host ${h.last.result!.winner} (${h.last.result!.reason}), turn ${h.last.view.turnNumber}, moves ${h.moves}+${g.moves}, errors ${h.errors}+${g.errors}, choices: ${[...new Set([...h.choices, ...g.choices])].join(",") || "-"}`);
    return;
  }
  const t = await post<SeatTicket>("/api/games", { yourDeck, botDeck: otherDeck, bot, seed: `selftest-${i}` });
  const r = await playSeat(t.gameId, t.token, "human");
  console.log(`game ${i + 1} (${t.gameId}): ${yourDeck} vs ${otherDeck} → ${r.last.result!.winner} (${r.last.result!.reason}), turn ${r.last.view.turnNumber}, moves ${r.moves}, log ${r.last.log.length}, errors ${r.errors}, choices: ${[...r.choices].join(",") || "-"}`);
}

let failed = 0;
for (let i = 0; i < nGames; i++) {
  try {
    await playOne(i);
  } catch (err) {
    failed++;
    console.error(`game ${i + 1} FAILED:`, (err as Error).message);
  }
}
console.log(`intents: ${intents} (options dialogs: ${intentOptions})`);
console.log(failed ? `SELFTEST: ${failed} failed` : "SELFTEST OK");
process.exit(failed ? 1 : 0);
