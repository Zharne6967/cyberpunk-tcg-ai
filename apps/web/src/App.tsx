import { useEffect, useState } from "react";
import { Lobby } from "./components/Lobby.tsx";
import { Game } from "./components/Game.tsx";
import { DeckBuilder } from "./components/DeckBuilder.tsx";
import { JoinRoom } from "./components/Rooms.tsx";
import { Analysis } from "./components/Analysis.tsx";
import { Lab } from "./components/Lab.tsx";

function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHashRoute();
  const game = /^#\/game\/([\w-]+)/.exec(hash);
  if (game) return <Game key={game[1]} gameId={game[1]!} />;
  const join = /^#\/join\/([\w-]+)\/([\w-]+)/.exec(hash);
  if (join) return <JoinRoom key={join[1]} gameId={join[1]!} invite={join[2]!} />;
  const builder = /^#\/builder(?:\/([\w-]+))?/.exec(hash);
  if (builder) return <DeckBuilder deckId={builder[1]} />;
  const analyze = /^#\/analyze(?:\/([\w-]+))?/.exec(hash);
  if (analyze) return <Analysis key={analyze[1] ?? ""} deckId={analyze[1]} />;
  if (hash.startsWith("#/lab")) return <Lab />;
  return <Lobby />;
}
