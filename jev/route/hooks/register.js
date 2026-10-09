// jev/lib/host/config.ts
var CONFIG_FILE = ".config/claude-mods/jev.json";
var section = (raw, key) => {
  const value = JSON.parse(raw)[key] ?? {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error(`"${key}" must be an object`);
  return value;
};
async function familyConfig($, key, fallback) {
  const home = await $.env.get("HOME");
  const file = home ? `${home}/${CONFIG_FILE}` : undefined;
  const fromFile = file && await $.fs.exists(file) ? section(await $.fs.read(file), key) : {};
  const env = await $.env.get("JEV_LEVEL_CONFIG");
  const fromEnv = env ? section(env, key) : {};
  return { ...fallback, ...fromFile, ...fromEnv };
}

// jev/lib/core/types.ts
var LIMITS = {
  MAX_CHOICE_OPTIONS: 255,
  MIN_SCORE_LEVELS: 2,
  MAX_SCORE_LEVELS: 10,
  TOTAL_TOKEN_BUDGET: 64000
};

class QuestionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuestionValidationError";
  }
}
var isRecord = (value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function validateRequest(request) {
  if (!isRecord(request))
    throw new QuestionValidationError("Expected a request object.");
  if (typeof request.state !== "string" && !isRecord(request.state) && !Array.isArray(request.state)) {
    throw new QuestionValidationError("State must be a string, object, or array.");
  }
  if (request.model !== undefined && (typeof request.model !== "string" || !request.model.trim())) {
    throw new QuestionValidationError("Model must be a nonblank string.");
  }
  validateQuestions(request.questions);
}
function validateQuestions(questions) {
  if (!isRecord(questions) || Object.keys(questions).length === 0) {
    throw new QuestionValidationError("Questions must be a nonempty object.");
  }
  for (const [id, q] of Object.entries(questions)) {
    if (!isRecord(q))
      throw new QuestionValidationError(`Question "${id}" must be an object.`);
    if (q.type !== "noul" && q.type !== "choice" && q.type !== "score") {
      throw new QuestionValidationError(`Question "${id}" has a missing or unknown type.`);
    }
    if (typeof q.instructions === "string" ? !q.instructions.trim() : !isRecord(q.instructions)) {
      throw new QuestionValidationError(`Question "${id}" needs nonblank string or object instructions.`);
    }
    if (q.type === "noul" && q.criteria !== undefined) {
      if (!isRecord(q.criteria) || Object.entries(q.criteria).some(([key, value]) => !["true", "false"].includes(key) || value !== undefined && typeof value !== "string")) {
        throw new QuestionValidationError(`Noul "${id}" criteria must map true/false to descriptions.`);
      }
    }
    if (q.type === "choice") {
      if (!isRecord(q.criteria)) {
        throw new QuestionValidationError(`Choice "${id}" criteria must be an object.`);
      }
      const options = Object.keys(q.criteria);
      if (options.length === 0) {
        throw new QuestionValidationError(`Choice "${id}" has no options.`);
      }
      if (options.length > LIMITS.MAX_CHOICE_OPTIONS) {
        throw new QuestionValidationError(`Choice "${id}" has ${options.length} options; the maximum is ${LIMITS.MAX_CHOICE_OPTIONS}.`);
      }
      if (Object.values(q.criteria).some((value) => value !== null && typeof value !== "string")) {
        throw new QuestionValidationError(`Choice "${id}" descriptions must be strings or null.`);
      }
    }
    if (q.type === "score") {
      if (!Array.isArray(q.criteria)) {
        throw new QuestionValidationError(`Score "${id}" criteria must be an array.`);
      }
      if (q.criteria.length < LIMITS.MIN_SCORE_LEVELS || q.criteria.length > LIMITS.MAX_SCORE_LEVELS) {
        throw new QuestionValidationError(`Score "${id}" must have between ${LIMITS.MIN_SCORE_LEVELS} and ${LIMITS.MAX_SCORE_LEVELS} levels; got ${q.criteria.length}.`);
      }
      if (q.criteria.some((level) => typeof level !== "string" || !level.trim())) {
        throw new QuestionValidationError(`Score "${id}" levels must be nonblank strings.`);
      }
    }
  }
}

// jev/lib/levels/level10/spend.ts
var JEV_INPUT_USD_PER_M = 0.042;

// jev/lib/host/tool.ts
var errorText = (err) => err instanceof Error ? err.message : String(err);

// jev/lib/core/wire.ts
var ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/alpha/decisions",
  typesafe: "https://api.typesafe.ai/v1/systemone"
};
var DEFAULT_MODELS = {
  openrouter: "~typesafe/jev-latest",
  typesafe: "jev-latest"
};
var KEY_ENV = {
  openrouter: "OPENROUTER_API_KEY",
  typesafe: "TYPESAFE_API_KEY"
};
var RETRY_STATUSES = new Set([429, 502, 503, 529]);
var MAX_ATTEMPTS = 3;

