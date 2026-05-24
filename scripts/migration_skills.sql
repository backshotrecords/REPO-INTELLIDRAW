-- ============================================================
-- IntelliDraw Skills System — Database Migration
-- Run this against your Supabase SQL Editor
-- ============================================================

-- 1. Skill Notes (core entity)
CREATE TABLE IF NOT EXISTS skill_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  instruction_text TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_published BOOLEAN DEFAULT false,
  stars INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  source_skill_id UUID REFERENCES skill_notes(id) ON DELETE SET NULL,
  source_version INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Marketplace release lifecycle columns. Visibility lives on skill_notes so
-- every version of a skill has the same distribution channel.
ALTER TABLE skill_notes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE skill_notes ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';
ALTER TABLE skill_notes ADD COLUMN IF NOT EXISTS current_published_version_id UUID;
ALTER TABLE skill_notes ADD COLUMN IF NOT EXISTS has_unpublished_changes BOOLEAN DEFAULT false;
ALTER TABLE skill_notes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE skill_notes ADD COLUMN IF NOT EXISTS unpublished_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_notes_status_check'
  ) THEN
    ALTER TABLE skill_notes ADD CONSTRAINT skill_notes_status_check
    CHECK (status IN ('draft', 'published', 'unpublished', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_notes_visibility_check'
  ) THEN
    ALTER TABLE skill_notes ADD CONSTRAINT skill_notes_visibility_check
    CHECK (visibility IN ('private', 'shared', 'public'));
  END IF;
END $$;

-- Immutable released snapshots for public and shared marketplace use.
CREATE TABLE IF NOT EXISTS skill_note_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_note_id UUID NOT NULL REFERENCES skill_notes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  instruction_text TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  release_notes TEXT DEFAULT '',
  published_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(skill_note_id, version_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_notes_current_published_version_fkey'
  ) THEN
    ALTER TABLE skill_notes
      ADD CONSTRAINT skill_notes_current_published_version_fkey
      FOREIGN KEY (current_published_version_id)
      REFERENCES skill_note_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- User install/subscription records. Installing no longer copies skill_notes.
CREATE TABLE IF NOT EXISTS skill_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_note_id UUID NOT NULL REFERENCES skill_notes(id) ON DELETE CASCADE,
  installed_version_id UUID NOT NULL REFERENCES skill_note_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'uninstalled', 'archived')),
  installed_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_installations_active_unique
  ON skill_installations(user_id, skill_note_id)
  WHERE status = 'active';

-- 2. User Groups
CREATE TABLE IF NOT EXISTS user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Group Members
CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- 4. Skill Note Attachments (to projects/canvases or global)
CREATE TABLE IF NOT EXISTS skill_note_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_note_id UUID NOT NULL REFERENCES skill_notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canvas_id UUID REFERENCES canvases(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('local', 'global')),
  trigger_mode TEXT NOT NULL CHECK (trigger_mode IN ('automatic', 'manual')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE skill_note_attachments
  ALTER COLUMN skill_note_id DROP NOT NULL;
ALTER TABLE skill_note_attachments
  ADD COLUMN IF NOT EXISTS skill_installation_id UUID REFERENCES skill_installations(id) ON DELETE CASCADE;
ALTER TABLE skill_note_attachments
  ADD COLUMN IF NOT EXISTS attached_version_id UUID REFERENCES skill_note_versions(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_attachment_source_check'
  ) THEN
    ALTER TABLE skill_note_attachments ADD CONSTRAINT skill_attachment_source_check
    CHECK (
      skill_note_id IS NOT NULL OR skill_installation_id IS NOT NULL
    );
  END IF;
END $$;

-- Unique constraint: a skill can only be attached once per user/canvas/scope combo
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_attachment_unique
  ON skill_note_attachments (skill_note_id, user_id, COALESCE(canvas_id, '00000000-0000-0000-0000-000000000000'), scope);

-- 5. Skill Note Shares (individual user or group sharing)
CREATE TABLE IF NOT EXISTS skill_note_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_note_id UUID NOT NULL REFERENCES skill_notes(id) ON DELETE CASCADE,
  shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shared_with_group_id UUID REFERENCES user_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT share_target_check CHECK (
    (shared_with_user_id IS NOT NULL AND shared_with_group_id IS NULL) OR
    (shared_with_user_id IS NULL AND shared_with_group_id IS NOT NULL)
  )
);

