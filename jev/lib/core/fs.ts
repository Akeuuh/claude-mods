/**
 * The file system the levels read through. Node by default; a Claude Code mod passes its host's.
 */
export interface FileInfo {
  isFile: boolean;
  size: number;
}

export interface Fs {
  /** Rejects when the path does not exist. */
  stat(path: string): Promise<FileInfo>;
  readText(path: string): Promise<string>;
  /** Paths matching `pattern`, relative to `cwd`. */
  glob(pattern: string, cwd: string): Promise<string[]>;
}
