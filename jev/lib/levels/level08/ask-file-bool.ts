/**
 * Level 8, option A: ask_jev_file_bool.
 * One file, one yes or no question, flat parameters. The agent asks "does src/auth/session.ts validate tokens?" and gets a Noul back without the file ever entering its context.
 */
import type { Fs } from "../../core/fs.ts";
import { noul } from "../../core/helpers.ts";
import type { NoulAnswer, Questions, State } from "../../core/types.ts";
import { readFileState } from "./read-state.ts";

export type Decide = (state: State, questions: Questions) => Promise<{ answers: Record<string, unknown>; usage?: unknown }>;

export interface FileBool {
  path: string;
  answer: boolean;
  noul: number;
  usage?: unknown;
}

/** A: the question is written against `content`; the tool description says so. */
export async function askFileBool(
  path: string,
  question: string,
  cwd: string,
  criteria: { yes?: string; no?: string } = {},
  decide: Decide,
  fs: Fs,
): Promise<FileBool> {
  const state = await readFileState(path, cwd, fs);
  const questions = { answer: noul(question, criteria.yes || criteria.no ? { true: criteria.yes, false: criteria.no } : undefined) };
  const { answers, usage } = await decide(state, questions);
  const a = answers.answer as NoulAnswer;
  return { path, answer: a.noul > 0.5, noul: a.noul, usage };
}
