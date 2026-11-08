import { useEffect, useState } from "react";
import { Lobby } from "./components/Lobby.tsx";
import { Game } from "./components/Game.tsx";
import { DeckBuilder } from "./components/DeckBuilder.tsx";

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
  const builder = /^#\/builder(?:\/([\w-]+))?/.exec(hash);
  if (builder) return <DeckBuilder deckId={builder[1]} />;
  return <Lobby />;
}
