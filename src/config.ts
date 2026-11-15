// Online scoreboard (optional). Leave both empty and best times are kept on this device only.
// To share one scoreboard between everyone you need a Supabase project with the `scores` table
// (supabase/migrations/) and its URL plus anon / publishable (public) key here. Until the key is
// filled in, the game stays on per-device times.
// The anon key is meant to be public; the table's row-level security is what protects it.
export const SUPABASE_URL = 'https://rgaklzcjtqbbwamflwju.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_6ZiMq7qC5-Zry32pNgzTgg_EWZ99AGK';
