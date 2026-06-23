import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { listCollaborationRoleSummaries } from "./lib/collaboration-roles.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const roles = await listCollaborationRoleSummaries();
    return res.status(200).json({ roles });
  } catch (err) {
    console.error("List collaboration role summaries error:", err);
    return res.status(500).json({ error: "Failed to load collaboration roles" });
  }
}
