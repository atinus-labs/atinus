// The intro: spinning circles draw the logo, adding circles as they go, until
// the drawing is exact. Then the bowl of the "a" becomes a window onto the
// page and we fly through it.
//
// Runs only while <html> has the `intro` class (set in Base.astro). Removing
// it ends the intro. Adding `opening` wakes the hero's attractor as the bowl
// opens, and `revealing` fades the rest of the hero in.

import { SAMPLES, STROKE, logoSeries, trace, weight } from './epicycles';

const MAX = 256;
const DELAY = 0.15; // seconds, before the pen starts
const DRAW = 1.9; // one trip round the logo while circles are added
const OPEN = 0.5; // circles fade out and the bowl opens
const ZOOM = 0.95; // through the bowl
const HOLE = 1 - STROKE / 2; // inner radius of the bowl

const BG = '#090909';
const INK = '#eeeeee';

const easeInOut = (p: number) => (1 - Math.cos(Math.PI * p)) / 2;
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/** `focus`: the logo sits level with this element's centre, so the bowl opens onto it. */
export function playIntro(root: HTMLElement, focus?: HTMLElement | null) {
  const html = document.documentElement;
  if (!html.classList.contains('intro')) return;

  const finish = () => {
    html.classList.remove('intro', 'opening', 'revealing');
    root.remove();
  };
  if (document.hidden) return finish();

  const canvas = root.querySelector('canvas')!;
  const label = root.querySelector<HTMLElement>('[data-count]')!;
  const ctx = canvas.getContext('2d')!;
  const terms = logoSeries(MAX);
  const curve = new Float32Array(2 * (SAMPLES + 1));
  let start = performance.now();
  let shown = 0;

  // Any input skips straight to the end of the drawing.
  const skip = () => {
    const s = (performance.now() - start) / 1000;
    if (s < DELAY + DRAW) start -= (DELAY + DRAW - s) * 1000;
  };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, skip, { once: true, passive: true });
  }

  function frame(now: number) {
    const s = (now - start) / 1000 - DELAY;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const unit = Math.min(w * 0.17, h * 0.12);
    const cx = w / 2;
    let cy = h / 2;
    if (focus) {
      const box = focus.getBoundingClientRect();
      cy = Math.max(1.4 * unit, (box.top + box.height / 2) * dpr);
    }

    // Where we are: drawing (p), opening (q), zooming (z).
    const p = clamp01(s / DRAW);
    const q = clamp01((s - DRAW) / OPEN);
    const z = clamp01((s - DRAW - OPEN) / ZOOM);
    const t = s < DRAW ? easeInOut(p) : 1 + (s - DRAW) / DRAW;
    const count = Math.min(MAX, 2 ** (8 * p ** 1.6));

    // Fly in until the bowl's inside covers the screen.
    const end = Math.hypot(w, h) / 2 / (HOLE * unit);
    const scale = end ** (z ** 2.2);
    const r = unit * scale;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    if (q > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1 - (1 - q) ** 2;
      ctx.beginPath();
      ctx.arc(cx, cy, HOLE * r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = INK;
    ctx.lineWidth = STROKE * r;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (s < DRAW) {
      // The drawing so far, as the circles currently in play would draw it.
      const upto = Math.floor(t * SAMPLES);
      trace(terms, count, upto, curve);
      for (let m = 0; m <= upto; m++) {
        const x = cx + curve[2 * m] * r;
        const y = cy + curve[2 * m + 1] * r;
        if (m) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    } else {
      // Done: the exact logo, the same shape as the one in the header.
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx + r, cy + r);
    }
    // The ring fades as it grows past the screen's edges.
    ctx.globalAlpha = 1 - z * z;
    if (s > 0) ctx.stroke();
    ctx.globalAlpha = 1;

    // The circles, inverted so they show over the stroke too.
    const fade = 1 - q;
    if (s > 0 && fade > 0) {
      ctx.globalCompositeOperation = 'difference';
      ctx.lineWidth = dpr;
      let x = cx + terms[0].re * r;
      let y = cy + terms[0].im * r;
      const n = s < DRAW ? count : MAX;
      for (let i = 1; i < terms.length; i++) {
        const k = weight(n, i - 1);
        if (!k) break;
        const { re, im, r: size } = terms[i];
        const a = 2 * Math.PI * terms[i].k * t;
        const nx = x + k * (re * Math.cos(a) - im * Math.sin(a)) * r;
        const ny = y + k * (re * Math.sin(a) + im * Math.cos(a)) * r;
        if (k * size * r > dpr) {
          ctx.strokeStyle = `rgba(255,255,255,${0.24 * k * fade})`;
          ctx.beginPath();
          ctx.arc(x, y, k * size * r, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.strokeStyle = `rgba(255,255,255,${0.5 * k * fade})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
        }
        x = nx;
        y = ny;
      }
      ctx.fillStyle = `rgba(255,255,255,${fade})`;
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * dpr, 0, 2 * Math.PI);
      ctx.fill();
    }

    // A loading counter that counts circles.
    const n = Math.round(s < DRAW ? count : MAX);
    if (n !== shown) {
      shown = n;
      label.textContent = `${n} ${n === 1 ? 'circle' : 'circles'}`;
    }
    label.style.top = `${(cy + 1.16 * unit) / dpr + 36}px`;
    label.style.opacity = String(s > 0 ? fade : 0);

    if (q > 0) html.classList.add('opening');
    if (z > 0.3) html.classList.add('revealing');
    if (z >= 1 || !html.classList.contains('intro')) return finish();
    root.style.background = 'transparent'; // the canvas paints it from here
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
