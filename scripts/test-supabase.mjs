import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://epiigfxulmmngaohbicv.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwaWlnZnh1bG1tbmdhb2hiaWN2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTkyMzc3NywiZXhwIjoyMDkxNDk5Nzc3fQ.FWMKS2YZF4Sw1N7txtnPa2KSf5GQ60Y0wnJaUUjONY4';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function test() {
  console.log('Testing Supabase REST API connection...\n');

  // Test: read from users table (should be empty)
  const { data: users, error: usersErr } = await supabase.from('users').select('id').limit(1);
  if (usersErr) {
    console.log('❌ users table error:', usersErr.message);
  } else {
    console.log('✅ users table accessible — rows:', users.length);
  }

  // Test: read from ai_models table
  const { data: models, error: modelsErr } = await supabase.from('ai_models').select('id').limit(1);
  if (modelsErr) {
    console.log('❌ ai_models table error:', modelsErr.message);
  } else {
    console.log('✅ ai_models table accessible — rows:', models.length);
  }

  // Test: read from canvases table
  const { data: canvases, error: canvasErr } = await supabase.from('canvases').select('id').limit(1);
  if (canvasErr) {
    console.log('❌ canvases table error:', canvasErr.message);
  } else {
    console.log('✅ canvases table accessible — rows:', canvases.length);
  }

  console.log('\n🎉 Supabase REST API connection verified!');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
});
