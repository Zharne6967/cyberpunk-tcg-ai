import { enMessages } from "@tcg/cyberpunk-engine";
import type { CardView, MatchView } from "@cpai/core/protocol";

type MessageKey = keyof typeof enMessages;

/** Polish action-log templates; anything not translated falls back to the engine's English text. */
const PL: Partial<Record<MessageKey, string>> = {
  "move.rejected": "Akcja odrzucona: {reason}.",
  "move.playCard": "Zagrywa {cardName} za {cost} €$.",
  "move.playCard.gear": "Zagrywa {cardName} za {cost} €$, podłączając do {attachedToName}.",
  "move.sellCard": "Sprzedaje {cardName}.",
  "move.callLegend": "Przywołuje Legendę {legendName}.",
  "move.attackUnit": "Atak: {attackerName} atakuje {defenderName}.",
  "move.attackRival": "Atak: {attackerName} atakuje Gigi rywala.",
  "move.useBlocker": "Reakcja: {blockerName} ({blockerPower}) blokuje {attackerName} ({attackerPower}).",
  "move.resolveAttack.fight.attackerWins": "Walka: {attackerName} ({attackerPower}) pokonuje {defenderName} ({defenderPower}).",
  "move.resolveAttack.fight.defenderWins": "Walka: {defenderName} ({defenderPower}) pokonuje {attackerName} ({attackerPower}).",
  "move.resolveAttack.fight.mutual": "Walka: obie jednostki giną ({attackerName} {attackerPower}, {defenderName} {defenderPower}).",
  "move.resolveAttack.direct": "Kradzież: {attackerName} kradnie {stolenGigs} (siła {attackerPower}).",
  "move.resolveAttack.ended": "Atak {attackerName} zakończył się bez walki i kradzieży.",
  "move.turnEnded": "Koniec tury {turnNumber}.",
  "game.overtimeStarted": "Dogrywka (Overtime)! Kto pierwszy będzie miał 7 Gigów — wygrywa od razu.",
  "game.overtimeFirstEmptyTurn": "Obie strefy Fixera zaczęły turę puste. Dogrywka zacznie się po jeszcze jednej takiej turze.",
  "game.overtimeFinalTurn": "Strefy Fixera znów puste — dogrywka zaczyna się po tej turze.",
  "move.concede": "Gracz poddaje partię.",
  "move.activateAbility": "{cardName} używa zdolności.",
  "move.activateAbility.attached": "{attachedToName} używa {cardName}.",
  "move.searchDeck.reveal": "Odkrywa {count} wierzchnich kart talii.",
  "effect.draw.resolved": "{sourceCardName}: dobrano kart: {drawnCount}.",
  "effect.discard.resolved": "{sourceCardName}: odrzucono {discardedCardName} (koszt {discardedCost}).",
  "effect.noValidTargets": "{sourceCardName}: efekt {effectName} nie ma prawidłowych celów.",
  "move.searchDeck.revealNamed": "Odkrywa {count} wierzchnich kart talii: {revealedCardNames}.",
  "move.searchDeck.revealSelected": "Odkrywa wyszukane karty ({count}): {revealedCardNames}.",
  "move.resolveSearchDeck": "Przeszukuje {looked} wierzchnich kart i znajduje {count}.",
  "move.resolveSearchDeckNamed": "Przeszukuje {looked} wierzchnich kart i dodaje {selectedCardNames} ({destination}). Pod spód talii: {remainderCount}.",
  "move.resolveAdjustGig": "Zmienia Gig {dieLabel} z {previousValue} na {value}.",
  "move.readyStep.cantReady": "{cardName} nie odświeża się z powodu: {sourceDescription}.",
  "move.resolveRedirectDefeat": "{replacementCardName} płaci {cost} €$, by uratować {protectedCardName}, i zostaje usunięta z gry.",
  "move.resolveAttack.fight.attackerWins.prevented": "Walka: {attackerName} ({attackerPower}) wygrywa z {defenderName} ({defenderPower}); {sourceCardName} zapobiega pokonaniu.",
  "move.resolveAttack.fight.defenderWins.prevented": "Walka: {defenderName} ({defenderPower}) wygrywa z {attackerName} ({attackerPower}); {sourceCardName} zapobiega pokonaniu.",
  "move.resolveAttack.fight.mutual.prevented": "Walka: obie jednostki przegrywają przy sile {attackerPower}; {sourceCardName} ratuje {defenderName}.",
  "move.resolveAttack.fight.mutual.attackerPrevented": "Walka: obie przegrywają ({attackerName} {attackerPower}, {defenderName} {defenderPower}); {sourceCardName} ratuje {attackerName}.",
  "move.resolveAttack.fight.mutual.bothPrevented": "Walka: obie przegrywają ({attackerName} {attackerPower}, {defenderName} {defenderPower}); {sourceCardName} ratuje obie.",
  "effect.draw.skipped": "{sourceCardName}: nie dobrano karty ({reason}).",
  "effect.skipped": "{sourceCardName}: efekt {effectName} pominięty ({reason}).",
  "effect.noAction": "{sourceCardName}: efekt {effectName} nic nie zrobił — warunki niespełnione.",
  "effect.modifyPower.resolved": "{sourceCardName}: {targetNames} otrzymuje {powerChange} siły.",
  "trigger.resolutionFailed": "Zdolność {cardName} nie mogła się rozpatrzyć: {reason}.",
  "effect.insufficientTargets": "{sourceCardName}: efekt {effectName} wymagał {requiredCount} celów, dostępnych {availableCount} — nic się nie stało.",
  "effect.spend.skippedAlreadySpent": "{sourceCardName}: {targetName} jest już zużyta (spent).",
  "effect.trashFromDeck.resolved": "{sourceCardName}: do kosza z wierzchu talii ({trashedCount}): {trashedCardNames}.",
  "effect.sellFromDeck.resolved": "{sourceCardName}: sprzedaje z wierzchu talii {soldCardNames}.",
  "trigger.autoResolved": "Efekt {cardName}: {abilityText}",
  "trigger.resolved": "Rozpatrzono {cardName}: {abilityText}",
  "trigger.orderPending": "Kolejność efektów: wybierz 1 z {triggerCount}: {triggerNames}.",
  "trigger.orderSelected": "Najpierw rozpatruje się {cardName}; pozostało {remainingCount} ({remainingTriggerNames}).",
  "trigger.noValidTargets": "{cardName}: brak prawidłowych celów ({reason}).",
  "trigger.requiredTargetUnavailable": "{cardName}: brak legalnego celu ({targetDescription}); efekty zależne od celu pominięte.",
  "trigger.insufficientTargets": "{cardName}: potrzeba {requiredCount} celów ({targetDescription}), dostępnych {availableCount}; efekty pominięte.",
  "trigger.stealGig": "{cardName} kradnie {stolenGigs}.",
  "trigger.targetResolved": "Wybrano {targetNames} dla {sourceCardName}.",
  "trigger.targetResolved.deckBottom": "Wybrano {targetNames} dla {sourceCardName} — pod spód talii.",
  "trigger.targetResolved.rerollGig": "Wybrano {targetNames} dla {sourceCardName}: {previousValue} → {newValue}.",
  "trigger.grantRule.cantAttack": "{sourceCardName}: {targetNames} nie może atakować do Twojej następnej tury.",
  "trigger.defeatedTarget": "{sourceCardName} pokonuje {targetNames}.",
  "trigger.defeatFailed": "{sourceCardName} nie pokonał {targetNames} (cel niedostępny lub ochroniony).",
  "effect.callLegend.free": "{sourceCardName} przywołuje {legendName} za darmo.",
  "effect.callLegend.skippedAlreadyCalled": "{sourceCardName}: Legenda była już przywołana w tej turze.",
  "trigger.copyGigValue": "{sourceCardName} kopiuje wartość {sourceValue} z {sourceDieType} na {targetDieType} ({previousValue} → {newValue}).",
  "trigger.delayedDefeat": "{sourceCardName} pokonuje {targetNames} na koniec tury.",
  "trigger.revealTopCardType.hit": "{sourceCardName}: wybrano {chosenType}, odkryto {revealedCardName} ({revealedType}) — pasuje, trafia na rękę.",
  "trigger.revealTopCardType.miss": "{sourceCardName}: wybrano {chosenType}, odkryto {revealedCardName} ({revealedType}) — nie pasuje, do kosza.",
  "setup.blankEddie": "Dodano {count} pustych Eddies z wierzchu talii.",
  "setup.firstPlayerChoice": "Wybiera, że gra jako {order}.",
};

