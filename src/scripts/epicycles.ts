// The logo as a Fourier series: a chain of spinning circles whose tip traces
// the logo's centre line. Circles are sorted largest first, so cutting the
// series after n of them gives the best drawing n circles can make.
//
// The centre line is one closed stroke with the bowl's radius as the unit and
// y pointing down: up the lower half of the stem, once round the bowl, on up
// to the top of the stem, then all the way back down.

export const SAMPLES = 1024;
export const STROKE = 0.32; // logo stroke width / bowl radius (64 / 200)

export interface Term {
  k: number;
  re: number;
  im: number;
  r: number;
}

// e^(2πi·j/SAMPLES)
const COS = new Float64Array(SAMPLES);
const SIN = new Float64Array(SAMPLES);
for (let j = 0; j < SAMPLES; j++) {
  COS[j] = Math.cos((2 * Math.PI * j) / SAMPLES);
  SIN[j] = Math.sin((2 * Math.PI * j) / SAMPLES);
}

function centreLine(s: number): [number, number] {
  if (s < 1) return [1, 1 - s];
  s -= 1;
  if (s < 2 * Math.PI) return [Math.cos(-s), Math.sin(-s)];
  s -= 2 * Math.PI;
  if (s < 1) return [1, -s];
  return [1, s - 2];
}

const wrap = (k: number) => ((k % SAMPLES) + SAMPLES) % SAMPLES;

/** The fixed centre (k = 0) first, then the `max` largest circles. */
export function logoSeries(max: number): Term[] {
  const length = 2 * Math.PI + 4;
  const xs = new Float64Array(SAMPLES);
  const ys = new Float64Array(SAMPLES);
  for (let n = 0; n < SAMPLES; n++) [xs[n], ys[n]] = centreLine((n / SAMPLES) * length);

  const terms: Term[] = [];
  for (let k = -SAMPLES / 2; k < SAMPLES / 2; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0, j = 0, step = wrap(k); n < SAMPLES; n++, j = (j + step) % SAMPLES) {
      re += xs[n] * COS[j] + ys[n] * SIN[j];
      im += ys[n] * COS[j] - xs[n] * SIN[j];
    }
    re /= SAMPLES;
    im /= SAMPLES;
    terms.push({ k, re, im, r: Math.hypot(re, im) });
  }
  const centre = terms.find((t) => t.k === 0)!;
  const rest = terms.filter((t) => t.k !== 0).sort((p, q) => q.r - p.r);
  return [centre, ...rest.slice(0, max)];
}

/**
 * How much of circle i (from 0) is in when drawing with `count` circles. The
 * count is continuous: 5.5 means the sixth circle is at half size, so the
 * drawing morphs smoothly as circles are added.
 */
export function weight(count: number, i: number) {
  return Math.min(1, Math.max(0, count - i));
}

/** Samples 0..upto of the drawing, as x0, y0, x1, y1, … in `out`. */
export function trace(terms: Term[], count: number, upto: number, out: Float32Array) {
  for (let m = 0; m <= upto; m++) {
    out[2 * m] = terms[0].re;
    out[2 * m + 1] = terms[0].im;
  }
  for (let i = 1; i < terms.length; i++) {
    const w = weight(count, i - 1);
    if (!w) break;
    const re = w * terms[i].re;
    const im = w * terms[i].im;
    const step = wrap(terms[i].k);
    for (let m = 0, j = 0; m <= upto; m++, j = (j + step) % SAMPLES) {
      out[2 * m] += re * COS[j] - im * SIN[j];
      out[2 * m + 1] += re * SIN[j] + im * COS[j];
    }
  }
}
