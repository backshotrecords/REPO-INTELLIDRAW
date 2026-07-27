-- One code-agent credential can authorize multiple independently managed folders.
-- Legacy connection roots are retained during rollout and backfilled as folder grants.

ALTER TABLE agent_connections
  ALTER COLUMN root_project_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS agent_connection_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES agent_connections(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'read',
  include_subfolders BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_connection_folders_connection_project
    UNIQUE (connection_id, project_id),
  CONSTRAINT agent_connection_folders_access_level
    CHECK (access_level IN ('read', 'edit'))
);

CREATE INDEX IF NOT EXISTS idx_agent_connection_folders_connection_active
  ON agent_connection_folders(connection_id, created_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_connection_folders_project
  ON agent_connection_folders(project_id, created_at DESC);

INSERT INTO agent_connection_folders (
  connection_id,
  project_id,
  access_level,
  include_subfolders,
  revoked_at,
  created_at,
  updated_at
)
SELECT
  id,
  root_project_id,
  access_level,
  include_subfolders,
  NULL::TIMESTAMPTZ,
  created_at,
  updated_at
FROM agent_connections
WHERE root_project_id IS NOT NULL
ON CONFLICT (connection_id, project_id) DO NOTHING;

ALTER TABLE agent_actions
  ADD COLUMN IF NOT EXISTS authorization_folder_id UUID
    REFERENCES agent_connection_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_actions_authorization_folder
  ON agent_actions(authorization_folder_id, created_at DESC);

ALTER TABLE agent_connection_folders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE agent_connection_folders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE agent_connection_folders TO service_role;
