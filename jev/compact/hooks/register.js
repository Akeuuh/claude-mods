// jev/lib/core/helpers.ts
function noul(instructions, criteria) {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}
function choice(instructions, criteria) {
  return { type: "choice", instructions, criteria };
}
function score(instructions, criteria) {
  return { type: "score", instructions, criteria };
}

// jev/lib/levels/level07/should-compact.ts
var COMPACT_QUESTIONS = {
  switched_gears: noul("Is `current_request` a different task from `previous_work`?", {
    true: "A new feature, a different file area, a different goal, or an unrelated question",
    false: "The same task continuing, a follow up, a fix to what was just done"
  }),
  at_boundary: noul("Did `recent_turn` finish a unit of work?", {
    true: "Tests passed, a commit was made, a summary was given, or a question was asked of the user",
    false: "Mid task, more steps clearly remain"
  }),
  needs_history: score("How much of `previous_work` does the next step need?", [
    "None; the new work stands alone",
    "Some references, a file name or a decision",
    "Most of it; the work continues directly from it"
  ]),
  mid_operation: noul("Is the agent in the middle of a multi step edit whose partial state only exists in the conversation?", {
    true: "Half applied changes, a plan being executed step by step, an unfinished refactor",
    false: "A clean point, nothing half done"
  })
};
var clip = (s, n = 70) => s.length > n ? s.slice(0, n - 1) + "…" : s;
function decideTier(a, usage, compactable, lines, state) {
  if (!compactable)
    return { tier: "silent", reason: "nothing to compact yet" };
  if (a.mid_operation.noul > 0.6)
    return { tier: "silent", reason: "mid operation" };
  const switched = a.switched_gears.noul > 0.7;
  const boundary = a.at_boundary.noul > 0.6 && a.needs_history.score < 1;
  if (!switched && !boundary)
    return { tier: "silent", reason: "same work continuing" };
  if (usage.tokens < lines.notice)
    return { tier: "silent", reason: "below the notice line" };
  const reason = switched ? `The task changed${state ? ` from "${clip(state.previous_work)}" to "${clip(state.current_request)}"` : ""}.` : "The last turn finished a unit of work and the next step needs little of the earlier context.";
  if (usage.tokens < lines.recommend)
    return { tier: "notice", reason };
  if (usage.tokens < lines.request)
    return { tier: "recommend", reason };
  return { tier: "request", reason };
}
function tierMessage(d, usage) {
  const pct = `${Math.round(usage.tokens / 1000)}k tokens, ${usage.pct.toFixed(1)}% of the window`;
  switch (d.tier) {
    case "notice":
      return `Context is at ${pct}. ${d.reason} Compacting is optional. If you do, call compact_now with a short note to yourself.`;
    case "recommend":
      return `Recommended: compact now. Context is at ${pct}. ${d.reason} Call compact_now with a short note to yourself, then continue.`;
    case "request":
      return `Please compact before continuing. Context is at ${pct}. ${d.reason} Call compact_now with a short note to yourself.`;
    default:
      return null;
  }
}
// jev/lib/levels/level07/compact-on-demand.ts
function compactVerdict(d, a, usage, lines) {
  const should = d.tier === "recommend" || d.tier === "request";
  return {
    should_compact: should,
    tier: d.tier,
    reason: d.reason,
    context_tokens: usage.tokens,
    context_percent: Number(usage.pct.toFixed(1)),
    lines,
    signals: {
      switched_gears: a.switched_gears.noul,
      at_boundary: a.at_boundary.noul,
      needs_history: a.needs_history.score,
      mid_operation: a.mid_operation.noul
    },
    next_step: should ? "Call compact_now with a short note to yourself, then continue the current request." : d.tier === "notice" ? "Optional. Continue, or call compact_now if you are at a clean point." : "Continue. Nothing to do."
  };
}
// jev/lib/levels/level07/pick-cut-point.ts
function cutPointQuestion(turns) {
  const criteria = {};
  for (const t of turns)
    criteria[String(t.index)] = t.request;
  criteria.none = "Every turn is still live; keep the most recent context only";
  return {
    live_from: choice("Which turn in `turns` starts the work that is still live? Earlier turns can be summarized briefly.", criteria)
  };
}
function cutPointInstructions(turns, answer, floor = 0.6) {
  if (answer.choice === "none" || answer.confidence < floor) {
    return { liveFrom: null, confidence: answer.confidence, instructions: "Summarize the earlier work briefly and keep the most recent turns in detail." };
  }
  const idx = Number(answer.choice);
  const turn = turns.find((t) => t.index === idx);
  const from = turn ? `"${turn.request}"` : `turn ${idx}`;
  return {
    liveFrom: idx,
    confidence: answer.confidence,
    instructions: `The live work starts at ${from}. Summarize everything before it in a few lines. Keep the decisions, file paths, and open questions from ${from} onward in full detail.`
  };
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
async function decide($, source, state, questions) {
  validateRequest({ state, questions });
  const started = await $.clock.now();
  const result = await systemOne($, state, questions);
  const ms = await $.clock.now() - started;
  const answers = Object.entries(result.answers).map(([id, a]) => `${id} ${brief(a)}`).join(", ");
  $.ui.log(`jev · ${source} · ${answers} · ${ms} ms`);
  return { answers: result.answers, usage: result.usage, model: result.model, ms };
}
async function levelConfig($, fallback) {
  try {
    const raw = await $.env.get("JEV_LEVEL_CONFIG");
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

// jev/lib/host/tool.ts
var ok = (payload) => ({ result: JSON.stringify(payload, null, 2) });
var errorText = (err) => err instanceof Error ? err.message : String(err);

// jev/compact/src/register.ts
var CLAUDE_CODE_LINES = { notice: 80000, recommend: 120000, request: 160000 };
var clip2 = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
var isRequest = (m) => m.role === "user" && !m.toolResults?.length && m.text.trim() !== "";
var SILENT_ANSWERS = {
  switched_gears: { type: "noul", noul: 0 },
  at_boundary: { type: "noul", noul: 0 },
  needs_history: { type: "score", score: 2 },
  mid_operation: { type: "noul", noul: 0 }
};
async function usageOf($) {
  const { context } = await $.session.usage();
  return { tokens: context.tokens ?? 0, pct: context.percent ?? 0 };
}
function buildState(messages, recentText) {
  const requests = messages.filter(isRequest);
  const lastRequest = messages.lastIndexOf(requests.at(-1));
  const tools = messages.slice(lastRequest + 1).flatMap((m) => m.toolUses.map((t) => t.tool));
  return {
    current_request: clip2(requests.at(-1)?.text ?? "", 600),
    previous_work: requests.slice(0, -1).map((m) => clip2(m.text, 200)).join(`
`) || "(nothing before this request)",
    recent_turn: clip2(recentText || `(tool calls only: ${tools.join(", ") || "none"})`, 600),
    tools_this_turn: [...new Set(tools)]
  };
}
async function evaluate($, recentText, source) {
  const lines = (await levelConfig($, { lines: CLAUDE_CODE_LINES })).lines;
  const usage = await usageOf($);
  const messages = await $.session.messages();
  if (messages.filter(isRequest).length < 2) {
    return { decision: { tier: "silent", reason: "first request, nothing to move on from" }, message: null, usage, answers: null };
  }
  const state = buildState(messages, recentText);
  const { answers } = await decide($, source, { ...state }, COMPACT_QUESTIONS);
  const a = answers;
  const decision = decideTier(a, usage, true, lines, state);
  return { decision, message: tierMessage(decision, usage), usage, answers: a };
}
function register(on) {
  let current = null;
  let pendingNote = null;
  on("session.start", async ($, e, next) => {
    await $.tool.register({
      name: "should_i_compact",
      description: "Ask whether now is a good moment to compact the conversation. Returns should_compact, a tier " + "(silent, notice, recommend, request), the reason, and the current context percent. Cheap, call it freely.",
      isDeferred: false,
      inputSchema: { type: "object", properties: {} }
    });
    await $.tool.register({
      name: "compact_now",
      description: "Compact the conversation once this turn ends. Pass a short note_to_self: what you were doing, what is done, what is next. " + "The note is kept in the summary so you can pick up where you left off.",
      isDeferred: false,
      inputSchema: {
        type: "object",
        properties: { note_to_self: { type: "string", description: "Two to five lines: state of the work, next step." } },
        required: ["note_to_self"]
      }
    });
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    if (e.agentId !== undefined)
      return done;
    if (pendingNote !== null) {
      const instructions = `Keep this note from the agent verbatim at the top of the summary:
${pendingNote}`;
      pendingNote = null;
      $.clock.after(0, () => {
        $.session.compact({ instructions }).catch((err) => $.ui.log(`jev-compact: compact_now failed: ${errorText(err)}`));
      });
      return done;
    }
    try {
      current = await evaluate($, e.answer, "turn.complete");
      $.ui.status(current.decision.tier === "silent" ? undefined : `jev · compact ${current.decision.tier}`);
    } catch (err) {
      $.ui.log(`jev-compact: ${errorText(err)}`);
    }
    return done;
  });
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    if (!current?.message)
      return composed;
    return { sections: [...composed.sections, { id: "jev-compact:guidance", text: current.message, scope: "session" }] };
  });
  on("tool.call", { tool: "mcp__jev-compact__should_i_compact" }, async ($) => {
    const lines = (await levelConfig($, { lines: CLAUDE_CODE_LINES })).lines;
    const last = (await $.session.messages()).findLast((m) => m.role === "assistant")?.text ?? "";
    const r = await evaluate($, last, "should_i_compact");
    return ok(compactVerdict(r.decision, r.answers ?? SILENT_ANSWERS, r.usage, lines));
  });
  on("tool.call", { tool: "mcp__jev-compact__compact_now" }, async ($, e) => {
    pendingNote = e.note_to_self;
    return ok("Compaction is queued for the end of this turn. Your note will lead the summary. Finish the current step, then stop.");
  });
  on("session.compact", async ($, e, next) => {
    current = null;
    pendingNote = null;
    $.ui.status(undefined);
    const turns = e.messages.filter(isRequest).map((m, index) => ({ index, request: clip2(m.text, 120) }));
    if (turns.length < 2)
      return next(e);
    try {
      const { answers } = await decide($, "session.compact", { turns }, cutPointQuestion(turns));
      const cut = cutPointInstructions(turns, answers.live_from);
      return next({ ...e, instructions: `${e.instructions ?? ""}
${cut.instructions}`.trim() });
    } catch (err) {
      $.ui.log(`jev-compact: cut point failed: ${errorText(err)}`);
      return next(e);
    }
  });
}
export {
  register
};