class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}
var isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var isNonnegative = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
var isUnit = (x) => isNonnegative(x) && x <= 1;
var isTokenCount = (x) => isNonnegative(x) && Number.isSafeInteger(x);
function validateResponse(response, questions) {
  if (!isObject(response) || !isObject(response.answers) || typeof response.model !== "string" || !response.model.trim()) {
    throw new ContractError("Invalid response envelope: expected model and answers.");
  }
  if (!isObject(response.usage) || !isTokenCount(response.usage.input_tokens) || !isTokenCount(response.usage.output_tokens)) {
    throw new ContractError("Invalid response usage: expected nonnegative integer input_tokens and output_tokens.");
  }
  for (const [id, q] of Object.entries(questions)) {
    const answer = response.answers[id];
    if (!Object.hasOwn(response.answers, id) || !isObject(answer) || answer.type !== q.type) {
      throw new ContractError(`Missing or mismatched answer: ${id}`);
    }
    if (q.type === "noul") {
      if (!isUnit(answer.noul))
        throw new ContractError(`Invalid noul: ${id}`);
      continue;
    }
    if (!isUnit(answer.confidence) || !isObject(answer.probabilities)) {
      throw new ContractError(`Invalid distribution: ${id}`);
    }
    const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    const probs = answer.probabilities;
    if (Object.keys(probs).length !== keys.length || !keys.every((k) => Object.hasOwn(probs, k) && isUnit(probs[k]))) {
      throw new ContractError(`Distribution keys must match the declared criteria: ${id}`);
    }
    const sum = keys.reduce((acc, k) => acc + probs[k], 0);
    if (Math.abs(sum - 1) > 0.025)
      throw new ContractError(`Distribution does not sum to one: ${id} (${sum})`);
    if (q.type === "choice" && (typeof answer.choice !== "string" || !keys.includes(answer.choice))) {
      throw new ContractError(`Undeclared choice returned: ${id}`);
    }
    if (q.type === "score") {
      if (!isNonnegative(answer.score) || answer.score > keys.length - 1) {
        throw new ContractError(`Score out of range: ${id}`);
      }
      const legend = answer.legend;
      if (!isObject(legend) || Object.keys(legend).length !== keys.length || !keys.every((k, i) => Object.hasOwn(legend, k) && legend[k] === q.criteria[i])) {
        throw new ContractError(`Score legend must match the declared criteria: ${id}`);
      }
    }
  }
}

// jev/lib/host/jev.ts
async function selectProvider($) {
  const backend = (await $.env.get("JEV_BACKEND"))?.trim();
  const typesafe = (await $.env.get("TYPESAFE_API_KEY"))?.trim();
  const openrouter = (await $.env.get("OPENROUTER_API_KEY"))?.trim();
  const keys = { typesafe, openrouter };
  if (backend === "typesafe" || backend === "openrouter") {
    const key = keys[backend];
    if (!key)
      throw new Error(`Provider "${backend}" needs ${KEY_ENV[backend]}.`);
    return { provider: backend, key };
  }
  if (backend)
    throw new Error(`Unknown JEV backend "${backend}"; use openrouter or typesafe.`);
  if (typesafe)
    return { provider: "typesafe", key: typesafe };
  if (openrouter)
    return { provider: "openrouter", key: openrouter };
  throw new Error("No Jev credentials: set TYPESAFE_API_KEY or OPENROUTER_API_KEY.");
}
async function systemOne($, state, questions) {
  const { provider, key } = await selectProvider($);
  const body = JSON.stringify({ model: DEFAULT_MODELS[provider], state, questions });
  for (let attempt = 1;; attempt++) {
    const res = await $.http.fetch(ENDPOINTS[provider], {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body
    });
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      await $.clock.sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok)
      throw new Error(`${provider} HTTP ${res.status}.${res.status === 401 ? ` Check the ${KEY_ENV[provider]} key.` : ""}`);
    const response = JSON.parse(res.text);
    validateResponse(response, questions);
    return response;
  }
}
var brief = (a) => a.type === "noul" ? a.noul.toFixed(2) : a.type === "choice" ? `${a.choice} ${a.confidence.toFixed(2)}` : `${a.score.toFixed(2)}`;
var EVENT_PREFIX = "jev-event ";
function emit($, event) {
  $.ui.log(EVENT_PREFIX + JSON.stringify(event), { to: "debug" });
}
function verdict($, source, text, tone) {
  emit($, { kind: "verdict", source, text, tone });
}

