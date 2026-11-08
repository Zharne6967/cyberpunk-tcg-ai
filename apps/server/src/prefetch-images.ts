/** Download all card images into var/images so the game works fully offline:  pnpm images */
import { prefetchAll } from "./images.ts";

console.log("Pobieram obrazki kart (jednorazowo, ~150 plików)...");
const { total, ok } = await prefetchAll((done, all, okSoFar) => {
  if (done % 10 === 0 || done === all) process.stdout.write(`\r  ${done}/${all} (pobrane: ${okSoFar})`);
});
console.log(`\nGotowe: ${ok}/${total}.${ok < total ? " Brakujące karty będą rysowane z tekstu — spróbuj ponownie później." : ""}`);
