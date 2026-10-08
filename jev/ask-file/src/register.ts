/**
 * Level 8 as a Claude Code mod: cheap reads. Three tools, one file each, flat parameters.
 *
 *   ask_jev_file_bool(path, question, yes?, no?)
 *   ask_jev_file_choice(path, question, options)
 *   ask_jev_file_score(path, question, levels)
 *
 * Code reads the file and sends it to Jev as `content`. The agent gets a typed answer and never the file.
 */
import type { On } from "claude-code";
import { askFileBool, askFileChoice, askFileScore, FileStateError } from "../../lib/levels/level08/index.ts";
import { hostFs } from "../../lib/host/fs.ts";
import { decide } from "../../lib/host/jev.ts";
import { errorText, fail, ok } from "../../lib/host/tool.ts";

const WHEN =
  "Use this for a judgment about what a file does or contains, without reading it into your context. " +
  "Write the question against `content`, which is the file's text. Use the Read tool instead when you need the code itself, to edit or quote it. " +
  "Exact lookups, does this string appear, how many lines, belong to Grep, not here.";

const PATH = { type: "string", description: "File path, relative to the repo" };

const TOOLS = [
  {
    name: "ask_jev_file_bool",
    description: `Yes or no about one file. Returns { path, answer, noul } where noul is the probability of yes, 0 to 1. ${WHEN}`,
    inputSchema: {
      type: "object",
      properties: {
        path: PATH,
        question: { type: "string", description: "A yes or no question about `content`, for example: Does `content` validate authentication tokens?" },
        yes: { type: "string", description: "What counts as yes" },
        no: { type: "string", description: "What counts as no" },
      },
      required: ["path", "question"],
    },
  },
  {
    name: "ask_jev_file_choice",
    description: `Pick one option about one file. Returns { path, choice, confidence, probabilities }. The choice is always one of your options; an "other" option is added if you leave none. ${WHEN}`,
    inputSchema: {
      type: "object",
      properties: {
        path: PATH,
        question: { type: "string", description: "The question, for example: Which layer is `content`?" },
        options: { type: "object", additionalProperties: { type: "string" }, description: "Option name to a one line description of when it applies. Up to 255." },
      },
      required: ["path", "question", "options"],
    },
  },
  {
    name: "ask_jev_file_score",
    description: `A position on a scale you define, about one file. Returns { path, score, top, nearest, confidence, legend }. Levels are ordered low to high, two to ten of them, each a described situation. ${WHEN}`,
    inputSchema: {
      type: "object",
      properties: {
        path: PATH,
        question: { type: "string", description: "The question, for example: How risky is a refactor of `content`?" },
        levels: { type: "array", items: { type: "string" }, description: "Ordered low to high, each level a situation, for example: Isolated and well tested" },
      },
      required: ["path", "question", "levels"],
    },
  },
];

const failure = (err: unknown) => fail(err instanceof FileStateError ? err.message : `error: ${errorText(err)}`);

export function register(on: On) {
  on("session.start", async ($, e, next) => {
    for (const tool of TOOLS) await $.tool.register({ ...tool, isDeferred: false });
    return next(e);
  });

  on("tool.call", { tool: "mcp__ask-jev-file__ask_jev_file_bool" }, async ($, e) => {
    const p = e as unknown as { path: string; question: string; yes?: string; no?: string };
    try {
      return ok(await askFileBool(p.path, p.question, await $.session.cwd(), { yes: p.yes, no: p.no }, (s, q) => decide($, "ask_jev_file_bool", s, q), hostFs($)));
    } catch (err) { return failure(err); }
  });

  on("tool.call", { tool: "mcp__ask-jev-file__ask_jev_file_choice" }, async ($, e) => {
    const p = e as unknown as { path: string; question: string; options: Record<string, string> };
    try {
      return ok(await askFileChoice(p.path, p.question, p.options, await $.session.cwd(), (s, q) => decide($, "ask_jev_file_choice", s, q), hostFs($)));
    } catch (err) { return failure(err); }
  });

  on("tool.call", { tool: "mcp__ask-jev-file__ask_jev_file_score" }, async ($, e) => {
    const p = e as unknown as { path: string; question: string; levels: string[] };
    try {
      return ok(await askFileScore(p.path, p.question, p.levels, await $.session.cwd(), (s, q) => decide($, "ask_jev_file_score", s, q), hostFs($)));
    } catch (err) { return failure(err); }
  });
}
