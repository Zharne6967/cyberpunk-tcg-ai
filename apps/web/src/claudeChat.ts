/**
 * Claude in the Deck Lab's chat: the player's own API key, called straight from this browser (nothing goes
 * through our server). Claude talks with the player and builds decks through tools that run on the ladder
 * data in a Web Worker (packages/ai/src/deck-tools.ts); the last deck it builds or checks is shown on the page.
 * Loaded on demand, so the SDK is not in the main bundle.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { DeckData } from "@cpai/core/protocol";
import { deckTool, type MetaBuild } from "./browserAnalysis.ts";

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", input: 4, output: 20 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", input: 2, output: 10 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", input: 0.1, output: 0.5 },
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]["id"];

const SYSTEM = `You build decks for the Cyberpunk TCG with a player, in the Deck Lab of a practice app. Every choice must come from the ladder data the tools give you: ChoomBattler ranked games (Core BO1, last 30 days), grouped into archetypes by the colours of the three Legends.

Deck rules: 3 Legends with different names; a Main Deck of 40 cards (40-50 allowed); at most 3 copies of a card; each Legend gives 2 RAM of its colour, and a card's RAM must not exceed the RAM its colour gets. Winning lists play about 13-17 Units, about 60% cards with a sell tag (every Gear and Program has one, almost no Unit) and 8-11 cards costing 5 or more.

How to work:
- build_deck makes a legal deck from what winning lists of an archetype play, with the player's wishes (Legends, cards in or out, Units, curve). Start there.
- archetype_cards gives the numbers of an archetype's Legends and cards; search_cards finds cards by name, effect text, colour, type or cost; check_deck checks a list you changed by hand and gives the Deck Doctor's swaps.
- The last deck you build or check is shown to the player with its numbers. When the player wants a deck, end with build_deck or check_deck.
- Explain choices with the numbers: popularity (share of the lists that play a card), lift (how many points more or less those lists win) and games. A lift over few games says little.
- When the data does not support what the player asks for, say so and offer the closest deck.
- Under each deck the player can press "Check with Strong bots" to play it against the meta decks; suggest it for matchup questions.

Reply in English with the game's official terms (Legends, Units, Gear, Programs, RAM, Gigs, Street Cred, Eddies, sell tag). Keep replies short: a few sentences or a short list, plain text, no Markdown headings or tables. The deck list is on the page, so do not repeat it in full.`;

const str = { type: "string" } as const;

type RunTool = (name: string, input: unknown, pool: DeckData[]) => Promise<{ content: string; build?: MetaBuild }>;

function makeTools(pool: DeckData[], onTool: (name: string) => void, shown: (b: MetaBuild) => void, runTool: RunTool) {
  const run = (name: string) => async (input: unknown) => {
    onTool(name);
    const r = await runTool(name, input, pool);
    if (r.build) shown(r.build);
    return r.content;
  };
  return [
    betaTool({
      name: "list_archetypes",
      description: "All archetypes on the ladder: key, win rate, games, share of the field and the most played Legends with their lift.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: run("list_archetypes"),
    }),
    betaTool({
      name: "archetype_cards",
      description: "Legends and cards that the lists of one archetype play: popularity, average copies, lift and games, with each card's type, colour, cost, RAM and sell tag.",
      inputSchema: {
        type: "object",
        properties: { archetype: { type: "string", description: "Archetype key from list_archetypes, e.g. 4-red-2-green" } },
        required: ["archetype"],
        additionalProperties: false,
      },
      run: run("archetype_cards"),
    }),
    betaTool({
      name: "search_cards",
      description: "Find cards by words in their name or effect text (all words must match), colour, type, maximum cost or sell tag. Up to 30 results with their text.",
      inputSchema: {
        type: "object",
        properties: {
          text: str,
          color: { type: "string", enum: ["red", "blue", "green", "yellow"] },
          type: { type: "string", enum: ["legend", "unit", "gear", "program"] },
          max_cost: { type: "integer" },
          sellable: { type: "boolean" },
        },
        additionalProperties: false,
      },
      run: run("search_cards"),
    }),
    betaTool({
      name: "build_deck",
      description:
        "Build a legal 40-card deck from what the winning lists of an archetype play, with the player's wishes. Without an archetype it picks the best one that fits the other wishes. Shows the deck to the player.",
      inputSchema: {
        type: "object",
        properties: {
          archetype: { type: "string", description: "Archetype key, e.g. 4-red-2-green" },
          legends: { type: "array", items: str, description: "Legends to play: a name (Padre) or the full name of one version (V: Streetkid)" },
          include: {
            type: "array",
            items: {
              type: "object",
              properties: { card: str, copies: { type: "integer", minimum: 1, maximum: 3 } },
              required: ["card"],
              additionalProperties: false,
            },
          },
          exclude: { type: "array", items: str, description: "Cards that must not be in the deck" },
          units_min: { type: "integer" },
          units_max: { type: "integer" },
          curve: { type: "string", enum: ["low", "high"], description: "low: cheap cards, at most 6 costing 5+; high: room for expensive cards" },
          goal: { type: "string", enum: ["winRate", "popular", "rare"], description: "Which archetype to prefer: best win rate (default), most played, or a less played one" },
          avoid_colors: { type: "array", items: { type: "string", enum: ["red", "blue", "green", "yellow"] } },
        },
        additionalProperties: false,
      },
      run: run("build_deck"),
    }),
    betaTool({
      name: "check_deck",
      description:
        "Check a deck list: legality, shape, every card's ladder numbers and the Deck Doctor's swaps. Use full names for Legends with several versions. Shows the deck to the player when it is legal.",
      inputSchema: {
        type: "object",
        properties: {
          legends: { type: "array", items: str },
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: { card: str, copies: { type: "integer", minimum: 1, maximum: 3 } },
              required: ["card", "copies"],
              additionalProperties: false,
            },
          },
        },
        required: ["legends", "cards"],
        additionalProperties: false,
      },
      run: run("check_deck"),
    }),
  ];
}

export interface ClaudeTurn {
  history: Anthropic.Beta.BetaMessageParam[];
  text: string;
  build: MetaBuild | null;
  tools: string[];
  usd: number;
  refused: boolean;
}

/** One message to Claude: the whole tool loop, until Claude answers. */
export async function askClaude(opts: {
  apiKey: string;
  model: ClaudeModel;
  history: Anthropic.Beta.BetaMessageParam[];
  text: string;
  pool: DeckData[];
  signal: AbortSignal;
  onTool: (name: string) => void;
  /** Tests: another way to run the tools, and to reach the API. */
  runTool?: RunTool;
  fetch?: typeof fetch;
}): Promise<ClaudeTurn> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const price = CLAUDE_MODELS.find((m) => m.id === opts.model) ?? CLAUDE_MODELS[0];
  const tools: string[] = [];
  let build: MetaBuild | null = null;
  const runner = client.beta.messages.toolRunner(
    {
      model: opts.model,
      max_tokens: 16000,
      thread: false,
      max_iterations: 10,
      system: SYSTEM,
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      // A policy decline is retried on the model's default fallback (a no-op on models without one).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: makeTools(
        opts.pool,
        (name) => (tools.push(name), opts.onTool(name)),
        (b) => (build = b),
        opts.runTool ?? deckTool,
      ),
      messages: [...opts.history, { role: "user", content: opts.text }],
    },
    { signal: opts.signal },
  );
  let usd = 0;
  let last: Anthropic.Beta.BetaMessage | null = null;
  for await (const message of runner) {
    last = message;
    const u = message.usage;
    const input = (u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
    usd += (input * price.input + (u.output_tokens ?? 0) * price.output) / 1e6;
  }
  const history = [...runner.params.messages];
  if (last && history.at(-1)?.role !== "assistant") history.push({ role: "assistant", content: last.content });
  const text = (last?.content ?? [])
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { history, text, build, tools, usd, refused: last?.stop_reason === "refusal" };
}

/** A short message for an API error (typed SDK errors, most specific first). */
export function claudeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The API key was not accepted. Check it in the Claude Console.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key may not use this model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the API: try again in a moment.";
  if (e instanceof Anthropic.BadRequestError) return `The API refused the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach the API (network).";
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`;
  return String((e as Error)?.message ?? e);
}
