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
