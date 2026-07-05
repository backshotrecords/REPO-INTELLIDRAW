import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { getEntitlements } from "./lib/entitlements.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  try {
    return res.status(200).json(await getEntitlements(auth.userId, { includeUsage: true }));
  } catch (err) {
    console.error("Entitlements API error:", err);
    return res.status(500).json({ error: "Failed to load entitlements" });
  }
}
