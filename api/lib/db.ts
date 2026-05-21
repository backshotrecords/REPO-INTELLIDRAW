import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

// Server-side Supabase client (used in API routes)
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize database tables if they don't exist
export async function initDatabase() {
  // Create users table
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          api_key_encrypted TEXT,
          api_key_source TEXT NOT NULL DEFAULT 'user',
          api_key_updated_at TIMESTAMPTZ,
          api_key_managed_by UUID REFERENCES users(id) ON DELETE SET NULL,
          active_model_id UUID,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `,
    });
  } catch {
    // Table may already exist, that's fine
  }

  // Create ai_models table
  try {
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
    });
  } catch {
    // Table may already exist
  }

  // Create canvases table
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS canvases (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'Untitled Canvas',
          mermaid_code TEXT NOT NULL DEFAULT 'flowchart TD\\n    A[Start]',
          chat_history JSONB DEFAULT '[]'::jsonb,
          is_public BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `,
    });
  } catch {
    // Table may already exist
  }

  // Migration: add is_public column to existing canvases table
  try {
    await supabase.rpc("exec_sql", {
      sql: `ALTER TABLE canvases ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;`,
    });
  } catch {
    // Column may already exist
  }

  // Migration: add is_banned column to users table
  try {
    await supabase.rpc("exec_sql", {
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;`,
    });
  } catch {
    // Column may already exist
  }

  // Migration: track whether API keys are user-owned or admin-managed
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_source TEXT;
        UPDATE users SET api_key_source = 'user' WHERE api_key_source IS NULL;
        ALTER TABLE users ALTER COLUMN api_key_source SET DEFAULT 'user';
        ALTER TABLE users ALTER COLUMN api_key_source SET NOT NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_updated_at TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_managed_by UUID REFERENCES users(id) ON DELETE SET NULL;
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'users_api_key_source_check'
          ) THEN
            ALTER TABLE users ADD CONSTRAINT users_api_key_source_check
            CHECK (api_key_source IN ('user', 'admin'));
          END IF;
        END $$;
      `,
    });
  } catch {
    // Columns/constraint may already exist
  }
}
