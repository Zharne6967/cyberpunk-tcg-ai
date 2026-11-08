import { useEffect, useMemo, useRef, useState } from "react";
import type { CardView, GameStateMessage, LogLine, UiAction } from "@cpai/core/protocol";
import { COLOR_PL, TYPE_PL, type CardDb } from "../api.ts";
import { CardFace } from "./CardFace.tsx";
import { cardData } from "./Board.tsx";

type Send = (move: string, args?: Record<string, unknown>) => void;

const GROUP_PL: Record<string, string> = {
  setup: "Przygotowanie",
  play: "Zagraj kartę",
  sell: "Sprzedaj (Eddie)",
  legend: "Legendy",
  attack: "Atak",
  react: "Reakcja",
  ability: "Zdolności",
  choice: "Wybór",
  phase: "Tura",
  other: "Inne",
};

const CHOICE_PL: Record<string, string> = {
  chooseFirstPlayer: "Kto zaczyna partię?",
  gainGig: "Wybierz kość Gig z Fixera",
  chooseTarget: "Wybierz cel efektu",
  chooseEffect: "Wybierz jedną z opcji",
  chooseTrigger: "Wybierz, który efekt rozpatrzyć",
  chooseGigsToSteal: "Wybierz Gigi do kradzieży",
  preventGigSteal: "Rywal kradnie Twoje Gigi — możesz zapobiec",
  scry: "Rozdziel odkryte karty",
  revealDestination: "Gdzie trafia odkryta karta?",
  chooseCardToPlay: "Wybierz kartę do zagrania",
  chooseCardToMove: "Wybierz kartę",
  chooseCardType: "Wybierz typ karty",
  redirectDefeat: "Uratować jednostkę przed pokonaniem?",
  chooseSacrificialGear: "Wybierz Gear do poświęcenia",
};

function describeTurn(s: GameStateMessage): string {
  const v = s.view;
  const mine = v.activePlayerId === s.you;
  if (s.result) return "Koniec gry";
  if (v.gamePhase === "setup") return "Przygotowanie partii";
  const att = v.attackState;
  if (att) {
    const step: Record<string, string> = { attack: "deklaracja ataku", react: "reakcje", fight: "walka", fightResult: "wynik walki", steal: "kradzież" };
    return `${mine ? "Twój atak" : "Atak bota"} — ${step[att.step] ?? att.step}`;
  }
  return `Tura ${v.turnNumber} · ${mine ? "Twoja" : "bota"} · faza ${v.gamePhase === "main" ? "główna" : v.gamePhase}${v.overtimeActive ? " · DOGRYWKA" : ""}`;
}

/** Better labels for choice actions that need the choice payload (effect options, trigger texts, card types). */
function choiceLabel(a: UiAction, s: GameStateMessage): string {
  const p = (s.choice?.payload ?? {}) as Record<string, unknown>;
  const args = a.args ?? {};
  if (a.move === "resolveChooseEffect") {
    const opt = (p.options as { id: string; label: string }[] | undefined)?.find((o) => o.id === args.optionId);
    if (opt) return opt.label;
  }
  if (a.move === "resolveTrigger" && !args.pass) {
    const opt = (p.options as { triggerId: string; cardName: string; abilityText: string }[] | undefined)?.find((o) => o.triggerId === args.triggerId);
    if (opt) return `${opt.cardName}: ${opt.abilityText}`;
  }
  if (a.move === "resolveCardTypeChoice") return `Typ: ${TYPE_PL[String(args.cardType)] ?? String(args.cardType)}`;
  return a.label;
}

