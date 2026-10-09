// notes/branch-notes/src/register.tsx
import { atom, read, update } from "claude-code";

// notes/branch-notes/src/notes.ts
var SECTIONS = [
  { key: "objectif", heading: "Objectif", aliases: ["objectif", "objective", "goal"] },
  { key: "decisions", heading: "Décisions", aliases: ["decisions", "décisions", "decision", "décision"] },
  { key: "contraintes", heading: "Contraintes", aliases: ["contraintes", "constraints", "constraint"] },
  { key: "etat", heading: "État / prochaines étapes", aliases: ["etat", "état", "state", "status", "next"] }
];
var LONG_LIVED = new Set(["main", "master", "develop"]);
var slugOf = (branch) => encodeURIComponent(branch);
var branchOf = (slug) => decodeURIComponent(slug);
var sectionOf = (name) => {
  const wanted = name.trim().toLowerCase();
  return SECTIONS.find((s) => s.aliases.some((alias) => alias === wanted));
};
var repoOf = (commonDir) => {
  const parts = commonDir.trim().split("/");
  const last = parts.pop() ?? "";
  return last === ".git" ? parts.pop() ?? "" : last.replace(/\.git$/, "");
};
var template = (repo, branch, date) => [`# Notes — ${repo} @ ${branch}`, `Créé : ${date}`, ...SECTIONS.map((s) => `## ${s.heading}`)].join(`

`) + `
`;
var parse = (text) => {
  const doc = { preamble: [], blocks: [] };
  for (const line of text.split(`
`)) {
    if (line.startsWith("## "))
      doc.blocks.push({ heading: line.slice(3).trim(), body: [] });
    else
      (doc.blocks.at(-1)?.body ?? doc.preamble).push(line);
  }
  return doc;
};
var trimmed = (lines) => {
  const kept = [...lines];
  while (kept.at(-1)?.trim() === "")
    kept.pop();
  while (kept[0]?.trim() === "")
    kept.shift();
  return kept;
};
var print = (doc) => [trimmed(doc.preamble).join(`
`), ...doc.blocks.map((b) => ["## " + b.heading, ...trimmed(b.body)].join(`
`))].filter(Boolean).join(`

`) + `
`;
var bodyOf = (text, section) => trimmed(parse(text).blocks.find((b) => b.heading === section.heading)?.body ?? []);
var withEntry = (text, section, entry, replace) => {
  const doc = parse(text);
  let block = doc.blocks.find((b) => b.heading === section.heading);
  if (!block) {
    block = { heading: section.heading, body: [] };
    doc.blocks.push(block);
  }
  const line = `- ${entry.trim().replace(/\s*\n\s*/g, " ")}`;
  block.body = replace ? [line] : [...trimmed(block.body), line];
  return print(doc);
};
var filledSections = (text) => parse(text).blocks.map((b) => ({ heading: b.heading, body: trimmed(b.body) })).filter((b) => b.body.length > 0);
var KEPT_HEAD_LINES = 10;
var KEPT_TAIL_LINES = 15;
var clipLines = (lines) => {
  const omitted = lines.length - KEPT_HEAD_LINES - KEPT_TAIL_LINES;
  if (omitted <= 0)
    return lines;
  return [...lines.slice(0, KEPT_HEAD_LINES), `… ${omitted} more line(s) in the notes file`, ...lines.slice(-KEPT_TAIL_LINES)];
};
var forPrompt = (text) => filledSections(text).map((b) => `## ${b.heading}
${clipLines(b.body).join(`
`)}`).join(`

`);
var firstEntry = (text, key) => (bodyOf(text, SECTIONS.find((s) => s.key === key))[0] ?? "").replace(/^-\s*/, "");
var branchSlugsOf = (refs) => new Set(refs.split(`
`).map((ref) => ref.match(/^refs\/(?:heads|remotes\/[^/]+)\/(.+)$/)?.[1]).filter((name) => name !== undefined && name !== "HEAD").map(slugOf));