export const LOG_MESSAGES = { ...enMessages, ...PL } as Record<MessageKey, string>;
export const LOG_MESSAGES_EN = enMessages as Record<MessageKey, string>;

export interface NameIndex {
  card(id: string | undefined): CardView | undefined;
  name(id: string | undefined): string;
}

export function buildNameIndex(view: MatchView): NameIndex {
  const byId = new Map<string, CardView>();
  for (const p of Object.values(view.players)) {
    for (const cards of Object.values(p.zones)) {
      if (Array.isArray(cards)) for (const c of cards) byId.set(c.instanceId, c);
    }
  }
  return {
    card: (id) => (id ? byId.get(id) : undefined),
    name(id) {
      if (!id) return "?";
      const c = byId.get(id);
      if (!c) return "?";
      if (id.startsWith("gd_")) return `${c.definitionId} (${c.power})`;
      return c.cardName ?? (c.type === "legend" ? "zakryta Legenda" : "zakryta karta");
    },
  };
}

export interface ActionLabel {
  label: string;
  group: "setup" | "play" | "sell" | "legend" | "attack" | "react" | "ability" | "phase" | "choice" | "other";
  cardId?: string;
  targetId?: string;
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

export function labelAction(move: string, args: Record<string, unknown> | undefined, idx: NameIndex, view: MatchView): ActionLabel {
  const a = args ?? {};
  switch (move) {
    case "keepHand":
      return { label: "Zostaw rękę startową", group: "setup" };
    case "mulligan":
      return { label: "Mulligan — przetasuj rękę i dobierz 6 nowych kart", group: "setup" };
    case "resolveFirstPlayer":
      return { label: a.goFirst ? "Chcę zaczynać" : "Niech zaczyna rywal", group: "choice" };
    case "playCard": {
      const card = s(a.cardId);
      const cost = idx.card(card)?.effectiveCost;
      const costTxt = cost != null ? ` (${cost} €$)` : "";
      if (a.attachToId) return { label: `Zagraj ${idx.name(card)}${costTxt} → na ${idx.name(s(a.attachToId))}`, group: "play", cardId: card, targetId: s(a.attachToId) };
      return { label: `Zagraj ${idx.name(card)}${costTxt}`, group: "play", cardId: card };
    }
    case "sellCard":
      return { label: `Sprzedaj ${idx.name(s(a.cardId))} (+1 €$, raz na turę)`, group: "sell", cardId: s(a.cardId) };
    case "callLegend":
      return { label: `Przywołaj Legendę: ${idx.name(s(a.legendId))}`, group: "legend", cardId: s(a.legendId) };
    case "attackUnit":
      return { label: `Atakuj: ${idx.name(s(a.attackerId))} → ${idx.name(s(a.defenderId))}`, group: "attack", cardId: s(a.attackerId), targetId: s(a.defenderId) };
    case "attackRival":
      return { label: `Atakuj Gigi rywala: ${idx.name(s(a.attackerId))}`, group: "attack", cardId: s(a.attackerId) };
    case "useBlocker":
      return { label: `Zablokuj jednostką ${idx.name(s(a.blockerId))}`, group: "react", cardId: s(a.blockerId) };
    case "goSolo":
      return { label: `GO SOLO: ${idx.name(s(a.cardId))}`, group: "ability", cardId: s(a.cardId) };
    case "activateAbility": {
      const card = s(a.cardId);
      const n = typeof a.abilityIndex === "number" && a.abilityIndex > 0 ? ` #${a.abilityIndex + 1}` : "";
      return { label: `Użyj zdolności${n}: ${idx.name(card)}`, group: "ability", cardId: card };
    }
    case "gainGig":
      return a.dieId
        ? { label: `Weź Gig ${idx.name(s(a.dieId))}`, group: "choice", cardId: s(a.dieId) }
        : { label: "Weź Gig z Fixera", group: "phase" };
    case "passPhase": {
      const step = view.attackState?.step;
      if (step === "react") return { label: "Nie reaguj (pas)", group: "phase" };
      if (view.gamePhase === "main") return { label: "Zakończ turę", group: "phase" };
      return { label: "Dalej", group: "phase" };
    }
    case "resolveAttack":
      return { label: a.pass ? "Kontynuuj atak" : "Rozpatrz atak", group: "phase" };
    case "resolveTrigger":
      return a.pass ? { label: "Pomiń opcjonalny efekt", group: "choice" } : { label: "Rozpatrz efekt", group: "choice" };
    case "resolveEffectTarget": {
      if (a.pass) return { label: "Nie wybieraj (pomiń)", group: "choice" };
      const ids = Array.isArray(a.targetIds) ? (a.targetIds as string[]) : [];
      if (ids.length === 0) return { label: "Nie wybieraj nic", group: "choice" };
      return { label: `Wybierz: ${ids.map((i) => idx.name(i)).join(", ") || "—"}`, group: "choice", cardId: ids[0] };
    }
    case "resolveDiscardFromHand": {
      if (a.pass) return { label: "Nie odrzucaj", group: "choice" };
      const ids = Array.isArray(a.cardIds) ? (a.cardIds as string[]) : [];
      return { label: `Odrzuć: ${ids.map((i) => idx.name(i)).join(", ")}`, group: "choice", cardId: ids[0] };
    }
    case "resolveStealGigs": {
      const ids = Array.isArray(a.dieIds) ? (a.dieIds as string[]) : [];
      return { label: `Ukradnij: ${ids.map((i) => idx.name(i)).join(", ")}`, group: "choice", cardId: ids[0] };
    }
    case "resolvePreventGigSteal":
      return { label: "Nie zapobiegaj kradzieży", group: "choice" };
    case "resolveAdjustGig":
      return a.kind === "noAdjustment"
        ? { label: "Nie zmieniaj Giga", group: "choice" }
        : { label: `Zmień Gig ${idx.name(s(a.dieId))} → ${String(a.value)}`, group: "choice", cardId: s(a.dieId) };
    case "resolveChooseEffect":
      return { label: `Wybierz opcję ${String(a.optionId)}`, group: "choice" };
    case "resolveCardToPlay":
      return { label: `Zagraj ${idx.name(s(a.cardId))}`, group: "choice", cardId: s(a.cardId) };
    case "resolveCardToMove":
      return a.pass ? { label: "Nie przenoś", group: "choice" } : { label: `Wybierz ${idx.name(s(a.cardId))}`, group: "choice", cardId: s(a.cardId) };
    case "resolveRevealDestination":
      return { label: a.destination === "hand" ? "Weź na rękę" : "Odrzuć do kosza", group: "choice" };
    case "resolveCardTypeChoice":
      return { label: `Typ karty: ${String(a.cardType)}`, group: "choice" };
    case "resolveRedirectDefeat":
      return { label: a.pass ? "Nie ratuj" : "Uratuj (zapłać i usuń zamiennik z gry)", group: "choice" };
    case "resolveSacrificialGear":
      return { label: `Poświęć ${idx.name(s(a.cardId))}`, group: "choice", cardId: s(a.cardId) };
    default:
      return { label: move, group: "other" };
  }
}
