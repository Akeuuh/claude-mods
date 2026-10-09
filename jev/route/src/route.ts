/**
 * Jev scores how hard a request is on five task levels that name no model; the config maps each
 * level to a model and an effort. Moving up is free. Moving down costs the prompt cache of the whole
 * conversation, so past a context size it waits for a streak of lower requests.
 */
import { score } from "../../lib/core/helpers.ts";
import type { ScoreAnswer } from "../../lib/core/types.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Tier {
  model: string;
  effort: Effort;
}

export interface RouteConfig {
  /** One tier per level, level 1 first. */
  tiers: Tier[];
  /** Below this many context tokens, a model switch costs little cache and moving down is free. */
  freeDescentTokens: number;
  /** Above freeDescentTokens, how many lower requests in a row before moving down. */
  descentStreak: number;
  /** Below this confidence, the current level stays. */
  minConfidence: number;
  /** A prompt this short or shorter ("ok", "A", "go on") keeps the current level without asking Jev. */
  shortPrompt: number;
  timeoutMs: number;
  floor?: number;
  ceil?: number;
}

export const DEFAULT_CONFIG: RouteConfig = {
  tiers: [
    { model: "haiku", effort: "low" },
    { model: "sonnet", effort: "low" },
    { model: "sonnet", effort: "medium" },
    { model: "opus", effort: "high" },
    { model: "opus", effort: "max" },
  ],
  freeDescentTokens: 20_000,
  descentStreak: 2,
  minConfidence: 0.6,
  shortPrompt: 12,
  timeoutMs: 1500,
};

export const LEVELS = [
  "A factual question, a rewording, a trivial command to run",
  "A bounded edit in one or two files, a rename, running the tests",
  "A standard feature or bug across several files",
  "A hard debugging session, a cross-cutting refactor, an API design",
  "Architecture, long reasoning, strong ambiguity, or security or data at stake",
];

export const ROUTE_QUESTIONS = {
  level: score(
    "How demanding is the work `request` asks for? Read it in light of `previous_requests` and `last_answer` when it is short or refers back to them.",
    LEVELS,
  ),
};

export interface RouteState {
  request: string;
  previous_requests: string[];
  last_answer: string;
  context_tokens: number;
  current_level: number | null;
  command: string | null;
}

export interface Judgment {
  level: number;
  confidence: number;
}

export function judgmentOf(answer: ScoreAnswer): Judgment {
  return { level: Math.round(answer.score) + 1, confidence: answer.confidence };
}

export function validateConfig(config: RouteConfig): RouteConfig {
  const ok = config.tiers.length === LEVELS.length && config.tiers.every((t) => typeof t?.model === "string" && typeof t?.effort === "string");
  if (!ok) throw new Error(`route.tiers needs ${LEVELS.length} entries of { model, effort }`);
  return config;
}

export const isShort = (text: string, config: RouteConfig) => text.trim().length <= config.shortPrompt;

export const commandOf = (text: string) => /^\/([\w:-]+)/.exec(text.trim())?.[1] ?? null;

export interface Bounds {
  floor?: number;
  ceil?: number;
}

export const clamp = (level: number, { floor = 1, ceil = LEVELS.length }: Bounds) => Math.min(Math.max(level, floor), ceil);

export interface Memory {
  level: number | null;
  lowStreak: number;
}

export interface Step extends Memory {
  reason: string;
}

/** The main loop's next level. A null level leaves the session's own model. */
export function nextLevel(memory: Memory, judged: Judgment, contextTokens: number, config: RouteConfig): Step {
  const { level: current } = memory;
  if (judged.confidence < config.minConfidence) return { ...memory, reason: `unsure (${judged.confidence.toFixed(2)})` };
  if (current === null || judged.level >= current) return { level: judged.level, lowStreak: 0, reason: judged.level === current ? "same" : "up" };
  if (contextTokens < config.freeDescentTokens) return { level: judged.level, lowStreak: 0, reason: "down, small context" };
  const lowStreak = memory.lowStreak + 1;
  if (lowStreak >= config.descentStreak) return { level: judged.level, lowStreak: 0, reason: `down after ${lowStreak} lower requests` };
  return { level: current, lowStreak, reason: `holding, ${lowStreak}/${config.descentStreak} lower` };
}

/** turn.step sends the model as named and the API knows ids only, so the aliases a tier may use resolve here. */
const MODEL_IDS: Record<string, string> = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };

export const modelId = (model: string) => MODEL_IDS[model] ?? model;

export const tierName = (tier: Tier) => `${tier.model}/${tier.effort}`;

/** A level from `3` or from a tier name such as `sonnet/medium`. */
export function parseLevel(arg: string, config: RouteConfig): number | null {
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= LEVELS.length) return n;
  const i = config.tiers.findIndex((t) => tierName(t) === arg);
  return i < 0 ? null : i + 1;
}
