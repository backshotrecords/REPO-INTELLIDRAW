import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import {
  normalizeProjectAccent,
  normalizeProjectId,
  PROJECT_SELECT,
  touchProjectAncestors,
} from "../lib/canvas-projects.js";
import { canEdit, getProjectAccess, withAccessMetadata } from "../lib/project-access.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  if (req.method === "GET") {
    try {
      const { data: ownedProjects, error } = await supabase
        .from("canvas_projects")
        .select(PROJECT_SELECT)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("List projects error:", error);
        return res.status(500).json({ error: "Failed to fetch projects" });
      }

      const ownedRows = (ownedProjects || []) as Record<string, unknown>[];
      const ownedProjectIds = ownedRows.map((project) => String(project.id));
      const ownerShareSummaries = new Map<string, { count: number; names: string[] }>();
      const ownedProjectsById = new Map(ownedRows.map((project) => [String(project.id), project]));

      if (ownedProjectIds.length > 0) {
        const { data: ownerShares, error: ownerShareError } = await supabase
          .from("project_shares")
          .select("project_id, user_groups(name)")
          .in("project_id", ownedProjectIds);

        if (ownerShareError) {
          console.error("List owned project shares error:", ownerShareError);
        } else {
          for (const share of (ownerShares || []) as Array<{ project_id: string; user_groups?: { name?: string } | null }>) {
            const summary = ownerShareSummaries.get(share.project_id) ?? { count: 0, names: [] };
            summary.count += 1;
            if (share.user_groups?.name) summary.names.push(share.user_groups.name);
            ownerShareSummaries.set(share.project_id, summary);
          }
        }
      }

      const getInheritedShareSummary = (project: Record<string, unknown>) => {
        const seen = new Set<string>();
        let current: Record<string, unknown> | undefined = project;

        while (current) {
          const currentId = String(current.id);
          if (seen.has(currentId)) break;
          seen.add(currentId);

          const summary = ownerShareSummaries.get(currentId);
          if (summary) return summary;

          const parentId = current.parent_project_id ? String(current.parent_project_id) : "";
          current = parentId ? ownedProjectsById.get(parentId) : undefined;
        }

        return null;
      };

      const ownedWithAccess = ownedRows.map((project) => {
        const shareSummary = getInheritedShareSummary(project);
        return {
          ...withAccessMetadata(project, { accessLevel: "owner" }),
          shared_with_group_count: shareSummary?.count ?? 0,
          shared_with_group_names: shareSummary?.names ?? [],
        };
      });

      const { data: memberships } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", userId);
      const groupIds = ((memberships || []) as Array<{ group_id: string }>).map((membership) => membership.group_id);
      const sharedProjects: Record<string, unknown>[] = [];

      if (groupIds.length > 0) {
        const { data: shares, error: shareError } = await supabase
          .from("project_shares")
          .select("project_id, shared_with_group_id, access_level, user_groups(name)")
          .in("shared_with_group_id", groupIds);

        if (shareError) {
          console.error("List project shares error:", shareError);
        } else {
          const shareRows = (shares || []) as Array<{
            project_id: string;
            shared_with_group_id: string;
            access_level: "view" | "edit";
            user_groups?: { name?: string } | null;
          }>;
          const rootIds = [...new Set(shareRows.map((share) => share.project_id))];

          if (rootIds.length > 0) {
            const { data: rootRows } = await supabase
              .from("canvas_projects")
              .select(PROJECT_SELECT)
              .in("id", rootIds);
            const roots = ((rootRows || []) as Record<string, unknown>[]).filter((project) => project.user_id !== userId);
            const ownerIds = [...new Set(roots.map((project) => String(project.user_id)))];
            const { data: ownerProjectRows } = ownerIds.length > 0
              ? await supabase
                .from("canvas_projects")
                .select(PROJECT_SELECT)
                .in("user_id", ownerIds)
              : { data: [] as Record<string, unknown>[] };
            const projectsByParent = new Map<string, Record<string, unknown>[]>();

            for (const project of (ownerProjectRows || []) as Record<string, unknown>[]) {
              const parentId = project.parent_project_id ? String(project.parent_project_id) : "";
              const children = projectsByParent.get(parentId) ?? [];
              children.push(project);
              projectsByParent.set(parentId, children);
            }

            const rootById = new Map(roots.map((project) => [String(project.id), project]));
            const shareByRoot = new Map<string, typeof shareRows[number]>();
            for (const share of shareRows) {
              const current = shareByRoot.get(share.project_id);
              if (!current || share.access_level === "edit") shareByRoot.set(share.project_id, share);
            }

            const addSharedSubtree = (project: Record<string, unknown>, share: typeof shareRows[number], isRoot: boolean) => {
              const displayProject = {
                ...project,
                parent_project_id: isRoot ? null : project.parent_project_id,
              };
              sharedProjects.push(withAccessMetadata(displayProject, {
                accessLevel: share.access_level,
                sharedRootProjectId: share.project_id,
                sharedViaGroupId: share.shared_with_group_id,
                sharedViaGroupName: share.user_groups?.name || "",
              }));

              for (const child of projectsByParent.get(String(project.id)) ?? []) {
                addSharedSubtree(child, share, false);
              }
            };

            for (const [rootId, share] of shareByRoot.entries()) {
              const root = rootById.get(rootId);
              if (root) addSharedSubtree(root, share, true);
            }
          }
        }
      }

      const seen = new Set<string>();
      const projects = [...ownedWithAccess, ...sharedProjects].filter((project) => {
        const key = `${project.access_level}:${project.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return res.status(200).json({ projects });
    } catch (err) {
      console.error("List projects error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "POST") {
    const { title, description, accent, parentProjectId } = req.body || {};
    const parentId = normalizeProjectId(parentProjectId);

    try {
      let ownerUserId = userId;
      if (parentId) {
        const parentAccess = await getProjectAccess(parentId, userId);
        if (!parentAccess) return res.status(400).json({ error: "Parent project not found" });
        if (!canEdit(parentAccess)) return res.status(403).json({ error: "You do not have permission to add folders here" });
        ownerUserId = parentAccess.ownerUserId;
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("canvas_projects")
        .insert({
          user_id: ownerUserId,
          parent_project_id: parentId ?? null,
          title: String(title || "Untitled Project").slice(0, 80),
          description: String(description || "").slice(0, 240),
          accent: normalizeProjectAccent(accent),
          manually_archived: false,
          updated_at: now,
        })
        .select(PROJECT_SELECT)
        .single();

      if (error || !data) {
        console.error("Create project error:", error);
        return res.status(500).json({ error: "Failed to create project" });
      }

      if (parentId) await touchProjectAncestors(parentId, ownerUserId, now);

      return res.status(201).json({
        project: withAccessMetadata(data as Record<string, unknown>, {
          accessLevel: ownerUserId === userId ? "owner" : "edit",
        }),
      });
    } catch (err) {
      console.error("Create project error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
