import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { ShareInfo } from "@cpai/core/protocol";
import { VAR_DIR } from "./paths.ts";

/**
 * Playing with friends over the internet without opening ports: a Cloudflare quick tunnel
 * (`cloudflared tunnel --url http://127.0.0.1:PORT`) gives this server a random public
 * https://….trycloudflare.com address. Every request that arrives through the tunnel (or from
 * another device on the network) must carry the access key — it is part of every shared link and is
 * then kept in a cookie. Requests from this computer itself never need it.
 */

const KEY_FILE = join(VAR_DIR, "share-key.txt");
export const ACCESS_KEY: string = (() => {
  try {
    if (existsSync(KEY_FILE)) {
      const k = readFileSync(KEY_FILE, "utf8").trim();
      if (k.length >= 16) return k;
    }
  } catch {
    /* regenerate */
  }
  const k = randomBytes(18).toString("base64url");
  writeFileSync(KEY_FILE, k);
  return k;
})();

const COOKIE = "cpai_key";

/** Arrived through the tunnel / a proxy, or from another machine. */
export function isRemote(req: IncomingMessage): boolean {
  if (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]) return true;
  const ip = req.socket.remoteAddress ?? "";
  return !(ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1");
}

function cookieKey(req: IncomingMessage): string | null {
  const m = /(?:^|;\s*)cpai_key=([^;]+)/.exec(req.headers.cookie ?? "");
  return m ? decodeURIComponent(m[1]!) : null;
}

export function isAuthorized(req: IncomingMessage): boolean {
  return !isRemote(req) || cookieKey(req) === ACCESS_KEY;
}

/** `?key=` in the URL: valid → cookie to set (and the URL to redirect to without the key). */
export function keyLogin(req: IncomingMessage, url: URL): { cookie: string; location: string } | null {
  if (url.searchParams.get("key") !== ACCESS_KEY) return null;
  url.searchParams.delete("key");
  const secure = req.headers["x-forwarded-proto"] === "https" || !!req.headers["cf-connecting-ip"];
  return {
    cookie: `${COOKIE}=${encodeURIComponent(ACCESS_KEY)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`,
    location: `${url.pathname}${url.search}`,
  };
}

// ---------------------------------------------------------------- cloudflared tunnel
let tunnel: ChildProcess | null = null;
let publicUrl: string | null = null;
let lastError: string | undefined;

function findCloudflared(): string | null {
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    process.env.CLOUDFLARED,
    join(VAR_DIR, "tools", "cloudflared.exe"),
    join(local, "Microsoft", "WinGet", "Links", "cloudflared.exe"),
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  // On PATH? (spawn fails later if not)
  for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
    for (const name of ["cloudflared.exe", "cloudflared"]) if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}

export function shareStatus(): ShareInfo {
  return { active: !!publicUrl, url: publicUrl, key: ACCESS_KEY, available: !!findCloudflared(), error: lastError };
}

export function startShare(port: number): Promise<ShareInfo> {
  if (publicUrl) return Promise.resolve(shareStatus());
  const exe = findCloudflared();
  if (!exe) {
    lastError = "cloudflared is not installed";
    return Promise.resolve(shareStatus());
  }
  lastError = undefined;
  return new Promise((resolve) => {
    const child = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { windowsHide: true });
    tunnel = child;
    const timer = setTimeout(() => {
      lastError = "The tunnel did not start in 40 s";
      resolve(shareStatus());
    }, 40_000);
    const scan = (buf: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
      if (m && !publicUrl) {
        publicUrl = m[0];
        clearTimeout(timer);
        console.log(`\n  Shared on the internet: ${publicUrl}/?key=${ACCESS_KEY}\n`);
        resolve(shareStatus());
      }
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.on("exit", (code) => {
      if (tunnel === child) {
        tunnel = null;
        publicUrl = null;
        if (code) lastError = `cloudflared exited (${code})`;
      }
      clearTimeout(timer);
      resolve(shareStatus());
    });
  });
}

export function stopShare(): ShareInfo {
  tunnel?.kill();
  tunnel = null;
  publicUrl = null;
  return shareStatus();
}

process.on("exit", () => tunnel?.kill());
