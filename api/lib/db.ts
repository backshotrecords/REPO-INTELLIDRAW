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
          api_key_request_status TEXT NOT NULL DEFAULT 'none',
          api_key_requested_at TIMESTAMPTZ,
          api_key_request_channel TEXT,
          api_key_request_note TEXT,
          active_model_id UUID,
          password_changed_at TIMESTAMPTZ,
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
          manually_archived BOOLEAN NOT NULL DEFAULT FALSE,
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

  // Migration: dashboard project folders and long-term memory flags
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS canvas_projects (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          parent_project_id UUID REFERENCES canvas_projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'Untitled Project',
          description TEXT NOT NULL DEFAULT '',
          accent TEXT NOT NULL DEFAULT 'blue',
          manually_archived BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'canvas_projects_accent_check'
          ) THEN
            ALTER TABLE canvas_projects ADD CONSTRAINT canvas_projects_accent_check
            CHECK (accent IN ('blue', 'cyan', 'green', 'violet', 'amber'));
          END IF;
        END $$;
        ALTER TABLE canvases ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES canvas_projects(id) ON DELETE CASCADE;
        ALTER TABLE canvases ADD COLUMN IF NOT EXISTS manually_archived BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS idx_canvas_projects_user_parent ON canvas_projects(user_id, parent_project_id);
        CREATE INDEX IF NOT EXISTS idx_canvas_projects_user_updated ON canvas_projects(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_canvases_user_project ON canvases(user_id, project_id);
        CREATE INDEX IF NOT EXISTS idx_canvases_user_archive ON canvases(user_id, manually_archived, updated_at DESC);
      `,
    });
  } catch {
    // Table/columns/indexes may already exist
  }

  // Migration: project context cache for lazy folder/canvas inheritance
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        ALTER TABLE canvas_projects
          ADD COLUMN IF NOT EXISTS local_context TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS effective_context TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS context_source_hash TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS context_parent_hash TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS context_status TEXT NOT NULL DEFAULT 'stale',
          ADD COLUMN IF NOT EXISTS context_updated_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS context_error TEXT NOT NULL DEFAULT '';
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'canvas_projects_context_status_check'
          ) THEN
            ALTER TABLE canvas_projects
              ADD CONSTRAINT canvas_projects_context_status_check
              CHECK (context_status IN ('stale', 'refreshing', 'fresh', 'error'));
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS idx_canvas_projects_context_status
          ON canvas_projects(user_id, context_status, updated_at DESC);
      `,
    });
  } catch {
    // Columns/indexes may already exist
  }

  // Migration: project collaboration shares
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS project_shares (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
          shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          shared_with_group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
          access_level TEXT NOT NULL DEFAULT 'view',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, shared_with_group_id)
        );
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'project_shares_access_level_check'
          ) THEN
            ALTER TABLE project_shares
              ADD CONSTRAINT project_shares_access_level_check
              CHECK (access_level IN ('view', 'edit'));
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS idx_project_shares_project ON project_shares(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_shares_group ON project_shares(shared_with_group_id);
      `,
    });
  } catch {
    // Table/indexes/constraint may already exist
  }

  // Migration: dynamic collaboration roles and capability matrix
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS collaboration_roles (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT UNIQUE NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS collaboration_role_capabilities (
          role_id UUID NOT NULL REFERENCES collaboration_roles(id) ON DELETE CASCADE,
          capability TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (role_id, capability)
        );

        ALTER TABLE project_shares
          ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES collaboration_roles(id) ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS idx_project_shares_role
          ON project_shares(role_id);

        CREATE INDEX IF NOT EXISTS idx_collaboration_role_capabilities_role
          ON collaboration_role_capabilities(role_id);

        WITH inserted_role AS (
          INSERT INTO collaboration_roles (name, description, is_system_role)
          VALUES ('Viewer', 'Can inspect shared project folders and canvases.', TRUE)
          ON CONFLICT (name) DO NOTHING
          RETURNING id
        )
        INSERT INTO collaboration_role_capabilities (role_id, capability)
        SELECT inserted_role.id, capability.key
        FROM inserted_role
        CROSS JOIN (VALUES
          ('project.view'),
          ('canvas.view')
        ) AS capability(key)
        ON CONFLICT DO NOTHING;

        WITH inserted_role AS (
          INSERT INTO collaboration_roles (name, description, is_system_role)
          VALUES ('Editor', 'Can create and edit project contents without owner-only management actions.', TRUE)
          ON CONFLICT (name) DO NOTHING
          RETURNING id
        )
        INSERT INTO collaboration_role_capabilities (role_id, capability)
        SELECT inserted_role.id, capability.key
        FROM inserted_role
        CROSS JOIN (VALUES
          ('project.view'),
          ('project.create_folder'),
          ('project.update'),
          ('canvas.view'),
          ('canvas.create'),
          ('canvas.update'),
          ('canvas.commit')
        ) AS capability(key)
        ON CONFLICT DO NOTHING;

        WITH inserted_role AS (
          INSERT INTO collaboration_roles (name, description, is_system_role)
          VALUES ('Manager', 'Can reorganize, archive, publish, delete, and manage sharing for project contents.', TRUE)
          ON CONFLICT (name) DO NOTHING
          RETURNING id
        )
        INSERT INTO collaboration_role_capabilities (role_id, capability)
        SELECT inserted_role.id, capability.key
        FROM inserted_role
        CROSS JOIN (VALUES
          ('project.view'),
          ('project.create_folder'),
          ('project.update'),
          ('project.move'),
          ('project.archive'),
          ('project.delete'),
          ('project.manage_shares'),
          ('canvas.view'),
          ('canvas.create'),
          ('canvas.update'),
          ('canvas.commit'),
          ('canvas.move'),
          ('canvas.archive'),
          ('canvas.delete'),
          ('canvas.publish')
        ) AS capability(key)
        ON CONFLICT DO NOTHING;

        UPDATE project_shares share
        SET role_id = role.id
        FROM collaboration_roles role
        WHERE share.role_id IS NULL
          AND share.access_level = 'view'
          AND role.name = 'Viewer';

        UPDATE project_shares share
        SET role_id = role.id
        FROM collaboration_roles role
        WHERE share.role_id IS NULL
          AND share.access_level = 'edit'
          AND role.name = 'Editor';
      `,
    });
  } catch {
    // Table/columns/indexes may already exist
  }

  // Migration: add is_banned column to users table
  try {
    await supabase.rpc("exec_sql", {
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;`,
    });
  } catch {
    // Column may already exist
  }

  // Migration: add password reset session invalidation timestamp
  try {
    await supabase.rpc("exec_sql", {
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;`,
    });
  } catch {
    // Column may already exist
  }

  // Migration: password reset tokens table
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          source TEXT NOT NULL DEFAULT 'self_service',
          created_by_admin UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
        CREATE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx ON password_reset_tokens(token_hash);
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_tokens_source_check'
          ) THEN
            ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_source_check
            CHECK (source IN ('self_service', 'admin'));
          END IF;
        END $$;
      `,
    });
  } catch {
    // Table/indexes/constraint may already exist
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

  // Migration: track API key requests that come from the community CTA
  try {
    await supabase.rpc("exec_sql", {
      sql: `
        ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_request_status TEXT DEFAULT 'none';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_requested_at TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_request_channel TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_request_note TEXT;
        UPDATE users
        SET api_key_request_status = 'fulfilled'
        WHERE api_key_encrypted IS NOT NULL
          AND COALESCE(api_key_request_status, 'none') = 'none';
        UPDATE users
        SET api_key_request_status = 'none'
        WHERE api_key_request_status IS NULL;
        ALTER TABLE users ALTER COLUMN api_key_request_status SET DEFAULT 'none';
        ALTER TABLE users ALTER COLUMN api_key_request_status SET NOT NULL;
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'users_api_key_request_status_check'
          ) THEN
            ALTER TABLE users ADD CONSTRAINT users_api_key_request_status_check
            CHECK (api_key_request_status IN ('none', 'requested', 'fulfilled', 'dismissed'));
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS idx_users_api_key_request_status
        ON users(api_key_request_status, api_key_requested_at DESC);
      `,
    });
  } catch {
    // Columns/constraint may already exist
  }
}
