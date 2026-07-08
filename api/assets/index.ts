import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import {
  isEntitlementError,
  isFeatureEnabled,
  recordFeatureUsage,
  requireFeature,
  requireFeatureQuota,
  sendEntitlementError,
} from "../lib/entitlements.js";

const VALID_TYPES = new Set(["markdown", "canvas", "project"]);
const VALID_ACCENTS = new Set(["blue", "green", "cyan", "violet", "amber", "rose"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // GET = list assets + links for one root-project scope
  if (req.method === "GET") {
    try {
      await requireFeature(auth.userId, "project.assets");

      const { rootProjectId } = req.query;
      const scopeId = typeof rootProjectId === "string" && rootProjectId ? rootProjectId : null;

      let assetQuery = supabase.from("project_assets")
        .select("*")
        .eq("user_id", auth.userId);
      assetQuery = scopeId
        ? assetQuery.eq("root_project_id", scopeId)
        : assetQuery.is("root_project_id", null);

      const { data: assets, error: assetsError } = await assetQuery.order("created_at", { ascending: true });
      if (assetsError) return res.status(500).json({ error: assetsError.message || "Failed to fetch assets" });

      const assetIds = (assets || []).map((asset) => asset.id);
      let links: unknown[] = [];
      if (assetIds.length > 0 && (await isFeatureEnabled(auth.userId, "project.asset_links"))) {
        const { data: linkRows, error: linksError } = await supabase.from("project_asset_links")
          .select("*")
          .eq("user_id", auth.userId)
          .in("asset_id", assetIds)
          .order("created_at", { ascending: true });
        if (linksError) return res.status(500).json({ error: linksError.message || "Failed to fetch asset links" });
        links = linkRows || [];
      }

      return res.json({ assets: assets || [], links });
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("List project assets error:", err);
      return res.status(500).json({ error: "Failed to fetch project assets" });
    }
  }

  // POST = register an asset in a root-project scope
  if (req.method === "POST") {
    const { root_project_id, type, name, markdown, target_id, accent } = req.body || {};

    if (!type || !VALID_TYPES.has(type)) return res.status(400).json({ error: "Invalid asset type" });
    if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Asset name required" });
    if (type !== "markdown" && !target_id) return res.status(400).json({ error: "target_id required for reference assets" });

    try {
      const { count } = await supabase
        .from("project_assets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.userId);
      await requireFeatureQuota(auth.userId, "project.assets", count || 0);
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Project asset quota check error:", err);
      return res.status(500).json({ error: "Failed to check project asset quota" });
    }

    const row: Record<string, unknown> = {
      user_id: auth.userId,
      root_project_id: root_project_id || null,
      type,
      name: name.trim().slice(0, 80),
      markdown: type === "markdown" ? (typeof markdown === "string" ? markdown.slice(0, 100_000) : "") : null,
      target_id: type === "markdown" ? null : target_id,
      accent: VALID_ACCENTS.has(accent) ? accent : "blue",
    };

    const { data, error } = await supabase.from("project_assets").insert(row).select("*").single();
    if (error) {
      if (error.code === "23503") return res.status(404).json({ error: "Project not found" });
      if (error.code === "42P01") {
        return res.status(409).json({
          error: "Project assets require the production database migration (migration_project_assets.sql).",
        });
      }
      return res.status(500).json({ error: error.message || "Failed to register asset" });
    }

    await recordFeatureUsage(auth.userId, "project.assets", 1, {
      rootProjectId: root_project_id || null,
      type,
    });

    return res.status(201).json({ asset: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
