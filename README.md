# Weiner Man

A wobbly little tilting toy for the browser: tilt the yellow plate and get the Weiner Man to
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

## Online scoreboard (optional)

Out of the box, best times are saved on each player's own device. To give everyone one shared
scoreboard, connect a free [Supabase](https://supabase.com) project:

1. Create a project, open its **SQL editor**, and run:

   ```sql
   create table public.scores (
     id bigint generated always as identity primary key,
     name text not null check (char_length(name) between 1 and 14),
     time_ms integer not null check (time_ms between 300 and 3600000),
     created_at timestamptz not null default now()
   );
   alter table public.scores enable row level security;
   create policy "anyone can read scores" on public.scores for select to anon using (true);
   create policy "anyone can add a score" on public.scores for insert to anon with check (true);
   ```

2. Copy the project's **URL** and **anon public key** (Project settings → API) into `src/config.ts`.

The anon key is meant to be public. The policies above only let visitors read scores and add
new ones; nobody can edit or delete. Times are sent by the browser, so a determined friend could
fake one. Fine for a game between friends, not for prizes.

## How it works

The physics is a small custom rigid-body simulation in `src/physics/` (no physics engine):
the shell and the ball are separate bodies, the ball is constrained to the inside of the shell,
and the plate is an analytic shape the shell collides with. Rendering is Three.js; the buttons
and other controls are [Jelly UI](https://jelly-ui.com) web components, loaded from its hosted script.
