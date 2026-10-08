/**
 * Level 8, shared: the file becomes Jev's state, never the agent's context.
 * Code reads it, refuses binaries and files over the budget, and hands back `{ path, content }`. Every ask_jev_file tool starts here.
 */
import { isAbsolute, resolve } from "node:path";
import type { Fs } from "../../core/fs.ts";
import { LIMITS } from "../../core/types.ts";

/** Roughly four characters per token. The budget is shared with the questions, so leave room. */
export const MAX_FILE_CHARS = (LIMITS.TOTAL_TOKEN_BUDGET - 4000) * 4;

export type FileState = {
  path: string;
  content: string;
};

export class FileStateError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(message);
    this.name = "FileStateError";
    this.path = path;
  }
}

const looksBinary = (text: string) => text.slice(0, 8192).includes("\0");

/** Read one file as state. Errors name the path and the reason, so a tool can report them per file. */
export async function readFileState(path: string, cwd: string, fs: Fs): Promise<FileState> {
  const full = isAbsolute(path) ? path : resolve(cwd, path);
  let info;
  try {
    info = await fs.stat(full);
  } catch {
    throw new FileStateError(`not found: ${path}`, path);
  }
  if (!info.isFile) throw new FileStateError(`not a file: ${path}`, path);
  if (info.size > MAX_FILE_CHARS) {
    throw new FileStateError(`too large for one Jev call: ${path} is ${info.size} bytes, the limit is ${MAX_FILE_CHARS}`, path);
  }
  const content = await fs.readText(full);
  if (looksBinary(content)) throw new FileStateError(`binary: ${path}`, path);
  return { path, content };
}
