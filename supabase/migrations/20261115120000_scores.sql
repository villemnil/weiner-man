-- Wiener Man scoreboard: one row per saved run.
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 14),
  time_ms integer not null check (time_ms between 300 and 3600000),
  created_at timestamptz not null default now()
);

create index if not exists scores_time_idx on public.scores (time_ms);

-- Visitors (the public "anon" role) may read scores and add new ones. Nothing else:
-- no policy exists for update or delete, so row-level security refuses both.
alter table public.scores enable row level security;

grant select, insert on public.scores to anon, authenticated;

drop policy if exists "anyone can read scores" on public.scores;
create policy "anyone can read scores" on public.scores
  for select to anon, authenticated using (true);

drop policy if exists "anyone can add a score" on public.scores;
create policy "anyone can add a score" on public.scores
  for insert to anon, authenticated with check (true);
