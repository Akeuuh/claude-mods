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
// jev/lib/levels/level09/ask-files.ts
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
async function parallel(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
async function askFiles(patterns, questionsJson, cwd, opts) {
  const questions = parseQuestions(questionsJson);
  const decide = opts.decide;
  const expanded = await expandPatterns(patterns, cwd, opts.recursive ?? false, opts.fs);
  const { files, skipped } = await pruneFiles(expanded, cwd, undefined, opts.fs);
  const results = [];
  await parallel(files, opts.concurrency ?? 16, async (path) => {
    try {
      const state = await readFileState(path, cwd, opts.fs);
      const { answers, usage } = await decide(state, questions);
      const r = { path, answers, usage };
      results.push(r);
      opts.onResult?.(r);
    } catch (err) {
      skipped.push({ path, reason: err instanceof FileStateError ? err.message : `call failed: ${err?.message ?? err}` });
    }
  });
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { results, skipped, calls: results.length };
}
// jev/lib/core/helpers.ts
function choice(instructions, criteria) {
  return { type: "choice", instructions, criteria };
}

// jev/lib/levels/level09/pick-first.ts
function pickQuestion(question, candidates) {
  const criteria = {};
  for (const c of candidates.slice(0, LIMITS.MAX_CHOICE_OPTIONS - 1))
    criteria[c.path] = c.note ?? null;
  criteria.none = "No file in the list fits";
  return { pick: choice(question, criteria) };
}
async function pickFirstFile(question, candidates, decide, floor = 0.3) {
  if (!candidates.length)
    return { path: null, confidence: 0, probabilities: {} };
  const state = { question, files: candidates.map((c) => c.path) };
  const { answers } = await decide(state, pickQuestion(question, candidates));
  const a = answers.pick;
  const path = a.choice === "none" || a.confidence < floor ? null : a.choice;
  return { path, confidence: a.confidence, probabilities: a.probabilities };
}
// jev/lib/levels/level09/question-schema.ts
var QUESTION_SCHEMA = "questions_json is a JSON object keyed by question id. Three types. " + 'noul: {"type":"noul","instructions":"Does `content` ...?","criteria":{"true":"...","false":"..."}} returns a probability of yes. ' + 'choice: {"type":"choice","instructions":"Which ... is `content`?","criteria":{"option_a":"when it applies","option_b":"...","other":"none of the above"}} returns one of your keys plus confidence, up to 255 options. ' + 'score: {"type":"score","instructions":"How ... is `content`?","criteria":["lowest situation","...","highest situation"]} returns a position on your levels, two to ten of them. ' + "Write every question against `content`, the file's text; `path` is also in the state. Ask every question you might need in one block, it is one call per file either way.";
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

// jev/lib/levels/level10/spend.ts
var JEV_INPUT_USD_PER_M = 0.042;

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
async function decide($, source, state, questions) {
  validateRequest({ state, questions });
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

// jev/lib/host/tool.ts
var ok = (payload) => ({ result: JSON.stringify(payload, null, 2) });
var fail = (message) => ({ deny: message });
var errorText = (err) => err instanceof Error ? err.message : String(err);

// jev/ask-files/src/register.ts
var TOOLS = [
  {
    name: "ask_jev_files",
    description: "Ask the same typed questions of many files at once without reading any of them. Code expands globs and directories, " + "drops node_modules, .git, binaries, and files over the budget, caps the list at 255, then makes one Jev call per file in parallel. " + "Returns { results: [{ path, answers }], skipped: [{ path, reason }], calls }. " + QUESTION_SCHEMA + " Use Read when you need a file's code; use Grep for exact strings.",
    inputSchema: {
      type: "object",
      properties: {
        paths_or_globs: { type: "array", items: { type: "string" }, description: 'Files, directories, or globs, relative to the repo, for example ["src/**/*.ts"] or ["src/http"]' },
        questions_json: { type: "string", description: "The question block as a JSON string" },
        recursive: { type: "boolean", description: "For directories: include every file below them. Default false." }
      },
      required: ["paths_or_globs", "questions_json"]
    }
  },
  {
    name: "pick_first_file",
    description: "After ask_jev_files, choose which of a list of files to open first for a goal. One Choice keyed by path, so the pick is always a real file. " + "Returns { path | null, confidence, probabilities }. Pass a short note per path if you have one, for example the answers you already got.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The goal, for example: Which file should I open first to fix the proration bug?" },
        candidates: {
          type: "array",
          items: { type: "object", properties: { path: { type: "string" }, note: { type: "string" } }, required: ["path"] },
          description: "Paths, with an optional one line note each"
        }
      },
      required: ["question", "candidates"]
    }
  }
];
function register(on) {
  on("session.start", async ($, e, next) => {
    for (const tool of TOOLS)
      await $.tool.register({ ...tool, isDeferred: false });
    return next(e);
  });
  on("tool.call", { tool: "mcp__ask-jev-files__ask_jev_files" }, async ($, e) => {
    const p = e;
    try {
      return ok(await askFiles(p.paths_or_globs, p.questions_json, await $.session.cwd(), {
        recursive: p.recursive ?? false,
        decide: (s, q) => decide($, `ask_jev_files ${s.path ?? ""}`, s, q),
        fs: hostFs($)
      }));
    } catch (err) {
      return fail(`error: ${errorText(err)}`);
    }
  });
  on("tool.call", { tool: "mcp__ask-jev-files__pick_first_file" }, async ($, e) => {
    const p = e;
    try {
      return ok(await pickFirstFile(p.question, p.candidates, (s, q) => decide($, "pick_first_file", s, q)));
    } catch (err) {
      return fail(`error: ${errorText(err)}`);
    }
  });
}
export {
  register
};
