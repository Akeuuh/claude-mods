/**
 * Level 9 as a Claude Code mod: files at scale.
 *
 *   ask_jev_files(paths_or_globs, questions_json, recursive?)   one call per file, in parallel, answers per path
 *   pick_first_file(question, candidates)                        a second pass: which of these to open first
 */
import type { On } from "claude-code";
import { askFiles, pickFirstFile, QUESTION_SCHEMA, type Candidate } from "../../lib/levels/level09/index.ts";
import { hostFs } from "../../lib/host/fs.ts";
import { decide } from "../../lib/host/jev.ts";
import { errorText, fail, ok } from "../../lib/host/tool.ts";

const TOOLS = [
  {
    name: "ask_jev_files",
    description:
      "Ask the same typed questions of many files at once without reading any of them. Code expands globs and directories, " +
      "drops node_modules, .git, binaries, and files over the budget, caps the list at 255, then makes one Jev call per file in parallel. " +
      "Returns { results: [{ path, answers }], skipped: [{ path, reason }], calls }. " + QUESTION_SCHEMA +
      " Use Read when you need a file's code; use Grep for exact strings.",
    inputSchema: {
      type: "object",
      properties: {
        paths_or_globs: { type: "array", items: { type: "string" }, description: 'Files, directories, or globs, relative to the repo, for example ["src/**/*.ts"] or ["src/http"]' },
        questions_json: { type: "string", description: "The question block as a JSON string" },
        recursive: { type: "boolean", description: "For directories: include every file below them. Default false." },
      },
      required: ["paths_or_globs", "questions_json"],
    },
  },
  {
    name: "pick_first_file",
    description:
      "After ask_jev_files, choose which of a list of files to open first for a goal. One Choice keyed by path, so the pick is always a real file. " +
      "Returns { path | null, confidence, probabilities }. Pass a short note per path if you have one, for example the answers you already got.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The goal, for example: Which file should I open first to fix the proration bug?" },
        candidates: {
          type: "array",
          items: { type: "object", properties: { path: { type: "string" }, note: { type: "string" } }, required: ["path"] },
          description: "Paths, with an optional one line note each",
        },
      },
      required: ["question", "candidates"],
    },
  },
];

export function register(on: On) {
  on("session.start", async ($, e, next) => {
    for (const tool of TOOLS) await $.tool.register({ ...tool, isDeferred: false });
    return next(e);
  });

  on("tool.call", { tool: "mcp__ask-jev-files__ask_jev_files" }, async ($, e) => {
    const p = e as unknown as { paths_or_globs: string[]; questions_json: string; recursive?: boolean };
    try {
      return ok(await askFiles(p.paths_or_globs, p.questions_json, await $.session.cwd(), {
        recursive: p.recursive ?? false,
        decide: (s, q) => decide($, `ask_jev_files ${(s as { path?: string }).path ?? ""}`, s, q),
        fs: hostFs($),
      }));
    } catch (err) { return fail(`error: ${errorText(err)}`); }
  });

  on("tool.call", { tool: "mcp__ask-jev-files__pick_first_file" }, async ($, e) => {
    const p = e as unknown as { question: string; candidates: Candidate[] };
    try {
      return ok(await pickFirstFile(p.question, p.candidates, (s, q) => decide($, "pick_first_file", s, q)));
    } catch (err) { return fail(`error: ${errorText(err)}`); }
  });
}
