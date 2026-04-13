import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../../lib/auth.js";
import { supabase } from "../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Check if admin
  const { data: user } = await supabase
    .from("users")
    .select("is_global_admin")
    .eq("id", authPayload.userId)
    .single();

  if (!user?.is_global_admin) {
    return res.status(403).json({ error: "Forbidden: Admins only" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Rule ID is required" });
  }

  try {
    if (req.method === "PUT") {
      const { is_active } = req.body;
      
      const { data, error } = await supabase
        .from("sanitization_rules")
        .update({ is_active })
        .eq("id", id)
        .select("*")
        .single();
        
      if (error) return res.status(500).json({ error: "Failed to update rule" });
      return res.status(200).json({ rule: data });
    }
    
    else if (req.method === "DELETE") {
      const { error } = await supabase
        .from("sanitization_rules")
        .delete()
        .eq("id", id);
        
      if (error) return res.status(500).json({ error: "Failed to delete rule" });
      return res.status(200).json({ success: true });
    }
    
    else {
      return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (err) {
    console.error("Rules API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
