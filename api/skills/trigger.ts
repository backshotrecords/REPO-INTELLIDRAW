import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";
import OpenAI from "openai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { skill_note_id, canvas_id } = req.body || {};
  if (!skill_note_id || !canvas_id) return res.status(400).json({ error: "skill_note_id and canvas_id required" });

  const { data: skill } = await supabase.from("skill_notes").select("*").eq("id", skill_note_id).single();
  if (!skill) return res.status(404).json({ error: "Skill not found" });

  const { data: canvas } = await supabase.from("canvases").select("mermaid_code").eq("id", canvas_id).eq("user_id", auth.userId).single();
  if (!canvas) return res.status(404).json({ error: "Canvas not found" });

  const { data: user } = await supabase.from("users").select("api_key_encrypted, active_model_id").eq("id", auth.userId).single();
  if (!user?.api_key_encrypted) return res.status(400).json({ error: "No API key configured" });

  const apiKey = decrypt(user.api_key_encrypted);
  let modelId = "gpt-4o";
  if (user.active_model_id) {
    const { data: model } = await supabase.from("ai_models").select("model_id").eq("id", user.active_model_id).single();
    if (model) modelId = model.model_id;
  }

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: modelId,
    messages: [
      { role: "system", content: `You are an AI that applies skill instructions to Mermaid flowcharts.\n\nCURRENT MERMAID CODE:\n\`\`\`mermaid\n${canvas.mermaid_code}\n\`\`\`\n\nSKILL INSTRUCTIONS:\n${skill.instruction_text}\n\nApply these instructions to the current flowchart. Return the updated Mermaid code in a \`\`\`mermaid code block and a brief explanation of what you changed.` },
      { role: "user", content: `Apply the skill "${skill.title}" to this flowchart now.` },
    ],
    temperature: modelId === "gpt-5.5" ? 1 : 0.7,
  });

  const aiResponse = completion.choices[0]?.message?.content || "";
  const mermaidMatch = aiResponse.match(/```mermaid\n([\s\S]*?)```/);
  const updatedMermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

  return res.json({ response: aiResponse, updatedMermaidCode, skillTitle: skill.title });
}
