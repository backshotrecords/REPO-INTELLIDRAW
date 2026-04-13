import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

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

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("sanitization_rules")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) return res.status(500).json({ error: "Failed to fetch rules" });
      return res.status(200).json({ rules: data || [] });
    } 
    
    else if (req.method === "POST") {
      const { rule_description, is_active } = req.body;
      const { data, error } = await supabase
        .from("sanitization_rules")
        .insert({
          rule_description,
          is_active: is_active !== undefined ? is_active : true
        })
        .select("*")
        .single();

      if (error) return res.status(500).json({ error: "Failed to create rule" });
      return res.status(201).json({ rule: data });
    }
    
    else {
      return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (err) {
    console.error("Rules API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
