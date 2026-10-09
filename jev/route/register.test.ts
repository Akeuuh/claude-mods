import { expect, mock, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

const SESSION_MODEL = "claude-opus-5-5";
const CONFIG = "/home/.config/claude-mods/jev.json";

type Reply = { level: number; confidence: number };

const level = (n: number, confidence = 0.9): Reply => ({ level: n, confidence });

/** Jev's score answer to the question the mod sent, its legend being that question's levels. */
function answerTo(body: string, { level: n, confidence }: Reply) {
  const levels: string[] = JSON.parse(body).questions.level.criteria;
  return {
    level: {
      type: "score",
      score: n - 1,
      confidence,
      legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
      probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === n - 1 ? 0.9 : 0.1 / (levels.length - 1)])),
    },
  };
}

interface Setup {
  replies?: Reply[];
  tokens?: number;
  config?: object;
  slowJev?: boolean;
  /** What a subagent's own definition names, when it names a model. */
  definedModel?: string;
}

function engine(on: On, { replies = [], tokens = 1000, config, slowJev = false, definedModel }: Setup = {}) {
  const env: Record<string, string | undefined> = { JEV_BACKEND: "openrouter", OPENROUTER_API_KEY: "test-key", HOME: "/home" };
  const world = { env, model: SESSION_MODEL, jevCalls: 0, sent: [] as { model: string; effort?: unknown; agentId?: string }[], logged: [] as string[] };
  const clock = mock.clock(on);
  on("env.get", ($, e) => ({ value: env[e.name] }));
  on("ui.log", ($, e) => {
    world.logged.push(e.text);
    return { value: undefined };
  });
  on("ui.status", () => ({ value: undefined }));
  on("fs.exists", { path: CONFIG }, () => ({ value: config !== undefined }));
  on("fs.read", { path: CONFIG }, () => ({ value: JSON.stringify(config) }));
  on("session.messages", () => ({ value: [] }));
  on("session.usage", () => ({ value: { context: { tokens, percent: 1 } } }) as never);
  on("session.model", () => ({ value: world.model }));
  on("http.fetch", async ($, e) => {
    world.jevCalls++;
    if (slowJev) await clock.sleep(5000);
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected Jev call");
    const answers = answerTo(e.init?.body as string, reply);
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 1 } }) } };
  });
  on("prompt.submit", ($, e) => ({ text: e.text }));
  on("agent.spawn", ($, e) => ({ model: e.model ?? definedModel ?? SESSION_MODEL, agentId: "sub-1" }));
  on("turn.step", async function* ($, e) {
    world.sent.push({ model: e.model, effort: e.effort, agentId: e.agentId });
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: "end_turn", usage: null };
  });
  return { world, clock };
}

const say = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: "composer" } } as never);

async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: "t", index: 0, model: SESSION_MODEL, effort: "high", messageCount: 1, agentId });
  for await (const _ of stream);
}

const HARD = "Debug why the payment webhook double-charges under retries";
const EASY = "Run the unit tests of the auth module";

test("a hard request goes out on the level's model and effort", async ($, on) => {
  const { world } = engine(on, { replies: [level(4)] });

  await say($, HARD);
  await step($);

  expect(world.sent).toEqual([{ model: "claude-opus-5-5", effort: "high", agentId: undefined }]);
});

test("in a small context, an easier request moves down at once", async ($, on) => {
  const { world } = engine(on, { replies: [level(4), level(1)], tokens: 5_000 });

  await say($, HARD);
  await say($, EASY);
  await step($);

  expect(world.sent[0]).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
});

test("in a large context, moving down waits for two easier requests in a row", async ($, on) => {
  const { world } = engine(on, { replies: [level(4), level(2), level(2)], tokens: 50_000 });

  await say($, HARD);
  await say($, EASY);
  await step($);
  await say($, EASY);
  await step($);

  expect(world.sent.map((s) => `${s.model}/${s.effort}`)).toEqual(["claude-opus-5-5/high", "claude-sonnet-5-5/low"]);
});

test("an unsure judgment keeps the level", async ($, on) => {
  const { world } = engine(on, { replies: [level(4), level(1, 0.3)] });

  await say($, HARD);
  await say($, EASY);
  await step($);

  expect(world.sent[0]).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
});

test("a short follow-up keeps the level without asking Jev", async ($, on) => {
  const { world } = engine(on, { replies: [level(4)] });

  await say($, HARD);
  await say($, "ok vas-y");
  await step($);

  expect(world.jevCalls).toBe(1);
  expect(world.sent[0]).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
});

