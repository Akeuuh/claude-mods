// jev/lib/core/helpers.ts
function noul(instructions, criteria) {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}
function choice(instructions, criteria) {
  return { type: "choice", instructions, criteria };
}

// jev/lib/levels/level06/bash-gate.ts
var BASH_QUESTIONS = {
  effect: choice("What does running `command` in `cwd` do to the machine?", {
    read_only: "Lists, reads, searches, tests, builds into a scratch directory; nothing durable changes",
    reversible: "Changes files or state that git or a reinstall can restore: edits, installs, generated output",
    irreversible: "Deletes or overwrites things with no way back: removing directories, force pushing, dropping data, rewriting history"
  }),
  destructive_intent: noul("Does `command` aim to remove or wipe something rather than build or inspect?", {
    true: "rm -rf, drop, purge, force, reset --hard, truncate, overwriting real data",
    false: "Reading, listing, testing, installing, generating, or editing in place"
  })
};
var BASH_THRESHOLDS = { irreversible: 0.6, destructive: 0.7 };
var BLOCK_NOTICE = "This block is final. Do not try to work around it with another command, another tool, a different path, or an encoding that does the same thing. Stop and tell the user what was blocked and why.";
function gateBash(a, t = BASH_THRESHOLDS) {
  if (a.effect.choice === "irreversible" && a.effect.confidence >= t.irreversible) {
    return { block: true, reason: `irreversible (${a.effect.confidence.toFixed(2)}): nothing would restore what this removes or overwrites` };
  }
  if (a.destructive_intent.noul >= t.destructive) {
    return { block: true, reason: `destructive intent (${a.destructive_intent.noul.toFixed(2)}): this command aims to wipe something` };
  }
  return { block: false, reason: `${a.effect.choice} (${a.effect.confidence.toFixed(2)}), destructive ${a.destructive_intent.noul.toFixed(2)}` };
}
async function gateBashCommand(command, cwd, decide) {
  const { answers } = await decide({ command, cwd }, BASH_QUESTIONS);
  return gateBash(answers);
}

// jev/lib/core/types.ts
var LIMITS = {
  MAX_CHOICE_OPTIONS: 255,
  MIN_SCORE_LEVELS: 2,
  MAX_SCORE_LEVELS: 10,
  TOTAL_TOKEN_BUDGET: 64000
};

class QuestionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuestionValidationError";
  }
}
var isRecord = (value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function validateRequest(request) {
  if (!isRecord(request))
    throw new QuestionValidationError("Expected a request object.");
  if (typeof request.state !== "string" && !isRecord(request.state) && !Array.isArray(request.state)) {
    throw new QuestionValidationError("State must be a string, object, or array.");
  }
  if (request.model !== undefined && (typeof request.model !== "string" || !request.model.trim())) {
    throw new QuestionValidationError("Model must be a nonblank string.");
  }
  validateQuestions(request.questions);
}
function validateQuestions(questions) {
  if (!isRecord(questions) || Object.keys(questions).length === 0) {
    throw new QuestionValidationError("Questions must be a nonempty object.");
  }
  for (const [id, q] of Object.entries(questions)) {
    if (!isRecord(q))
      throw new QuestionValidationError(`Question "${id}" must be an object.`);
    if (q.type !== "noul" && q.type !== "choice" && q.type !== "score") {
      throw new QuestionValidationError(`Question "${id}" has a missing or unknown type.`);
    }
    if (typeof q.instructions === "string" ? !q.instructions.trim() : !isRecord(q.instructions)) {
      throw new QuestionValidationError(`Question "${id}" needs nonblank string or object instructions.`);
    }
    if (q.type === "noul" && q.criteria !== undefined) {
      if (!isRecord(q.criteria) || Object.entries(q.criteria).some(([key, value]) => !["true", "false"].includes(key) || value !== undefined && typeof value !== "string")) {
        throw new QuestionValidationError(`Noul "${id}" criteria must map true/false to descriptions.`);
      }
    }
    if (q.type === "choice") {
      if (!isRecord(q.criteria)) {
        throw new QuestionValidationError(`Choice "${id}" criteria must be an object.`);
      }
      const options = Object.keys(q.criteria);
      if (options.length === 0) {
        throw new QuestionValidationError(`Choice "${id}" has no options.`);
      }
      if (options.length > LIMITS.MAX_CHOICE_OPTIONS) {
        throw new QuestionValidationError(`Choice "${id}" has ${options.length} options; the maximum is ${LIMITS.MAX_CHOICE_OPTIONS}.`);
      }
      if (Object.values(q.criteria).some((value) => value !== null && typeof value !== "string")) {
        throw new QuestionValidationError(`Choice "${id}" descriptions must be strings or null.`);
      }
    }
    if (q.type === "score") {
      if (!Array.isArray(q.criteria)) {
        throw new QuestionValidationError(`Score "${id}" criteria must be an array.`);
      }
      if (q.criteria.length < LIMITS.MIN_SCORE_LEVELS || q.criteria.length > LIMITS.MAX_SCORE_LEVELS) {
        throw new QuestionValidationError(`Score "${id}" must have between ${LIMITS.MIN_SCORE_LEVELS} and ${LIMITS.MAX_SCORE_LEVELS} levels; got ${q.criteria.length}.`);
      }
      if (q.criteria.some((level) => typeof level !== "string" || !level.trim())) {
        throw new QuestionValidationError(`Score "${id}" levels must be nonblank strings.`);
      }
    }
  }
}

// jev/lib/levels/level10/ask.ts
function parseState(raw) {
  if (typeof raw !== "string")
    return raw;
  const t = raw.trim();
  if (t.startsWith("{") && t.endsWith("}") || t.startsWith("[") && t.endsWith("]")) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  return raw;
}
function parseQuestions(questionsJson) {
  let parsed;
  try {
    parsed = JSON.parse(questionsJson);
  } catch (err) {
    throw new Error(`questions_json is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("questions_json must be an object keyed by question id");
  validateQuestions(parsed);
  return parsed;
}
// node:path
function assertPath(path) {
  if (typeof path !== "string")
    throw new TypeError("Path must be a string. Received " + JSON.stringify(path));
}
function normalizeStringPosix(path, allowAboveRoot) {
  var res = "", lastSegmentLength = 0, lastSlash = -1, dots = 0, code;
  for (var i = 0;i <= path.length; ++i) {
    if (i < path.length)
      code = path.charCodeAt(i);
    else if (code === 47)
      break;
    else
      code = 47;
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1)
        ;
      else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf("/");
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1)
                res = "", lastSegmentLength = 0;
              else
                res = res.slice(0, lastSlashIndex), lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
              lastSlash = i, dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = "", lastSegmentLength = 0, lastSlash = i, dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0)
            res += "/..";
          else
            res = "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += "/" + path.slice(lastSlash + 1, i);
        else
          res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i, dots = 0;
    } else if (code === 46 && dots !== -1)
      ++dots;
    else
      dots = -1;
  }
  return res;
}
function _format(sep, pathObject) {
  var dir = pathObject.dir || pathObject.root, base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
  if (!dir)
    return base;
  if (dir === pathObject.root)
    return dir + base;
  return dir + sep + base;
}
function resolve() {
  var resolvedPath = "", resolvedAbsolute = false, cwd;
  for (var i = arguments.length - 1;i >= -1 && !resolvedAbsolute; i--) {
    var path;
    if (i >= 0)
      path = arguments[i];
    else {
      if (cwd === undefined)
        cwd = process.cwd();
      path = cwd;
    }
    if (assertPath(path), path.length === 0)
      continue;
    resolvedPath = path + "/" + resolvedPath, resolvedAbsolute = path.charCodeAt(0) === 47;
  }
  if (resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute), resolvedAbsolute)
    if (resolvedPath.length > 0)
      return "/" + resolvedPath;
    else
      return "/";
  else if (resolvedPath.length > 0)
    return resolvedPath;
  else
    return ".";
}
function normalize(path) {
  if (assertPath(path), path.length === 0)
    return ".";
  var isAbsolute = path.charCodeAt(0) === 47, trailingSeparator = path.charCodeAt(path.length - 1) === 47;
  if (path = normalizeStringPosix(path, !isAbsolute), path.length === 0 && !isAbsolute)
    path = ".";
  if (path.length > 0 && trailingSeparator)
    path += "/";
  if (isAbsolute)
    return "/" + path;
  return path;
}
function isAbsolute(path) {
  return assertPath(path), path.length > 0 && path.charCodeAt(0) === 47;
}
function join() {
  if (arguments.length === 0)
    return ".";
  var joined;
  for (var i = 0;i < arguments.length; ++i) {
    var arg = arguments[i];
    if (assertPath(arg), arg.length > 0)
      if (joined === undefined)
        joined = arg;
      else
        joined += "/" + arg;
  }
  if (joined === undefined)
    return ".";
  return normalize(joined);
}
function relative(from, to) {
  if (assertPath(from), assertPath(to), from === to)
    return "";
  if (from = resolve(from), to = resolve(to), from === to)
    return "";
  var fromStart = 1;
  for (;fromStart < from.length; ++fromStart)
    if (from.charCodeAt(fromStart) !== 47)
      break;
  var fromEnd = from.length, fromLen = fromEnd - fromStart, toStart = 1;
  for (;toStart < to.length; ++toStart)
    if (to.charCodeAt(toStart) !== 47)
      break;
  var toEnd = to.length, toLen = toEnd - toStart, length = fromLen < toLen ? fromLen : toLen, lastCommonSep = -1, i = 0;
  for (;i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === 47)
          return to.slice(toStart + i + 1);
        else if (i === 0)
          return to.slice(toStart + i);
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === 47)
          lastCommonSep = i;
        else if (i === 0)
          lastCommonSep = 0;
      }
      break;
    }
    var fromCode = from.charCodeAt(fromStart + i), toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode)
      break;
    else if (fromCode === 47)
      lastCommonSep = i;
  }
  var out = "";
  for (i = fromStart + lastCommonSep + 1;i <= fromEnd; ++i)
    if (i === fromEnd || from.charCodeAt(i) === 47)
      if (out.length === 0)
        out += "..";
      else
        out += "/..";
  if (out.length > 0)
    return out + to.slice(toStart + lastCommonSep);
  else {
    if (toStart += lastCommonSep, to.charCodeAt(toStart) === 47)
      ++toStart;
    return to.slice(toStart);
  }
}
function _makeLong(path) {
  return path;
}
function dirname(path) {
  if (assertPath(path), path.length === 0)
    return ".";
  var code = path.charCodeAt(0), hasRoot = code === 47, end = -1, matchedSlash = true;
  for (var i = path.length - 1;i >= 1; --i)
    if (code = path.charCodeAt(i), code === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else
      matchedSlash = false;
  if (end === -1)
    return hasRoot ? "/" : ".";
  if (hasRoot && end === 1)
    return "//";
  return path.slice(0, end);
}
function basename(path, ext) {
  if (ext !== undefined && typeof ext !== "string")
    throw new TypeError('"ext" argument must be a string');
  assertPath(path);
  var start = 0, end = -1, matchedSlash = true, i;
  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path)
      return "";
    var extIdx = ext.length - 1, firstNonSlashEnd = -1;
    for (i = path.length - 1;i >= 0; --i) {
      var code = path.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1)
          matchedSlash = false, firstNonSlashEnd = i + 1;
        if (extIdx >= 0)
          if (code === ext.charCodeAt(extIdx)) {
            if (--extIdx === -1)
              end = i;
          } else
            extIdx = -1, end = firstNonSlashEnd;
      }
    }
    if (start === end)
      end = firstNonSlashEnd;
    else if (end === -1)
      end = path.length;
    return path.slice(start, end);
  } else {
    for (i = path.length - 1;i >= 0; --i)
      if (path.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1)
        matchedSlash = false, end = i + 1;
    if (end === -1)
      return "";
    return path.slice(start, end);
  }
}
function extname(path) {
  assertPath(path);
  var startDot = -1, startPart = 0, end = -1, matchedSlash = true, preDotState = 0;
  for (var i = path.length - 1;i >= 0; --i) {
    var code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1)
      matchedSlash = false, end = i + 1;
    if (code === 46) {
      if (startDot === -1)
        startDot = i;
      else if (preDotState !== 1)
        preDotState = 1;
    } else if (startDot !== -1)
      preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    return "";
  return path.slice(startDot, end);
}
function format(pathObject) {
  if (pathObject === null || typeof pathObject !== "object")
    throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
  return _format("/", pathObject);
}
function parse(path) {
  assertPath(path);
  var ret = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0)
    return ret;
  var code = path.charCodeAt(0), isAbsolute2 = code === 47, start;
  if (isAbsolute2)
    ret.root = "/", start = 1;
  else
    start = 0;
  var startDot = -1, startPart = 0, end = -1, matchedSlash = true, i = path.length - 1, preDotState = 0;
  for (;i >= start; --i) {
    if (code = path.charCodeAt(i), code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1)
      matchedSlash = false, end = i + 1;
    if (code === 46) {
      if (startDot === -1)
        startDot = i;
      else if (preDotState !== 1)
        preDotState = 1;
    } else if (startDot !== -1)
      preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    if (end !== -1)
      if (startPart === 0 && isAbsolute2)
        ret.base = ret.name = path.slice(1, end);
      else
        ret.base = ret.name = path.slice(startPart, end);
  } else {
    if (startPart === 0 && isAbsolute2)
      ret.name = path.slice(1, startDot), ret.base = path.slice(1, end);
    else
      ret.name = path.slice(startPart, startDot), ret.base = path.slice(startPart, end);
    ret.ext = path.slice(startDot, end);
  }
  if (startPart > 0)
    ret.dir = path.slice(0, startPart - 1);
  else if (isAbsolute2)
    ret.dir = "/";
  return ret;
}
var sep = "/";
var delimiter = ":";
var posix = ((p) => (p.posix = p, p))({ resolve, normalize, isAbsolute, join, relative, _makeLong, dirname, basename, extname, format, parse, sep, delimiter, win32: null, posix: null });

// jev/lib/levels/level08/read-state.ts
var MAX_FILE_CHARS = (LIMITS.TOTAL_TOKEN_BUDGET - 4000) * 4;

class FileStateError extends Error {
  path;
  constructor(message, path) {
    super(message);
    this.name = "FileStateError";
    this.path = path;
  }
}
var looksBinary = (text) => text.slice(0, 8192).includes("\x00");
async function readFileState(path, cwd, fs) {
  const full = isAbsolute(path) ? path : resolve(cwd, path);
  let info;
  try {
    info = await fs.stat(full);
  } catch {
    throw new FileStateError(`not found: ${path}`, path);
  }
  if (!info.isFile)
    throw new FileStateError(`not a file: ${path}`, path);
  if (info.size > MAX_FILE_CHARS) {
    throw new FileStateError(`too large for one Jev call: ${path} is ${info.size} bytes, the limit is ${MAX_FILE_CHARS}`, path);
  }
  const content = await fs.readText(full);
  if (looksBinary(content))
    throw new FileStateError(`binary: ${path}`, path);
  return { path, content };
}

// jev/lib/levels/level09/prune.ts
var SKIP_DIRS = new Set(["node_modules", ".git", ".sessions", "dist", "build", "coverage", ".pi"]);
var GLOB_CHARS = /[*?[\]{}]/;
async function expandPatterns(patterns, cwd, recursive, fs) {
  const out = new Set;
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!pattern)
      continue;
    if (GLOB_CHARS.test(pattern)) {
      for (const p of await fs.glob(pattern, cwd))
        out.add(p);
      continue;
    }
    const full = isAbsolute(pattern) ? pattern : resolve(cwd, pattern);
    let info;
    try {
      info = await fs.stat(full);
    } catch {
      out.add(pattern);
      continue;
    }
    if (info.isFile) {
      out.add(pattern);
      continue;
    }
    for (const p of await fs.glob(recursive ? `${pattern.replace(/\/+$/, "")}/**/*` : `${pattern.replace(/\/+$/, "")}/*`, cwd))
      out.add(p);
  }
  return [...out].sort();
}
async function pruneFiles(paths, cwd, cap = LIMITS.MAX_CHOICE_OPTIONS, fs) {
  const files = [];
  const skipped = [];
  for (const path of paths) {
    const full = isAbsolute(path) ? path : resolve(cwd, path);
    const rel = relative(cwd, full);
    if (rel.startsWith("..")) {
      skipped.push({ path, reason: "outside the repo" });
      continue;
    }
    if (rel.split(sep).some((part) => SKIP_DIRS.has(part))) {
      skipped.push({ path, reason: "skipped directory" });
      continue;
    }
    let info;
    try {
      info = await fs.stat(full);
    } catch {
      skipped.push({ path, reason: "not found" });
      continue;
    }
    if (!info.isFile)
      continue;
    if (info.size === 0) {
      skipped.push({ path, reason: "empty" });
      continue;
    }
    if (info.size > MAX_FILE_CHARS) {
      skipped.push({ path, reason: `too large, ${info.size} bytes` });
      continue;
    }
    if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|mp[34]|mov|lock)$/i.test(path)) {
      skipped.push({ path, reason: "binary or lock file" });
      continue;
    }
    if (files.length >= cap) {
      skipped.push({ path, reason: `over the ${cap} file cap; narrow the pattern` });
      continue;
    }
    files.push(path);
  }
  return { files, skipped };
}

// jev/lib/levels/level10/assemble.ts
var tokensOf = (text) => Math.ceil(text.length / 4);
var STATE_TOKEN_BUDGET = LIMITS.TOTAL_TOKEN_BUDGET - 4000;
var MAX_FILES_PER_CALL = 20;
var MAX_OWN_STATE_CHARS = 8000;

class AskStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "AskStateError";
  }
}
var fmtK = (t) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t)) + " tokens";
function suggestSplit(parts, budget) {
  const bins = [];
  for (const part of [...parts].sort((a, b) => b.tokens - a.tokens)) {
    const bin = bins.find((b) => b.total + part.tokens <= budget);
    if (bin) {
      bin.items.push(part);
      bin.total += part.tokens;
    } else
      bins.push({ total: part.tokens, items: [part] });
  }
  return bins.map((b) => b.items);
}
function describe(parts) {
  const files = parts.filter((p) => p.kind === "file").map((p) => p.name);
  const bits = [];
  if (parts.some((p) => p.kind === "own"))
    bits.push("your state");
  if (files.length)
    bits.push(`paths [${files.join(", ")}]`);
  if (parts.some((p) => p.kind === "output"))
    bits.push("the command");
  const total = parts.reduce((n, p) => n + p.tokens, 0);
  return `${bits.join(" + ")} (${fmtK(total)})`;
}
function overflowMessage(parts, budget) {
  const total = parts.reduce((n, p) => n + p.tokens, 0);
  const groups = suggestSplit(parts, budget);
  const oversize = parts.filter((p) => p.tokens > budget);
  const lines = [
    `ask_jev: the state is ${fmtK(total)}, the limit per call is ${fmtK(budget)}.`,
    `Parts: ${[...parts].sort((a, b) => b.tokens - a.tokens).map((p) => `${p.name} ${fmtK(p.tokens)}`).join(", ")}.`
  ];
  if (oversize.length) {
    lines.push(`Too large for any single call: ${oversize.map((p) => p.name).join(", ")}. Narrow it (a smaller file, a command with less output) or leave it out.`);
  }
  if (groups.length > 1 && !oversize.length) {
    lines.push(`Split into ${groups.length} calls with the same questions_json: ${groups.map((g, i) => `call ${i + 1}: ${describe(g)}`).join("; ")}.`);
  }
  return lines.join(" ");
}
async function assembleState(input, cwd, run, fs) {
  const own = input.state === undefined || input.state === "" ? {} : parseState(input.state);
  const base = typeof own === "string" ? { text: own } : Array.isArray(own) ? { items: own } : { ...own };
  const ownText = JSON.stringify(base);
  if (ownText.length > MAX_OWN_STATE_CHARS) {
    throw new AskStateError(`ask_jev: your state is ${fmtK(tokensOf(ownText))}; the limit for your own state is ${fmtK(tokensOf("x".repeat(MAX_OWN_STATE_CHARS)))}. Do not paste file contents or command output; pass paths or command instead and code fetches them.`);
  }
  const parts = [];
  if (Object.keys(base).length)
    parts.push({ name: "your state", tokens: tokensOf(ownText), kind: "own" });
  const skipped = [];
  const files = {};
  if (input.paths?.length) {
    const expanded = await expandPatterns(input.paths, cwd, true, fs);
    const pruned = await pruneFiles(expanded, cwd, MAX_FILES_PER_CALL + 1, fs);
    skipped.push(...pruned.skipped);
    if (pruned.files.length > MAX_FILES_PER_CALL) {
      throw new AskStateError(`ask_jev: paths expanded to more than ${MAX_FILES_PER_CALL} files. This tool judges one situation in one call. For many files use ask_jev_files, one call per file in parallel, or narrow the paths.`);
    }
    for (const path of pruned.files) {
      try {
        const f = await readFileState(path, cwd, fs);
        files[path] = f.content;
        parts.push({ name: path, tokens: tokensOf(f.content), kind: "file" });
      } catch (err) {
        skipped.push({ path, reason: err instanceof FileStateError ? err.message : String(err?.message ?? err) });
      }
    }
  }
  let output = null;
  if (input.command?.trim()) {
    output = await run(input.command.trim(), cwd);
    parts.push({ name: `output of \`${output.command}\``, tokens: tokensOf(output.stdout + output.stderr), kind: "output" });
  }
  if (!parts.length)
    throw new AskStateError("ask_jev: nothing to judge. Pass state, paths, or command.");
  const total = parts.reduce((n, p) => n + p.tokens, 0);
  if (total > STATE_TOKEN_BUDGET)
    throw new AskStateError(overflowMessage(parts, STATE_TOKEN_BUDGET));
  const state = { ...base };
  if (Object.keys(files).length)
    state.files = files;
  if (output)
    state.output = output;
  return {
    state,
    summary: {
      own_fields: Object.keys(base),
      files: Object.keys(files),
      output: output ? `${output.command}, exit ${output.exit_code}, ${fmtK(tokensOf(output.stdout + output.stderr))}` : null,
      skipped,
      tokens: total
    }
  };
}
// jev/lib/levels/level10/tool-description.ts
var ASK_JEV_DESCRIPTION = [
  "Ask Jev, a fast decision model, typed questions about one situation: files, a command's output, your own state, or any mix. It answers in about 300 ms for a fraction of a cent, and each answer is a number you can branch on, not prose. Use it whenever a judgment call would otherwise cost you a long think.",
  "",
  'Do not paste content you already have; that costs output tokens. Pass paths and code reads the files into files["path"]. Pass command and code runs it in the repo and puts the result into output {command, exit_code, stdout, stderr}. Use state for what only you can say: a customer report, your plan, a line of context. Plain text or a JSON object as a string; your field names are kept as is. You can combine all three, and you never receive the files or the output, only the answers.',
  "",
  "One call judges one situation: up to 20 files and about 60k tokens in total. Over that the call is refused with a message naming the parts and a split that fits; make two calls with the same questions_json. For many files judged separately use ask_jev_files instead.",
  "",
  "questions_json: a JSON object keyed by question id. Three types:",
  '  noul   {"type":"noul","instructions":"Is `output` a real failure rather than a flaky one?","criteria":{"true":"...","false":"..."}}  -> { noul: 0..1 }',
  '  choice {"type":"choice","instructions":"What kind of failure is `output`?","criteria":{"bug_in_code":"...","wrong_test":"...","environment":"...","other":"..."}}  -> { choice, confidence, probabilities }',
  '  score  {"type":"score","instructions":"How risky is `diff`?","criteria":["Isolated, tested","Some callers","Security sensitive, no tests"]}  -> { score, confidence, legend }',
  "",
  `Write questions against files["path"], output, or your own field names. Good uses: run the tests through command and classify the failure before choosing a fix, put git diff through command and score its risk before committing, pass the customer's words as state with the relevant paths and decide bug or expected, decide whether a request is clear enough to plan.`,
  "Ask every question you might need in one call; they share the state. Always give a choice an `other` option. Describe situations, not degrees.",
  "Not for: exact lookups, counting, math, or anything a grep answers. Not a substitute for reading code you need to edit."
].join(`
`);
// jev/lib/levels/level10/spend.ts
var JEV_INPUT_USD_PER_M = 0.042;
var emptyLedger = () => ({ calls: 0, questions: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
function record(ledger, usage, questionCount) {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  return {
    calls: ledger.calls + 1,
    questions: ledger.questions + questionCount,
    inputTokens: ledger.inputTokens + input,
    outputTokens: ledger.outputTokens + output,
    usd: ledger.usd + (usage?.cost ?? input * JEV_INPUT_USD_PER_M / 1e6)
  };
}
function summarize(ledger, agentUsd) {
  if (ledger.calls === 0)
    return "No Jev calls this session.";
  const ratio = ledger.usd > 0 ? Math.round(agentUsd / ledger.usd) : 0;
  return `${ledger.calls} Jev call${ledger.calls === 1 ? "" : "s"}, ${ledger.questions} question${ledger.questions === 1 ? "" : "s"}, $${ledger.usd.toFixed(6)}` + (ratio ? `, the agent's own spend was ${ratio}x that` : "");
}
// jev/lib/host/fs.ts
var GLOB_CHARS2 = /[*?[\]{}]/;
function globToRegExp(pattern) {
  let out = "";
  for (let i = 0;i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*")
      out += "[^/]*";
    else if (c === "?")
      out += "[^/]";
    else if (c === "{")
      out += "(?:";
    else if (c === "}")
      out += ")";
    else if (c === "," && out.lastIndexOf("(?:") > out.lastIndexOf(")"))
      out += "|";
    else if (c === "[") {
      const end = pattern.indexOf("]", i);
      out += end > i ? pattern.slice(i, end + 1) : "\\[";
      if (end > i)
        i = end;
    } else
      out += c.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}
async function glob($, pattern, cwd) {
  const segments = pattern.split("/");
  const firstGlob = segments.findIndex((s) => GLOB_CHARS2.test(s));
  const base = segments.slice(0, firstGlob).join("/");
  const deep = segments.slice(firstGlob).some((s) => s.includes("**"));
  const depth = segments.length - firstGlob;
  const match = globToRegExp(pattern);
  const out = [];
  const walk = async (dir, level) => {
    const full = dir.startsWith("/") ? dir : `${cwd}/${dir}`;
    const entries = await $.fs.list(full).catch(() => []);
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (match.test(path))
        out.push(path);
      if (entry.kind === "dir" && !SKIP_DIRS.has(entry.name) && (deep || level + 1 < depth))
        await walk(path, level + 1);
    }
  };
  await walk(base, 0);
  return out;
}
function hostFs($) {
  return {
    async stat(path) {
      const info = await $.fs.stat(path);
      return { isFile: info.kind === "file", size: info.size };
    },
    readText: (path) => $.fs.read(path),
    glob: (pattern, cwd) => glob($, pattern, cwd)
  };
}

// jev/lib/host/tool.ts
var ok = (payload) => ({ result: JSON.stringify(payload, null, 2) });
var fail = (message) => ({ deny: message });
var errorText = (err) => err instanceof Error ? err.message : String(err);

// jev/lib/core/wire.ts
var ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/alpha/decisions",
  typesafe: "https://api.typesafe.ai/v1/systemone"
};
var DEFAULT_MODELS = {
  openrouter: "~typesafe/jev-latest",
  typesafe: "jev-latest"
};
var KEY_ENV = {
  openrouter: "OPENROUTER_API_KEY",
  typesafe: "TYPESAFE_API_KEY"
};
var RETRY_STATUSES = new Set([429, 502, 503, 529]);
var MAX_ATTEMPTS = 3;

class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
}
var isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var isNonnegative = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
var isUnit = (x) => isNonnegative(x) && x <= 1;
var isTokenCount = (x) => isNonnegative(x) && Number.isSafeInteger(x);
function validateResponse(response, questions) {
  if (!isObject(response) || !isObject(response.answers) || typeof response.model !== "string" || !response.model.trim()) {
    throw new ContractError("Invalid response envelope: expected model and answers.");
  }
  if (!isObject(response.usage) || !isTokenCount(response.usage.input_tokens) || !isTokenCount(response.usage.output_tokens)) {
    throw new ContractError("Invalid response usage: expected nonnegative integer input_tokens and output_tokens.");
  }
  for (const [id, q] of Object.entries(questions)) {
    const answer = response.answers[id];
    if (!Object.hasOwn(response.answers, id) || !isObject(answer) || answer.type !== q.type) {
      throw new ContractError(`Missing or mismatched answer: ${id}`);
    }
    if (q.type === "noul") {
      if (!isUnit(answer.noul))
        throw new ContractError(`Invalid noul: ${id}`);
      continue;
    }
    if (!isUnit(answer.confidence) || !isObject(answer.probabilities)) {
      throw new ContractError(`Invalid distribution: ${id}`);
    }
    const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    const probs = answer.probabilities;
    if (Object.keys(probs).length !== keys.length || !keys.every((k) => Object.hasOwn(probs, k) && isUnit(probs[k]))) {
      throw new ContractError(`Distribution keys must match the declared criteria: ${id}`);
    }
    const sum = keys.reduce((acc, k) => acc + probs[k], 0);
    if (Math.abs(sum - 1) > 0.025)
      throw new ContractError(`Distribution does not sum to one: ${id} (${sum})`);
    if (q.type === "choice" && (typeof answer.choice !== "string" || !keys.includes(answer.choice))) {
      throw new ContractError(`Undeclared choice returned: ${id}`);
    }
    if (q.type === "score") {
      if (!isNonnegative(answer.score) || answer.score > keys.length - 1) {
        throw new ContractError(`Score out of range: ${id}`);
      }
      const legend = answer.legend;
      if (!isObject(legend) || Object.keys(legend).length !== keys.length || !keys.every((k, i) => Object.hasOwn(legend, k) && legend[k] === q.criteria[i])) {
        throw new ContractError(`Score legend must match the declared criteria: ${id}`);
      }
    }
  }
}

// jev/lib/host/jev.ts
async function selectProvider($) {
  const backend = (await $.env.get("JEV_BACKEND"))?.trim();
  const typesafe = (await $.env.get("TYPESAFE_API_KEY"))?.trim();
  const openrouter = (await $.env.get("OPENROUTER_API_KEY"))?.trim();
  const keys = { typesafe, openrouter };
  if (backend === "typesafe" || backend === "openrouter") {
    const key = keys[backend];
    if (!key)
      throw new Error(`Provider "${backend}" needs ${KEY_ENV[backend]}.`);
    return { provider: backend, key };
  }
  if (backend)
    throw new Error(`Unknown JEV backend "${backend}"; use openrouter or typesafe.`);
  if (typesafe)
    return { provider: "typesafe", key: typesafe };
  if (openrouter)
    return { provider: "openrouter", key: openrouter };
  throw new Error("No Jev credentials: set TYPESAFE_API_KEY or OPENROUTER_API_KEY.");
}
async function systemOne($, state, questions) {
  const { provider, key } = await selectProvider($);
  const body = JSON.stringify({ model: DEFAULT_MODELS[provider], state, questions });
  for (let attempt = 1;; attempt++) {
    const res = await $.http.fetch(ENDPOINTS[provider], {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body
    });
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      await $.clock.sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok)
      throw new Error(`${provider} HTTP ${res.status}.${res.status === 401 ? ` Check the ${KEY_ENV[provider]} key.` : ""}`);
    const response = JSON.parse(res.text);
    validateResponse(response, questions);
    return response;
  }
}
var brief = (a) => a.type === "noul" ? a.noul.toFixed(2) : a.type === "choice" ? `${a.choice} ${a.confidence.toFixed(2)}` : `${a.score.toFixed(2)}`;
var EVENT_PREFIX = "jev-event ";
function emit($, event) {
  $.ui.log(EVENT_PREFIX + JSON.stringify(event), { to: "debug" });
}
class JevPausedError extends Error {
  constructor() {
    super("Jev is paused; resume it from the jev HUD");
    this.name = "JevPausedError";
  }
}
async function decide($, source, state, questions) {
  validateRequest({ state, questions });
  if (await $.env.get("JEV_PAUSED") === "1")
    throw new JevPausedError;
  const started = await $.clock.now();
  emit($, { kind: "start", source });
  try {
    const result = await systemOne($, state, questions);
    const ms = await $.clock.now() - started;
    const usage = result.usage;
    const answers = Object.entries(result.answers).map(([id, a]) => `${id} ${brief(a)}`).join(", ");
    $.ui.log(`jev · ${source} · ${answers} · ${ms} ms`);
    emit($, { kind: "done", source, ms, usd: usage.cost ?? usage.input_tokens * JEV_INPUT_USD_PER_M / 1e6, brief: answers, isError: false });
    return { answers: result.answers, usage, model: result.model, ms };
  } catch (err) {
    const ms = await $.clock.now() - started;
    emit($, { kind: "done", source, ms, usd: 0, brief: err instanceof Error ? err.message : String(err), isError: true });
    throw err;
  }
}

// jev/ask/src/register.ts
var NUDGE = "You have ask_jev. When you need a classification, a risk score, or a yes or no with a confidence, " + "prefer it over reasoning it out yourself. Give it paths or a command instead of pasting content. " + "It answers in 300 ms and costs almost nothing.";
var COMMAND_TIMEOUT_MS = 60000;
var MAX_OUTPUT_CHARS = 200000;
async function runCommand($, command, cwd) {
  const r = await $.process.run(["sh", "-c", command], { cwd, env: { CI: "1" }, timeoutMs: COMMAND_TIMEOUT_MS }).catch((err) => ({ exitCode: null, stdout: "", stderr: errorText(err) }));
  return { command, exit_code: r.exitCode, stdout: r.stdout.slice(0, MAX_OUTPUT_CHARS), stderr: r.stderr.slice(0, MAX_OUTPUT_CHARS) };
}
function register(on) {
  let ledger = emptyLedger();
  on("session.start", async ($, e, next) => {
    await $.tool.register({
      name: "ask_jev",
      description: ASK_JEV_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: "object",
        properties: {
          questions_json: { type: "string", description: "The question block, a JSON object keyed by question id" },
          state: { type: "string", description: "Your own state: plain text, or a JSON object as a string. Short. Not for pasting files or output." },
          paths: { type: "array", items: { type: "string" }, description: 'Files or globs for code to read into files["path"]. Up to 20 files.' },
          command: { type: "string", description: "A command for code to run in the repo; its result goes into output. Runs through the bash gate." }
        },
        required: ["questions_json"]
      }
    });
    return next(e);
  });
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    if (composed.sections.some((s) => s.text.includes("ask_jev")))
      return composed;
    return { sections: [...composed.sections, { id: "ask-jev:nudge", text: NUDGE, scope: "session" }] };
  });
  on("tool.call", { tool: "mcp__ask-jev__ask_jev" }, async ($, e) => {
    const p = e;
    try {
      const questions = parseQuestions(p.questions_json);
      const run = async (command, cwd) => {
        const gate = await gateBashCommand(command, cwd, (s, q) => decide($, "ask_jev command gate", s, q));
        if (gate.block)
          throw new AskStateError(`ask_jev: the command was refused by the bash gate: ${gate.reason}. ${BLOCK_NOTICE} ask_jev commands should only read.`);
        return runCommand($, command, cwd);
      };
      const { state, summary } = await assembleState({ state: p.state, paths: p.paths, command: p.command }, await $.session.cwd(), run, hostFs($));
      const result = await decide($, "ask_jev", state, questions);
      ledger = record(ledger, result.usage, Object.keys(result.answers).length);
      return ok({ answers: result.answers, state_summary: summary, usage: result.usage, model: result.model });
    } catch (err) {
      return fail(err instanceof AskStateError ? err.message : `ask_jev error: ${errorText(err)}`);
    }
  });
  on("turn.complete", async ($, e, next) => {
    const done = await next(e);
    if (ledger.calls)
      $.ui.status(`jev · ${summarize(ledger, (await $.session.usage()).cost?.usd ?? 0)}`);
    return done;
  });
}
export {
  register
};