// notes/branch-notes/src/register.tsx
var PANE = "branch-notes";
var NOTE_ADD = "mcp__branch-notes__note_add";
var BRANCH_CHANGE = /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|switch|worktree)\b/;
var USAGE = [
  "/notes                          show the notes of this branch",
  "/notes all                      list the notes of every branch of this repo",
  "/notes pane                     open the live notes pane",
  "/notes add <section> <text>     append a note (objectif, decisions, contraintes, etat)",
  "/notes edit                     open the notes file in the default editor",
  "/notes prune [--yes]            list, or with --yes delete, the notes of branches that no longer exist"
].join(`
`);
var view = atom({ plugin: "branch-notes", key: "view" }, null);
var failure = (message) => ({ deny: message });
async function git($, ...argv) {
  const cwd = await $.session.cwd();
  const ran = await $.process.run(["git", ...argv], { cwd }).catch(() => {
    return;
  });
  return ran?.exitCode === 0 ? ran.stdout.trim() : undefined;
}
async function inRepo($) {
  const common = await git($, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const home = await $.env.get("HOME");
  if (!common || !home)
    return;
  const repo = repoOf(common);
  return { repo, dir: `${home}/.claude/branch-notes/${repo}`, branch: await git($, "branch", "--show-current") || undefined };
}
async function locate($) {
  const found = await inRepo($);
  if (!found?.branch || LONG_LIVED.has(found.branch))
    return;
  return { ...found, branch: found.branch, file: `${found.dir}/${slugOf(found.branch)}.md` };
}
async function load($, where) {
  if (await $.fs.exists(where.file))
    return $.fs.read(where.file);
  const created = template(where.repo, where.branch, new Date().toISOString().slice(0, 10));
  await $.fs.write(where.file, created);
  return created;
}
async function refresh($) {
  const where = await locate($);
  if (!where) {
    await update($, view, () => null);
    return;
  }
  const text = await load($, where);
  await update($, view, () => ({ branch: where.branch, file: where.file, text }));
  return { where, text };
}
var LOCK_TRIES = 50;
var LOCK_WAIT_MS = 100;
var LOCK_STALE_MS = 1e4;
var BUSY = "The notes file is busy (another session is writing it). Try again.";
async function acquire($, lock) {
  for (let i = 0;i < LOCK_TRIES; i++) {
    const made = await $.process.run(["mkdir", lock]).catch(() => {
      return;
    });
    if (made?.exitCode === 0)
      return true;
    const held = await $.fs.stat(lock).catch(() => {
      return;
    });
    if (held && await $.clock.now() - held.mtimeMs > LOCK_STALE_MS)
      await $.process.run(["rmdir", lock]).catch(() => {
        return;
      });
    else
      await $.clock.sleep(LOCK_WAIT_MS);
  }
  return false;
}
async function record($, section, entry, replace) {
  const where = await locate($);
  if (!where)
    return { reason: NOT_TRACKED };
  const lock = `${where.file}.lock`;
  await $.process.run(["mkdir", "-p", where.dir]);
  if (!await acquire($, lock))
    return { reason: BUSY };
  try {
    await $.fs.write(where.file, withEntry(await load($, where), section, entry, replace));
  } finally {
    await $.process.run(["rmdir", lock]).catch(() => {
      return;
    });
  }
  await refresh($);
  return { where };
}
async function noteFiles($, dir) {
  const entries = await $.fs.list(dir).catch(() => []);
  return entries.filter((f) => f.kind === "file" && f.name.endsWith(".md")).map((f) => ({ ...f, slug: f.name.slice(0, -3), path: `${dir}/${f.name}` }));
}
async function orphans($, found) {
  const refs = await git($, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes");
  if (refs === undefined)
    return [];
  const alive = branchSlugsOf(refs);
  return (await noteFiles($, found.dir)).filter((f) => !alive.has(f.slug));
}
var NOT_TRACKED = "No notes here: not a git branch, or a long-lived one (main, master, develop).";
var NOT_A_REPO = "Not in a git repository.";
async function showNotes($) {
  const located = await refresh($);
  if (!located)
    return NOT_TRACKED;
  return `${located.where.file}

${located.text}`;
}
async function listNotes($) {
  const found = await inRepo($);
  if (!found)
    return NOT_A_REPO;
  const dead = new Set((await orphans($, found)).map((f) => f.slug));
  const files = (await noteFiles($, found.dir)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (files.length === 0)
    return `No notes yet for ${found.repo}.`;
  const blocks = await Promise.all(files.map(async (f) => {
    const text = await $.fs.read(f.path);
    const mark = f.slug === (found.branch && slugOf(found.branch)) ? "*" : " ";
    const gone = dead.has(f.slug) ? " (branch gone)" : "";
    const head = `${mark} ${branchOf(f.slug)}${gone}  ${new Date(f.mtimeMs).toISOString().slice(0, 10)}`;
    const details = [`objectif: ${firstEntry(text, "objectif")}`, `état: ${firstEntry(text, "etat")}`].filter((line) => !line.endsWith(": "));
    return [head, ...details.map((line) => `    ${line}`)].join(`
`);
  }));
  return `${found.repo}
${blocks.join(`
`)}`;
}
async function addNote($, args) {
  const [name = "", ...words] = args.trim().split(/\s+/);
  const section = sectionOf(name);
  const entry = words.join(" ");
  if (!section || !entry)
    return `Usage: /notes add <${SECTIONS.map((s) => s.key).join("|")}> <text>`;
  const recorded = await record($, section, entry, false);
  return "reason" in recorded ? recorded.reason : `Added to ${section.heading} (${recorded.where.branch}).`;
}
async function editNotes($) {
  const located = await refresh($);
  if (!located)
    return NOT_TRACKED;
  const isMac = (await $.process.run(["uname", "-s"]).catch(() => {
    return;
  }))?.stdout.trim() === "Darwin";
  const opened = await $.process.run(isMac ? ["open", "-t", located.where.file] : ["xdg-open", located.where.file]).catch(() => {
    return;
  });
  return opened?.exitCode === 0 ? `Opened ${located.where.file}` : `Could not open an editor. The file is ${located.where.file}`;
}
async function pruneNotes($, isConfirmed) {
  const found = await inRepo($);
  if (!found)
    return NOT_A_REPO;
  const dead = await orphans($, found);
  if (dead.length === 0)
    return "Nothing to prune: every notes file has a branch.";
  const names = dead.map((f) => branchOf(f.slug)).join(`
`);
  if (!isConfirmed)
    return `${dead.length} notes file(s) without a branch:
${names}

Run /notes prune --yes to delete them.`;
  const kept = [];
  for (const f of dead) {
    const ran = await $.process.run(["rm", "--", f.path]).catch(() => {
      return;
    });
    if (ran?.exitCode !== 0)
      kept.push(branchOf(f.slug));
  }
  const deleted = dead.length - kept.length;
  return kept.length === 0 ? `Deleted ${deleted} notes file(s):
${names}` : `Deleted ${deleted}, could not delete:
${kept.join(`
`)}`;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "notes",
      description: "Branch notes: show, all, pane, add, edit, prune",
      argumentHint: "[all|pane|add|edit|prune]"
    });
    await $.tool.register({
      name: "note_add",
      description: "Record a durable fact in the notes of the current git branch: the goal, a decision, a constraint, or the current state. Keep the what (decisions, specs, constraints), never the how (logs, reasoning, narrative). Use replace for the state section so it always shows where the work stands.",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", enum: SECTIONS.map((s) => s.key), description: "objectif, decisions, contraintes or etat" },
          text: { type: "string", description: "One short entry" },
          replace: { type: "boolean", description: "Replace the whole section instead of appending" }
        },
        required: ["section", "text"]
      },
      isDeferred: false
    });
    await refresh($);
    return next(e);
  });
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    const current = await read($, view);
    if (!current)
      return composed;
    const notes = forPrompt(current.text);
    const text = [
      `BRANCH NOTES for ${current.branch} (${current.file})`,
      notes || "(empty)",
      "Record the branch's goal, decisions, constraints and state with the note_add tool as they settle, without waiting for the end of the session."
    ].join(`

`);
    return { sections: [...composed.sections, { id: "branch-notes:notes", text, scope: "session" }] };
  });
  on("tool.call", { tool: NOTE_ADD }, async ($, e) => {
    const { section: name, text, replace } = e;
    const section = sectionOf(name);
    if (!section)
      return failure(`Unknown section "${name}". Use one of: ${SECTIONS.map((s) => s.key).join(", ")}.`);
    const recorded = await record($, section, text, replace === true);
    if ("reason" in recorded)
      return failure(recorded.reason);
    return { result: `Noted under "${section.heading}" for ${recorded.where.branch}.` };
  });
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const ran = await next(e);
    if (BRANCH_CHANGE.test(e.command))
      await refresh($);
    return ran;
  });
  on("command.run", { command: "notes" }, async ($, e) => {
    const args = e.args.trim();
    const [sub = "", ...rest] = args.split(/\s+/);
    if (sub === "")
      return { text: await showNotes($) };
    if (sub === "all")
      return { text: await listNotes($) };
    if (sub === "add")
      return { text: await addNote($, rest.join(" ")) };
    if (sub === "edit")
      return { text: await editNotes($) };
    if (sub === "prune")
      return { text: await pruneNotes($, rest.includes("--yes")) };
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
    if (!current)
      return /* @__PURE__ */ h(Text, {
        dimColor: true
      }, NOT_TRACKED);
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4);
    const rows = filledSections(current.text).flatMap((s) => [
      { text: s.heading, isHeading: true },
      ...s.body.map((text) => ({ text, isHeading: false }))
    ]);
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column"
    }, /* @__PURE__ */ h(Text, {
      dimColor: true
    }, current.branch), rows.length === 0 && /* @__PURE__ */ h(Text, {
      dimColor: true
    }, "No notes yet."), rows.slice(0, room).map((row, i) => /* @__PURE__ */ h(Text, {
      key: `${i}`,
      bold: row.isHeading
    }, row.text)));
  });
}
export {
  register
};
