/**
 * Jev picks the model and the effort for each request.
 *
 *   prompt.submit   one Jev call per typed prompt, the level held across prompts (route.ts says when it moves)
 *   turn.step       every request of the turn goes out on that level's model and effort
 *   agent.spawn     a subagent with no model of its own is judged on its task, without holding
 *   /jev-route      auto, pin, floor, ceil, status
 *
 * A /model change, a pin, or Jev paused leaves the session's own model.
 */
import type { EngineInterface, On, SessionMessage } from "claude-code";
import type { ScoreAnswer } from "../../lib/core/types.ts";
import { familyConfig } from "../../lib/host/config.ts";
import { decide, logFailure, verdict } from "../../lib/host/jev.ts";
import { errorText } from "../../lib/host/tool.ts";
import {
  clamp, commandOf, DEFAULT_CONFIG, isShort, judgmentOf, modelId, nextLevel, parseLevel, ROUTE_QUESTIONS, tierName, validateConfig,
  type Bounds, type Judgment, type Memory, type RouteConfig, type RouteState, type Tier,
} from "./route.ts";

type Mode = { kind: "auto" } | { kind: "pin"; level: number } | { kind: "manual"; model: string };

interface Router {
  config: RouteConfig;
  memory: Memory;
  mode: Mode;
  /** Set by /jev-route floor and ceil, over the config's; null is "off". */
  bounds: { floor?: number | null; ceil?: number | null };
  /** The session's model at the last prompt, to tell a /model change. */
  sessionModel?: string;
  last: string;
  subagents: Map<string, Promise<Tier | null>>;
}

const SOURCE = "route";
const USAGE = "/jev-route auto | pin <level> | floor <level|off> | ceil <level|off> | status, a level being 1-5 or a tier such as sonnet/medium";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const isRequest = (m: SessionMessage) => m.role === "user" && !m.toolResults?.length && m.text.trim() !== "";

const bound = (set: number | null | undefined, configured?: number) => (set === undefined ? configured : (set ?? undefined));
const boundsOf = (r: Router): Bounds => ({ floor: bound(r.bounds.floor, r.config.floor), ceil: bound(r.bounds.ceil, r.config.ceil) });

function levelOf(r: Router): number | null {
  if (r.mode.kind === "manual") return null;
  if (r.mode.kind === "pin") return r.mode.level;
  return r.memory.level === null ? null : clamp(r.memory.level, boundsOf(r));
}

function tierOf(r: Router): Tier | null {
  const level = levelOf(r);
  return level === null ? null : r.config.tiers[level - 1];
}

function describe(r: Router): string {
  if (r.mode.kind === "manual") return `off, /model ${r.mode.model} · /jev-route auto to resume`;
  const level = levelOf(r);
  const { floor, ceil } = boundsOf(r);
  const limits = [floor && `floor ${floor}`, ceil && `ceil ${ceil}`].filter(Boolean).join(" ");
  return `${level === null ? "session model" : `${level} ${tierName(r.config.tiers[level - 1])}`} · ${r.mode.kind}${limits ? ` · ${limits}` : ""}`;
}

function runCommand(r: Router, args: string): string {
  const [verb = "status", arg = ""] = args.trim().split(/\s+/).filter(Boolean);
  const level = parseLevel(arg, r.config);
  switch (verb) {
    case "status":
      return `jev-route: ${describe(r)}. Last: ${r.last}.`;
    case "auto":
      r.mode = { kind: "auto" };
      r.bounds = {};
      r.sessionModel = undefined;
      return `jev-route: ${describe(r)}`;
    case "pin":
      if (level === null) return USAGE;
      r.mode = { kind: "pin", level };
      return `jev-route: ${describe(r)}`;
    case "floor":
    case "ceil":
      if (level === null && arg !== "off") return USAGE;
      r.bounds = { ...r.bounds, [verb]: level };
      return `jev-route: ${describe(r)}`;
    default:
      return USAGE;
  }
}

function show($: EngineInterface, r: Router): void {
  $.ui.status(`jev · route ${describe(r)}`);
}

async function isPaused($: EngineInterface): Promise<boolean> {
  return (await $.env.get("JEV_PAUSED")) === "1";
}

async function loadConfig($: EngineInterface): Promise<RouteConfig> {
  try {
    return validateConfig(await familyConfig($, "route", DEFAULT_CONFIG));
  } catch (err) {
    verdict($, SOURCE, `route config unusable, defaults · ${errorText(err)}`, "warn");
    return DEFAULT_CONFIG;
  }
}

