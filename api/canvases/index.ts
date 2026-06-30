import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { normalizeProjectId, touchProjectAncestors } from "../lib/canvas-projects.js";
import {
  capabilitiesForShareRow,
  legacyAccessForCapabilities,
  loadRoleCapabilityMap,
  roleSummaryForShareRow,
} from "../lib/collaboration-roles.js";
import {
  isEntitlementError,
  requireFeatureQuota,
  sendEntitlementError,
} from "../lib/entitlements.js";
import { getProjectAccess, hasCapability, withAccessMetadata } from "../lib/project-access.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // GET /api/canvases — List all canvases for the user
  if (req.method === "GET") {
    try {
      const { data: ownedCanvases, error } = await supabase
        .from("canvases")
        .select("id, title, is_public, project_id, manually_archived, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("List canvases error:", error);
        return res.status(500).json({ error: "Failed to fetch canvases" });
      }

      const canvases = ((ownedCanvases || []) as Record<string, unknown>[]).map((canvas) => (
        withAccessMetadata(canvas, { accessLevel: "owner" })
      ));

      const { data: memberships } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", userId);
      const groupIds = ((memberships || []) as Array<{ group_id: string }>).map((membership) => membership.group_id);

      if (groupIds.length > 0) {
        const { data: shares, error: shareError } = await supabase
          .from("project_shares")
          .select("project_id, shared_with_group_id, access_level, role_id, user_groups(name), collaboration_roles(id, name, description, is_system_role)")
          .in("shared_with_group_id", groupIds);

        if (shareError) {
          console.error("List shared canvas projects error:", shareError);
        } else {
          const shareRows = (shares || []) as Array<{
            project_id: string;
            shared_with_group_id: string;
            access_level: "view" | "edit";
            role_id?: string | null;
            user_groups?: { name?: string } | null;
            collaboration_roles?: { id?: string; name?: string; description?: string; is_system_role?: boolean } | null;
          }>;
          const roleCapabilityMap = await loadRoleCapabilityMap(shareRows.map((share) => share.role_id || ""));
          const rootIds = [...new Set(shareRows.map((share) => share.project_id))];
          const { data: rootRows } = rootIds.length > 0
            ? await supabase.from("canvas_projects").select("id, user_id").in("id", rootIds)
            : { data: [] as Record<string, unknown>[] };
          const roots = ((rootRows || []) as Record<string, unknown>[]).filter((project) => project.user_id !== userId);
          const ownerIds = [...new Set(roots.map((project) => String(project.user_id)))];
          const { data: ownerProjectRows } = ownerIds.length > 0
            ? await supabase.from("canvas_projects").select("id, parent_project_id").in("user_id", ownerIds)
            : { data: [] as Record<string, unknown>[] };

          const projectsByParent = new Map<string, Record<string, unknown>[]>();
          for (const project of (ownerProjectRows || []) as Record<string, unknown>[]) {
            const parentId = project.parent_project_id ? String(project.parent_project_id) : "";
            const children = projectsByParent.get(parentId) ?? [];
            children.push(project);
            projectsByParent.set(parentId, children);
          }

          const shareByProjectId = new Map<string, typeof shareRows[number]>();
          const collectProjectIds = (projectId: string, share: typeof shareRows[number]) => {
            const current = shareByProjectId.get(projectId);
            const shareCapabilities = capabilitiesForShareRow(share, roleCapabilityMap);
            const currentCapabilities = current ? capabilitiesForShareRow(current, roleCapabilityMap) : [];
            const shareAccess = legacyAccessForCapabilities(shareCapabilities);
            const currentAccess = legacyAccessForCapabilities(currentCapabilities);
            if (
              !current ||
              (shareAccess === "edit" && currentAccess !== "edit") ||
              (shareAccess === currentAccess && shareCapabilities.length > currentCapabilities.length)
            ) {
              shareByProjectId.set(projectId, share);
            }
            for (const child of projectsByParent.get(projectId) ?? []) collectProjectIds(String(child.id), share);
          };

          const rootIdsOwnedByOthers = new Set(roots.map((project) => String(project.id)));
          for (const share of shareRows) {
            if (rootIdsOwnedByOthers.has(share.project_id)) collectProjectIds(share.project_id, share);
          }

          const sharedProjectIds = [...shareByProjectId.keys()];
          if (sharedProjectIds.length > 0) {
            const { data: sharedCanvasRows, error: sharedCanvasError } = await supabase
              .from("canvases")
              .select("id, title, is_public, project_id, manually_archived, created_at, updated_at")
              .in("project_id", sharedProjectIds)
              .order("updated_at", { ascending: false });

            if (sharedCanvasError) {
              console.error("List shared canvases error:", sharedCanvasError);
            } else {
              for (const canvas of (sharedCanvasRows || []) as Record<string, unknown>[]) {
                const share = shareByProjectId.get(String(canvas.project_id));
                if (!share) continue;
                const capabilities = capabilitiesForShareRow(share, roleCapabilityMap);
                const role = roleSummaryForShareRow(share);
                canvases.push(withAccessMetadata(canvas, {
                  accessLevel: legacyAccessForCapabilities(capabilities),
                  capabilities,
                  accessRoleId: role?.id,
                  accessRoleName: role?.name,
                  sharedRootProjectId: share.project_id,
                  sharedViaGroupId: share.shared_with_group_id,
                  sharedViaGroupName: share.user_groups?.name || "",
                }));
              }
            }
          }
        }
      }

      const seen = new Set<string>();
      const uniqueCanvases = canvases.filter((canvas) => {
        const key = String(canvas.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return res.status(200).json({ canvases: uniqueCanvases });
    } catch (err) {
      console.error("List canvases error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // POST /api/canvases — Create a new canvas
  if (req.method === "POST") {
    const { title, mermaidCode, projectId } = req.body || {};
    const parentProjectId = normalizeProjectId(projectId);

    try {
      const { count } = await supabase
        .from("canvases")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      await requireFeatureQuota(userId, "canvas.create", count || 0);

      let ownerUserId = userId;
      let inheritedAccess = null as Awaited<ReturnType<typeof getProjectAccess>> | null;
      if (parentProjectId) {
        const projectAccess = await getProjectAccess(parentProjectId, userId);
        if (!projectAccess) return res.status(400).json({ error: "Project not found" });
        if (!hasCapability(projectAccess, "canvas.create")) {
          return res.status(403).json({ error: "You do not have permission to add canvases here" });
        }
        ownerUserId = projectAccess.ownerUserId;
        inheritedAccess = projectAccess;
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("canvases")
        .insert({
          user_id: ownerUserId,
          title: (title ? String(title).slice(0, 80) : "Untitled Canvas"),
          mermaid_code: mermaidCode || "flowchart TD\n    A[Start] --> B[Next Step]",
          chat_history: [],
          project_id: parentProjectId ?? null,
          manually_archived: false,
          updated_at: now,
        })
        .select("id, title, mermaid_code, chat_history, is_public, project_id, manually_archived, created_at, updated_at")
        .single();

      if (error) {
        console.error("Create canvas error:", error);
        return res.status(500).json({ error: "Failed to create canvas" });
      }

      if (parentProjectId) await touchProjectAncestors(parentProjectId, ownerUserId, now);

      return res.status(201).json({
        canvas: withAccessMetadata(
          data as Record<string, unknown>,
          ownerUserId === userId ? { accessLevel: "owner" } : inheritedAccess ?? { accessLevel: "edit" },
        ),
      });
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Create canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
