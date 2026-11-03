// Frame-grid time math for RaceGOW/IGOW UTT submissions.
// Times snap to whole frames before any difference is taken, matching
// racegow_format.py — the numbers shown here equal the burned timer's.

// Round like Python's round(): half to even, not half up. Python and JS
// disagree on exact .5 products (e.g. 11.35 * 30 == 340.5 -> py 340, js 341),
// and the ffmpeg script's frame grid is the authority.
function pyRound(x) {
  const r = Math.round(x);
  if (Math.abs(Math.abs(x) % 1 - 0.5) < 1e-9) {
    const f = Math.floor(x);
    return (f % 2 === 0) ? f : f + 1;
  }
  return r;
}

export function quantizeTime(t, fps) {
  return pyRound(t * fps) / fps;
}

const LABELS = { start: "start", l2: "lap 2", l3: "lap 3", end: "end" };
const KEYS = ["start", "l2", "l3", "end"];

export function computeResults(marks, fps) {
  const missing = KEYS.filter((k) => !Number.isFinite(marks[k]));
  if (missing.length > 0) {
    return { errors: ["marks not set: " + missing.map((k) => LABELS[k]).join(", ")] };
  }
  const q = KEYS.map((k) => quantizeTime(marks[k], fps));
  for (let i = 1; i < q.length; i++) {
    if (q[i] <= q[i - 1]) {
      return {
        errors: [
          `marks out of order: ${LABELS[KEYS[i]]} must be after ${LABELS[KEYS[i - 1]]}`,
        ],
      };
    }
  }
  const splits = [q[1] - q[0], q[2] - q[1], q[3] - q[2]];
  return { errors: [], splits, total: q[3] - q[0], hotLap: Math.min(...splits) };
}

const VALID_OS = new Set(["posix", "macos", "windows"]);

// POSIX-safe single-quote escaping: the command gets pasted into a shell, and
// a deep link can carry an arbitrary filename, so quote every filename and
// escape embedded apostrophes as '\'' (copilot review: command injection).
// On Windows, cmd.exe treats single quotes as literal characters, so the
// windows form uses double quotes instead — '"' is not a legal NTFS filename
// character, so any filename that needs one is invalid on the target anyway.
export function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function buildCommand(marks, fps, filename, os = "posix") {
  const name = filename && filename.trim() ? filename.trim() : "clip.mp4";
  const q = (k) => quantizeTime(marks[k], fps).toFixed(5);
  const times = `--start ${q("start")} --laps ${q("l2")} ${q("l3")} --end ${q("end")}`;
  if (os === "windows") {
    // Displayed name is pasted into cmd/PowerShell inside double quotes — strip
    // the chars that would break out or interpolate: '"' (closes the quote),
    // '$' and backtick (PowerShell interpolation), '%' (cmd env expansion).
    // None are legal NTFS filename characters anyway, except '%'/'$', which are
    // legal but pathological in names.
    const winName = name.replace(/["$`%]/g, "");
    return `python racegow_format.py "${winName}" ${times}`;
  }
  return `racegow-format ${shellQuote(name)} ${times}`;
}

// Parse a command produced by buildCommand back into filename + marks.
// Accepts the current single-quoted form (with \'\' escapes) and the legacy
// double-quoted form. Number tokens must be strict decimals.
const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const CMD_RE = new RegExp(
  String.raw`^\s*(?:racegow-format|python[\d.]*\s+(?:[\w~.-]+[\\/])*racegow_format\.py)` +
    String.raw`\s+(?:'((?:[^']|'\\'')*)'|"([^"]+)")` +
    String.raw`\s+--start\s+` + NUM +
    String.raw`\s+--laps\s+` + NUM + String.raw`\s+` + NUM +
    String.raw`\s+--end\s+` + NUM + String.raw`\s*$`,
);

export function parseCommand(text) {
  const m = text.match(CMD_RE);
  if (!m) return null;
  const filename = m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2];
  const nums = m.slice(3).map(parseFloat);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return {
    filename,
    marks: { start: nums[0], l2: nums[1], l3: nums[2], end: nums[3] },
  };
}

// URL-hash deep-link state: everything restorable without the video.
export function encodeState(marks, fps, filename, os) {
  const p = new URLSearchParams();
  if (Number.isFinite(fps)) p.set("fps", fps);
  if (filename) p.set("file", filename);
  if (os && VALID_OS.has(os)) p.set("os", os);
  for (const k of KEYS) {
    if (Number.isFinite(marks[k])) p.set(k, marks[k].toFixed(5));
  }
  return p.toString();
}

export function decodeState(hash) {
  const s = (hash || "").replace(/^#/, "");
  if (!s) return null;
  const p = new URLSearchParams(s);
  // Strict numerals only: parseFloat swallows trailing junk ("1.2junk" -> 1.2),
  // so validate the whole token before accepting it (copilot review).
  const num = (k) => {
    const raw = p.get(k);
    if (raw === null) return { present: false, ok: true, value: null };
    if (!/^\d+(\.\d+)?$/.test(raw)) return { present: true, ok: false, value: null };
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return { present: true, ok: false, value: null };
    return { present: true, ok: true, value };
  };
  const fpsTok = num("fps");
  const toks = ["start", "l2", "l3", "end"].map(num);
  const meaningful = fpsTok.present || p.get("file") || toks.some((t) => t.present);
  if (!meaningful) return null;
  if (!fpsTok.ok || toks.some((t) => !t.ok)) return null;
  // fps must be within the UI's input range so restored state stays renderable
  if (fpsTok.present && (fpsTok.value < 1 || fpsTok.value > 240)) return null;
  const osTok = p.get("os");
  return {
    fps: fpsTok.present ? fpsTok.value : 30,
    filename: p.get("file") || "",
    os: osTok && VALID_OS.has(osTok) ? osTok : null,
    marks: {
      start: toks[0].value,
      l2: toks[1].value,
      l3: toks[2].value,
      end: toks[3].value,
    },
  };
}
