import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import {
  CAPABILITY_DEFINITIONS,
  getCollaborationRole,
  listCollaborationRoles,
  normalizeCapabilities,
} from "../lib/collaboration-roles.js";

async function isGlobalAdmin(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("is_global_admin")
    .eq("id", userId)
    .single();

  return Boolean(data?.is_global_admin);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (!(await isGlobalAdmin(auth.userId))) return res.status(403).json({ error: "Forbidden: Admins only" });

  if (req.method === "GET") {
    try {
      const roles = await listCollaborationRoles();
      return res.status(200).json({ roles, capabilities: CAPABILITY_DEFINITIONS });
    } catch (err) {
      console.error("List collaboration roles error:", err);
      return res.status(500).json({ error: "Failed to load collaboration roles" });
    }
  }

  if (req.method === "POST") {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const description = String(req.body?.description || "").trim().slice(0, 240);
    const capabilities = normalizeCapabilities(req.body?.capabilities);

    if (!name) return res.status(400).json({ error: "Role name is required" });

    try {
      const { data: created, error: createError } = await supabase
        .from("collaboration_roles")
        .insert({
          name,
          description,
          is_system_role: false,
          created_by: auth.userId,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (createError || !created) {
        return res.status(400).json({ error: createError?.message || "Failed to create role" });
      }

      if (capabilities.length > 0) {
        const { error: capabilityError } = await supabase
          .from("collaboration_role_capabilities")
          .insert(capabilities.map((capability) => ({ role_id: created.id, capability })));

        if (capabilityError) {
          return res.status(500).json({ error: capabilityError.message || "Failed to save role capabilities" });
        }
      }

      const role = await getCollaborationRole(created.id);
      return res.status(201).json({ role });
    } catch (err) {
      console.error("Create collaboration role error:", err);
      return res.status(500).json({ error: "Failed to create role" });
    }
  }

  if (req.method === "PUT") {
    const roleId = String(req.body?.id || "");
    const name = req.body?.name === undefined ? undefined : String(req.body.name || "").trim().slice(0, 80);
    const description = req.body?.description === undefined
      ? undefined
      : String(req.body.description || "").trim().slice(0, 240);
    const capabilitiesProvided = Array.isArray(req.body?.capabilities);
    const capabilities = normalizeCapabilities(req.body?.capabilities);

    if (!roleId) return res.status(400).json({ error: "Role ID is required" });
    if (name !== undefined && !name) return res.status(400).json({ error: "Role name is required" });

    try {
      const existing = await getCollaborationRole(roleId);
      if (!existing) return res.status(404).json({ error: "Role not found" });

      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (description !== undefined) updateData.description = description;
      if (name !== undefined && !existing.is_system_role) updateData.name = name;

      const { error: updateError } = await supabase
        .from("collaboration_roles")
        .update(updateData)
        .eq("id", roleId);

      if (updateError) return res.status(400).json({ error: updateError.message || "Failed to update role" });

      if (capabilitiesProvided) {
        const { error: deleteError } = await supabase
          .from("collaboration_role_capabilities")
          .delete()
          .eq("role_id", roleId);

        if (deleteError) return res.status(500).json({ error: deleteError.message || "Failed to update capabilities" });

        if (capabilities.length > 0) {
          const { error: insertError } = await supabase
            .from("collaboration_role_capabilities")
            .insert(capabilities.map((capability) => ({ role_id: roleId, capability })));

          if (insertError) return res.status(500).json({ error: insertError.message || "Failed to update capabilities" });
        }
      }

      const role = await getCollaborationRole(roleId);
      return res.status(200).json({ role });
    } catch (err) {
      console.error("Update collaboration role error:", err);
      return res.status(500).json({ error: "Failed to update role" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
