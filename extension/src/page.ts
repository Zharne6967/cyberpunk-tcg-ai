/**
 * Runs in the page's own context (manifest "world": "MAIN"): reads the game snapshot the site keeps in
 * window.__cyberpunkTcgApp.snapshot and hands a trimmed copy to the extension when it changes.
 * Read-only: it never calls the site's functions or sends anything to the site's server.
 */
type Json = Record<string, unknown>;

const DROP = new Set(["imageUrl", "rulesText", "text", "accent", "stripe", "cosmetics", "altArtId", "altArtLabel", "isAltArt", "supporterProfile", "deckRestrictionNotices", "deckSizeNotices", "reconnectRecoveryToken", "actions"]);
/** Clocks and server time change all the time: not part of the position. */
const VOLATILE = /clock|NowMs|UpdatedAt|Deadline/i;

/** A plain copy without the dropped fields. Safe on anything: loops back to a parent and very deep data are cut. */
function clean(v: unknown, parents: Set<object> = new Set(), depth = 0): unknown {
  if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return null;
  if (!v || typeof v !== "object") return v;
  if (parents.has(v) || depth > 24) return null;
  parents.add(v);
  try {
    if (Array.isArray(v)) return v.map((x) => clean(x, parents, depth + 1));
    const out: Json = {};
    for (const [k, x] of Object.entries(v as Json)) {
      if (DROP.has(k) || VOLATILE.test(k)) continue;
      // Card statuses: keep only their kinds ("lag", "spent"…).
      if (k === "currentEffects") {
        if (Array.isArray(x) && x.length) out.effects = x.map((e) => String((e as Json | null)?.kind ?? (e as Json | null)?.id ?? ""));
        continue;
      }
      out[k] = clean(x, parents, depth + 1);
    }
    return out;
  } finally {
    parents.delete(v);
  }
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
  const pending = (controls.pending && typeof controls.pending === "object" ? controls.pending : null) as Json | null;
  const source = (pending?.sourceCard && typeof pending.sourceCard === "object" ? pending.sourceCard : null) as Json | null;
  const attack = (pending?.attackContext && typeof pending.attackContext === "object" ? pending.attackContext : null) as Json | null;
  return {
    room: { ...flags, deckSelections: decks },
    self: { playerId: self.playerId ?? null, role: self.role ?? null, isSpectator: self.isSpectator ?? false },
    game: clean(game),
    players: clean(players),
    controls: {
      pending: pending
        ? {
            type: String(pending.type ?? ""),
            stepLabel: String(pending.stepLabel ?? ""),
            actorId: String(pending.actorId ?? ""),
            prompt: String(pending.prompt ?? ""),
            sourceCard: source ? { id: String(source.id ?? ""), cardId: String(source.cardId ?? "") } : null,
            options: Array.isArray(pending.actions) ? (pending.actions as (Json | null)[]).map((a) => String(a?.label ?? "")) : [],
            attackContext: attack
              ? {
                  attackerId: String(attack.attackerId ?? ""),
                  attackerPlayerId: String(attack.attackerPlayerId ?? ""),
                  targetId: typeof attack.targetId === "string" ? attack.targetId : null,
                  targetType: String(attack.targetType ?? ""),
                }
              : null,
          }
        : null,
      primaryActions: Array.isArray(controls.primaryActions) ? (controls.primaryActions as (Json | null)[]).map((a) => String(a?.type ?? "")) : [],
      canChooseTurnOrder: controls.canChooseTurnOrder === true,
      canKeepOpeningHand: controls.canKeepOpeningHand === true,
      canMulligan: controls.canMulligan === true,
    },
  };
}

type App = { snapshot?: Json | null };
/** The site's app object (its debug handle as a second way in). */
function findApp(): App | null {
  const w = window as unknown as { __cyberpunkTcgApp?: App; __cyberpunkTcgDebug?: { app?: App } };
  const app = w.__cyberpunkTcgApp ?? w.__cyberpunkTcgDebug?.app;
  return app && typeof app === "object" ? app : null;
}

// Started twice (the extension also injects itself into tabs that were open when it was installed or updated)?
const started = window as unknown as { __cpaiCoachPageV2?: boolean };
if (!started.__cpaiCoachPageV2) {
  started.__cpaiCoachPageV2 = true;
  let last = "";
  const tick = () => {
    const app = findApp();
    let snap: Json | null = null;
    let error: string | null = null;
    try {
      snap = app?.snapshot && typeof app.snapshot === "object" ? trimmed(app.snapshot) : null;
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, 200);
    }
    let text: string;
    try {
      text = JSON.stringify([!!app, snap, error]);
    } catch (e) {
      snap = null;
      error = String((e as Error)?.message ?? e).slice(0, 200);
      text = JSON.stringify([!!app, null, error]);
    }
    if (text === last) return;
    last = text;
    try {
      window.postMessage({ source: "cpai-coach-page", snapshot: snap, app: !!app, error, path: location.pathname }, location.origin);
    } catch (e) {
      // Something in the copy cannot be sent between the page and the extension: say so instead of going quiet.
      const why = String((e as Error)?.message ?? e).slice(0, 200);
      window.postMessage({ source: "cpai-coach-page", snapshot: null, app: !!app, error: why, path: location.pathname }, location.origin);
    }
  };
  setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.warn("[coach]", e);
    }
  }, 500);
  // The extension's part of the page asks again (e.g. it was injected after this script).
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data?.source === "cpai-coach-hello") {
      last = "";
      tick();
    }
  });
}
