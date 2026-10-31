import { calculateRate } from "./rate-calculator.js";

/**
 * Sample the stick position at time t from a timeline.
 *
 * The timeline is an ascending list of {t, stick} points. The stick is
 * linearly interpolated between adjacent points; before the first point it
 * holds the first stick value, after the last point the last stick value,
 * and an empty timeline reads as zero stick throughout.
 *
 * @param {{t: number, stick: number}[]} timeline - Ascending timeline points
 * @param {number} t - Time in seconds
 * @returns {number} Stick position in -1..1
 */
export function stickAt(timeline, t) {
  if (!timeline || timeline.length === 0) return 0;
  const first = timeline[0];
  if (t <= first.t) return first.stick;
  const last = timeline[timeline.length - 1];
  if (t >= last.t) return last.stick;
  for (let i = 0; i < timeline.length - 1; i++) {
    const a = timeline[i];
    const b = timeline[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.stick;
      return a.stick + (b.stick - a.stick) * ((t - a.t) / span);
    }
  }
  return last.stick;
}

/**
 * Build a scripted stick flick: rise from 0 to peak, hold, fall back to 0.
 *
 * @param {object} [opts] - Flick parameters
 * @param {number} [opts.peak=1] - Peak stick position (-1..1)
 * @param {number} [opts.rise=0.05] - Seconds to ramp from 0 to peak
 * @param {number} [opts.hold=0.3] - Seconds to hold at peak
 * @param {number} [opts.fall=0.05] - Seconds to ramp from peak back to 0
 * @returns {{t: number, stick: number}[]} Four-point stick timeline
 */
export function buildFlickTimeline(opts = {}) {
  const { peak = 1, rise = 0.05, hold = 0.3, fall = 0.05 } = opts;
  return [
    { t: 0, stick: 0 },
    { t: rise, stick: peak },
    { t: rise + hold, stick: peak },
    { t: rise + hold + fall, stick: 0 },
  ];
}

/**
 * Simulate cumulative rotation for one axis over a scripted stick timeline.
 *
 * Forward Euler integration: at each step the stick is sampled from the
 * timeline, the instantaneous rate comes from the profile's rate curve
 * (dispatched by ratesType), and the angle accumulates rate * dt. The series
 * records the state at every step including t = 0, so its length is
 * round(duration / dt) + 1 and the final entry's angle equals the returned
 * total.
 *
 * @param {object} profile - App profile shape: ratesType plus per-axis
 *   rates ({ roll|pitch|yaw: { center, maxRate, expo } }) and throttle
 * @param {"roll"|"pitch"|"yaw"} axis - Axis to simulate
 * @param {{t: number, stick: number}[]} timeline - Ascending stick timeline
 * @param {object} [opts] - Simulation options
 * @param {number} [opts.dt=1/120] - Step size in seconds
 * @param {number} [opts.duration] - Seconds to simulate; defaults to the
 *   timeline's last t plus 0.5
 * @returns {{angle: number, series: Array<{t: number, stick: number, rate: number, angle: number}>}}
 *   Total signed rotation in degrees plus one sample per step
 */
export function simulateRotation(profile, axis, timeline, opts = {}) {
  const dt = opts.dt ?? 1 / 120;
  const lastT = timeline.length > 0 ? timeline[timeline.length - 1].t : 0;
  const duration = opts.duration ?? lastT + 0.5;
  const steps = Math.round(duration / dt);
  const { center, maxRate, expo } = profile.rates[axis];

  let angle = 0;
  const series = [];
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const stick = stickAt(timeline, t);
    const rate = calculateRate(stick, center, maxRate, expo, profile.ratesType);
    series.push({ t, stick, rate, angle });
    if (i < steps) angle += rate * dt;
  }
  return { angle, series };
}
