import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { supabase } from "./lib/db.js";
import { decrypt } from "./lib/crypto.js";
import OpenAI from "openai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { message, mermaidCode, chatHistory, canvasId } = req.body;

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
        const { data: activeSkills } = await supabase.from("skill_note_attachments")
          .select("skill_notes(title, instruction_text)")
          .eq("user_id", authPayload.userId).eq("is_active", true).eq("trigger_mode", "automatic")
          .or(`canvas_id.eq.${canvasId},scope.eq.global`);
        const skills = (activeSkills || []).filter((d: Record<string, unknown>) => d.skill_notes);
        if (skills.length > 0) {
          skillInstructions = "\n\nACTIVE SKILL NOTES (follow these as additional instructions and preferences):\n" +
            skills.map((s: Record<string, unknown>, i: number) => {
              const sn = s.skill_notes as Record<string, unknown>;
              return `--- Skill ${i + 1}: ${sn.title} ---\n${sn.instruction_text}`;
            }).join("\n\n");
        }
      } catch { /* non-fatal */ }
    }

    // Build conversation history for context
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are IntelliDraw, an AI assistant that helps users create and refine Mermaid flowcharts through natural conversation.

CURRENT MERMAID CODE:
\`\`\`mermaid
${mermaidCode || "flowchart TD\n    A[Start]"}
\`\`\`

INSTRUCTIONS:
1. Respond conversationally to the user's request
2. When you need to update the flowchart, include the COMPLETE updated Mermaid code in a fenced code block with the language identifier "mermaid"
3. Always output the FULL mermaid code, not just the changes
4. Use valid Mermaid syntax (flowchart TD, graph LR, etc.)
5. Keep your conversational response concise but helpful
6. If the user asks for changes, apply them and show the updated code
7. Use descriptive node labels and proper flow connections${skillInstructions}`,
      },
    ];

    // Add chat history for context (last 20 messages max)
    const history = Array.isArray(chatHistory) ? chatHistory.slice(-20) : [];
    for (const msg of history) {
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
      temperature: 0.7,
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
