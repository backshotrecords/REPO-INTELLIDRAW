-- ============================================================
-- IntelliDraw Project Assets — Database Migration
-- Run this against your Supabase SQL Editor BEFORE deploying the
-- project-assets API endpoints.
--
-- Assets are registered once per ROOT project folder (top-level
-- ancestor). Every folder and canvas under that root shares the
-- registry. root_project_id IS NULL = the per-user "unfiled" scope
-- for canvases that live outside any project.
-- ============================================================

-- 1. Asset registry
CREATE TABLE IF NOT EXISTS project_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_project_id UUID REFERENCES canvas_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('markdown', 'canvas', 'project')),
  name TEXT NOT NULL,
  -- Markdown assets: the document body. Reference assets: NULL.
  markdown TEXT,
  -- Reference assets: the canvas/project id they point at. Intentionally not
  -- a FK (it can target either table); dangling references are handled by the
  -- client when the target no longer resolves.
  target_id UUID,
  accent TEXT NOT NULL DEFAULT 'blue'
    CHECK (accent IN ('blue', 'green', 'cyan', 'violet', 'amber', 'rose')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_assets_user_scope
  ON project_assets(user_id, root_project_id);

-- 2. Asset-to-node links (mermaid node ids are strings parsed from the
-- canvas's mermaid_code at runtime; they are stable until the diagram is
-- refactored, at which point the client prunes dead links).
CREATE TABLE IF NOT EXISTS project_asset_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES project_assets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (asset_id, canvas_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_project_asset_links_user_canvas
  ON project_asset_links(user_id, canvas_id);
CREATE INDEX IF NOT EXISTS idx_project_asset_links_asset
  ON project_asset_links(asset_id);
