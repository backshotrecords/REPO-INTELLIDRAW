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
      active_model_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ users table ready');

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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ canvases table ready');

  // Verify tables exist
  console.log('\nVerifying tables...');
  const result = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('users', 'ai_models', 'canvases')
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
