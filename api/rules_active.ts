import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { supabase } from "./lib/db.js";

/**
 * Returns active sanitization rule descriptions.
 * Any authenticated user can access this (used by the auto-fix flow).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data, error } = await supabase
      .from("sanitization_rules")
      .select("rule_description")
      .eq("is_active", true);

    if (error) return res.status(500).json({ error: "Failed to fetch rules" });

    const descriptions = (data || []).map((r) => r.rule_description);
    return res.status(200).json({ rules: descriptions });
  } catch (err) {
    console.error("Rules active error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
