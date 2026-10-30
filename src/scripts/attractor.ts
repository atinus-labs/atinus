// Clifford attractor:  x′ = sin(a·y) + c·cos(a·x),  y′ = sin(b·x) + d·cos(b·y).
//
// Drawn on the GPU without keeping any state between frames: each vertex picks
// a fresh random point, runs the map ITER times (which is plenty to land on the
// attractor) and adds one pixel to a half-float density buffer. That buffer
// fades a little every frame, so the picture builds up, and the display pass
// tone-maps density to ink. Each lit pixel should average about HITS hits.

const CENTER = [-1.8, 1.7, -1.6, -0.9];
const DRIFT = 0.14; // how far a, b, c, d wander on their own
const POINTER = 0.2; // how far the pointer bends a and b
// Every attractor inside that range stays chaotic (checked offline: under 0.5%
// of it collapses to a few points, and only briefly), and fits in this box:
const EXTENT_X = 2.72;
const EXTENT_Y = 2.02;

const ITER = 28;
const HITS = 20;
const MAX_POINTS = 1 << 20;
const MIN_POINTS = 1 << 16;

const POINTS_VS = `#version 300 es
uniform vec4 u_p;
uniform uint u_frame;
uniform vec2 u_scale;
uniform vec2 u_offset;

uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16; return x;
}

void main() {
  uint id = uint(gl_VertexID) * 2u + u_frame * 0x9e3779b9u;
  vec2 p = vec2(hash(id), hash(id + 1u)) * (4.0 / 4294967295.0) - 2.0;
  for (int i = 0; i < ${ITER}; i++) {
    p = vec2(sin(u_p.x * p.y) + u_p.z * cos(u_p.x * p.x),
             sin(u_p.y * p.x) + u_p.w * cos(u_p.y * p.y));
  }
  gl_Position = vec4(u_offset + p * u_scale, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const POINTS_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(1.0); }`;

// One triangle that covers the screen.
const QUAD_VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FADE_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`;

const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D u_density;
uniform float u_exposure;
out vec4 o;
void main() {
  float h = texelFetch(u_density, ivec2(gl_FragCoord.xy), 0).r;
  float v = pow(1.0 - exp(-h * u_exposure), 0.9);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  vec3 bg = vec3(9.0 / 255.0), ink = vec3(238.0 / 255.0);
  o = vec4(mix(bg, ink, v) + n * min(v * 40.0, 1.0) / 255.0, 1.0);
}`;

export interface Params {
  a: number;
  b: number;
  c: number;
  d: number;
}

interface Options {
  canvas: HTMLCanvasElement;
  /** The attractor is fitted inside this element's box. */
  stage: HTMLElement;
  onParams?: (p: Params) => void;
}

