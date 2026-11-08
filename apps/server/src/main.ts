import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { STRATEGIES } from "@cpai/ai";
import type { BotSummary, ClientMessage, NewGameRequest } from "@cpai/core/protocol";
import { getDeck, loadAllDecks, summarizeDeck } from "./decks.ts";
import { GameSession, games } from "./game.ts";
import { getCardImage } from "./images.ts";
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
    res.end("Interfejs nie jest zbudowany. Uruchom: pnpm build  (albo start.bat)");
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    if (p === "/api/health") return sendJson(res, 200, { ok: true });
    if (p === "/api/cards") {
      cardsJson ??= readFileSync(join(DATA_DIR, "cards.json"), "utf8");
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      return res.end(cardsJson);
    }
    if (p === "/api/decks" && req.method === "GET") return sendJson(res, 200, loadAllDecks().map(summarizeDeck).sort((a, b) => a.name.localeCompare(b.name)));
    if (p.startsWith("/api/decks/") && req.method === "GET") {
      const deck = getDeck(decodeURIComponent(p.slice("/api/decks/".length)));
      return deck ? sendJson(res, 200, deck) : sendJson(res, 404, { error: "Nie ma takiej talii" });
    }
    if (p === "/api/bots") {
      const bots: BotSummary[] = Object.entries(STRATEGIES)
        .filter(([, b]) => b.inLobby)
        .map(([id, b]) => ({ id, label: b.label, fair: b.fair, description: b.description }));
      return sendJson(res, 200, bots);
    }
    if (p === "/api/games" && req.method === "POST") {
      const body = (await readBody(req)) as NewGameRequest;
      const you = getDeck(body.yourDeck);
      const bot = getDeck(body.botDeck);
      if (!you || !bot) return sendJson(res, 400, { error: "Wybierz obie talie" });
      const game = new GameSession(you, bot, body.bot ?? "tactical", body.seed);
      games.set(game.id, game);
      return sendJson(res, 200, { gameId: game.id });
    }
    if (p.startsWith("/api/games/") && req.method === "GET") {
      const g = games.get(p.slice("/api/games/".length));
      return g ? sendJson(res, 200, { gameId: g.id }) : sendJson(res, 404, { error: "Gra nie istnieje (serwer był restartowany?)" });
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
    if (p.startsWith("/api/")) return sendJson(res, 404, { error: "Nieznany adres API" });
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: String((err as Error).message ?? err) });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/ws") return socket.destroy();
  const game = games.get(url.searchParams.get("game") ?? "");
  if (!game) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    const unsubscribe = game.subscribe((msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    });
    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "action") game.handleAction(msg.actionId, msg.stateID);
      else if (msg.type === "command") game.handleCommand(msg.move, msg.args, msg.stateID);
      else if (msg.type === "setBotSpeed") game.botDelayMs = Math.max(0, Math.min(5000, Number(msg.ms) || 0));
      else if (msg.type === "concede") game.concede();
    });
    ws.on("close", unsubscribe);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Cyberpunk TCG AI działa:  http://localhost:${PORT}\n  (zamknij to okno, aby zatrzymać serwer)\n`);
});
