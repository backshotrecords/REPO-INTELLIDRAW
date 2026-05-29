import pg from 'pg';
const { Client } = pg;

// Connection string with URL-encoded password (intellidraw!@#$)
const connectionString = 'postgresql://postgres:intellidraw%21%40%23%24@db.epiigfxulmmngaohbicv.supabase.co:5432/postgres';

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function initDatabase() {
  console.log('Connecting to Supabase PostgreSQL...');
  await client.connect();
  console.log('✅ Connected successfully!\n');

  // Create users table
  console.log('Creating users table...');
  await client.query(`
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
      password_changed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_source TEXT;
    UPDATE users SET api_key_source = 'user' WHERE api_key_source IS NULL;
    ALTER TABLE users ALTER COLUMN api_key_source SET DEFAULT 'user';
    ALTER TABLE users ALTER COLUMN api_key_source SET NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_updated_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_managed_by UUID REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_api_key_source_check'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_api_key_source_check
        CHECK (api_key_source IN ('user', 'admin'));
      END IF;
    END $$;
  `);
  console.log('✅ users table ready');

  console.log('Creating password_reset_tokens table...');
  await client.query(`
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
  `);
  console.log('✅ password_reset_tokens table ready');

  // Create ai_models table
  console.log('Creating ai_models table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      label TEXT,
      added_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ ai_models table ready');

  // Create canvases table
  console.log('Creating canvases table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS canvases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Untitled Canvas',
      mermaid_code TEXT NOT NULL DEFAULT 'flowchart TD\n    A[Start]',
      chat_history JSONB DEFAULT '[]'::jsonb,
      manually_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ canvases table ready');

  console.log('Creating canvas_projects table...');
  await client.query(`
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
        ALTER TABLE canvas_projects
          ADD CONSTRAINT canvas_projects_accent_check
          CHECK (accent IN ('blue', 'cyan', 'green', 'violet', 'amber'));
      END IF;
    END $$;

    ALTER TABLE canvases
      ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES canvas_projects(id) ON DELETE CASCADE;
    ALTER TABLE canvases
      ADD COLUMN IF NOT EXISTS manually_archived BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_canvas_projects_user_parent
      ON canvas_projects(user_id, parent_project_id);
    CREATE INDEX IF NOT EXISTS idx_canvas_projects_user_updated
      ON canvas_projects(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_canvases_user_project
      ON canvases(user_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_canvases_user_archive
      ON canvases(user_id, manually_archived, updated_at DESC);
  `);
  console.log('✅ canvas_projects table ready');

  // Verify tables exist
  console.log('\nVerifying tables...');
  const result = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('users', 'ai_models', 'canvases', 'canvas_projects')
    ORDER BY table_name;
  `);
  console.log('Tables found:', result.rows.map(r => r.table_name).join(', '));

  await client.end();
  console.log('\n🎉 Database initialization complete!');
}

initDatabase().catch(err => {
  console.error('❌ Database initialization failed:', err.message);
  process.exit(1);
});