test("a slow Jev keeps the level", async ($, on) => {
  const { world, clock } = engine(on, { replies: [level(1)], slowJev: true });

  const submitted = say($, HARD);
  await clock.advance(1500);
  await submitted;
  await step($);

  expect(world.sent[0]).toMatchObject({ model: SESSION_MODEL, effort: "high" });
});

test("a /model change turns routing off until /jev-route auto", async ($, on) => {
  const { world } = engine(on, { replies: [level(1), level(1)] });

  await say($, HARD);
  world.model = "claude-sonnet-5-5";
  await say($, EASY);
  await step($);
  await $.command.run({ command: "jev-route", args: "auto" } as never);
  await say($, EASY);
  await step($);

  expect(world.sent.map((s) => s.model)).toEqual([SESSION_MODEL, "claude-haiku-5-5"]);
});

test("pin holds a tier without Jev, floor raises what Jev picks", async ($, on) => {
  const { world } = engine(on, { replies: [level(1)] });

  await $.command.run({ command: "jev-route", args: "pin opus/max" } as never);
  await say($, EASY);
  await step($);
  await $.command.run({ command: "jev-route", args: "auto" } as never);
  await $.command.run({ command: "jev-route", args: "floor 3" } as never);
  await say($, EASY);
  await step($);

  expect(world.sent.map((s) => `${s.model}/${s.effort}`)).toEqual(["claude-opus-5-5/max", "claude-sonnet-5-5/medium"]);
});

test("while Jev is paused the session's model goes out", async ($, on) => {
  const { world } = engine(on, { replies: [level(4)] });

  await say($, HARD);
  world.env.JEV_PAUSED = "1";
  await step($);

  expect(world.sent[0]).toMatchObject({ model: SESSION_MODEL, effort: "high" });
});

test("tiers come from the config file", async ($, on) => {
  const tiers = [1, 2, 3, 4, 5].map((n) => ({ model: `m${n}`, effort: "low" }));
  const { world } = engine(on, { replies: [level(4)], config: { route: { tiers } } });

  await say($, HARD);
  await step($);

  expect(world.sent[0]).toMatchObject({ model: "m4" });
});

test("a config file with the wrong tiers falls back to the defaults", async ($, on) => {
  const { world } = engine(on, { replies: [level(4)], config: { route: { tiers: [{ model: "m1", effort: "low" }] } } });

  await say($, HARD);
  await step($);

  expect(world.sent[0]).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
});

test("a subagent that inherits is routed on its own task", async ($, on) => {
  const { world } = engine(on, { replies: [level(1)] });

  await $.agent.spawn({ prompt: "Find where the session token is refreshed", subagentType: "Explore", parentModel: SESSION_MODEL } as never);
  await step($, "sub-1");

  expect(world.sent[0]).toMatchObject({ model: "claude-haiku-5-5", effort: "low", agentId: "sub-1" });
});

test("a subagent spawned with a model keeps it", async ($, on) => {
  const { world } = engine(on);

  await $.agent.spawn({ prompt: "Review the diff", subagentType: "reviewer", model: "sonnet", parentModel: SESSION_MODEL } as never);
  await step($, "sub-1");

  expect(world.jevCalls).toBe(0);
  expect(world.sent[0]).toMatchObject({ model: SESSION_MODEL, effort: "high" });
});

test("a subagent whose definition names a model keeps it", async ($, on) => {
  const { world } = engine(on, { replies: [level(5)], definedModel: "claude-haiku-5-5" });

  await $.agent.spawn({ prompt: "List the TODOs", subagentType: "scanner", parentModel: SESSION_MODEL } as never);
  await step($, "sub-1");

  expect(world.sent[0]).toMatchObject({ model: SESSION_MODEL, effort: "high" });
});

test("a floor that holds the level is not shown as a move", async ($, on) => {
  const { world } = engine(on, { replies: [level(1), level(1, 0.3)] });

  await $.command.run({ command: "jev-route", args: "floor 3" } as never);
  await say($, EASY);
  await say($, EASY);

  expect(world.logged.filter((t) => t.includes('"kind":"verdict"')).map((t) => JSON.parse(t.slice(10)).text)).toEqual([
    "route session→3 sonnet/medium · up",
    "route 3 · unsure (0.30)",
  ]);
});

test("floor off lifts a floor set in the config file", async ($, on) => {
  const { world } = engine(on, { replies: [level(1)], config: { route: { floor: 3 } } });

  await $.command.run({ command: "jev-route", args: "floor off" } as never);
  await say($, EASY);
  await step($);

  expect(world.sent[0]).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
});
