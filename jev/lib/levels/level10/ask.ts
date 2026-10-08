/**
 * Level 10, option A: ask_jev on any content.
 * The general form. The agent passes its own state, paths for code to read, a command for code to run, and its question block. Code assembles one state, validates, and makes one call. The agent never receives the files or the output, only the answers.
 */
import { validateQuestions, type Questions, type State } from "../../core/types.ts";

/** A JSON string becomes structured state; anything else is sent as the string it is. */
export function parseState(raw: string | Record<string, unknown>): State {
  if (typeof raw !== "string") return raw;
  const t = raw.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch { /* not JSON after all, send the text */ }
  }
  return raw;
}

export function parseQuestions(questionsJson: string): Questions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(questionsJson);
  } catch (err: any) {
    throw new Error(`questions_json is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("questions_json must be an object keyed by question id");
  validateQuestions(parsed as Questions);
  return parsed as Questions;
}
