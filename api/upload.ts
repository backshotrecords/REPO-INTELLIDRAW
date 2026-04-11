import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth";
import { supabase } from "./lib/db";
import { decrypt } from "./lib/crypto";
import OpenAI from "openai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
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

    // Parse the uploaded file from the request body (base64 encoded)
    const { fileData, fileName, fileType } = req.body;

    if (!fileData) {
      return res.status(400).json({ error: "No file data provided" });
    }

    const openai = new OpenAI({ apiKey });

    // Determine if it's an image or document
    const isImage = fileType?.startsWith("image/");

    let aiResponse: string;

    if (isImage) {
      // Use vision model for images
      const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: "system",
            content: `You are IntelliDraw, an AI that analyzes images and documents to generate Mermaid flowcharts.
            
When given an image or document, analyze its content and create a comprehensive Mermaid flowchart that represents the processes, workflows, relationships, or structure shown.

ALWAYS output the complete Mermaid code in a fenced code block with the language identifier "mermaid".
Use descriptive node labels and proper flow connections.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this ${fileName ? `file "${fileName}"` : "image"} and create a Mermaid flowchart that represents its content, structure, or workflow.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${fileType};base64,${fileData}`,
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
      });

      aiResponse = completion.choices[0]?.message?.content || "";
    } else {
      // For documents, decode the text content and send as text
      const textContent = Buffer.from(fileData, "base64").toString("utf-8");

      const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: "system",
            content: `You are IntelliDraw, an AI that analyzes documents to generate Mermaid flowcharts.
            
When given document content, analyze it and create a comprehensive Mermaid flowchart that represents the processes, workflows, relationships, or structure described.

ALWAYS output the complete Mermaid code in a fenced code block with the language identifier "mermaid".
Use descriptive node labels and proper flow connections.`,
          },
          {
            role: "user",
            content: `Analyze this document "${fileName || "document"}" and create a Mermaid flowchart:\n\n${textContent.slice(0, 8000)}`,
          },
        ],
        max_tokens: 4096,
      });

      aiResponse = completion.choices[0]?.message?.content || "";
    }

    // Extract mermaid code
    const mermaidMatch = aiResponse.match(/```mermaid\n([\s\S]*?)```/);
    const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    return res.status(200).json({
      response: aiResponse,
      mermaidCode,
      model: modelId,
    });
  } catch (err: unknown) {
    console.error("Upload analysis error:", err);
    const errorMessage = err instanceof Error ? err.message : "Failed to analyze file";
    return res.status(500).json({ error: errorMessage });
  }
}
