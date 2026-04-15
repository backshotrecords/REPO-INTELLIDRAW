export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  causedCrash?: boolean;
  mermaidSnapshot?: string;
  versionSource?: "ai_chat" | "manual" | "auto_fix" | "upload" | "restore";
}
