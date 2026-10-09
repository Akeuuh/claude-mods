/**
 * Per-branch notes, kept in ~/.claude/branch-notes/<repo>/<branch-slug>.md.
 *
 *   session.start    registers the note_add tool and /notes, loads the notes of the current branch
 *   prompt.compose   the notes ride as a system prompt section, so they survive a compaction
 *   tool.call        note_add writes a section; a git checkout/switch in Bash reloads the branch
 *   command.run      /notes: show, all, pane, add, edit, prune
 *   ui.render        the notes pane
 */
import { atom, read, update } from "claude-code";
import type { EngineInterface, On, ToolCallResult } from "claude-code";

import type { NotesView } from "../types";
import {
  LONG_LIVED, SECTIONS, branchOf, branchSlugsOf, filledSections, firstEntry, forPrompt, repoOf, sectionOf, slugOf, template, withEntry,
  type Section,
} from "./notes.ts";

const PANE = "branch-notes";
const NOTE_ADD = "mcp__branch-notes__note_add";
const BRANCH_CHANGE = /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|switch|worktree)\b/;
const USAGE = [
  "/notes                          show the notes of this branch",
  "/notes all                      list the notes of every branch of this repo",
  "/notes pane                     open the live notes pane",
  "/notes add <section> <text>     append a note (objectif, decisions, contraintes, etat)",
  "/notes edit                     open the notes file in the default editor",
  "/notes prune [--yes]            list, or with --yes delete, the notes of branches that no longer exist",
].join("\n");

const view = atom({ plugin: "branch-notes", key: "view" } as const, null);

type Repo = { repo: string; dir: string; branch: string | undefined };
type Where = Repo & { branch: string; file: string };

const failure = (message: string): ToolCallResult => ({ deny: message });

async function git($: EngineInterface, ...argv: string[]) {
  const cwd = await $.session.cwd();
  const ran = await $.process.run(["git", ...argv], { cwd }).catch(() => undefined);
  return ran?.exitCode === 0 ? ran.stdout.trim() : undefined;
}

