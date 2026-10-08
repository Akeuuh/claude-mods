import { expect, mock, test } from "claude-code/testing";

const request = (text: string) => ({ role: "user" as const, text, toolUses: [] });

test("compaction is told where the live work starts", async ($, on) => {
  mock.env(on, { JEV_BACKEND: "openrouter", OPENROUTER_API_KEY: "test-key" });
  mock.clock(on);
  on("ui.log", () => ({ value: undefined }));
  on("ui.status", () => ({ value: undefined }));
  on("http.fetch", () => {
    const answers = { live_from: { type: "choice", choice: "1", confidence: 0.9, probabilities: { "0": 0.05, "1": 0.9, none: 0.05 } } };
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 30, output_tokens: 1 } }) } };
  });
  let told: string | undefined;
  on("session.compact", ($, e) => {
    told = e.instructions;
    return { skip: "test" };
  });

  await $.session.compact({ instructions: "Keep the plan.", messages: [request("Fix the login bug"), request("Now add CSV export")] });

  expect(told).toBe('Keep the plan.\nThe live work starts at "Now add CSV export". Summarize everything before it in a few lines. Keep the decisions, file paths, and open questions from "Now add CSV export" onward in full detail.');
});
