import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { authenticateRequest } from "./lib/auth.js";
import { supabase } from "./lib/db.js";
import { decrypt } from "./lib/crypto.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { mermaidCode, errorMsg, chatHistory } = req.body;
  if (!mermaidCode || !errorMsg) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { data: user } = await supabase
      .from("users")
      .select("api_key_encrypted, active_model_id")
      .eq("id", authPayload.userId)
      .single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({ error: "No API key configured" });
    }

    const apiKey = decrypt(user.api_key_encrypted);
    let modelId = "gpt-4o";

    if (user.active_model_id) {
      const { data: model } = await supabase
        .from("ai_models")
        .select("model_id")
        .eq("id", user.active_model_id)
        .single();
      if (model) modelId = model.model_id;
    }

    const { data: rules } = await supabase
      .from("sanitization_rules")
      .select("rule_description")
      .eq("is_active", true);

    let rulesText = "";
    if (rules && rules.length > 0) {
      rulesText = "\n\nAdditionally, you MUST adhere to these global sanitization rules:\n" +
        rules.map((r, i) => `${i + 1}. ${r.rule_description}`).join("\n");
    }

    const openai = new OpenAI({ apiKey });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are IntelliDraw's Code Fixer. The previous AI attempted to generate Mermaid code, but the Mermaid parser crashed.
        
YOUR TASK:
Return the COMPLETE, fixed Mermaid code in a single markdown code block (\`\`\`mermaid \`\`\`).
Do NOT reply with explanations. Only return the code.

CURRENT BROKEN CODE:
\`\`\`mermaid
${mermaidCode}
\`\`\`

THE PARSER ERROR WAS:
${errorMsg}

Please fix the specific error mentioned above.
ALSO: Check the rest of the code for any standard syntax issues that typically cause Mermaid to fail (e.g., unescaped parentheses in node string values).${rulesText}`
      }
    ];

    const history = Array.isArray(chatHistory) ? chatHistory.slice(-10) : [];
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content } as OpenAI.Chat.ChatCompletionMessageParam);
    }

    messages.push({ role: "user", content: "Please fix the code." });

    const completion = await openai.chat.completions.create({
      model: modelId,
      messages,
      //max_tokens: 4096, // lets get rid of this for the time being to allow later models to be loaded
      temperature: 0.2,
    });

    const aiResponse = completion.choices[0]?.message?.content || "";
    // Try multiple regex patterns — AI sometimes formats the block differently
    const mermaidMatch = aiResponse.match(/```mermaid\s*\n([\s\S]*?)```/)
      || aiResponse.match(/```\s*\n([\s\S]*?)```/);
    const updatedMermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    return res.status(200).json({ response: aiResponse, updatedMermaidCode, model: modelId });
  } catch (err) {
    console.error("Chat Fix error:", err);
    return res.status(500).json({ error: (err as Error).message || "Failed to fix code" });
  }
}