export function ActionPanel({ s, db, send, sendAction, onHover }: { s: GameStateMessage; db: CardDb; send: Send; sendAction: (a: UiAction) => void; onHover: (ids: string[]) => void }) {
  const yourTurn = s.promptStatus === "action" || s.promptStatus === "choice";
  const groups = useMemo(() => {
    // Two copies of the same card give identical options — show one button with a ×N counter.
    const m = new Map<string, { a: UiAction; n: number }[]>();
    for (const a of s.actions) {
      if (a.move === "passPhase") continue;
      const g = m.get(a.group) ?? [];
      const dup = g.find((x) => x.a.label === a.label && (a.group === "play" || a.group === "sell"));
      if (dup) dup.n++;
      else g.push({ a, n: 1 });
      m.set(a.group, g);
    }
    return [...m.entries()];
  }, [s.actions]);
  const pass = s.actions.find((a) => a.move === "passPhase");
  const choice = s.choice;
  const source = (choice?.payload as { source?: { displayName?: string; rulesText?: string } } | undefined)?.source;

  return (
    <div className="panel actions-panel">
      <div className={`turn-banner ${yourTurn ? "you" : "bot"}`}>{describeTurn(s)}</div>
      {s.botThinking && <div className="thinking">Bot myśli<span className="dots" /></div>}
      {!yourTurn && !s.botThinking && !s.result && <div className="muted">Czekaj na ruch rywala…</div>}
      {choice && (
        <div className="choice-box">
          <div className="choice-title">{CHOICE_PL[choice.type] ?? choice.type}</div>
          {source?.displayName && (
            <div className="choice-src">
              <b>{source.displayName}</b>
              {source.rulesText ? <div className="small">{source.rulesText}</div> : null}
            </div>
          )}
          {choice.type === "scry" && <ScryPicker s={s} db={db} send={send} />}
          {choice.type === "preventGigSteal" && <PreventStealPicker s={s} send={send} />}
        </div>
      )}
      {groups.map(([group, acts]) => (
        <div key={group} className="act-group">
          <div className="act-group-title">{GROUP_PL[group] ?? group}</div>
          {acts.map(({ a, n }) => (
            <button
              key={a.id}
              className={`btn act g-${a.group}`}
              onClick={() => sendAction(a)}
              onMouseEnter={() => onHover([a.cardId, a.targetId].filter((x): x is string => !!x))}
              onMouseLeave={() => onHover([])}
            >
              {a.group === "choice" ? choiceLabel(a, s) : a.label}
              {n > 1 && <span className="mult"> ×{n}</span>}
            </button>
          ))}
        </div>
      ))}
      {pass && (
        <button className="btn primary pass" onClick={() => sendAction(pass)}>
          {pass.label} ⏎
        </button>
      )}
    </div>
  );
}

