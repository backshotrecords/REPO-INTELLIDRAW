import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

const MAX_PREVIEW_CODE_IDS = 120;

function normalizeIds(value: unknown): string[] {
  const rawIds = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      rawIds
        .map((id) => String(id).trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_PREVIEW_CODE_IDS);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ids = normalizeIds(req.method === "POST" ? req.body?.ids : req.query.ids);
  if (ids.length === 0) {
    return res.status(200).json({ canvases: [] });
  }

  try {
    const { data, error } = await supabase
      .from("canvases")
      .select("id, title, mermaid_code, updated_at")
      .eq("user_id", authPayload.userId)
      .in("id", ids);

    if (error) {
      console.error("Preview code fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch canvas preview code" });
    }

    const byId = new Map((data || []).map((canvas) => [canvas.id, canvas]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

    return res.status(200).json({ canvases: ordered });
  } catch (err) {
    console.error("Preview code fetch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
