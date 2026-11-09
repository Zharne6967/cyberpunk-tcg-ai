import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { STRATEGIES } from "@cpai/ai";
import { checkDeckLegality, isDeckLegal, type Deck } from "@cpai/core";
import type { BotSummary, ClientMessage, NewGameRequest, RoomInfo, SeatTicket } from "@cpai/core/protocol";
import { checkDeck, deleteUserDeck, getDeck, importDeckText, isUserDeck, loadAllDecks, loadBuiltinDecks, sanitizeDeck, saveUserDeck, summarizeDeck } from "./decks.ts";
import { botPool } from "./bot-pool.ts";
import { AnalysisBusy, GAMES_PER_MATCHUP, analysisJob, startAnalysis } from "./analysis.ts";
import { GameSession, games, roomByCode } from "./game.ts";
import { getCardImage } from "./images.ts";
import { isAuthorized, isRemote, keyLogin, shareStatus, startShare, stopShare } from "./share.ts";
import { DATA_DIR, WEB_DIST } from "./paths.ts";

const PORT = Number(process.env.PORT ?? 5177);
const HOST = process.env.HOST ?? "127.0.0.1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("UI is not built. Run: pnpm build (or start.bat)");
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  let file = normalize(join(WEB_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(WEB_DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIST, "index.html");
  const ext = extname(file);
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
  });
  createReadStream(file).pipe(res);
}

let cardsJson: string | undefined;

/** An error caused by the request (shown to the player), not by the server. */
class UserError extends Error {}

/**
 * Cloud mode (CPAI_CLOUD=1, the free always-reachable deployment): the site is open to everyone,
 * friends meet by 6-digit room code, and your own decks live in your browser (a free server's disk
 * is wiped whenever it sleeps), sent along when a game starts.
 */
const CLOUD = process.env.CPAI_CLOUD === "1";
/** Public address of the always-on start page (Render gives the internal service name: add the domain). */
const LANDING_URL = (() => {
  if (process.env.PUBLIC_LANDING_URL) return process.env.PUBLIC_LANDING_URL;
  const h = process.env.PUBLIC_LANDING_HOST;
  return h ? `https://${h.includes(".") ? h : `${h}.onrender.com`}` : null;
})();

/** Room-code lookups per address and minute (codes must not be guessable by brute force). */
const codeTries = new Map<string, { n: number; t: number }>();
function clientIp(req: IncomingMessage): string {
  return String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0]!.trim();
}
function tooManyCodeTries(req: IncomingMessage): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const e = codeTries.get(ip);
  if (!e || now - e.t > 60_000) {
    codeTries.set(ip, { n: 1, t: now });
    return false;
  }
  return ++e.n > 20;
}

/** A deck sent as data (decks saved in the browser): normalised and checked like any other. */
function deckFromData(data: unknown): Deck {
  const deck = sanitizeDeck({ ...(data as object), id: "user-" + String((data as { id?: string })?.id ?? "deck").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60) });
  if (!isDeckLegal(deck)) throw new UserError(`The deck is not legal: ${checkDeckLegality(deck).filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`);
  return deck;
}

/** A deck chosen by id, sent as data, or pasted as a text list (friends can bring their own list). */
function playerDeck(body: { deckId?: string; deck?: unknown; deckText?: string; deckName?: string }): Deck {
  if (body.deck) return deckFromData(body.deck);
  if (body.deckText && body.deckText.trim()) {
    const { deck, unresolved } = importDeckText(body.deckText, body.deckName);
    if (unresolved.length) throw new UserError(`Unknown cards: ${unresolved.map((u) => u.name).join(", ")}`);
    if (!isDeckLegal(deck)) throw new UserError(`The deck is not legal: ${checkDeckLegality(deck).filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`);
    return deck;
  }
  const deck = body.deckId ? getDeck(body.deckId) : undefined;
  if (!deck) throw new UserError("Choose a deck");
  if (!isDeckLegal(deck)) throw new UserError("The deck is not legal");
  return deck;
}

