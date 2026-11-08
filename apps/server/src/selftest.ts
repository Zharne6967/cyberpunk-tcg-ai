/**
 * Headless end-to-end check: starts the server in-process, creates games over HTTP and plays the human
 * side over WebSocket with random legal actions until each game ends.
 *   pnpm --filter @cpai/server selftest [games] [bot]
 */
import { WebSocket } from "ws";
import type { GameStateMessage, Intent, ServerMessage, UiAction } from "@cpai/core/protocol";

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

async function playOne(i: number) {
  const decks = (await (await fetch(`${base}/api/decks`)).json()) as { id: string; legal: boolean }[];
  const legal = decks.filter((d) => d.legal);
  const yourDeck = legal[i % legal.length]!.id;
  const botDeck = legal[(i * 7 + 3) % legal.length]!.id;
  const { gameId } = (await (await fetch(`${base}/api/games`, { method: "POST", body: JSON.stringify({ yourDeck, botDeck, bot, seed: `selftest-${i}` }) })).json()) as { gameId: string };
  const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/ws?game=${gameId}`);
  let humanMoves = 0;
  let errors = 0;
  const seenChoices = new Set<string>();
  const last = await new Promise<GameStateMessage>((resolve, reject) => {
    let lastSent = -1;
    let lastMsg: GameStateMessage | undefined;
    const timer = setTimeout(() => {
      const m = lastMsg;
      const info = m ? `sid=${m.view.stateID} phase=${m.view.gamePhase} turn=${m.view.turnNumber} active=${m.view.activePlayerId} status=${m.promptStatus} bot=${m.botThinking} choice=${m.choice?.type ?? "-"} ${JSON.stringify(m.choice?.payload ?? {}).slice(0, 300)} actions=${JSON.stringify(m.actions).slice(0, 400)} attack=${JSON.stringify(m.view.attackState)} log=${m.log.slice(-3).map((l) => l.text).join(" | ")}` : "no state";
      reject(new Error(`game ${gameId} timed out: ${info}`));
    }, Number(process.env.SELFTEST_TIMEOUT ?? 120_000));
    ws.on("open", () => ws.send(JSON.stringify({ type: "setBotSpeed", ms: 0 })));
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.type === "error") {
        errors++;
        if (!msg.message.includes("changed") && !msg.message.includes("not your turn")) console.log(`  [${gameId}] error: ${msg.message}`);
        return;
      }
      if (msg.type === "options") {
        // The table gesture fit several legal moves: pick one like a player would.
        const o = msg.options[Math.floor(Math.random() * msg.options.length)]!;
        intentOptions++;
        ws.send(JSON.stringify({ type: "action", actionId: o.id, stateID: lastMsg!.view.stateID }));
        return;
      }
      if (msg.type !== "state") return;
      lastMsg = msg;
      if (msg.result) {
        clearTimeout(timer);
        resolve(msg);
        return;
      }
      if (msg.choice) seenChoices.add(msg.choice.type);
      if ((msg.promptStatus === "action" || msg.promptStatus === "choice") && !msg.botThinking && msg.actions.length && lastSent !== msg.view.stateID) {
        lastSent = msg.view.stateID;
        // Mostly sensible random play: prefer non-pass actions 70% of the time.
        const nonPass = msg.actions.filter((a) => a.move !== "passPhase");
        const pool = nonPass.length && Math.random() < 0.7 ? nonPass : msg.actions;
        const a = pool[Math.floor(Math.random() * pool.length)]!;
        humanMoves++;
        // Half of the time send the table gesture (drag & drop / click) instead of the exact action.
        const intent = Math.random() < 0.5 ? intentFor(a) : null;
        if (intent) {
          intents++;
          ws.send(JSON.stringify({ type: "intent", intent, stateID: msg.view.stateID }));
        } else ws.send(JSON.stringify({ type: "action", actionId: a.id, stateID: msg.view.stateID }));
      }
    });
    ws.on("error", reject);
  });
  ws.close();
  console.log(
    `game ${i + 1} (${gameId}): ${yourDeck} vs ${botDeck} → ${last.result!.winner} (${last.result!.reason}), tur ${last.view.turnNumber}, ruchów człowieka ${humanMoves}, log ${last.log.length} linii, błędy ${errors}, wybory: ${[...seenChoices].join(",") || "-"}`,
  );
  return last;
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
console.log(failed ? `SELFTEST: ${failed} nieudanych` : "SELFTEST OK");
process.exit(failed ? 1 : 0);
