import { useEffect, useState } from "react";
import type { DeckSummary, RoomInfo, ShareInfo } from "@cpai/core/protocol";
import { api, loadCardDb, playerName, setPlayerName, type CardDb } from "../api.ts";
import { DeckPicker } from "./Lobby.tsx";

const isLocalHost = () => ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

/** The link a friend opens: public tunnel address while sharing, this address otherwise. Carries the access key. */
export function inviteLink(share: ShareInfo | null, gameId: string, invite: string): string {
  const base = share?.active && share.url ? share.url : location.origin;
  const key = share?.key ? `/?key=${encodeURIComponent(share.key)}` : "/";
  return `${base}${key}#/join/${gameId}/${invite}`;
}

/** Host's screen while the friend has not joined yet. */
export function WaitingRoom({ gameId, invite, hostDeck }: { gameId: string; invite?: string; hostDeck: string }) {
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.share().then(setShare).catch(() => {});
  }, []);
  if (!invite) return <div className="center-msg">Waiting for the other player…</div>;
  const link = inviteLink(share, gameId, invite);
  const localOnly = isLocalHost() && !share?.active;
  return (
    <div className="room">
      <h1>
        CYBERPUNK <span>TCG</span> // AI
      </h1>
      <section className="panel room-card">
        <h2>Waiting for your friend</h2>
        <p className="muted small">Your deck: {hostDeck}</p>
        <div className="invite">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button
            className="btn primary"
            onClick={() =>
              navigator.clipboard
                .writeText(link)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {isLocalHost() && (
          <div className="share-box">
            {share?.active ? (
              <p className="small">
                Shared on the internet: <b>{share.url}</b>{" "}
                <button className="btn small" onClick={() => api.stopShare().then(setShare)}>
                  Stop sharing
                </button>
              </p>
            ) : share && !share.available ? (
              <p className="small warn-text">Internet sharing needs cloudflared: run udostepnij.bat once.</p>
            ) : (
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setShare(await api.startShare().catch(() => share));
                  setBusy(false);
                }}
              >
                {busy ? "Starting…" : "Share over the internet"}
              </button>
            )}
            {localOnly && <p className="small muted">This link only works on this computer until you share over the internet.</p>}
            {share?.error && <p className="small warn-text">{share.error}</p>}
          </div>
        )}
        <div className="spinner-line">
          <span className="dots">Waiting</span>
        </div>
        <a className="btn ghost small" href="#/">
          Cancel
        </a>
      </section>
    </div>
  );
}

/** The invited friend picks a name and a deck (or pastes a list) and joins. */
export function JoinRoom({ gameId, invite }: { gameId: string; invite: string }) {
  const [info, setInfo] = useState<RoomInfo>();
  const [error, setError] = useState<string>();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [db, setDb] = useState<CardDb>();
  const [name, setName] = useState(playerName());
  const [deckId, setDeckId] = useState("starter-the-heist");
  const [useList, setUseList] = useState(false);
  const [deckText, setDeckText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.roomInfo(gameId, invite).then(setInfo).catch((e) => setError(String(e.message ?? e)));
    api.decks().then(setDecks).catch(() => {});
    loadCardDb().then(setDb).catch(() => {});
  }, [gameId, invite]);

  const join = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setPlayerName(name);
      await api.joinRoom(gameId, { invite, name, ...(useList ? { deckText } : { deckId }) });
      location.hash = `#/game/${gameId}`;
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <div className="room">
      <h1>
        CYBERPUNK <span>TCG</span> // AI
      </h1>
      <section className="panel room-card">
        {info ? (
          <h2>
            {info.hostName} invites you {info.status === "started" ? "(already started)" : ""}
          </h2>
        ) : (
          <h2>Join game</h2>
        )}
        {error && <div className="banner error">{error}</div>}
        <div className="lobby-row">
          <label>Your name</label>
          <input className="search" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <span />
        </div>
        <div className="lobby-row">
          <label>Your deck</label>
          {useList ? (
            <textarea className="deck-paste" value={deckText} onChange={(e) => setDeckText(e.target.value)} placeholder={"Legends\n1 …\n\nMain Deck\n3x …"} />
          ) : (
            <DeckPicker decks={decks} db={db} value={deckId} onChange={setDeckId} />
          )}
          <span />
        </div>
        <label className="opt paste-toggle">
          <input type="checkbox" checked={useList} onChange={(e) => setUseList(e.target.checked)} /> Paste my own deck list
        </label>
        <button className="btn primary big" disabled={busy || !info || info.status !== "waiting" || (useList && !deckText.trim())} onClick={join}>
          {busy ? "Joining…" : "Join"}
        </button>
      </section>
    </div>
  );
}
