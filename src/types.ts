export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  causedCrash?: boolean;
  mermaidSnapshot?: string;
  versionSource?: "ai_chat" | "manual" | "auto_fix" | "upload" | "restore";
}

export interface CanvasCommit {
  id: string;
  canvas_id: string;
  mermaid_code: string;
  source: string;
  commit_message: string;
  created_at: string;
}

export type ProjectAccent = "blue" | "cyan" | "green" | "violet" | "amber";

export interface DashboardCanvas {
  id: string;
  title: string;
  mermaid_code?: string;
  is_public: boolean;
  project_id: string | null;
  manually_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CanvasPreviewCode {
  id: string;
  title: string;
  mermaid_code: string;
  updated_at: string;
}

export interface CanvasProject {
  id: string;
  user_id: string;
  parent_project_id: string | null;
  title: string;
  description: string;
  accent: ProjectAccent;
  manually_archived: boolean;
  created_at: string;
  updated_at: string;
}

export function isLongTermMemoryItem(item: { updated_at: string; manually_archived?: boolean }) {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Boolean(item.manually_archived) || Date.now() - new Date(item.updated_at).getTime() > thirtyDaysMs;
}

// ===== Skill Notes =====

export type SkillScope = "local" | "global";
export type SkillTriggerMode = "automatic" | "manual" | "contextual";

export interface SkillNote {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  instruction_text: string;
  category: string;
  is_published: boolean;
  version: number;
  source_skill_id: string | null;
  source_version: number | null;
  status?: "draft" | "published" | "unpublished" | "archived";
  visibility?: "private" | "shared" | "public";
  current_published_version_id?: string | null;
  has_unpublished_changes?: boolean;
  archived_at?: string | null;
  unpublished_at?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (from queries)
  owner_display_name?: string;
  owner_email?: string;
  has_update?: boolean;
  latest_version_id?: string | null;
  latest_version_number?: number | null;
  relationship?: "not_installed" | "installed_current" | "installed_stale" | "owner";
  installation_id?: string;
  installed_version_id?: string;
  installed_version_number?: number;
  install_count?: number;
  active_usage_count?: number;
  deprecated?: boolean;
}

export interface SkillNoteAttachment {
  id: string;
  skill_note_id: string | null;
  skill_installation_id?: string | null;
  attached_version_id?: string | null;
  user_id: string;
  canvas_id: string | null;
  scope: SkillScope;
  trigger_mode: SkillTriggerMode;
  is_active: boolean;
  created_at: string;
  // Joined
  skill_note?: SkillNote;
  installed_skill?: SkillInstallation;
  attached_version?: SkillNoteVersion;
  has_update?: boolean;
}

export interface SkillNoteVersion {
  id: string;
  skill_note_id: string;
  version_number: number;
  title: string;
  description: string;
  instruction_text: string;
  category: string;
  release_notes: string;
  published_at: string;
  created_by: string;
}

export interface SkillInstallation {
  id: string;
  user_id: string;
  skill_note_id: string;
  installed_version_id: string;
  status: "active" | "uninstalled" | "archived";
  installed_at: string;
  updated_at: string;
  skill_note?: SkillNote;
  installed_version?: SkillNoteVersion;
  latest_version?: SkillNoteVersion;
  has_update?: boolean;
  stale_attachment_count?: number;
}

export interface UserGroup {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  members?: GroupMember[];
  member_count?: number;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  added_at: string;
  display_name?: string;
  email?: string;
}
