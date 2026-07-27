-- User-managed MCP access for folder-scoped code agents.
-- Apply this migration before deploying the MCP endpoint and Agent Access UI.

CREATE TABLE IF NOT EXISTS agent_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_project_id UUID NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  access_level TEXT NOT NULL DEFAULT 'read',
  include_subfolders BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_connections_name_length
    CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT agent_connections_access_level
    CHECK (access_level IN ('read', 'edit'))
);

CREATE INDEX IF NOT EXISTS idx_agent_connections_user_created
  ON agent_connections(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_connections_root_project
  ON agent_connections(root_project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_connections_active
  ON agent_connections(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES agent_connections(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_name TEXT NOT NULL,
  root_project_id UUID REFERENCES canvas_projects(id) ON DELETE SET NULL,
  target_project_id UUID REFERENCES canvas_projects(id) ON DELETE SET NULL,
  canvas_id UUID REFERENCES canvases(id) ON DELETE SET NULL,
  commit_id UUID REFERENCES canvas_commits(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  change_summary TEXT,
  reason TEXT,
  before_hash TEXT,
  after_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_actions_operation
    CHECK (
      operation IN (
        'list_folder',
        'get_flowchart',
        'validate_flowchart',
        'create_flowchart',
        'update_flowchart'
      )
    ),
  CONSTRAINT agent_actions_status
    CHECK (status IN ('success', 'failure', 'conflict'))
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_user_created
  ON agent_actions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_connection_created
  ON agent_actions(connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_root_project_created
  ON agent_actions(root_project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_target_project_created
  ON agent_actions(target_project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_canvas_created
  ON agent_actions(canvas_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_commit
  ON agent_actions(commit_id);

CREATE TABLE IF NOT EXISTS agent_idempotency (
  connection_id UUID NOT NULL REFERENCES agent_connections(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (connection_id, operation, idempotency_key),
  CONSTRAINT agent_idempotency_operation
    CHECK (operation IN ('create_flowchart', 'update_flowchart')),
  CONSTRAINT agent_idempotency_status
    CHECK (status IN ('pending', 'completed')),
  CONSTRAINT agent_idempotency_key_length
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 160)
);

ALTER TABLE canvas_commits
  ADD COLUMN IF NOT EXISTS actor_type TEXT,
  ADD COLUMN IF NOT EXISTS agent_connection_id UUID REFERENCES agent_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_connection_name TEXT,
  ADD COLUMN IF NOT EXISTS change_summary TEXT,
  ADD COLUMN IF NOT EXISTS change_reason TEXT,
  ADD COLUMN IF NOT EXISTS before_hash TEXT,
  ADD COLUMN IF NOT EXISTS after_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canvas_commits_actor_type'
  ) THEN
    ALTER TABLE canvas_commits
      ADD CONSTRAINT canvas_commits_actor_type
      CHECK (
        actor_type IS NULL
        OR actor_type IN ('user', 'intellidraw_ai', 'external_agent')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_canvas_commits_agent_connection
  ON canvas_commits(agent_connection_id, created_at DESC);

CREATE OR REPLACE FUNCTION agent_create_canvas(
  p_owner_user_id UUID,
  p_project_id UUID,
  p_title TEXT,
  p_mermaid_code TEXT,
  p_connection_id UUID,
  p_connection_name TEXT,
  p_change_summary TEXT,
  p_change_reason TEXT,
  p_after_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_canvas canvases%ROWTYPE;
  v_commit_id UUID;
BEGIN
  INSERT INTO canvases (
    user_id,
    project_id,
    title,
    mermaid_code,
    is_public,
    manually_archived,
    created_at,
    updated_at
  )
  VALUES (
    p_owner_user_id,
    p_project_id,
    LEFT(TRIM(p_title), 80),
    p_mermaid_code,
    FALSE,
    FALSE,
    NOW(),
    NOW()
  )
  RETURNING * INTO v_canvas;

  INSERT INTO canvas_commits (
    canvas_id,
    mermaid_code,
    source,
    commit_message,
    actor_type,
    agent_connection_id,
    agent_connection_name,
    change_summary,
    change_reason,
    after_hash
  )
  VALUES (
    v_canvas.id,
    p_mermaid_code,
    'external_agent',
    p_change_summary,
    'external_agent',
    p_connection_id,
    p_connection_name,
    p_change_summary,
    p_change_reason,
    p_after_hash
  )
  RETURNING id INTO v_commit_id;

  RETURN to_jsonb(v_canvas) || jsonb_build_object('commit_id', v_commit_id);
END;
$$;

CREATE OR REPLACE FUNCTION agent_update_canvas(
  p_canvas_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_title TEXT,
  p_mermaid_code TEXT,
  p_connection_id UUID,
  p_connection_name TEXT,
  p_change_summary TEXT,
  p_change_reason TEXT,
  p_before_hash TEXT,
  p_after_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_canvas canvases%ROWTYPE;
  v_commit_id UUID;
BEGIN
  UPDATE canvases
  SET
    title = CASE
      WHEN p_title IS NULL THEN title
      ELSE LEFT(TRIM(p_title), 80)
    END,
    mermaid_code = p_mermaid_code,
    manually_archived = FALSE,
    updated_at = NOW()
  WHERE id = p_canvas_id
    AND updated_at = p_expected_updated_at
  RETURNING * INTO v_canvas;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('conflict', TRUE);
  END IF;

  INSERT INTO canvas_commits (
    canvas_id,
    mermaid_code,
    source,
    commit_message,
    actor_type,
    agent_connection_id,
    agent_connection_name,
    change_summary,
    change_reason,
    before_hash,
    after_hash
  )
  VALUES (
    v_canvas.id,
    p_mermaid_code,
    'external_agent',
    p_change_summary,
    'external_agent',
    p_connection_id,
    p_connection_name,
    p_change_summary,
    p_change_reason,
    p_before_hash,
    p_after_hash
  )
  RETURNING id INTO v_commit_id;

  RETURN to_jsonb(v_canvas) || jsonb_build_object(
    'commit_id', v_commit_id,
    'conflict', FALSE
  );
END;
$$;

ALTER TABLE agent_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_idempotency ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE agent_connections FROM anon, authenticated;
REVOKE ALL ON TABLE agent_actions FROM anon, authenticated;
REVOKE ALL ON TABLE agent_idempotency FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE agent_connections TO service_role;
GRANT SELECT, INSERT ON TABLE agent_actions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE agent_idempotency TO service_role;

REVOKE ALL ON FUNCTION agent_create_canvas(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION agent_update_canvas(
  UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION agent_create_canvas(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION agent_update_canvas(
  UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
