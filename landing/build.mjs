// Builds the always-on start page: copies index.html and writes config.js with the game server URL.
// Render passes the server's host name in SERVER_HOST (render.yaml); SERVER_URL overrides it.
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
// Render's `fromService … property: host` is the internal service name (no dots): add the public domain.
const host = process.env.SERVER_HOST ?? "";
const publicHost = host && !host.includes(".") ? `${host}.onrender.com` : host;
const url = process.env.SERVER_URL || (publicHost ? `https://${publicHost}` : "");
mkdirSync(out, { recursive: true });
copyFileSync(join(here, "index.html"), join(out, "index.html"));
writeFileSync(join(out, "config.js"), `window.CPAI_SERVER = ${JSON.stringify(url)};\n`);
console.log(`landing built, server: ${url || "(not set)"}`);
