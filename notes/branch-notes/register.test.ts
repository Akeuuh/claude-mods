import { expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

import { repoOf } from "./src/notes.ts";

const HOME = "/home/me";
const COMMON_DIR = "/work/shop/.git";
const REPO = repoOf(COMMON_DIR).name;
const DIR = `${HOME}/.claude/branch-notes/${repoOf(COMMON_DIR).key}`;
const FILE = `${DIR}/feat%2Fcart.md`;
const NOTE_ADD = "mcp__branch-notes__note_add";
const COMPOSE = { model: "m", promptModel: "m", surfaces: [], tools: [], outputStyle: null, traits: [] };

const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } });

type Git = { branch: string; commonDir: string; refs: string; rmExit: number; lockedFor: number; lockMtime: number; rmdirs: string[] };

function world(on: On, files: Record<string, string>, git: Partial<Git> = {}) {
  const state: Git = { branch: "feat/cart", commonDir: COMMON_DIR, refs: "refs/heads/feat/cart\nrefs/remotes/origin/main\n", rmExit: 0, lockedFor: 0, lockMtime: 0, rmdirs: [], ...git };
  const removed: string[] = [];
  mock.env(on, { HOME });
  on("session.cwd", () => ({ value: "/work/shop" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("process.run", (_$, e) => {
    const [cmd, ...args] = e.argv;
    if (cmd === "rm") {
      removed.push(args.at(-1)!);
      if (state.rmExit === 0) delete files[args.at(-1)!];
      return ran("", state.rmExit);
    }
    if (cmd === "mkdir" && args[0] === "-p") return ran("");
    if (cmd === "mkdir") {
      if (state.lockedFor <= 0) return ran("");
      state.lockedFor--;
      return ran("", 1);
    }
    if (cmd === "rmdir") {
      state.rmdirs.push(args[0]);
      state.lockedFor = 0;
      return ran("");
    }
    if (args[0] === "branch") return ran(`${state.branch}\n`);
    if (args[0] === "rev-parse") return ran(`${state.commonDir}\n`);
    if (args[0] === "for-each-ref") return ran(state.refs);
    return ran("", 1);
  });
  on("fs.stat", () => ({ value: { kind: "dir" as const, size: 0, mtimeMs: state.lockMtime, isLink: false } }));
  on("fs.exists", (_$, e) => ({ value: e.path in files }));
  on("fs.read", (_$, e) => ({ value: files[e.path] }));
  on("fs.write", (_$, e) => {
    files[e.path] = e.text;
    return { value: undefined };
  });
  on("fs.list", (_$, e) => ({
    value: Object.keys(files)
      .filter((path) => path.startsWith(`${e.path}/`))
      .map((path) => ({ name: path.slice(e.path.length + 1), kind: "file" as const, size: 1, mtimeMs: 0, isLink: false })),
  }));
  on("command.register", () => ({ value: undefined }));
  on("tool.register", (_$, e) => ({ value: { tool: `mcp__branch-notes__${e.name}` } }));
  return { removed, state };
}

const NOTES = `# Notes — shop @ feat/cart\n\nCréé : 2026-10-09\n\n## Objectif\n- Ship the cart\n\n## Décisions\n\n## Contraintes\n\n## État / prochaines étapes\n- Wire the API\n`;

test("note_add appends under its heading and the notes ride in the system prompt", async ($, on) => {
  const files = { [FILE]: NOTES };
  world(on, files);
  on("prompt.compose", () => ({ sections: [] }));

  await $.session.start({ cwd: "/work/shop", surface: null, isInteractive: false });
  const added = await $.tool.call({ tool: NOTE_ADD, section: "decisions", text: "Cart lives in the URL" } as never);
  const composed = await $.prompt.compose(COMPOSE);

  expect(added.result).toBe('Noted under "Décisions" for feat/cart.');
  expect(files[FILE]).toContain("## Décisions\n- Cart lives in the URL\n");
  expect(composed.sections.at(-1)?.text).toContain("- Cart lives in the URL");
  expect(composed.sections.at(-1)?.text).not.toContain("## Contraintes");
});

test("replace swaps the whole state section", async ($, on) => {
  const files = { [FILE]: NOTES };
  world(on, files);

  await $.session.start({ cwd: "/work/shop", surface: null, isInteractive: false });
  await $.tool.call({ tool: NOTE_ADD, section: "etat", text: "Tests green", replace: true } as never);

  expect(files[FILE]).toContain("## État / prochaines étapes\n- Tests green\n");
  expect(files[FILE]).not.toContain("Wire the API");
});

test("a branch without notes gets the template on session start, under the lock", async ($, on) => {
  const files: Record<string, string> = {};
  const { state } = world(on, files);

  await $.session.start({ cwd: "/work/shop", surface: null, isInteractive: false });

  expect(files[FILE]).toContain("# Notes — shop @ feat/cart");
  expect(files[FILE]).toContain("## État / prochaines étapes");
  expect(state.rmdirs).toEqual([`${FILE}.lock`]);
});

test("/notes prune lists notes of deleted branches and deletes them only with --yes", async ($, on) => {
  const old = `${DIR}/old-idea.md`;
  const files = { [FILE]: NOTES, [old]: NOTES };
  const { removed, state } = world(on, files);

  const listed = await $.command.run({ command: "notes", args: "prune" });
  expect(listed.text).toContain("old-idea");
  expect(listed.text).not.toContain("feat-cart");
  expect(removed).toEqual([]);

  await $.command.run({ command: "notes", args: "prune --yes" });
  expect(removed).toEqual([old]);
  expect(state.rmdirs).toEqual([`${old}.lock`]);
  expect(FILE in files).toBe(true);
});

test("/notes add refuses an unknown section", async ($, on) => {
  const files = { [FILE]: NOTES };
  world(on, files);

  const answer = await $.command.run({ command: "notes", args: "add nope some text" });

  expect(answer.text).toStartWith("Usage: /notes add");
  expect(files[FILE]).toBe(NOTES);
});

test("the pane draws the filled sections", async ($, on) => {
  const files = { [FILE]: NOTES };
  world(on, files);
  on("ui.open", () => ({ value: { isPlaced: true } }));

  await $.command.run({ command: "notes", args: "pane" });
  const ui = await $.ui.mount({ plugin: "branch-notes", surface: "terminal", component: "Pane", requestId: "branch-notes", props: {} } as never);

  expect(await ui.find({ type: "Markdown", props: { text: "## Objectif\n- Ship the cart\n\n## \u00c9tat / prochaines \u00e9tapes\n- Wire the API" } })).toBeDefined();
});

test("/notes all shows the goal and the state of each branch", async ($, on) => {
  const files = { [FILE]: NOTES };
  world(on, files);

  const answer = await $.command.run({ command: "notes", args: "all" });

  expect(answer.text).toBe(`${REPO}\n* feat/cart  1970-01-01\n    objectif: Ship the cart\n    état: Wire the API`);
});

test("/notes all lists a branch that has no notes yet, and never a long-lived one", async ($, on) => {
  const files = { [FILE]: NOTES };
  world(on, files, { refs: "refs/heads/feat/cart\nrefs/heads/feat/fresh\nrefs/heads/main\n" });

  const answer = await $.command.run({ command: "notes", args: "all" });

  expect(answer.text).toContain("  feat/fresh  no notes");
  expect(answer.text).not.toContain("main");
});

test("two repos with the same name keep separate notes", async ($, on) => {
  const elsewhere = "/elsewhere/shop/.git";
  const other = `${HOME}/.claude/branch-notes/${repoOf(elsewhere).key}/feat%2Fcart.md`;
  const files = { [FILE]: NOTES, [other]: NOTES.replace("Ship the cart", "The other shop") };
  const { state } = world(on, files);

  const here = await $.command.run({ command: "notes", args: "" });
  state.commonDir = elsewhere;
  const there = await $.command.run({ command: "notes", args: "" });

  expect(here.text).toContain("Ship the cart");
  expect(there.text).toContain("The other shop");
});

test("on main the notes stay out of the prompt and note_add refuses, but /notes all and prune still work", async ($, on) => {
  const old = `${DIR}/old-idea.md`;
  const files = { [FILE]: NOTES, [old]: NOTES };
  const { removed } = world(on, files, { branch: "main" });
  on("prompt.compose", () => ({ sections: [] }));

  await $.session.start({ cwd: "/work/shop", surface: null, isInteractive: false });
  const composed = await $.prompt.compose(COMPOSE);
  const added = await $.tool.call({ tool: NOTE_ADD, section: "decisions", text: "x" } as never);
  const listed = await $.command.run({ command: "notes", args: "all" });
  await $.command.run({ command: "notes", args: "prune --yes" });

  expect(composed.sections).toEqual([]);
  expect(added.deny).toStartWith("No notes here");
  expect(listed.text).toContain("old-idea (branch gone)");
  expect(removed).toEqual([old]);
});

test("a git checkout in Bash moves the notes to the new branch", async ($, on) => {
  const other = `${DIR}/feat%2Fother.md`;
  const files = { [FILE]: NOTES, [other]: NOTES.replace("Ship the cart", "Ship the other thing") };
  const { state } = world(on, files);
  on("prompt.compose", () => ({ sections: [] }));
  on("tool.call", () => ({ result: "ok" }));
  const compose = () => $.prompt.compose(COMPOSE);

  await $.session.start({ cwd: "/work/shop", surface: null, isInteractive: false });
  expect((await compose()).sections.at(-1)?.text).toContain("Ship the cart");

  state.branch = "feat/other";
  await $.tool.call({ tool: "Bash", command: "git checkout feat/other" });

  expect((await compose()).sections.at(-1)?.text).toContain("Ship the other thing");
});

test("a checkout run elsewhere with -C leaves the notes of the session branch alone", async ($, on) => {
  const files = { [FILE]: NOTES };
  const { state } = world(on, files);
  on("prompt.compose", () => ({ sections: [] }));
  on("tool.call", () => ({ result: "ok" }));

  await $.session.start({ cwd: "/work/shop", surface: null, isInteractive: false });
  state.branch = "feat/other";
  await $.tool.call({ tool: "Bash", command: "git -C /other/repo checkout feat/other" });
  const composed = await $.prompt.compose(COMPOSE);

  expect(composed.sections.at(-1)?.text).toContain("feat/cart");
});

test("/notes prune --yes reports the files it could not delete", async ($, on) => {
  const old = `${DIR}/old-idea.md`;
  const files = { [FILE]: NOTES, [old]: NOTES };
  world(on, files, { rmExit: 1 });

  const answer = await $.command.run({ command: "notes", args: "prune --yes" });

  expect(answer.text).toBe("Deleted 0, could not delete:\nold-idea");
});

test("feat/cart and feat-cart keep separate notes", async ($, on) => {
  const dash = `${DIR}/feat-cart.md`;
  const files = { [FILE]: NOTES, [dash]: NOTES.replace("Ship the cart", "Dashed branch") };
  const { state } = world(on, files);

  const slash = await $.command.run({ command: "notes", args: "" });
  state.branch = "feat-cart";
  const dashed = await $.command.run({ command: "notes", args: "" });

  expect(slash.text).toContain("Ship the cart");
  expect(dashed.text).toContain("Dashed branch");
});

test("a long section keeps its head and its tail in the prompt", async ($, on) => {
  const lines = Array.from({ length: 40 }, (_, i) => `- decision ${i}`).join("\n");
  const files = { [FILE]: NOTES.replace("## Décisions\n", `## Décisions\n${lines}\n`) };
  world(on, files);
  on("prompt.compose", () => ({ sections: [] }));

  await $.session.start({ cwd: "/work/shop", surface: null, isInteractive: false });
  const text = (await $.prompt.compose(COMPOSE)).sections.at(-1)?.text ?? "";

  expect(text).toContain("- decision 0\n");
  expect(text).toContain("- decision 39");
  expect(text).toContain("… 15 more line(s) in the notes file");
  expect(text).not.toContain("- decision 20\n");
});

test("note_add waits for a lock another session holds, then writes", async ($, on) => {
  const files = { [FILE]: NOTES };
  const clock = mock.clock(on, { now: 50_000 });
  const { state } = world(on, files, { lockedFor: 2, lockMtime: 50_000 });

  const added = $.tool.call({ tool: NOTE_ADD, section: "decisions", text: "Waited" } as never);
  await clock.advance(250);

  expect((await added).result).toBe('Noted under "Décisions" for feat/cart.');
  expect(files[FILE]).toContain("- Waited");
  expect(state.rmdirs).toEqual([`${FILE}.lock`]);
});

test("note_add takes over a lock left behind by a dead session", async ($, on) => {
  const files = { [FILE]: NOTES };
  mock.clock(on, { now: 50_000 });
  const { state } = world(on, files, { lockedFor: 1, lockMtime: 0 });

  const added = await $.tool.call({ tool: NOTE_ADD, section: "decisions", text: "Took over" } as never);

  expect(added.result).toBe('Noted under "Décisions" for feat/cart.');
  expect(files[FILE]).toContain("- Took over");
  expect(state.rmdirs).toEqual([`${FILE}.lock`, `${FILE}.lock`]);
});

test("note_add gives up when the lock never frees, and leaves the notes untouched", async ($, on) => {
  const files = { [FILE]: NOTES };
  const clock = mock.clock(on, { now: 50_000 });
  world(on, files, { lockedFor: Infinity, lockMtime: 50_000 });

  const added = $.tool.call({ tool: NOTE_ADD, section: "decisions", text: "Never" } as never);
  await clock.advance(6_000);

  expect((await added).deny).toStartWith("The notes file is busy");
  expect(files[FILE]).toBe(NOTES);
});
