-- Dynamic project collaboration roles and capability matrix.

CREATE TABLE IF NOT EXISTS collaboration_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collaboration_role_capabilities (
  role_id UUID NOT NULL REFERENCES collaboration_roles(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, capability)
);

ALTER TABLE project_shares
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES collaboration_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_shares_role
  ON project_shares(role_id);

CREATE INDEX IF NOT EXISTS idx_collaboration_role_capabilities_role
  ON collaboration_role_capabilities(role_id);

WITH inserted_role AS (
  INSERT INTO collaboration_roles (name, description, is_system_role)
  VALUES ('Viewer', 'Can inspect shared project folders and canvases.', TRUE)
  ON CONFLICT (name) DO NOTHING
  RETURNING id
)
INSERT INTO collaboration_role_capabilities (role_id, capability)
SELECT inserted_role.id, capability.key
FROM inserted_role
CROSS JOIN (VALUES
  ('project.view'),
  ('canvas.view')
) AS capability(key)
ON CONFLICT DO NOTHING;

WITH inserted_role AS (
  INSERT INTO collaboration_roles (name, description, is_system_role)
  VALUES ('Editor', 'Can create and edit project contents without owner-only management actions.', TRUE)
  ON CONFLICT (name) DO NOTHING
  RETURNING id
)
INSERT INTO collaboration_role_capabilities (role_id, capability)
SELECT inserted_role.id, capability.key
FROM inserted_role
CROSS JOIN (VALUES
  ('project.view'),
  ('project.create_folder'),
  ('project.update'),
  ('canvas.view'),
  ('canvas.create'),
  ('canvas.update'),
  ('canvas.commit')
) AS capability(key)
ON CONFLICT DO NOTHING;

WITH inserted_role AS (
  INSERT INTO collaboration_roles (name, description, is_system_role)
  VALUES ('Manager', 'Can reorganize, archive, publish, delete, and manage sharing for project contents.', TRUE)
  ON CONFLICT (name) DO NOTHING
  RETURNING id
)
INSERT INTO collaboration_role_capabilities (role_id, capability)
SELECT inserted_role.id, capability.key
FROM inserted_role
CROSS JOIN (VALUES
  ('project.view'),
  ('project.create_folder'),
  ('project.update'),
  ('project.move'),
  ('project.archive'),
  ('project.delete'),
  ('project.manage_shares'),
  ('canvas.view'),
  ('canvas.create'),
  ('canvas.update'),
  ('canvas.commit'),
  ('canvas.move'),
  ('canvas.archive'),
  ('canvas.delete'),
  ('canvas.publish')
) AS capability(key)
ON CONFLICT DO NOTHING;

UPDATE project_shares share
SET role_id = role.id
FROM collaboration_roles role
WHERE share.role_id IS NULL
  AND share.access_level = 'view'
  AND role.name = 'Viewer';

UPDATE project_shares share
SET role_id = role.id
FROM collaboration_roles role
WHERE share.role_id IS NULL
  AND share.access_level = 'edit'
  AND role.name = 'Editor';
