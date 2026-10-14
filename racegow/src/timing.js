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

export function buildCommand(marks, fps, filename) {
  const name = filename && filename.trim() ? filename.trim() : "clip.mp4";
  const q = (k) => quantizeTime(marks[k], fps).toFixed(5);
  return `racegow-format "${name}" --start ${q("start")} --laps ${q("l2")} ${q("l3")} --end ${q("end")}`;
}
