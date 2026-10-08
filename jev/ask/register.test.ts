import { expect, mock, test } from "claude-code/testing";

const QUESTIONS = JSON.stringify({ kind: { type: "choice", instructions: "What is `text`?", criteria: { bug: "a bug", feature: "a request", other: "else" } } });
const ANSWER = { kind: { type: "choice", choice: "bug", confidence: 0.8, probabilities: { bug: 0.8, feature: 0.15, other: 0.05 } } };

function jev(on: Parameters<Parameters<typeof test>[1]>[1]) {
  mock.env(on, { JEV_BACKEND: "openrouter", OPENROUTER_API_KEY: "test-key" });
  mock.clock(on);
  on("ui.log", () => ({ value: undefined }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("http.fetch", () => ({
    value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ model: "jev-test", answers: ANSWER, usage: { input_tokens: 30, output_tokens: 1 } }) },
  }));
}

test("the agent's own state is judged and only the answers come back", async ($, on) => {
  jev(on);

  const ran = await $.tool.call({ tool: "mcp__ask-jev__ask_jev", questions_json: QUESTIONS, state: "The invoice total is wrong after a refund" });

  expect(JSON.parse(String(ran.result))).toMatchObject({ answers: ANSWER, state_summary: { own_fields: ["text"], files: [] } });
});

test("a malformed question block is refused before any call", async ($, on) => {
  jev(on);

  const ran = await $.tool.call({ tool: "mcp__ask-jev__ask_jev", questions_json: "{nope", state: "x" });

  expect(ran.deny).toContain("questions_json is not valid JSON");
});
