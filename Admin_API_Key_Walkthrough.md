# Admin API Key Management Walkthrough

This adds an admin-managed API key flow to the Admin page User Management section.

## What Changed

- Admins can open User Management and click `API Key` beside a user.
- The modal saves an encrypted OpenAI API key for that user.
- The key is stored in the existing `users.api_key_encrypted` field.
- The key source is tracked in `users.api_key_source`.
- Users with admin-managed keys can use IntelliDraw normally, but Settings will not reveal or copy the raw key.
- If a user saves their own key from Settings later, the key source becomes `user` again and reveal/copy is restored.

## Database Migration

Run this in the Supabase SQL Editor before deploying the code:

```sql
ALTER TABLE users
ADD COLUMN IF NOT EXISTS api_key_source TEXT;

UPDATE users
SET api_key_source = 'user'
WHERE api_key_source IS NULL;

ALTER TABLE users
ALTER COLUMN api_key_source SET DEFAULT 'user';

ALTER TABLE users
ALTER COLUMN api_key_source SET NOT NULL;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS api_key_updated_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS api_key_managed_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_api_key_source_check'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_api_key_source_check
    CHECK (api_key_source IN ('user', 'admin'));
  END IF;
END $$;
```

The same SQL is also saved at `db/migrations/migration_admin_api_keys.sql`.

## How To Use

1. Log in as a global admin.
2. Open `/admin`.
3. Expand `User Management`.
4. Find the target user by name or email.
5. Click `API Key`.
6. Paste the OpenAI API key and click `Save Key`.
7. The user row will show `Admin Key`.

## Expected User Behavior

- In Settings, the user will see that the API key is managed by an administrator.
- The show and copy buttons are hidden for admin-managed keys.
- The backend also blocks raw-key retrieval for admin-managed keys, so this is not only a UI restriction.
- The user can still replace it by saving their own key. That changes `api_key_source` back to `user`.

## Files Touched

- `src/pages/AdminPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/lib/api.ts`
- `api/admin/users.ts`
- `api/admin/users/[id]/apikey.ts`
- `api/settings/apikey.ts`
- `api/settings/index.ts`
- `api/lib/db.ts`
- `server.dev.mjs`
- `db/migrations/migration_admin_api_keys.sql`

## Verification Checklist

1. Run the SQL migration.
2. Start the app and API locally.
3. Log in as an admin and save a key for a non-admin test user.
4. Confirm the user row displays `Admin Key`.
5. Log in as that user and confirm Settings hides reveal/copy.
6. Confirm chat/model actions still work with the assigned key.
7. Save a different key from the user's Settings page and confirm reveal/copy returns.
