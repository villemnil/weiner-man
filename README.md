# Weiner Man

A wobbly little tilting toy for the browser: tilt the yellow plate and get the Weiner Man to
stand in the hole in the middle. He is a hollow capsule with a loose steel ball inside, so he
tumbles end over end instead of rolling.

## Play

- **Desktop:** drag, or use WASD / arrow keys, to tilt the plate. R starts over.
- **Phone:** drag anywhere to tilt.
- **X-ray** (top right) shows the steel ball inside him.

## Run it locally

```bash
npm install
npm run dev
```

`npm test` runs the headless physics tests. Press **T** in the game for the tuning panel.

## How it works

The physics is a small custom rigid-body simulation in `src/physics/` (no physics engine):
the shell and the ball are separate bodies, the ball is constrained to the inside of the shell,
and the plate is an analytic shape the shell collides with. Rendering is Three.js.
