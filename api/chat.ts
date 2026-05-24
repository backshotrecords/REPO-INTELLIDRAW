import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { supabase } from "./lib/db.js";
import { decrypt } from "./lib/crypto.js";
import OpenAI from "openai";

/** Read rolling chat history config from admin_config table */
async function getChatConfig() {
  const { data: rows } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ["chat_rolling_enabled", "chat_rolling_window_length"]);

  const cfg: Record<string, string> = {};
  for (const row of rows || []) cfg[row.key] = row.value;

  return {
    rollingEnabled: (cfg.chat_rolling_enabled ?? "false") === "true",
    windowLength: parseInt(cfg.chat_rolling_window_length ?? "10", 10),
  };
}

/** Extract %% OBJECTIVES: ... comment from mermaid code */
function extractObjectives(mermaidCode: string): string | null {
  const match = mermaidCode.match(/%% OBJECTIVES:\s*(.+)/);
  return match ? match[1].trim() : null;
}

async function loadActiveSkillInstructions(userId: string, canvasId: string): Promise<string> {
  const { data: attachments } = await supabase.from("skill_note_attachments")
    .select("skill_note_id, attached_version_id, skill_notes(title, instruction_text)")
    .eq("user_id", userId).eq("is_active", true).eq("trigger_mode", "automatic")
    .or(`canvas_id.eq.${canvasId},scope.eq.global`);

  const skills: Array<{ title: string; instruction_text: string }> = [];
  for (const attachment of (attachments || []) as Record<string, unknown>[]) {
    if (attachment.attached_version_id) {
      const { data: version } = await supabase
        .from("skill_note_versions")
        .select("title, instruction_text")
        .eq("id", attachment.attached_version_id)
        .single();
      if (version) skills.push(version as { title: string; instruction_text: string });
      continue;
    }

    const skill = attachment.skill_notes as { title: string; instruction_text: string } | null;
    if (skill) skills.push(skill);
  }

  if (skills.length === 0) return "";
  return "\n\nACTIVE SKILL NOTES (follow these as additional instructions and preferences):\n" +
    skills.map((skill, i) => `--- Skill ${i + 1}: ${skill.title} ---\n${skill.instruction_text}`).join("\n\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { message, mermaidCode, chatHistory, canvasId, activeScopeId, scopePath } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    // Get user's API key and active model
    const { data: user } = await supabase
      .from("users")
      .select("api_key_encrypted, active_model_id")
      .eq("id", authPayload.userId)
      .single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({
        error: "No API key configured. Please add your OpenAI API key in Settings.",
      });
    }

    const apiKey = decrypt(user.api_key_encrypted);

    // Get the active model ID
    let modelId = "gpt-4o";
    if (user.active_model_id) {
      const { data: model } = await supabase
        .from("ai_models")
        .select("model_id")
        .eq("id", user.active_model_id)
        .single();
      if (model) modelId = model.model_id;
    }

    const openai = new OpenAI({ apiKey });

    // Fetch active skill notes for this canvas
    let skillInstructions = "";
    if (canvasId) {
      try {
        skillInstructions = await loadActiveSkillInstructions(authPayload.userId, canvasId);
      } catch { /* non-fatal */ }
    }

    // Read rolling chat history config
    const chatConfig = await getChatConfig();

    // Extract existing objectives from the current mermaid code
    const currentCode = mermaidCode || "flowchart TD\n    A[Start]";
    const existingObjectives = extractObjectives(currentCode);
    const objectivesContext = existingObjectives
      ? `\n\nCURRENT USER OBJECTIVES SUMMARY:\n${existingObjectives}`
      : "";

    // Build scope context if user is inside a subgraph
    let scopeContext = "";
    if (activeScopeId) {
      const scopePathStr = Array.isArray(scopePath) ? scopePath.join(' > ') : 'Root';
      scopeContext = `\n\nACTIVE SCOPE CONTEXT:\nThe user is currently viewing a specific subgraph scope within the full flowchart.\n- Active Scope ID: ${activeScopeId}\n- Scope Path (breadcrumb): ${scopePathStr}\n- The user's edits are focused on this scope, but you MUST output the COMPLETE updated Mermaid code (the entire project, not just the active scope).\n- When making changes to the active scope, be careful not to break nodes/edges in other scopes.\n- Subgraph boundaries (subgraph ... end) define scope structure. Do not remove or rename subgraph IDs unless explicitly asked.`;
    }

    // Build conversation history for context
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are IntelliDraw, an AI assistant that helps users create and refine Mermaid flowcharts through natural conversation.

CURRENT MERMAID CODE:
\`\`\`mermaid
${currentCode}
\`\`\`
${objectivesContext}${scopeContext}
INSTRUCTIONS:
1. Respond conversationally to the user's request
2. When you need to update the flowchart, include the COMPLETE updated Mermaid code in a fenced code block with the language identifier "mermaid"
3. Always output the FULL mermaid code, not just the changes
4. Use valid Mermaid syntax (flowchart TD, graph LR, etc.)
5. Keep your conversational response concise but helpful
6. If the user asks for changes, apply them and show the updated code
7. Use descriptive node labels and proper flow connections
8. IMPORTANT: At the very top of your mermaid code output, always include a single-line comment summarizing the user's current objectives and overall intent for this flowchart. Format: %% OBJECTIVES: <one-paragraph summary of what the user is building and their goals>. If a previous objectives summary exists above, update it to reflect the latest changes.${skillInstructions}`,
      },
    ];

    // Apply rolling window to chat history
    const fullHistory = Array.isArray(chatHistory) ? chatHistory : [];
    let contextHistory: typeof fullHistory;

    if (chatConfig.rollingEnabled && fullHistory.length > chatConfig.windowLength) {
      contextHistory = fullHistory.slice(-chatConfig.windowLength);
    } else {
      contextHistory = fullHistory;
    }

    for (const msg of contextHistory) {
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    // Add the new user message
    messages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: modelId,
      messages,
      //max_tokens: 4096, // lets get rid of this for the time being to allow later models to be loaded
      temperature: modelId === "gpt-5.5" ? 1 : 0.7,
    });

    const aiResponse = completion.choices[0]?.message?.content || "I couldn't generate a response. Please try again.";

    // Extract mermaid code from the response if present
    const mermaidMatch = aiResponse.match(/```mermaid\n([\s\S]*?)```/);
    const updatedMermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    return res.status(200).json({
      response: aiResponse,
      updatedMermaidCode,
      model: modelId,
    });
  } catch (err: unknown) {
    console.error("Chat error:", err);
    const errorMessage = err instanceof Error ? err.message : "Failed to get AI response";
    return res.status(500).json({ error: errorMessage });
  }
}