async function routeState($: EngineInterface, text: string, currentLevel: number | null): Promise<RouteState> {
  const messages = await $.session.messages();
  const { context } = await $.session.usage();
  return {
    request: clip(text, 1500),
    previous_requests: messages.filter(isRequest).slice(-3).map((m) => clip(m.text, 200)),
    last_answer: clip(messages.findLast((m) => m.role === "assistant")?.text ?? "", 2000),
    context_tokens: context.tokens ?? 0,
    current_level: currentLevel,
    command: commandOf(text),
  };
}

/** Jev's level, or "timeout": a slow call keeps the level rather than holding the prompt. */
async function judge($: EngineInterface, source: string, state: object, timeoutMs: number): Promise<Judgment | "timeout"> {
  const judging = decide($, source, { ...state }, ROUTE_QUESTIONS).then((d) => judgmentOf(d.answers.level as ScoreAnswer));
  judging.catch(() => {});
  return Promise.race([judging, $.clock.sleep(timeoutMs).then(() => "timeout" as const)]);
}

async function routePrompt($: EngineInterface, r: Router, text: string): Promise<void> {
  r.config = await loadConfig($);
  const model = await $.session.model();
  if (r.sessionModel !== undefined && model !== r.sessionModel && r.mode.kind !== "manual") {
    r.mode = { kind: "manual", model };
    verdict($, SOURCE, `route off · /model ${model}`, "info");
  }
  r.sessionModel = model;
  if (r.mode.kind !== "auto" || isShort(text, r.config)) return;

  const from = levelOf(r);
  try {
    const state = await routeState($, text, from);
    const judged = await judge($, SOURCE, state, r.config.timeoutMs);
    if (judged === "timeout") {
      r.last = `Jev took over ${r.config.timeoutMs} ms, level kept`;
      verdict($, SOURCE, "route kept · timeout", "warn");
      return;
    }
    const step = nextLevel(r.memory, judged, state.context_tokens, r.config);
    r.memory = { level: step.level, lowStreak: step.lowStreak };
    const to = levelOf(r);
    r.last = `judged ${judged.level} (${judged.confidence.toFixed(2)}), ${step.reason}`;
    const moved = from === to || to === null ? `${to ?? "session"}` : `${from ?? "session"}→${to} ${tierName(r.config.tiers[to - 1])}`;
    verdict($, SOURCE, `route ${moved} · ${step.reason}`, "info");
  } catch (err) {
    r.last = `Jev failed, level kept: ${errorText(err)}`;
    logFailure($, "jev-route: ", err);
  }
}

async function judgeSubagent($: EngineInterface, r: Router, prompt: string, agentType: string): Promise<Tier | null> {
  try {
    const judged = await judge($, `${SOURCE} ${agentType}`, { request: clip(prompt, 1500), agent_type: agentType }, r.config.timeoutMs);
    if (judged === "timeout" || judged.confidence < r.config.minConfidence) return null;
    return r.config.tiers[clamp(judged.level, boundsOf(r)) - 1];
  } catch (err) {
    logFailure($, "jev-route: ", err);
    return null;
  }
}

async function announce($: EngineInterface, judging: Promise<Tier | null>, agentType: string): Promise<Tier | null> {
  const tier = await judging;
  if (tier) verdict($, `${SOURCE} ${agentType}`, `route ${agentType} → ${tierName(tier)}`, "info");
  return tier;
}

export function register(on: On) {
  const r: Router = {
    config: DEFAULT_CONFIG,
    memory: { level: null, lowStreak: 0 },
    mode: { kind: "auto" },
    bounds: {},
    last: "no request routed yet",
    subagents: new Map(),
  };

  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "jev-route", description: "Jev picks the model per request: auto, pin, floor, ceil, status" });
    return next(e);
  });

  on("command.run", { command: "jev-route" }, async ($, e) => {
    r.config = await loadConfig($);
    const text = runCommand(r, e.args);
    show($, r);
    return { text };
  });

  on("prompt.submit", async ($, e, next) => {
    if (e.origin.kind === "composer" || e.origin.kind === "bridge" || e.origin.kind === "sdk") {
      await routePrompt($, r, e.text);
      show($, r);
    }
    return next(e);
  });

  on("agent.spawn", async ($, e, next) => {
    if (e.model !== undefined || (await isPaused($))) return next(e);
    const judging = judgeSubagent($, r, e.prompt, e.subagentType);
    const started = await next(e);
    if (started.agentId && started.model === e.parentModel) r.subagents.set(started.agentId, announce($, judging, e.subagentType));
    return started;
  });

  on("turn.step", async function* ($, e, next) {
    const tier = e.agentId === undefined ? tierOf(r) : await r.subagents.get(e.agentId);
    if (!tier || (await isPaused($))) return yield* next(e);
    return yield* next({ ...e, model: modelId(tier.model), effort: tier.effort });
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId !== undefined) r.subagents.delete(e.agentId);
    return next(e);
  });
}
