/**
 * Passes each annotated request of route-calibration.json to the real Jev with jev-route's question,
 * and prints how often its level matches, exactly and within one. Not part of CI: it spends Jev calls.
 *
 *   OPENROUTER_API_KEY=… bun scripts/calibrate-route.ts
 */
import { join } from "node:path";
import { DEFAULT_MODELS, ENDPOINTS, KEY_ENV, validateResponse, type JevProvider } from "../jev/lib/core/wire.ts";
import type { ScoreAnswer } from "../jev/lib/core/types.ts";
import { commandOf, judgmentOf, ROUTE_QUESTIONS } from "../jev/route/src/route.ts";

const cases: { level: number; request: string }[] = await Bun.file(join(import.meta.dir, "route-calibration.json")).json();

const provider: JevProvider = process.env.TYPESAFE_API_KEY ? "typesafe" : "openrouter";
const key = process.env[KEY_ENV[provider]];
if (!key) throw new Error("Set TYPESAFE_API_KEY or OPENROUTER_API_KEY.");

async function judge(request: string) {
  const state = { request, previous_requests: [], last_answer: "", context_tokens: 0, current_level: null, command: commandOf(request) };
  const res = await fetch(ENDPOINTS[provider], {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: DEFAULT_MODELS[provider], state, questions: ROUTE_QUESTIONS }),
  });
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
  const response: unknown = await res.json();
  validateResponse(response, ROUTE_QUESTIONS);
  return judgmentOf(response.answers.level as ScoreAnswer);
}

const results = await Promise.all(cases.map(async (c) => ({ ...c, judged: await judge(c.request) })));
for (const r of results) {
  const mark = r.judged.level === r.level ? "=" : Math.abs(r.judged.level - r.level) === 1 ? "~" : "✗";
  console.log(`${mark} expected ${r.level} got ${r.judged.level} (${r.judged.confidence.toFixed(2)})  ${r.request.slice(0, 80)}`);
}
const exact = results.filter((r) => r.judged.level === r.level).length;
const near = results.filter((r) => Math.abs(r.judged.level - r.level) <= 1).length;
console.log(`\nexact ${exact}/${results.length} · within one ${near}/${results.length}`);
