-- Dashboard project folders and long-term memory archive support.

CREATE TABLE IF NOT EXISTS canvas_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_project_id UUID REFERENCES canvas_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Project',
  description TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'blue',
  manually_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
