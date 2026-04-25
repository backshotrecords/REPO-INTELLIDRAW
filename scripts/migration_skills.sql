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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_skill_notes_owner ON skill_notes(owner_id);
CREATE INDEX IF NOT EXISTS idx_skill_notes_published ON skill_notes(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_skill_notes_source ON skill_notes(source_skill_id) WHERE source_skill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_attachments_user ON skill_note_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_attachments_canvas ON skill_note_attachments(canvas_id) WHERE canvas_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_shares_user ON skill_note_shares(shared_with_user_id) WHERE shared_with_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skill_shares_group ON skill_note_shares(shared_with_group_id) WHERE shared_with_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