class JevPausedError extends Error {
  constructor() {
    super("Jev is paused; resume it from the jev HUD");
    this.name = "JevPausedError";
  }
}
function logFailure($, prefix, err) {
  if (!(err instanceof JevPausedError))
    $.ui.log(`${prefix}${errorText(err)}`);
}
async function decide($, source, state, questions) {
  validateRequest({ state, questions });
  if (await $.env.get("JEV_PAUSED") === "1")
    throw new JevPausedError;
  const started = await $.clock.now();
  emit($, { kind: "start", source });
  try {
    const result = await systemOne($, state, questions);
    const ms = await $.clock.now() - started;
    const usage = result.usage;
    const answers = Object.entries(result.answers).map(([id, a]) => `${id} ${brief(a)}`).join(", ");
    $.ui.log(`jev · ${source} · ${answers} · ${ms} ms`);
    emit($, { kind: "done", source, ms, usd: usage.cost ?? usage.input_tokens * JEV_INPUT_USD_PER_M / 1e6, brief: answers, isError: false });
    return { answers: result.answers, usage, model: result.model, ms };
  } catch (err) {
    const ms = await $.clock.now() - started;
    emit($, { kind: "done", source, ms, usd: 0, brief: err instanceof Error ? err.message : String(err), isError: true });
    throw err;
  }
}

// jev/lib/core/helpers.ts
function score(instructions, criteria) {
  return { type: "score", instructions, criteria };
}

// jev/route/src/route.ts
var DEFAULT_CONFIG = {
  tiers: [
    { model: "haiku", effort: "low" },
    { model: "sonnet", effort: "low" },
    { model: "sonnet", effort: "medium" },
    { model: "opus", effort: "high" },
    { model: "opus", effort: "max" }
  ],
  freeDescentTokens: 20000,
  descentStreak: 2,
  minConfidence: 0.6,
  shortPrompt: 12,
  timeoutMs: 1500
};
var LEVELS = [
  "A factual question, a rewording, a trivial command to run",
  "A bounded edit in one or two files, a rename, running the tests",
  "A standard feature or bug across several files",
  "A hard debugging session, a cross-cutting refactor, an API design",
  "Architecture, long reasoning, strong ambiguity, or security or data at stake"
];
var ROUTE_QUESTIONS = {
  level: score("How demanding is the work `request` asks for? Read it in light of `previous_requests` and `last_answer` when it is short or refers back to them.", LEVELS)
};
function judgmentOf(answer) {
  return { level: Math.round(answer.score) + 1, confidence: answer.confidence };
}
function validateConfig(config) {
  const ok = config.tiers.length === LEVELS.length && config.tiers.every((t) => typeof t?.model === "string" && typeof t?.effort === "string");
  if (!ok)
    throw new Error(`route.tiers needs ${LEVELS.length} entries of { model, effort }`);
  return config;
}
var isShort = (text, config) => text.trim().length <= config.shortPrompt;
var commandOf = (text) => /^\/([\w:-]+)/.exec(text.trim())?.[1] ?? null;
var clamp = (level, { floor = 1, ceil = LEVELS.length }) => Math.min(Math.max(level, floor), ceil);
function nextLevel(memory, judged, contextTokens, config) {
  const { level: current } = memory;
  if (judged.confidence < config.minConfidence)
    return { ...memory, reason: `unsure (${judged.confidence.toFixed(2)})` };
  if (current === null || judged.level >= current)
    return { level: judged.level, lowStreak: 0, reason: judged.level === current ? "same" : "up" };
  if (contextTokens < config.freeDescentTokens)
    return { level: judged.level, lowStreak: 0, reason: "down, small context" };
  const lowStreak = memory.lowStreak + 1;
  if (lowStreak >= config.descentStreak)
    return { level: judged.level, lowStreak: 0, reason: `down after ${lowStreak} lower requests` };
  return { level: current, lowStreak, reason: `holding, ${lowStreak}/${config.descentStreak} lower` };
}
var MODEL_IDS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
var modelId = (model) => MODEL_IDS[model] ?? model;
var tierName = (tier) => `${tier.model}/${tier.effort}`;
function parseLevel(arg, config) {
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= LEVELS.length)
    return n;
  const i = config.tiers.findIndex((t) => tierName(t) === arg);
  return i < 0 ? null : i + 1;
}

