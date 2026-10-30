# atinus

The Atinus website: one static page built with Astro.

```sh
pnpm install
pnpm dev      # http://localhost:4321
pnpm build    # static site in dist/, deploy it anywhere
```

Set `SITE_URL` in `.env` to the real domain before building, so the canonical and share-image URLs are right.

## The page

- **Intro:** spinning circles draw the logo from its own Fourier series (`src/scripts/epicycles.ts`), adding circles as they go. Then the bowl of the "a" opens and the view flies through it into the hero (`src/scripts/intro.ts`). It takes about 3.5 seconds, any click or key skips it, and it's left out for people who prefer reduced motion.
- **Hero:** a Clifford attractor drawn live on the GPU (`src/scripts/attractor.ts`). It drifts on its own, and the pointer bends two of its parameters (on touch screens, drag it). Browsers without WebGL2 get a still of the same frame, `public/attractor.webp`.
- **Layout:** wide screens put the words at the left and the attractor at the right. Phones and tall screens stack them. Phones on their side and short windows drop the formula to give the attractor the height. Past laptop size, everything is sized in `rem` and the root font size grows with the screen, so a 4K monitor gets the same page, larger. Screens wider than about 2:1 get the page framed in the middle. Notches and home indicators are kept clear with `env(safe-area-inset-*)`.

If you change the attractor's parameters, re-render the still so it still matches:

```sh
node scripts/render-attractor.mjs /tmp/still.png 1600
magick /tmp/still.png -quality 72 -define webp:method=6 public/attractor.webp
```