async function inRepo($: EngineInterface): Promise<Repo | undefined> {
  const common = await git($, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const home = await $.env.get("HOME");
  if (!common || !home) return undefined;
  const repo = repoOf(common);
  return { repo, dir: `${home}/.claude/branch-notes/${repo}`, branch: (await git($, "branch", "--show-current")) || undefined };
}

async function locate($: EngineInterface): Promise<Where | undefined> {
  const found = await inRepo($);
  if (!found?.branch || LONG_LIVED.has(found.branch)) return undefined;
  return { ...found, branch: found.branch, file: `${found.dir}/${slugOf(found.branch)}.md` };
}

async function load($: EngineInterface, where: Where): Promise<string> {
  if (await $.fs.exists(where.file)) return $.fs.read(where.file);
  const created = template(where.repo, where.branch, new Date().toISOString().slice(0, 10));
  await $.fs.write(where.file, created);
  return created;
}

async function refresh($: EngineInterface) {
  const where = await locate($);
  if (!where) {
    await update($, view, () => null);
    return undefined;
  }
  const text = await load($, where);
  await update($, view, () => ({ branch: where.branch, file: where.file, text }));
  return { where, text };
}

const LOCK_TRIES = 50;
const LOCK_WAIT_MS = 100;
const LOCK_STALE_MS = 10_000;
const BUSY = "The notes file is busy (another session is writing it). Try again.";

async function acquire($: EngineInterface, lock: string) {
  for (let i = 0; i < LOCK_TRIES; i++) {
    const made = await $.process.run(["mkdir", lock]).catch(() => undefined);
    if (made?.exitCode === 0) return true;
    const held = await $.fs.stat(lock).catch(() => undefined);
    if (held && (await $.clock.now()) - held.mtimeMs > LOCK_STALE_MS) await $.process.run(["rmdir", lock]).catch(() => undefined);
    else await $.clock.sleep(LOCK_WAIT_MS);
  }
  return false;
}

async function record($: EngineInterface, section: Section, entry: string, replace: boolean): Promise<{ where: Where } | { reason: string }> {
  const where = await locate($);
  if (!where) return { reason: NOT_TRACKED };
  const lock = `${where.file}.lock`;
  await $.process.run(["mkdir", "-p", where.dir]);
  if (!(await acquire($, lock))) return { reason: BUSY };
  try {
    await $.fs.write(where.file, withEntry(await load($, where), section, entry, replace));
  } finally {
    await $.process.run(["rmdir", lock]).catch(() => undefined);
  }
  await refresh($);
  return { where };
}

async function noteFiles($: EngineInterface, dir: string) {
  const entries = await $.fs.list(dir).catch(() => []);
  return entries
    .filter((f) => f.kind === "file" && f.name.endsWith(".md"))
    .map((f) => ({ ...f, slug: f.name.slice(0, -3), path: `${dir}/${f.name}` }));
}

async function orphans($: EngineInterface, found: Repo) {
  const refs = await git($, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes");
  if (refs === undefined) return [];
  const alive = branchSlugsOf(refs);
  return (await noteFiles($, found.dir)).filter((f) => !alive.has(f.slug));
}

const NOT_TRACKED = "No notes here: not a git branch, or a long-lived one (main, master, develop).";
const NOT_A_REPO = "Not in a git repository.";

async function showNotes($: EngineInterface) {
  const located = await refresh($);
  if (!located) return NOT_TRACKED;
  return `${located.where.file}\n\n${located.text}`;
}

async function listNotes($: EngineInterface) {
  const found = await inRepo($);
  if (!found) return NOT_A_REPO;
  const dead = new Set((await orphans($, found)).map((f) => f.slug));
  const files = (await noteFiles($, found.dir)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (files.length === 0) return `No notes yet for ${found.repo}.`;
  const blocks = await Promise.all(
    files.map(async (f) => {
      const text = await $.fs.read(f.path);
      const mark = f.slug === (found.branch && slugOf(found.branch)) ? "*" : " ";
      const gone = dead.has(f.slug) ? " (branch gone)" : "";
      const head = `${mark} ${branchOf(f.slug)}${gone}  ${new Date(f.mtimeMs).toISOString().slice(0, 10)}`;
      const details = [`objectif: ${firstEntry(text, "objectif")}`, `état: ${firstEntry(text, "etat")}`].filter((line) => !line.endsWith(": "));
      return [head, ...details.map((line) => `    ${line}`)].join("\n");
    }),
  );
  return `${found.repo}\n${blocks.join("\n")}`;
}

async function addNote($: EngineInterface, args: string) {
  const [name = "", ...words] = args.trim().split(/\s+/);
  const section = sectionOf(name);
  const entry = words.join(" ");
  if (!section || !entry) return `Usage: /notes add <${SECTIONS.map((s) => s.key).join("|")}> <text>`;
  const recorded = await record($, section, entry, false);
  return "reason" in recorded ? recorded.reason : `Added to ${section.heading} (${recorded.where.branch}).`;
}

async function editNotes($: EngineInterface) {
  const located = await refresh($);
  if (!located) return NOT_TRACKED;
  const isMac = (await $.process.run(["uname", "-s"]).catch(() => undefined))?.stdout.trim() === "Darwin";
  const opened = await $.process.run(isMac ? ["open", "-t", located.where.file] : ["xdg-open", located.where.file]).catch(() => undefined);
  return opened?.exitCode === 0 ? `Opened ${located.where.file}` : `Could not open an editor. The file is ${located.where.file}`;
}

async function pruneNotes($: EngineInterface, isConfirmed: boolean) {
  const found = await inRepo($);
  if (!found) return NOT_A_REPO;
  const dead = await orphans($, found);
  if (dead.length === 0) return "Nothing to prune: every notes file has a branch.";
  const names = dead.map((f) => branchOf(f.slug)).join("\n");
  if (!isConfirmed) return `${dead.length} notes file(s) without a branch:\n${names}\n\nRun /notes prune --yes to delete them.`;
  const kept: string[] = [];
  for (const f of dead) {
    const ran = await $.process.run(["rm", "--", f.path]).catch(() => undefined);
    if (ran?.exitCode !== 0) kept.push(branchOf(f.slug));
  }
  const deleted = dead.length - kept.length;
  return kept.length === 0 ? `Deleted ${deleted} notes file(s):\n${names}` : `Deleted ${deleted}, could not delete:\n${kept.join("\n")}`;
}

export function register(on: On) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "notes",
      description: "Branch notes: show, all, pane, add, edit, prune",
      argumentHint: "[all|pane|add|edit|prune]",
    });
    await $.tool.register({
      name: "note_add",
      description:
        "Record a durable fact in the notes of the current git branch: the goal, a decision, a constraint, or the current state. Keep the what (decisions, specs, constraints), never the how (logs, reasoning, narrative). Use replace for the state section so it always shows where the work stands.",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", enum: SECTIONS.map((s) => s.key), description: "objectif, decisions, contraintes or etat" },
          text: { type: "string", description: "One short entry" },
          replace: { type: "boolean", description: "Replace the whole section instead of appending" },
        },
        required: ["section", "text"],
      },
      isDeferred: false,
    });
    await refresh($);

    return next(e);
  });

  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    const current = await read($, view);
    if (!current) return composed;
    const notes = forPrompt(current.text);
    const text = [
      `BRANCH NOTES for ${current.branch} (${current.file})`,
      notes || "(empty)",
      "Record the branch's goal, decisions, constraints and state with the note_add tool as they settle, without waiting for the end of the session.",
    ].join("\n\n");

    return { sections: [...composed.sections, { id: "branch-notes:notes", text, scope: "session" }] };
  });

  on("tool.call", { tool: NOTE_ADD }, async ($, e) => {
    const { section: name, text, replace } = e as unknown as { section: string; text: string; replace?: boolean };
    const section = sectionOf(name);
    if (!section) return failure(`Unknown section "${name}". Use one of: ${SECTIONS.map((s) => s.key).join(", ")}.`);
    const recorded = await record($, section, text, replace === true);
    if ("reason" in recorded) return failure(recorded.reason);
    return { result: `Noted under "${section.heading}" for ${recorded.where.branch}.` };
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const ran = await next(e);
    if (BRANCH_CHANGE.test(e.command)) await refresh($);
    return ran;
  });

  on("command.run", { command: "notes" }, async ($, e) => {
    const args = e.args.trim();
    const [sub = "", ...rest] = args.split(/\s+/);
    if (sub === "") return { text: await showNotes($) };
    if (sub === "all") return { text: await listNotes($) };
    if (sub === "add") return { text: await addNote($, rest.join(" ")) };
    if (sub === "edit") return { text: await editNotes($) };
    if (sub === "prune") return { text: await pruneNotes($, rest.includes("--yes")) };
    if (sub === "pane") {
      await refresh($);
      const opened = await $.ui.open({ id: PANE, title: "Branch notes" });
      return { text: opened.isPlaced ? "Notes pane opened." : `Notes pane opened but waiting for room: ${opened.reason}` };
    }
    return { text: USAGE };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const current = await read($, view);
    if (!current) return <Text dimColor>{NOT_TRACKED}</Text>;
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4);
    const rows = filledSections(current.text).flatMap((s) => [
      { text: s.heading, isHeading: true },
      ...s.body.map((text) => ({ text, isHeading: false })),
    ]);

    return (
      <Box flexDirection="column">
        <Text dimColor>{current.branch}</Text>
        {rows.length === 0 && <Text dimColor>No notes yet.</Text>}
        {rows.slice(0, room).map((row, i) => (
          <Text key={`${i}`} bold={row.isHeading}>
            {row.text}
          </Text>
        ))}
      </Box>
    );
  });
}