ALTER TABLE skill_note_shares
  ADD COLUMN IF NOT EXISTS access_level TEXT DEFAULT 'install';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_note_shares_access_level_check'
  ) THEN
    ALTER TABLE skill_note_shares ADD CONSTRAINT skill_note_shares_access_level_check
    CHECK (access_level IN ('view', 'install'));
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_skill_notes_owner ON skill_notes(owner_id);
CREATE INDEX IF NOT EXISTS idx_skill_notes_published ON skill_notes(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_skill_notes_source ON skill_notes(source_skill_id) WHERE source_skill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_notes_status_visibility ON skill_notes(status, visibility);
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_note_versions(skill_note_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_skill_installations_user ON skill_installations(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_skill_installations_skill ON skill_installations(skill_note_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_skill_attachments_user ON skill_note_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_attachments_canvas ON skill_note_attachments(canvas_id) WHERE canvas_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_attachments_installation ON skill_note_attachments(skill_installation_id) WHERE skill_installation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_shares_user ON skill_note_shares(shared_with_user_id) WHERE shared_with_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_shares_group ON skill_note_shares(shared_with_group_id) WHERE shared_with_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

-- ============================================================
-- Backfill existing marketplace data into the new release model
-- ============================================================

-- Existing published skills become public released skills.
INSERT INTO skill_note_versions (
  skill_note_id,
  version_number,
  title,
  description,
  instruction_text,
  category,
  release_notes,
  created_by,
  published_at
)
SELECT
  sn.id,
  GREATEST(COALESCE(sn.version, 1), 1),
  sn.title,
  COALESCE(sn.description, ''),
  sn.instruction_text,
  COALESCE(sn.category, 'general'),
  'Initial marketplace release',
  sn.owner_id,
  COALESCE(sn.updated_at, sn.created_at, now())
FROM skill_notes sn
WHERE sn.is_published = true
  AND NOT EXISTS (
    SELECT 1 FROM skill_note_versions v WHERE v.skill_note_id = sn.id
  );

UPDATE skill_notes sn
SET
  status = 'published',
  visibility = 'public',
  current_published_version_id = latest.id,
  has_unpublished_changes = false
FROM LATERAL (
  SELECT id
  FROM skill_note_versions v
  WHERE v.skill_note_id = sn.id
  ORDER BY v.version_number DESC
  LIMIT 1
) latest
WHERE sn.is_published = true;

-- Existing shared private skills get a shared release if they are not already public.
INSERT INTO skill_note_versions (
  skill_note_id,
  version_number,
  title,
  description,
  instruction_text,
  category,
  release_notes,
  created_by,
  published_at
)
SELECT
  sn.id,
  GREATEST(COALESCE(sn.version, 1), 1),
  sn.title,
  COALESCE(sn.description, ''),
  sn.instruction_text,
  COALESCE(sn.category, 'general'),
  'Initial shared release',
  sn.owner_id,
  COALESCE(sn.updated_at, sn.created_at, now())
FROM skill_notes sn
WHERE sn.is_published = false
  AND EXISTS (
    SELECT 1 FROM skill_note_shares sh WHERE sh.skill_note_id = sn.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM skill_note_versions v WHERE v.skill_note_id = sn.id
  );

UPDATE skill_notes sn
SET
  status = 'published',
  visibility = 'shared',
  current_published_version_id = latest.id,
  has_unpublished_changes = false
FROM LATERAL (
  SELECT id
  FROM skill_note_versions v
  WHERE v.skill_note_id = sn.id
  ORDER BY v.version_number DESC
  LIMIT 1
) latest
WHERE sn.is_published = false
  AND EXISTS (
    SELECT 1 FROM skill_note_shares sh WHERE sh.skill_note_id = sn.id
  );

-- Existing copied installs become active install records where possible.
INSERT INTO skill_installations (
  user_id,
  skill_note_id,
  installed_version_id,
  status,
  installed_at,
  updated_at
)
SELECT
  copy.owner_id,
  source.id,
  COALESCE(matching_version.id, latest_version.id),
  'active',
  COALESCE(copy.created_at, now()),
  COALESCE(copy.updated_at, now())
FROM skill_notes copy
JOIN skill_notes source ON source.id = copy.source_skill_id
LEFT JOIN LATERAL (
  SELECT id
  FROM skill_note_versions v
  WHERE v.skill_note_id = source.id
    AND v.version_number = copy.source_version
  LIMIT 1
) matching_version ON true
LEFT JOIN LATERAL (
  SELECT id
  FROM skill_note_versions v
  WHERE v.skill_note_id = source.id
  ORDER BY v.version_number DESC
  LIMIT 1
) latest_version ON true
WHERE copy.source_skill_id IS NOT NULL
  AND COALESCE(matching_version.id, latest_version.id) IS NOT NULL
ON CONFLICT (user_id, skill_note_id) WHERE status = 'active' DO NOTHING;

-- Existing attachments to copied installs should now point at the source installation/version.
UPDATE skill_note_attachments att
SET
  skill_note_id = copy.source_skill_id,
  skill_installation_id = inst.id,
  attached_version_id = inst.installed_version_id
FROM skill_notes copy
JOIN skill_installations inst
  ON inst.user_id = copy.owner_id
  AND inst.skill_note_id = copy.source_skill_id
  AND inst.status = 'active'
WHERE att.skill_note_id = copy.id
  AND copy.source_skill_id IS NOT NULL
  AND att.user_id = copy.owner_id;
