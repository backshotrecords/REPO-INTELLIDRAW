-- Project collaboration shares for group-based access.

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

CREATE INDEX IF NOT EXISTS idx_project_shares_project
  ON project_shares(project_id);

CREATE INDEX IF NOT EXISTS idx_project_shares_group
  ON project_shares(shared_with_group_id);

