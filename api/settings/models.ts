import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // GET /api/settings/models — List all global models (shared across users)
  if (req.method === "GET") {
    try {
      const { data: models, error } = await supabase
        .from("ai_models")
        .select("id, model_id, label, added_at")
        .order("added_at", { ascending: true });

      // Also get this user's active model ID
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

  // POST /api/settings/models — Add a new global model (admin only)
  if (req.method === "POST") {
    // Admin check
    const { data: adminUser } = await supabase
      .from("users")
      .select("is_global_admin")
      .eq("id", userId)
      .single();

    if (!adminUser?.is_global_admin) {
      return res.status(403).json({ error: "Forbidden: Admins only" });
    }

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

      return res.status(201).json({ model: data });
    } catch (err) {
      console.error("Add model error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // DELETE — handled via query param (admin only)
  if (req.method === "DELETE") {
    // Admin check
    const { data: adminUser } = await supabase
      .from("users")
      .select("is_global_admin")
      .eq("id", userId)
      .single();

    if (!adminUser?.is_global_admin) {
      return res.status(403).json({ error: "Forbidden: Admins only" });
    }

    const modelDbId = req.query.modelId as string;
    if (!modelDbId) {
      return res.status(400).json({ error: "Model ID is required" });
    }

    try {
      // Nullify active_model_id for ALL users who had this model selected
      await supabase
        .from("users")
        .update({ active_model_id: null })
        .eq("active_model_id", modelDbId);

      const { error } = await supabase
        .from("ai_models")
        .delete()
        .eq("id", modelDbId);

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
