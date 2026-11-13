import { describe, expect, it } from "vitest";
import { runDeckTool } from "../../../packages/ai/src/deck-tools.ts";
import type { MetaBuild } from "./browserAnalysis.ts";
import { askClaude } from "./claudeChat.ts";

/** A stand-in for the Messages API: answers each request with the next canned message and records what was sent. */
function fakeApi(replies: object[]) {
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    sent.push({ url: String(url), headers, body: JSON.parse(String(init?.body ?? "{}")) });
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json", "request-id": `req_${sent.length}` } });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const message = (content: object[], stop_reason: string, usage = { input_tokens: 1000, output_tokens: 200 }) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  stop_details: null,
  usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
});

describe("Claude in the deck chat", () => {
  it("runs the tools on the ladder data, keeps the conversation and adds up the cost", async () => {
    const api = fakeApi([
      message([{ type: "tool_use", id: "toolu_1", name: "build_deck", input: { legends: ["Padre"], exclude: ["Satori"] } }], "tool_use"),
      message([{ type: "text", text: "Padre in 4 Red / 2 Green: the best win rate for him." }], "end_turn"),
    ]);
    const used: string[] = [];
    const turn = await askClaude({
      apiKey: "test-key",
      model: "claude-opus-5-5",
      history: [],
      text: "Best deck with Padre, without Satori",
      pool: [],
      signal: new AbortController().signal,
      onTool: (n) => used.push(n),
      runTool: async (name, input, pool) => runDeckTool(name, input, pool as never) as { content: string; build?: MetaBuild },
      fetch: api.fetch,
    });
    expect(used).toEqual(["build_deck"]);
    expect(turn.text).toMatch(/Padre/);
    expect(turn.refused).toBe(false);
    expect(turn.build?.archetype.key).toBe("4-red-2-green");
    expect(Object.keys(turn.build!.deck.main).some((s) => s.startsWith("satori"))).toBe(false);
    // Two requests at Opus 5.5 prices: 2 × (1000 × $4 + 200 × $20) / 1M.
    expect(turn.usd).toBeCloseTo(0.016, 5);
    // The history holds the question, the tool call, its result and the answer, for the next message.
    expect(turn.history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

    expect(api.sent).toHaveLength(2);
    const [first, second] = api.sent;
    expect(first!.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(first!.headers.authorization).toBe("Bearer test-key");
    expect(first!.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(first!.headers["anthropic-beta"]).toMatch(/server-side-fallback-2026-07-01/);
    expect(first!.body.model).toBe("claude-opus-5-5");
    expect(first!.body.fallbacks).toBe("default");
    expect((first!.body.tools as { name: string }[]).map((t) => t.name)).toEqual(["list_archetypes", "archetype_cards", "search_cards", "build_deck", "check_deck"]);
    const results = (second!.body.messages as { role: string; content: unknown }[]).at(-1)!;
    expect(results.role).toBe("user");
    expect(JSON.stringify(results.content)).toMatch(/tool_result.*4 Red \/ 2 Green/);
  });

  it("passes the earlier conversation back and reports a refusal", async () => {
    const api = fakeApi([message([], "refusal")]);
    const history = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Hello" }] },
    ];
    const turn = await askClaude({
      apiKey: "test-key",
      model: "claude-haiku-5-5",
      history,
      text: "Next",
      pool: [],
      signal: new AbortController().signal,
      onTool: () => {},
      runTool: async () => ({ content: "" }),
      fetch: api.fetch,
    });
    expect(turn.refused).toBe(true);
    expect((api.sent[0]!.body.messages as unknown[]).length).toBe(3);
  });
});