/** Returns false when WebGL2 or float render targets are missing. */
export function startAttractor({ canvas, stage, onParams }: Options): boolean {
  // Software WebGL would crawl; the still image looks the same.
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return false;

  const points = program(gl, POINTS_VS, POINTS_FS);
  const fade = program(gl, QUAD_VS, FADE_FS);
  const show = program(gl, QUAD_VS, SHOW_FS);
  if (!points || !fade || !show) return false;
  const u = {
    p: gl.getUniformLocation(points, 'u_p'),
    frame: gl.getUniformLocation(points, 'u_frame'),
    scale: gl.getUniformLocation(points, 'u_scale'),
    offset: gl.getUniformLocation(points, 'u_offset'),
    density: gl.getUniformLocation(show, 'u_density'),
    exposure: gl.getUniformLocation(show, 'u_exposure'),
  };
  gl.bindVertexArray(gl.createVertexArray());

  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let width = 0;
  let height = 0;
  let maxDpr = 2;
  let lit = 1;
  let count = MAX_POINTS;
  let decay = 0.94;
  let exposure = 1;
  let filled = 0; // frames drawn since the buffer was cleared

  let fitted = '';

  // Called every frame: the stage can move without the canvas changing size
  // (fonts loading, the layout switching on rotation).
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const box = canvas.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(box.height * dpr));
    const key = [w, h, s.left - box.left, s.top - box.top, s.width, s.height].map(Math.round).join();
    if (key === fitted && w === width) return;
    fitted = key;

    if (w !== width || h !== height) {
      width = canvas.width = w;
      height = canvas.height = h;
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA16F, w, h, 0, gl!.RGBA, gl!.HALF_FLOAT, null);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, texture, 0);
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    filled = 0;

    // Fit the attractor's box inside the stage, in clip space.
    const k = Math.min(s.width / (2 * EXTENT_X), s.height / (2 * EXTENT_Y));
    const cx = s.left + s.width / 2 - box.left;
    const cy = s.top + s.height / 2 - box.top;
    gl!.useProgram(points);
    gl!.uniform2f(u.scale, (2 * k) / box.width, (-2 * k) / box.height);
    gl!.uniform2f(u.offset, (2 * cx) / box.width - 1, 1 - (2 * cy) / box.height);

    // Roughly a third of the attractor's box is lit. Aim for a couple of hits
    // per lit pixel per frame.
    lit = 0.35 * (2 * EXTENT_X * k * dpr) * (2 * EXTENT_Y * k * dpr);
    setCount(2 ** Math.round(Math.log2(lit * 2)));
  }

  // With fewer points the buffer fades more slowly, so pixels still collect
  // about HITS hits. Exposure then sets how bright an average lit pixel is.
  function setCount(n: number) {
    count = clamp(n, MIN_POINTS, MAX_POINTS);
    decay = clamp(1 - count / lit / HITS, 0.94, 0.99);
    exposure = (0.7 * lit * (1 - decay)) / count;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let frame = 0;
  let time = 0;
  let last = 0;
  let raf = 0;
  let visible = true;
  let slow = 0;
  let lastReport = 0;

  function params(): Params {
    const t = reduced.matches ? 0 : time;
    return {
      a: CENTER[0] + DRIFT * Math.sin(t * 0.142) + POINTER * pointer.x,
      b: CENTER[1] + DRIFT * Math.sin(t * 0.106 + 1.3) + POINTER * pointer.y,
      c: CENTER[2] + DRIFT * 0.85 * Math.sin(t * 0.074 + 2.1),
      d: CENTER[3] + DRIFT * 0.85 * Math.sin(t * 0.058 + 0.4),
    };
  }

  function draw(now: number) {
    raf = 0;
    // Save the GPU for the intro (Intro.astro) while it covers the page.
    const html = document.documentElement;
    if (html.classList.contains('intro') && !html.classList.contains('opening')) {
      last = 0;
      raf = requestAnimationFrame(draw);
      return;
    }
    const elapsed = last ? (now - last) / 1000 : 0;
    const dt = Math.min(elapsed, 0.1);
    last = now;
    time += dt;
    if (!reduced.matches) {
      const ease = 1 - Math.exp(-dt * 2.5);
      pointer.x += (pointer.tx - pointer.x) * ease;
      pointer.y += (pointer.ty - pointer.y) * ease;
    }
    // Cut the work if the device can't keep up: after a couple of seconds
    // under ~22fps (phones that cap at 30fps to save battery stay above that),
    // or right away when frames crawl. Drop to 1x pixels first, then points.
    slow = elapsed > 0.045 ? slow + 1 : Math.max(0, slow - 1);
    const crawling = elapsed > 0.1 && frame > 3;
    if (slow > 45 || crawling) {
      slow = 0;
      if (maxDpr > 1 && (window.devicePixelRatio || 1) > 1) {
        maxDpr = 1;
        width = 0;
      } else {
        setCount(count / (crawling ? 2 ** Math.ceil(Math.log2(elapsed / 0.03)) : 2));
      }
    }
    resize();
    const p = params();

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.viewport(0, 0, width, height);
    gl!.enable(gl!.BLEND);
    gl!.blendFunc(gl!.ZERO, gl!.CONSTANT_ALPHA);
    gl!.blendColor(0, 0, 0, decay);
    gl!.useProgram(fade);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    gl!.blendFunc(gl!.ONE, gl!.ONE);
    gl!.useProgram(points);
    gl!.uniform4f(u.p, p.a, p.b, p.c, p.d);
    gl!.uniform1ui(u.frame, frame++);
    gl!.drawArrays(gl!.POINTS, 0, count);
    filled++;

    gl!.disable(gl!.BLEND);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.useProgram(show);
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.uniform1i(u.density, 0);
    // Until the buffer has filled up, scale it up to its eventual brightness.
    gl!.uniform1f(u.exposure, exposure / (1 - decay ** Math.min(filled, 2000)));
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    if (onParams && now - lastReport > 100) {
      lastReport = now;
      onParams(p);
    }
    // With reduced motion, stop once the picture has filled in.
    if (visible && (!reduced.matches || frame < 90)) raf = requestAnimationFrame(draw);
  }

  function wake() {
    if (!raf && visible && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(draw);
    }
  }

  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  });
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.tx = pointer.ty = 0;
  });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    wake();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    // Don't count the time spent in a background tab as one long frame.
    last = 0;
    wake();
  });
  const relayout = new ResizeObserver(() => {
    if (reduced.matches) frame = 0;
    wake();
  });
  relayout.observe(canvas);
  relayout.observe(stage);
  canvas.addEventListener('webglcontextlost', () => {
    cancelAnimationFrame(raf);
    canvas.dispatchEvent(new Event('attractor:failed', { bubbles: true }));
  });

  wake();
  return true;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