function ScryPicker({ s, db, send }: { s: GameStateMessage; db: CardDb; send: Send }) {
  const p = s.choice!.payload as {
    revealedCards: CardView[];
    destinations: { zone: string; min?: number; max?: number; remainder?: boolean; eligibleCardIds: string[]; eligibilityLabel: string }[];
  };
  const pickable = p.destinations.filter((d) => !d.remainder);
  const remainder = p.destinations.find((d) => d.remainder);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const ZONE_PL: Record<string, string> = { hand: "na rękę", trash: "do kosza", deckTop: "na wierzch talii", deckBottom: "pod spód talii", field: "na pole", eddieArea: "jako Eddie" };
  const submit = () => {
    const destinations = pickable.map((d) => ({ zone: d.zone, cardIds: Object.entries(assign).filter(([, z]) => z === d.zone).map(([id]) => id) }));
    if (remainder) destinations.push({ zone: remainder.zone, cardIds: p.revealedCards.map((c) => c.instanceId).filter((id) => !assign[id]) });
    send("resolveScry", { destinations });
  };
  return (
    <div className="scry">
      {p.revealedCards.map((c) => {
        const opts = pickable.filter((d) => d.eligibleCardIds.includes(c.instanceId));
        return (
          <div key={c.instanceId} className="scry-row">
            <div className="scry-card">
              <CardFace card={cardData(db, c)} size="sm" showText={false} />
            </div>
            <div>
              <div>{c.cardName}</div>
              <select value={assign[c.instanceId] ?? ""} onChange={(e) => setAssign({ ...assign, [c.instanceId]: e.target.value })}>
                <option value="">{remainder ? `(reszta: ${ZONE_PL[remainder.zone] ?? remainder.zone})` : "—"}</option>
                {opts.map((d) => (
                  <option key={d.zone} value={d.zone}>
                    {ZONE_PL[d.zone] ?? d.zone}
                    {d.max != null ? ` (max ${d.max})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
      {pickable.map((d) => (
        <div key={d.zone} className="small muted">
          {ZONE_PL[d.zone] ?? d.zone}: {d.eligibilityLabel} {d.min != null ? `min ${d.min}` : ""} {d.max != null ? `max ${d.max}` : ""}
        </div>
      ))}
      <button className="btn primary" onClick={submit}>
        Zatwierdź
      </button>
    </div>
  );
}

function PreventStealPicker({ s, send }: { s: GameStateMessage; send: Send }) {
  const p = s.choice!.payload as { stealEntries: { dieId: string; value: number }[]; handEntries: { cardId: string; cost: number }[] };
  const hand = (s.view.players[s.you]!.zones.hand as CardView[]) ?? [];
  const nameOf = (id: string) => hand.find((c) => c.instanceId === id)?.cardName ?? id;
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const used = new Set(Object.values(pairs));
  return (
    <div className="prevent">
      <div className="small">Możesz odrzucić z ręki kartę o koszcie równym wartości Giga, aby go ochronić.</div>
      {p.stealEntries.map((e) => (
        <div key={e.dieId} className="prevent-row">
          Gig o wartości <b>{e.value}</b>:{" "}
          <select value={pairs[e.dieId] ?? ""} onChange={(ev) => setPairs({ ...pairs, [e.dieId]: ev.target.value })}>
            <option value="">nie chroń</option>
            {p.handEntries
              .filter((h) => h.cost === e.value && (!used.has(h.cardId) || pairs[e.dieId] === h.cardId))
              .map((h) => (
                <option key={h.cardId} value={h.cardId}>
                  odrzuć {nameOf(h.cardId)}
                </option>
              ))}
          </select>
        </div>
      ))}
      <button
        className="btn primary"
        onClick={() => {
          const preventions = Object.entries(pairs).filter(([, c]) => c).map(([dieId, cardId]) => ({ dieId, cardId }));
          send("resolvePreventGigSteal", preventions.length ? { preventions } : { pass: true, preventions: [] });
        }}
      >
        Zatwierdź
      </button>
    </div>
  );
}

export function LogPanel({ log, onCard }: { log: LogLine[]; onCard: (definitionId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length]);
  return (
    <div className="panel log-panel">
      <h3>Log partii</h3>
      <div className="log" ref={ref}>
        {log.map((l) => (
          <div key={l.seq} className={`log-line ${l.actor}`}>
            <span className="log-who">{l.actor === "you" ? "Ty" : l.actor === "bot" ? "Bot" : "•"}</span>
            <span className="log-text">
              {l.text}
              {l.cards.map((c) => (
                <button key={c.instanceId} className="log-card" title="Pokaż kartę" onClick={() => onCard(c.definitionId)}>
                  🔍
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Inspector({ db, definitionId, live, onClose }: { db: CardDb; definitionId: string; live?: CardView; onClose: () => void }) {
  const card = db.byId.get(definitionId) ?? (live?.cardName ? db.byName.get(live.cardName) : undefined);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!card) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal inspector" onClick={(e) => e.stopPropagation()}>
        <div className="insp-img">
          <CardFace card={card} size="lg" />
        </div>
        <div className="insp-body">
          <h2>{card.displayName}</h2>
          <div className="insp-meta">
            <span className={`pill c-${card.color}`}>{COLOR_PL[card.color]}</span>
            <span className="pill">{TYPE_PL[card.type]}</span>
            {card.cost != null && <span className="pill">Koszt {card.cost} €$</span>}
            {card.power != null && card.type !== "program" && <span className="pill">Siła {card.power}</span>}
            {card.ram != null && <span className="pill">RAM {card.ram}</span>}
            {card.sellTag && <span className="pill">Sell Tag €$</span>}
          </div>
          {card.tags.length > 0 && <div className="small">Tagi: {card.tags.join(", ")}</div>}
          <p className="insp-text">{card.text}</p>
          {live && live.zone === "field" && (
            <div className="insp-live">
              <b>Na stole:</b> siła {live.effectivePower}
              {live.effectivePower !== live.power ? ` (bazowo ${live.power})` : ""}
              {live.spent ? " · zużyta (spent)" : ""}
              {live.hasLag ? " · LAG (nie może atakować w tej turze)" : ""}
              {live.activeEffects.map((e) => (
                <div key={e.id} className={`fx-line ${e.tone}`}>
                  {e.sourceName}: {e.label} {e.durationLabel ? `(${e.durationLabel})` : ""}
                </div>
              ))}
            </div>
          )}
          {card.rulings.length > 0 && (
            <div className="rulings">
              <h4>Oficjalne FAQ ({card.rulings.length})</h4>
              {card.rulings.map((r, i) => (
                <div key={i} className="ruling">
                  {r.question && <div className="q">P: {r.question}</div>}
                  <div className="a">O: {r.answer}</div>
                </div>
              ))}
            </div>
          )}
          <div className="small muted">
            {card.set.name} · #{card.printNumber} · {card.rarity}
          </div>
          <button className="btn" onClick={onClose}>
            Zamknij (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
