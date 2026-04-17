import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";
import OpenAI from "openai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { mermaidCode } = req.body || {};

  if (!mermaidCode || typeof mermaidCode !== "string") {
    return res.status(400).json({ error: "mermaidCode is required" });
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

    const completion = await openai.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: "system",
          content:
            "You are a naming assistant. Given a Mermaid flowchart, suggest a short, descriptive title (3–6 words max). Reply with ONLY the title text — no quotes, no punctuation, no explanation.",
        },
        {
          role: "user",
          content: `Suggest a title for this flowchart:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``,
        },
      ],
      max_tokens: 100,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content || "Untitled Canvas";
    // Strip surrounding quotes / trailing punctuation the model may add
    const suggestedName = raw.replace(/^["']+|["']+$/g, "").trim() || "Untitled Canvas";

    return res.status(200).json({ suggestedName });
  } catch (err: unknown) {
    console.error("Suggest name error:", err);
    const errorMessage = err instanceof Error ? err.message : "Failed to suggest name";
    return res.status(500).json({ error: errorMessage });
  }
}