// jev/route/src/register.ts
var SOURCE = "route";
var USAGE = "/jev-route auto | pin <level> | floor <level|off> | ceil <level|off> | status, a level being 1-5 or a tier such as sonnet/medium";
var clip = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
var isRequest = (m) => m.role === "user" && !m.toolResults?.length && m.text.trim() !== "";
var bound = (set, configured) => set === undefined ? configured : set ?? undefined;
var boundsOf = (r) => ({ floor: bound(r.bounds.floor, r.config.floor), ceil: bound(r.bounds.ceil, r.config.ceil) });
function levelOf(r) {
  if (r.mode.kind === "manual")
    return null;
  if (r.mode.kind === "pin")
    return r.mode.level;
  return r.memory.level === null ? null : clamp(r.memory.level, boundsOf(r));
}
function tierOf(r) {
  const level = levelOf(r);
  return level === null ? null : r.config.tiers[level - 1];
}
function describe(r) {
  if (r.mode.kind === "manual")
    return `off, /model ${r.mode.model} · /jev-route auto to resume`;
  const level = levelOf(r);
  const { floor, ceil } = boundsOf(r);
  const limits = [floor && `floor ${floor}`, ceil && `ceil ${ceil}`].filter(Boolean).join(" ");
  return `${level === null ? "session model" : `${level} ${tierName(r.config.tiers[level - 1])}`} · ${r.mode.kind}${limits ? ` · ${limits}` : ""}`;
}
function runCommand(r, args) {
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
      if (level === null)
        return USAGE;
      r.mode = { kind: "pin", level };
      return `jev-route: ${describe(r)}`;
    case "floor":
    case "ceil":
      if (level === null && arg !== "off")
        return USAGE;
      r.bounds = { ...r.bounds, [verb]: level };
      return `jev-route: ${describe(r)}`;
    default:
      return USAGE;
  }
}
function show($, r) {
  $.ui.status(`jev · route ${describe(r)}`);
}
async function isPaused($) {
  return await $.env.get("JEV_PAUSED") === "1";
}
async function loadConfig($) {
  try {
    return validateConfig(await familyConfig($, "route", DEFAULT_CONFIG));
  } catch (err) {
    verdict($, SOURCE, `route config unusable, defaults · ${errorText(err)}`, "warn");
    return DEFAULT_CONFIG;
  }
}
async function routeState($, text, currentLevel) {
  const messages = await $.session.messages();
  const { context } = await $.session.usage();
  return {
    request: clip(text, 1500),
    previous_requests: messages.filter(isRequest).slice(-3).map((m) => clip(m.text, 200)),
    last_answer: clip(messages.findLast((m) => m.role === "assistant")?.text ?? "", 2000),
    context_tokens: context.tokens ?? 0,
    current_level: currentLevel,
    command: commandOf(text)
  };
}
async function judge($, source, state, timeoutMs) {
  const judging = decide($, source, { ...state }, ROUTE_QUESTIONS).then((d) => judgmentOf(d.answers.level));
  judging.catch(() => {});
  return Promise.race([judging, $.clock.sleep(timeoutMs).then(() => "timeout")]);
}
async function routePrompt($, r, text) {
  r.config = await loadConfig($);
  const model = await $.session.model();
  if (r.sessionModel !== undefined && model !== r.sessionModel && r.mode.kind !== "manual") {
    r.mode = { kind: "manual", model };
    verdict($, SOURCE, `route off · /model ${model}`, "info");
  }
  r.sessionModel = model;
  if (r.mode.kind !== "auto" || isShort(text, r.config))
    return;
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
async function judgeSubagent($, r, prompt, agentType) {
  try {
    const judged = await judge($, `${SOURCE} ${agentType}`, { request: clip(prompt, 1500), agent_type: agentType }, r.config.timeoutMs);
    if (judged === "timeout" || judged.confidence < r.config.minConfidence)
      return null;
    return r.config.tiers[clamp(judged.level, boundsOf(r)) - 1];
  } catch (err) {
    logFailure($, "jev-route: ", err);
    return null;
  }
}
async function announce($, judging, agentType) {
  const tier = await judging;
  if (tier)
    verdict($, `${SOURCE} ${agentType}`, `route ${agentType} → ${tierName(tier)}`, "info");
  return tier;
}
function register(on) {
  const r = {
    config: DEFAULT_CONFIG,
    memory: { level: null, lowStreak: 0 },
    mode: { kind: "auto" },
    bounds: {},
    last: "no request routed yet",
    subagents: new Map
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
    if (e.model !== undefined || await isPaused($))
      return next(e);
    const judging = judgeSubagent($, r, e.prompt, e.subagentType);
    const started = await next(e);
    if (started.agentId && started.model === e.parentModel)
      r.subagents.set(started.agentId, announce($, judging, e.subagentType));
    return started;
  });
  on("turn.step", async function* ($, e, next) {
    const tier = e.agentId === undefined ? tierOf(r) : await r.subagents.get(e.agentId);
    if (!tier || await isPaused($))
      return yield* next(e);
    return yield* next({ ...e, model: modelId(tier.model), effort: tier.effort });
  });
  on("turn.complete", async ($, e, next) => {
    if (e.agentId !== undefined)
      r.subagents.delete(e.agentId);
    return next(e);
  });
}
export {
  register
};
