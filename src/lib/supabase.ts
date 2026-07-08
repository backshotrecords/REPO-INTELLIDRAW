import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Per-window identity for realtime echo suppression: saves carry this id,
// the server echoes it in the broadcast, and the originating window ignores
// its own events.
export const realtimeClientId = crypto.randomUUID();

let client: SupabaseClient | null = null;
let attempted = false;

// Lazy singleton. Returns null when the Supabase env vars are absent so the
// realtime feature degrades to a no-op without affecting the rest of the app.
export function getSupabaseClient(): SupabaseClient | null {
  if (!attempted) {
    attempted = true;
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (url && anonKey) {
      client = createClient(url, anonKey, { auth: { persistSession: false } });
    }
  }
  return client;
}
