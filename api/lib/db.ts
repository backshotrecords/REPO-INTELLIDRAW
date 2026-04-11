import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

// Server-side Supabase client (used in API routes)
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize database tables if they don't exist
export async function initDatabase() {
  // Create users table
  await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        api_key_encrypted TEXT,
        active_model_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  }).catch(() => {
    // Table may already exist, that's fine
  });

  // Create ai_models table
  await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS ai_models (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        label TEXT,
        added_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  }).catch(() => {});

  // Create canvases table
  await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS canvases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'Untitled Canvas',
        mermaid_code TEXT NOT NULL DEFAULT 'flowchart TD\n    A[Start]',
        chat_history JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  }).catch(() => {});
}
