/**
 * Build the browser extension into extension/dist (load it in Chrome/Edge: Extensions → Developer mode →
 * Load unpacked → this folder).   node extension/build.mjs
 * Uses the web app's Vite (no extra dependencies); the rules engine and the coach are bundled in.
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const require = createRequire(join(here, "../apps/web/package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const entries = [
  { name: "page", format: "iife" },
  { name: "content", format: "iife" },
  { name: "popup", format: "iife" },
  { name: "background", format: "es" },
];
for (const e of entries) {
  await build({
    configFile: false,
    logLevel: "warn",
    root: here,
    build: {
      outDir: dist,
      emptyOutDir: false,
      minify: true,
      target: "chrome111",
      chunkSizeWarningLimit: 3000,
      lib: { entry: join(here, "src", `${e.name}.ts`), formats: [e.format], name: `cpai_${e.name}`, fileName: () => `${e.name}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
copyFileSync(join(here, "manifest.json"), join(dist, "manifest.json"));
copyFileSync(join(here, "popup.html"), join(dist, "popup.html"));
console.log(`extension built: ${dist}`);
