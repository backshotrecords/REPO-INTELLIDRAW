-- Project context cache for lazy folder/canvas inheritance.
-- local_context summarizes a folder's own direct contents.
-- effective_context is the compressed packet inherited by child folders/canvases.

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
