import { createClient } from '@supabase/supabase-js';

// ── Supabase connection ───────────────────────────────────────────────────────
// The anon key is PUBLIC by design — it only grants what Row-Level Security
// allows (see supabase/schema.sql). Safe to commit and ship in the browser.
export const SUPABASE_URL      = 'https://idhhdqbxtssiujuwopcq.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkaGhkcWJ4dHNzaXVqdXdvcGNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NDE0MzAsImV4cCI6MjEwMDExNzQzMH0.mDM7RGoLZ2MmcegPJ46PBeetV0gOAg6xRHOqMqOoSdM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,       // keep the login across reloads (localStorage)
    autoRefreshToken: true,
  },
});
