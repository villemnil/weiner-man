# Wiener Man

A wobbly little tilting toy for the browser: tilt the yellow plate and get the Wiener Man to
stand in the hole in the middle. He is a hollow capsule with a loose steel ball inside, so he
tumbles end over end instead of rolling.

## Play

- **Desktop:** drag, or use WASD / arrow keys, to tilt the plate. R starts over.
- **Phone:** drag anywhere to tilt.
- **X-ray** (top right) shows the steel ball inside him.
- A timer runs from the start (or a reset) until he is in the hole; save your time with a name.

## Run it locally

```bash
npm install
npm run dev
```

`npm test` runs the headless physics tests. Press **T** in the game for the tuning panel.

## Online scoreboard

Best times are saved on each player's own device until a Supabase key is set in `src/config.ts`.
The table lives in `supabase/migrations/`; with Supabase's GitHub integration it is applied to the
linked project when `main` is pushed (or paste that SQL into the project's SQL editor).

The anon / publishable key is meant to be public. The table's rules only let visitors read
scores and add new ones; nobody can edit or delete. Times are sent by the browser, so a
determined friend could fake one. Fine for a game between friends, not for prizes.

## How it works

The physics is a small custom rigid-body simulation in `src/physics/` (no physics engine):
the shell and the ball are separate bodies, the ball is constrained to the inside of the shell,
and the plate is an analytic shape the shell collides with. Rendering is Three.js; the buttons
and other controls are [Jelly UI](https://jelly-ui.com) web components, loaded from its hosted script.
