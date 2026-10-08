/**
 * Level 7 as a Claude Code mod: should I compact.
 *
 *   turn.complete    build the state from the session, one Jev call, decide the tier
 *   prompt.compose   the tier message rides as a system prompt section, only when not silent
 *   tools            should_i_compact returns the verdict on demand; compact_now(note_to_self) compacts once the turn ends
 *   session.compact  asks Jev which request starts the live work and folds it into the instructions
 *
 * Claude Code ends a turn per user prompt, where pi ends one per model response: the verdict lands less often.
 */
import type { EngineInterface, On, SessionMessage } from "claude-code";
import {
  COMPACT_QUESTIONS, compactVerdict, cutPointInstructions, cutPointQuestion, decideTier, tierMessage,
  type CompactAnswers, type CompactDecision, type CompactState, type Lines, type Usage,
} from "../../lib/levels/level07/index.ts";
import type { ChoiceAnswer } from "../../lib/core/types.ts";
import { decide, levelConfig } from "../../lib/host/jev.ts";
import { errorText, ok } from "../../lib/host/tool.ts";

/** Claude Code's own system prompt and tools weigh tens of thousands of tokens, so the lab's lines sit higher here. */
const CLAUDE_CODE_LINES: Lines = { notice: 80_000, recommend: 120_000, request: 160_000 };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const isRequest = (m: SessionMessage) => m.role === "user" && !m.toolResults?.length && m.text.trim() !== "";

interface Current {
  decision: CompactDecision;
  message: string | null;
  usage: Usage;
  answers: CompactAnswers | null;
}

const SILENT_ANSWERS = {
  switched_gears: { type: "noul", noul: 0 },
  at_boundary: { type: "noul", noul: 0 },
  needs_history: { type: "score", score: 2 },
  mid_operation: { type: "noul", noul: 0 },
} as unknown as CompactAnswers;

async function usageOf($: EngineInterface): Promise<Usage> {
  const { context } = await $.session.usage();
  return { tokens: context.tokens ?? 0, pct: context.percent ?? 0 };
}

function buildState(messages: readonly SessionMessage[], recentText: string): CompactState {
  const requests = messages.filter(isRequest);
  const lastRequest = messages.lastIndexOf(requests.at(-1)!);
  const tools = messages.slice(lastRequest + 1).flatMap((m) => m.toolUses.map((t) => t.tool));
  return {
    current_request: clip(requests.at(-1)?.text ?? "", 600),
    previous_work: requests.slice(0, -1).map((m) => clip(m.text, 200)).join("\n") || "(nothing before this request)",
    recent_turn: clip(recentText || `(tool calls only: ${tools.join(", ") || "none"})`, 600),
    tools_this_turn: [...new Set(tools)],
  };
}

async function evaluate($: EngineInterface, recentText: string, source: string): Promise<Current> {
  const lines = (await levelConfig<{ lines: Lines }>($, { lines: CLAUDE_CODE_LINES })).lines;
  const usage = await usageOf($);
  const messages = await $.session.messages();
  if (messages.filter(isRequest).length < 2) {
    return { decision: { tier: "silent", reason: "first request, nothing to move on from" }, message: null, usage, answers: null };
  }
  const state = buildState(messages, recentText);
  const { answers } = await decide($, source, { ...state }, COMPACT_QUESTIONS);
  const a = answers as unknown as CompactAnswers;
  const decision = decideTier(a, usage, true, lines, state);
  return { decision, message: tierMessage(decision, usage), usage, answers: a };
}

export function register(on: On) {
  let current: Current | null = null;
  let pendingNote: string | null = null;

  on("session.start", async ($, e, next) => {
    await $.tool.register({
      name: "should_i_compact",
      description:
        "Ask whether now is a good moment to compact the conversation. Returns should_compact, a tier " +
        "(silent, notice, recommend, request), the reason, and the current context percent. Cheap, call it freely.",
      isDeferred: false,
      inputSchema: { type: "object", properties: {} },
    });
    await $.tool.register({
      name: "compact_now",
      description:
        "Compact the conversation once this turn ends. Pass a short note_to_self: what you were doing, what is done, what is next. " +
        "The note is kept in the summary so you can pick up where you left off.",
      isDeferred: false,
      inputSchema: {
        type: "object",
        properties: { note_to_self: { type: "string", description: "Two to five lines: state of the work, next step." } },
        required: ["note_to_self"],
      },
    });
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    if (e.agentId !== undefined) return done;
    if (pendingNote !== null) {
      const instructions = `Keep this note from the agent verbatim at the top of the summary:\n${pendingNote}`;
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
    if (!current?.message) return composed;
    return { sections: [...composed.sections, { id: "jev-compact:guidance", text: current.message, scope: "session" }] };
  });

  on("tool.call", { tool: "mcp__jev-compact__should_i_compact" }, async ($) => {
    const lines = (await levelConfig<{ lines: Lines }>($, { lines: CLAUDE_CODE_LINES })).lines;
    const last = (await $.session.messages()).findLast((m) => m.role === "assistant")?.text ?? "";
    const r = await evaluate($, last, "should_i_compact");
    return ok(compactVerdict(r.decision, r.answers ?? SILENT_ANSWERS, r.usage, lines));
  });

  on("tool.call", { tool: "mcp__jev-compact__compact_now" }, async ($, e) => {
    pendingNote = (e as unknown as { note_to_self: string }).note_to_self;
    return ok("Compaction is queued for the end of this turn. Your note will lead the summary. Finish the current step, then stop.");
  });

  on("session.compact", async ($, e, next) => {
    current = null;
    pendingNote = null;
    $.ui.status(undefined);
    const turns = e.messages.filter(isRequest).map((m, index) => ({ index, request: clip(m.text, 120) }));
    if (turns.length < 2) return next(e);
    try {
      const { answers } = await decide($, "session.compact", { turns }, cutPointQuestion(turns));
      const cut = cutPointInstructions(turns, answers.live_from as ChoiceAnswer);
      return next({ ...e, instructions: `${e.instructions ?? ""}\n${cut.instructions}`.trim() });
    } catch (err) {
      $.ui.log(`jev-compact: cut point failed: ${errorText(err)}`);
      return next(e);
    }
  });
}
