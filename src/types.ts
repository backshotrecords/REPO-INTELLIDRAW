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

// ===== Skill Notes =====

export interface SkillNote {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  instruction_text: string;
  category: string;
  is_published: boolean;
  stars: number;
  version: number;
  source_skill_id: string | null;
  source_version: number | null;
  created_at: string;
  updated_at: string;
  // Joined fields (from queries)
  owner_display_name?: string;
  owner_email?: string;
  has_update?: boolean;
}

export interface SkillNoteAttachment {
  id: string;
  skill_note_id: string;
  user_id: string;
  canvas_id: string | null;
  scope: "local" | "global";
  trigger_mode: "automatic" | "manual";
  is_active: boolean;
  created_at: string;
  // Joined
  skill_note?: SkillNote;
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
