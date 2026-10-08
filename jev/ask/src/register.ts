/**
 * Level 10 as a Claude Code mod: ask_jev on any situation.
 *
 * One tool. The agent passes its own state, paths for code to read, a command for code to run,
 * and its question block. Code assembles one state and makes one call. A command runs through
 * the Level 6 bash gate first. Every call lands in a spend ledger shown in the status line.
 */
import type { EngineInterface, On } from "claude-code";
import { BLOCK_NOTICE, gateBashCommand } from "../../lib/levels/level06/bash-gate.ts";
import {
  ASK_JEV_DESCRIPTION, AskStateError, assembleState, emptyLedger, parseQuestions, record, summarize, type CommandOutput,
} from "../../lib/levels/level10/index.ts";
import { hostFs } from "../../lib/host/fs.ts";
import { decide } from "../../lib/host/jev.ts";
import { errorText, fail, ok } from "../../lib/host/tool.ts";

const NUDGE =
  "You have ask_jev. When you need a classification, a risk score, or a yes or no with a confidence, " +
  "prefer it over reasoning it out yourself. Give it paths or a command instead of pasting content. " +
  "It answers in 300 ms and costs almost nothing.";

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 200_000;

async function runCommand($: EngineInterface, command: string, cwd: string): Promise<CommandOutput> {
  const r = await $.process.run(["sh", "-c", command], { cwd, env: { CI: "1" }, timeoutMs: COMMAND_TIMEOUT_MS })
    .catch((err) => ({ exitCode: null, stdout: "", stderr: errorText(err) }));
  return { command, exit_code: r.exitCode, stdout: r.stdout.slice(0, MAX_OUTPUT_CHARS), stderr: r.stderr.slice(0, MAX_OUTPUT_CHARS) };
}

export function register(on: On) {
  let ledger = emptyLedger();

  on("session.start", async ($, e, next) => {
    await $.tool.register({
      name: "ask_jev",
      description: ASK_JEV_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: "object",
        properties: {
          questions_json: { type: "string", description: "The question block, a JSON object keyed by question id" },
          state: { type: "string", description: "Your own state: plain text, or a JSON object as a string. Short. Not for pasting files or output." },
          paths: { type: "array", items: { type: "string" }, description: 'Files or globs for code to read into files["path"]. Up to 20 files.' },
          command: { type: "string", description: "A command for code to run in the repo; its result goes into output. Runs through the bash gate." },
        },
        required: ["questions_json"],
      },
    });
    return next(e);
  });

  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    if (composed.sections.some((s) => s.text.includes("ask_jev"))) return composed;
    return { sections: [...composed.sections, { id: "ask-jev:nudge", text: NUDGE, scope: "session" }] };
  });

  on("tool.call", { tool: "mcp__ask-jev__ask_jev" }, async ($, e) => {
    const p = e as unknown as { questions_json: string; state?: string; paths?: string[]; command?: string };
    try {
      const questions = parseQuestions(p.questions_json);
      const run = async (command: string, cwd: string) => {
        const gate = await gateBashCommand(command, cwd, (s, q) => decide($, "ask_jev command gate", s, q));
        if (gate.block) throw new AskStateError(`ask_jev: the command was refused by the bash gate: ${gate.reason}. ${BLOCK_NOTICE} ask_jev commands should only read.`);
        return runCommand($, command, cwd);
      };
      const { state, summary } = await assembleState({ state: p.state, paths: p.paths, command: p.command }, await $.session.cwd(), run, hostFs($));
      const result = await decide($, "ask_jev", state, questions);
      ledger = record(ledger, result.usage, Object.keys(result.answers).length);
      return ok({ answers: result.answers, state_summary: summary, usage: result.usage, model: result.model });
    } catch (err) {
      return fail(err instanceof AskStateError ? err.message : `ask_jev error: ${errorText(err)}`);
    }
  });

  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    if (ledger.calls) $.ui.status(`jev · ${summarize(ledger, (await $.session.usage()).cost?.usd ?? 0)}`);
    return done;
  });
}
