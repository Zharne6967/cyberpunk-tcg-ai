// Builds the always-on start page: copies index.html and writes config.js with the game server URL.
// Render passes the server's host name in SERVER_HOST (render.yaml); SERVER_URL overrides it.
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const url = process.env.SERVER_URL || (process.env.SERVER_HOST ? `https://${process.env.SERVER_HOST}` : "");
mkdirSync(out, { recursive: true });
copyFileSync(join(here, "index.html"), join(out, "index.html"));
writeFileSync(join(out, "config.js"), `window.CPAI_SERVER = ${JSON.stringify(url)};\n`);
console.log(`landing built, server: ${url || "(not set)"}`);
