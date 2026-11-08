import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DATA_DIR = join(ROOT, "data");
/** Local, machine-specific state (saved games, image cache, user decks). Never shipped in the ZIP. */
export const VAR_DIR = process.env.CPAI_VAR_DIR ?? join(ROOT, "var");
export const IMAGES_DIR = join(VAR_DIR, "images");
export const GAMES_DIR = join(VAR_DIR, "games");
export const USER_DECKS_DIR = join(VAR_DIR, "decks");
export const WEB_DIST = join(ROOT, "apps/web/dist");

for (const d of [VAR_DIR, IMAGES_DIR, GAMES_DIR, USER_DECKS_DIR]) mkdirSync(d, { recursive: true });
