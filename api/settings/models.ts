import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth";
import { supabase } from "../lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // GET /api/settings/models — List user's saved models
  if (req.method === "GET") {
    try {
      const { data: models, error } = await supabase
        .from("ai_models")
        .select("id, model_id, label, added_at")
        .eq("user_id", userId)
        .order("added_at", { ascending: true });

      // Also get active model ID
      const { data: user } = await supabase
        .from("users")
        .select("active_model_id")
        .eq("id", userId)
        .single();

      if (error) {
        return res.status(500).json({ error: "Failed to fetch models" });
      }

      return res.status(200).json({
        models: models || [],
        activeModelId: user?.active_model_id || null,
      });
    } catch (err) {
      console.error("List models error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // POST /api/settings/models — Add a new model
  if (req.method === "POST") {
    const { modelId, label } = req.body || {};

    if (!modelId) {
      return res.status(400).json({ error: "Model ID is required" });
    }

    try {
      const { data, error } = await supabase
        .from("ai_models")
        .insert({
          user_id: userId,
          model_id: modelId,
          label: label || modelId,
        })
        .select("id, model_id, label, added_at")
        .single();

      if (error) {
        return res.status(500).json({ error: "Failed to add model" });
      }

      // If this is the user's first model, set it as active
      const { data: user } = await supabase
        .from("users")
        .select("active_model_id")
        .eq("id", userId)
        .single();

      if (!user?.active_model_id) {
        await supabase
          .from("users")
          .update({ active_model_id: data.id })
          .eq("id", userId);
      }

      return res.status(201).json({ model: data });
    } catch (err) {
      console.error("Add model error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // DELETE — handled via query param
  if (req.method === "DELETE") {
    const modelDbId = req.query.modelId as string;
    if (!modelDbId) {
      return res.status(400).json({ error: "Model ID is required" });
    }

    try {
      // Check if this is the active model
      const { data: user } = await supabase
        .from("users")
        .select("active_model_id")
        .eq("id", userId)
        .single();

      if (user?.active_model_id === modelDbId) {
        // Unset active model
        await supabase
          .from("users")
          .update({ active_model_id: null })
          .eq("id", userId);
      }

      const { error } = await supabase
        .from("ai_models")
        .delete()
        .eq("id", modelDbId)
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({ error: "Failed to delete model" });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Delete model error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // PUT — Set active model
  if (req.method === "PUT") {
    const { modelId: activeModelId } = req.body || {};

    try {
      const { error } = await supabase
        .from("users")
        .update({ active_model_id: activeModelId })
        .eq("id", userId);

      if (error) {
        return res.status(500).json({ error: "Failed to set active model" });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Set active model error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
