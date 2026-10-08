import { expect, mock, test } from "claude-code/testing";

const TREE: Record<string, { name: string; kind: "file" | "dir" }[]> = {
  "/repo/src": [
    { name: "a.ts", kind: "file" },
    { name: "b.ts", kind: "file" },
    { name: "notes.md", kind: "file" },
    { name: "node_modules", kind: "dir" },
  ],
};

test("a glob expands through the host, one Jev call per matching file", async ($, on) => {
  mock.env(on, { JEV_BACKEND: "openrouter", OPENROUTER_API_KEY: "test-key" });
  mock.clock(on);
  on("ui.log", () => ({ value: undefined }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("fs.list", ($, e) => ({ value: (TREE[String(e.path)] ?? []).map((x) => ({ ...x, size: 10, mtimeMs: 0, isLink: false })) }));
  on("fs.stat", () => ({ value: { kind: "file", size: 10, mtimeMs: 0, isLink: false } }));
  on("fs.read", ($, e) => ({ value: `// ${e.path}` }));
  const asked: string[] = [];
  on("http.fetch", ($, e) => {
    asked.push(JSON.parse(e.init?.body ?? "{}").state.path);
    const text = JSON.stringify({ model: "jev-test", answers: { tested: { type: "noul", noul: 0.2 } }, usage: { input_tokens: 20, output_tokens: 1 } });
    return { value: { status: 200, ok: true, headers: {}, text } };
  });

  const ran = await $.tool.call({
    tool: "mcp__ask-jev-files__ask_jev_files",
    paths_or_globs: ["src/*.ts"],
    questions_json: JSON.stringify({ tested: { type: "noul", instructions: "Is `content` a test?" } }),
  });

  expect(asked.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  expect(JSON.parse(String(ran.result)).results.map((r: { path: string }) => r.path)).toEqual(["src/a.ts", "src/b.ts"]);
});
