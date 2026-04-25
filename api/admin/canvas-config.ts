import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

async function getCanvasConfig() {
  const { data: rows } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ["max_zoom_level"]);

  const cfg: Record<string, string> = {};
  for (const row of rows || []) cfg[row.key] = row.value;

  return {
    maxZoomLevel: parseFloat(cfg.max_zoom_level ?? "16"), // default 1600%
  };
}

async function setConfig(key: string, value: string) {
  const { error } = await supabase
    .from("admin_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(`Config save failed for "${key}": ${error.message}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth required for all methods (assuming this is required even for GET, similar to sound config, 
  // wait, WorkspacePage needs this but might not always have auth for public views. Let's see...
  // PublicViewPage might not have auth. Let me check sound-config.ts)
  // Wait, if it's for PublicViewPage, the sound-config currently requires Auth:
  // "const authPayload = await authenticateRequest(req); if (!authPayload) return 401"
  // Let me check if PublicViewPage actually fetches sound-settings. It probably doesn't or fails silently.
  // We'll leave it as non-authenticated for GET, or follow sound-config pattern.
  // Actually, canvas config applies to Public View. Let's make GET open to everyone.

  try {
    if (req.method === "GET") {
      const config = await getCanvasConfig();
      return res.status(200).json(config);
    }

    // Auth required for PUT
    const authPayload = await authenticateRequest(req);
    if (!authPayload) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method === "PUT") {
      const { data: user } = await supabase
        .from("users")
        .select("is_global_admin")
        .eq("id", authPayload.userId)
        .single();

      if (!user?.is_global_admin) {
        return res.status(403).json({ error: "Forbidden: Admins only" });
      }

      const { maxZoomLevel } = req.body || {};

      if (maxZoomLevel !== undefined) await setConfig("max_zoom_level", String(maxZoomLevel));

      const config = await getCanvasConfig();
      return res.status(200).json(config);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Canvas config API error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
