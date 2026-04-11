import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth";
import { supabase } from "../lib/db";
import { decrypt } from "../lib/crypto";
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
    const { data: user } = await supabase
      .from("users")
      .select("api_key_encrypted")
      .eq("id", authPayload.userId)
      .single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({ error: "No API key configured", connected: false });
    }

    const apiKey = decrypt(user.api_key_encrypted);
    const openai = new OpenAI({ apiKey });

    // Simple test: list models
    const models = await openai.models.list();
    const modelList = [];
    for await (const model of models) {
      modelList.push(model.id);
      if (modelList.length >= 5) break;
    }

    return res.status(200).json({
      connected: true,
      message: `Successfully connected. ${modelList.length} models available.`,
    });
  } catch (err: unknown) {
    console.error("Test connection error:", err);
    const errorMessage = err instanceof Error ? err.message : "Connection failed";
    return res.status(200).json({
      connected: false,
      message: errorMessage,
    });
  }
}
