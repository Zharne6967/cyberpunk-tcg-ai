import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCatalog } from "@cpai/core";
import { IMAGES_DIR } from "./paths.ts";

const failedUntil = new Map<string, number>();

function candidateUrls(slug: string): string[] {
  const card = getCatalog().bySlug(slug) as (ReturnType<ReturnType<typeof getCatalog>["bySlug"]> & { printings?: { imageUrl?: string }[] }) | undefined;
  if (!card) return [];
  const urls = [card.imageUrl, ...(card.printings ?? []).map((p) => p.imageUrl)].filter((u): u is string => !!u);
  // Official card image endpoint used by cyberpunktcg.com.
  urls.push(`https://api.netdeck.gg/api/cards/cyberpunk/${slug}/image`);
  return [...new Set(urls)];
}

/** Resolve a definition id or slug to a slug. */
export function slugFor(key: string): string | undefined {
  const c = getCatalog();
  return c.bySlug(key)?.slug ?? (c.engineCatalog.get(key) as { slug?: string } | undefined)?.slug;
}

export function cachedImagePath(slug: string): string {
  return join(IMAGES_DIR, `${slug}.webp`);
}

/**
 * Card art is downloaded on first use and cached under var/images, so the game works offline afterwards.
 * Returns null when no source is reachable — the UI then draws the card from its text.
 */
export async function getCardImage(key: string): Promise<Buffer | null> {
  const slug = slugFor(key);
  if (!slug) return null;
  const file = cachedImagePath(slug);
  if (existsSync(file)) return readFileSync(file);
  if ((failedUntil.get(slug) ?? 0) > Date.now()) return null;
  for (const url of candidateUrls(slug)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "cyberpunk-tcg-ai (local)" } });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) continue;
      writeFileSync(file, buf);
      return buf;
    } catch {
      /* try next */
    }
  }
  failedUntil.set(slug, Date.now() + 10 * 60_000);
  return null;
}

/** Download every card image (used by `pnpm images`). */
export async function prefetchAll(onProgress?: (done: number, total: number, ok: number) => void) {
  const cards = getCatalog().cards;
  let ok = 0;
  for (let i = 0; i < cards.length; i++) {
    if (await getCardImage(cards[i]!.slug)) ok++;
    onProgress?.(i + 1, cards.length, ok);
  }
  return { total: cards.length, ok };
}
