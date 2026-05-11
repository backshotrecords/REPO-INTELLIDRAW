import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { cascadeDeleteUser } from "../lib/delete-user.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Authenticate
    const authPayload = await authenticateRequest(req);
    if (!authPayload) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Require email confirmation in body
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email confirmation is required" });
    }

    // Email must match the authenticated user's email
    if (email.toLowerCase().trim() !== authPayload.email.toLowerCase().trim()) {
      return res.status(400).json({ error: "Email does not match your account" });
    }

    // Block global admins from self-deleting
    const { data: currentUser } = await supabase
      .from("users")
      .select("is_global_admin")
      .eq("id", authPayload.userId)
      .single();

    if (currentUser?.is_global_admin) {
      return res.status(403).json({
        error: "Global admins cannot delete their own account. Please contact another admin.",
      });
    }

    // Perform cascading delete
    const result = await cascadeDeleteUser(authPayload.userId);

    return res.status(200).json({
      success: true,
      deleted_email: result.deleted_email,
      deleted_name: result.deleted_name,
    });
  } catch (err) {
    console.error("Self-delete account error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
