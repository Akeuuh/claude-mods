import { expect, mock, test } from "claude-code/testing";

const SOURCE = "export function verify(token: string) { return jwt.verify(token, KEY); }";

test("a yes or no about a file comes back typed, and the file never does", async ($, on) => {
  mock.env(on, { JEV_BACKEND: "openrouter", OPENROUTER_API_KEY: "test-key" });
  mock.clock(on);
  on("ui.log", () => ({ value: undefined }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("fs.stat", () => ({ value: { kind: "file", size: SOURCE.length, mtimeMs: 0, isLink: false } }));
  on("fs.read", () => ({ value: SOURCE }));
  let sent: { state: { path: string; content: string } } | undefined;
  on("http.fetch", ($, e) => {
    sent = JSON.parse(e.init?.body ?? "{}");
    const text = JSON.stringify({ model: "jev-test", answers: { answer: { type: "noul", noul: 0.86 } }, usage: { input_tokens: 40, output_tokens: 1 } });
    return { value: { status: 200, ok: true, headers: {}, text } };
  });

  const ran = await $.tool.call({ tool: "mcp__ask-jev-file__ask_jev_file_bool", path: "src/auth.ts", question: "Does `content` validate tokens?" });

  expect(sent?.state).toEqual({ path: "src/auth.ts", content: SOURCE });
  expect(JSON.parse(String(ran.result))).toMatchObject({ path: "src/auth.ts", answer: true, noul: 0.86 });
  expect(String(ran.result)).not.toContain("jwt.verify");
});

test("a binary file is refused with its path", async ($, on) => {
  mock.env(on, { JEV_BACKEND: "openrouter", OPENROUTER_API_KEY: "test-key" });
  on("session.cwd", () => ({ value: "/repo" }));
  on("fs.stat", () => ({ value: { kind: "file", size: 4, mtimeMs: 0, isLink: false } }));
  on("fs.read", () => ({ value: "PNG\0" }));

  const ran = await $.tool.call({ tool: "mcp__ask-jev-file__ask_jev_file_bool", path: "logo.png", question: "Is it a logo?" });

  expect(ran.deny).toBe("binary: logo.png");
});