const ticket = (g: GameSession, seat: "p1" | "p2", withInvite = false): SeatTicket => ({ gameId: g.id, token: g.seats[seat].token, ...(withInvite && g.invite ? { invite: g.invite } : {}) });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    // ---- access from other devices / the internet needs the key (shared links carry it once)
    if (!CLOUD && !isAuthorized(req)) {
      const login = keyLogin(req, url);
      if (login) {
        res.writeHead(302, { "set-cookie": login.cookie, location: login.location || "/", "cache-control": "no-store" });
        return res.end();
      }
      if (p.startsWith("/api/") || p.startsWith("/img/")) return sendJson(res, 403, { error: "Access key required" });
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      return res.end("<!doctype html><meta name=viewport content='width=device-width'><body style='background:#000;color:#f5e600;font:16px sans-serif;padding:24px'>Cyberpunk TCG AI: open the full link you received (it contains the access key).</body>");
    }
    const local = !isRemote(req);
    if (p === "/api/health") {
      // The always-on start page polls this while the sleeping server boots (another origin).
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (p === "/api/config") return sendJson(res, 200, { cloud: CLOUD, landingUrl: LANDING_URL });
    if (CLOUD && p.startsWith("/api/share")) return sendJson(res, 404, { error: "Not available online" });
    // ---- sharing over the internet (only from this computer)
    // Everyone who got this far is authorized (has the key or is on this computer).
    if (p === "/api/share" && req.method === "GET") return sendJson(res, 200, shareStatus());
    if (p === "/api/share/start" && req.method === "POST") return local ? sendJson(res, 200, await startShare(PORT)) : sendJson(res, 403, { error: "Only on the host computer" });
    if (p === "/api/share/stop" && req.method === "POST") return local ? sendJson(res, 200, stopShare()) : sendJson(res, 403, { error: "Only on the host computer" });
    if (p === "/api/cards") {
      cardsJson ??= readFileSync(join(DATA_DIR, "cards.json"), "utf8");
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      return res.end(cardsJson);
    }
    if (p === "/api/decks" && req.method === "GET") return sendJson(res, 200, loadAllDecks().map(summarizeDeck).sort((a, b) => a.name.localeCompare(b.name)));
    // ---- deck builder
    if (p === "/api/decks/check" && req.method === "POST") {
      const body = (await readBody(req)) as { deck?: unknown };
      return sendJson(res, 200, checkDeck(sanitizeDeck(body.deck)));
    }
    if (p === "/api/decks/import" && req.method === "POST") {
      const body = (await readBody(req)) as { text?: string; name?: string };
      return sendJson(res, 200, importDeckText(String(body.text ?? ""), body.name));
    }
    if (p.startsWith("/api/decks/") && (req.method === "PUT" || req.method === "DELETE") && (CLOUD || !local)) {
      return sendJson(res, 403, { error: CLOUD ? "Decks are saved in your browser" : "Decks can only be saved or deleted on the host computer" });
    }
    if (p.startsWith("/api/decks/") && req.method === "PUT") {
      const deck = sanitizeDeck({ ...((await readBody(req)) as object), id: decodeURIComponent(p.slice("/api/decks/".length)) });
      // Built-in decks are read-only: saving one makes it your own copy under a new id.
      if (getDeck(deck.id) && !isUserDeck(deck.id)) deck.id = `user-${Date.now().toString(36)}`;
      saveUserDeck(deck);
      return sendJson(res, 200, summarizeDeck(deck));
    }
    if (p.startsWith("/api/decks/") && req.method === "DELETE") {
      const id = decodeURIComponent(p.slice("/api/decks/".length));
      return deleteUserDeck(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "Only your own decks can be deleted" });
    }
    if (p.startsWith("/api/decks/") && req.method === "GET") {
      const deck = getDeck(decodeURIComponent(p.slice("/api/decks/".length)));
      return deck ? sendJson(res, 200, deck) : sendJson(res, 404, { error: "Deck not found" });
    }
    if (p === "/api/bots") {
      const bots: BotSummary[] = Object.entries(STRATEGIES)
        .filter(([, b]) => b.inLobby)
        .map(([id, b]) => ({ id, label: b.label, fair: b.fair, description: b.description }));
      return sendJson(res, 200, bots);
    }
    if (p === "/api/games" && req.method === "POST") {
      const body = (await readBody(req)) as NewGameRequest & { yourDeckData?: unknown; botDeckData?: unknown };
      const you = body.yourDeckData ? deckFromData(body.yourDeckData) : getDeck(body.yourDeck);
      const bot = body.botDeckData ? deckFromData(body.botDeckData) : getDeck(body.botDeck);
      if (!you || !bot) return sendJson(res, 400, { error: "Choose both decks" });
      const game = GameSession.vsBot(you, bot, body.bot ?? "tactical", body.seed, body.name?.trim() || "You");
      games.set(game.id, game);
      return sendJson(res, 200, ticket(game, "p1"));
    }
    // ---- deck analysis (gauntlet against the built-in decks, polled by the page)
    // The opponents of a deck analysis (full lists: the browser can play the gauntlet itself).
    if (p === "/api/analyze/pool" && req.method === "GET") return sendJson(res, 200, loadBuiltinDecks().filter((d) => isDeckLegal(d)));
    if (p === "/api/analyze" && req.method === "POST") {
      const body = (await readBody(req)) as { deckId?: string; deck?: unknown; deckText?: string; deckName?: string; games?: number };
      const deck = playerDeck(body);
      const perMatchup = (GAMES_PER_MATCHUP as readonly number[]).includes(Number(body.games)) ? Number(body.games) : 8;
      try {
        return sendJson(res, 200, startAnalysis(deck, perMatchup, clientIp(req)));
      } catch (e) {
        if (e instanceof AnalysisBusy) return sendJson(res, 429, { error: e.message });
        throw e;
      }
    }
    if (p.startsWith("/api/analyze/") && req.method === "GET") {
      const job = analysisJob(p.slice("/api/analyze/".length));
      return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: "This analysis is no longer available (was the server restarted?)" });
    }
    if (p.startsWith("/api/games/") && req.method === "GET") {
      const g = games.get(p.slice("/api/games/".length));
      return g ? sendJson(res, 200, { gameId: g.id, mode: g.mode, started: g.started }) : sendJson(res, 404, { error: "Game not found (was the server restarted?)" });
    }
    // ---- friend rooms
    if (p === "/api/rooms" && req.method === "POST") {
      const body = (await readBody(req)) as { deckId?: string; deck?: unknown; deckText?: string; name?: string };
      const game = GameSession.friendRoom(playerDeck(body), body.name?.trim() || "Player 1");
      games.set(game.id, game);
      return sendJson(res, 200, ticket(game, "p1", true));
    }
    const byCode = /^\/api\/rooms\/code\/(\d{6})$/.exec(p);
    if (byCode && req.method === "GET") {
      if (tooManyCodeTries(req)) return sendJson(res, 429, { error: "Too many attempts, wait a minute." });
      const g = roomByCode(byCode[1]!);
      return g ? sendJson(res, 200, { gameId: g.id, invite: g.invite }) : sendJson(res, 404, { error: "No open room with this code." });
    }
    const room = /^\/api\/rooms\/([\w-]+)(\/join)?$/.exec(p);
    if (room) {
      const g = games.get(room[1]!);
      const invite = url.searchParams.get("invite");
      if (!g || g.mode !== "friend") return sendJson(res, 404, { error: "Room not found (was the server restarted?)" });
      if (!room[2] && req.method === "GET") {
        if (invite !== g.invite) return sendJson(res, 403, { error: "This invite link is not valid." });
        const info: RoomInfo = { gameId: g.id, status: g.started ? "started" : "waiting", hostName: g.seats.p1.name, hostDeck: g.seats.p1.deck?.name ?? "" };
        return sendJson(res, 200, info);
      }
      if (room[2] && req.method === "POST") {
        const body = (await readBody(req)) as { invite?: string; deckId?: string; deck?: unknown; deckText?: string; name?: string };
        let token: string;
        try {
          token = g.join(String(body.invite ?? ""), playerDeck(body), String(body.name ?? ""));
        } catch (e) {
          throw new UserError((e as Error).message);
        }
        return sendJson(res, 200, { gameId: g.id, token } satisfies SeatTicket);
      }
    }
    if (p.startsWith("/img/")) {
      const key = decodeURIComponent(p.slice(5)).replace(/\.webp$/, "");
      const img = await getCardImage(key);
      if (!img) {
        res.writeHead(404, { "cache-control": "no-store" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "image/webp", "cache-control": "public, max-age=604800" });
      return res.end(img);
    }
    if (p.startsWith("/api/")) return sendJson(res, 404, { error: "Unknown API path" });
    return serveStatic(req, res);
  } catch (err) {
    // Player mistakes (bad invite, illegal deck…) are 400s; anything else is a server bug.
    const expected = err instanceof UserError;
    if (!expected) console.error(err);
    if (!res.headersSent) sendJson(res, expected ? 400 : 500, { error: String((err as Error).message ?? err) });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/ws" || (!CLOUD && !isAuthorized(req))) return socket.destroy();
  const game = games.get(url.searchParams.get("game") ?? "");
  // Only the players of this game: the token decides which seat (and so which cards) you see.
  const seat = game?.seatForToken(url.searchParams.get("token"));
  if (!game || !seat) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    const unsubscribe = game.subscribe(seat, (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    });
    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "action") game.handleAction(seat, msg.actionId, msg.stateID);
      else if (msg.type === "command") game.handleCommand(seat, msg.move, msg.args, msg.stateID);
      else if (msg.type === "intent") game.handleIntent(seat, msg.intent, msg.stateID);
      else if (msg.type === "setBotSpeed" && game.mode === "bot") game.botDelayMs = Math.max(0, Math.min(5000, Number(msg.ms) || 0));
      else if (msg.type === "concede") game.concede(seat);
    });
    ws.on("close", unsubscribe);
  });
});

botPool.warmUp();
server.listen(PORT, HOST, () => {
  console.log(`\n  Cyberpunk TCG AI is running:  http://localhost:${PORT}\n  (close this window to stop the server)\n`);
});
