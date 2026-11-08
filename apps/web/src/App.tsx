import { useEffect, useState } from "react";
import { Lobby } from "./components/Lobby.tsx";
import { Game } from "./components/Game.tsx";

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
  const m = /^#\/game\/([\w-]+)/.exec(hash);
  if (m) return <Game key={m[1]} gameId={m[1]!} />;
  return <Lobby />;
}
