/**
 * Runs in the page's own context (manifest "world": "MAIN"): reads the game snapshot the site keeps in
 * window.__cyberpunkTcgApp.snapshot and hands a trimmed copy to the extension when it changes.
 * Read-only: it never calls the site's functions or sends anything to the site's server.
 */
type Json = Record<string, unknown>;

const DROP = new Set(["imageUrl", "rulesText", "text", "accent", "stripe", "cosmetics", "altArtId", "altArtLabel", "isAltArt", "supporterProfile", "deckRestrictionNotices", "deckSizeNotices", "reconnectRecoveryToken", "actions"]);
/** Clocks and server time change all the time: not part of the position. */
const VOLATILE = /clock|NowMs|UpdatedAt|Deadline/i;

function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (!v || typeof v !== "object") return v;
  const out: Json = {};
  for (const [k, x] of Object.entries(v as Json)) {
    if (DROP.has(k) || VOLATILE.test(k)) continue;
    // Card statuses: keep only their kinds ("lag", "spent"…).
    if (k === "currentEffects") {
      if (Array.isArray(x) && x.length) out.effects = x.map((e) => String((e as Json).kind ?? (e as Json).id ?? ""));
      continue;
    }
    out[k] = clean(x);
  }
  return out;
}

function trimmed(s: Json): Json | null {
  const room = (s.room ?? {}) as Json;
  const game = s.game as Json | undefined;
  const players = s.players as Json | undefined;
  if (!game || !players) return null;
  // Room: every plain flag (the coach checks the kind of match) and the two deck lists.
  const flags: Json = {};
  for (const [k, x] of Object.entries(room)) if ((x === null || ["string", "number", "boolean"].includes(typeof x)) && !VOLATILE.test(k) && !/reconnect|seconds|prompt|spectator/i.test(k)) flags[k] = x;
  const selections = (room.deckSelections ?? {}) as Record<string, Json | undefined>;
  const decks: Json = {};
  for (const [pid, d] of Object.entries(selections)) if (d) decks[pid] = { deckLegendIds: d.deckLegendIds, deckCardQuantities: d.deckCardQuantities };
  const self = (s.self ?? {}) as Json;
  const controls = (s.controls ?? {}) as Json;
  return {
    room: { ...flags, deckSelections: decks },
    self: { playerId: self.playerId ?? null, role: self.role ?? null, isSpectator: self.isSpectator ?? false },
    game: clean(game),
    players: clean(players),
    controls: {
      pending: controls.pending ? { type: String((controls.pending as Json).type ?? ""), stepLabel: String((controls.pending as Json).stepLabel ?? ""), actorId: String((controls.pending as Json).actorId ?? "") } : null,
      primaryActions: Array.isArray(controls.primaryActions) ? (controls.primaryActions as Json[]).map((a) => String(a.type ?? "")) : [],
    },
  };
}

let last = "";
setInterval(() => {
  const app = (window as unknown as { __cyberpunkTcgApp?: { snapshot?: Json } }).__cyberpunkTcgApp;
  const snap = app?.snapshot ? trimmed(app.snapshot) : null;
  const text = JSON.stringify([!!app, snap]);
  if (text === last) return;
  last = text;
  window.postMessage({ source: "cpai-coach-page", snapshot: snap, app: !!app }, location.origin);
}, 500);
