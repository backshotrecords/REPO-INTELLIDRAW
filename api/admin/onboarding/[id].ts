import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Admin gate
  const { data: user } = await supabase
    .from("users")
    .select("is_global_admin")
    .eq("id", authPayload.userId)
    .single();

  if (!user?.is_global_admin) {
    return res.status(403).json({ error: "Forbidden: Admins only" });
  }

  const tutorialId = req.query.id as string;
  if (!tutorialId) {
    return res.status(400).json({ error: "Tutorial ID is required" });
  }

  try {
    // ── PUT: Update a tutorial ────────────────────────────
    if (req.method === "PUT") {
      const {
        gif_file_data,
        gif_file_name,
        explanation_text,
        attached_page,
        step_order,
        force_existing_users,
      } = req.body || {};

      // Fetch current tutorial for comparison
      const { data: current, error: fetchErr } = await supabase
        .from("onboarding_tutorials")
        .select("*")
        .eq("id", tutorialId)
        .single();

      if (fetchErr || !current) {
        return res.status(404).json({ error: "Tutorial not found" });
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // Detect content changes (GIF or explanation_text) → set content_updated_at
      let contentChanged = false;

      if (explanation_text !== undefined && explanation_text !== current.explanation_text) {
        updates.explanation_text = explanation_text;
        contentChanged = true;
      }

      if (attached_page !== undefined) {
        updates.attached_page = attached_page;
      }

      // Handle GIF replacement
      if (gif_file_data) {
        // Delete old GIF from storage if it exists
        if (current.gif_url && current.gif_url.includes("/onboarding-gifs/")) {
          const oldFileName = current.gif_url.split("/onboarding-gifs/").pop();
          if (oldFileName) {
            await supabase.storage.from("onboarding-gifs").remove([oldFileName]);
          }
        }

        const ext = gif_file_name?.match(/\.[^.]+$/)?.[0] || ".gif";
        const storagePath = `onboarding-${Date.now()}${ext}`;
        const buffer = Buffer.from(gif_file_data, "base64");

        const { error: uploadErr } = await supabase.storage
          .from("onboarding-gifs")
          .upload(storagePath, buffer, {
            contentType: "image/gif",
            upsert: true,
          });

        if (uploadErr) {
          console.error("GIF upload error:", uploadErr);
          return res.status(500).json({ error: "Failed to upload GIF" });
        }

        const { data: publicUrlData } = supabase.storage
          .from("onboarding-gifs")
          .getPublicUrl(storagePath);

        updates.gif_url = publicUrlData.publicUrl;
        updates.gif_file_name = gif_file_name || "onboarding.gif";
        contentChanged = true;
      }

      if (contentChanged) {
        updates.content_updated_at = new Date().toISOString();
      }

      // Handle step_order change + waiver logic
      const oldStepOrder = current.step_order;
      let waived_count = 0;

      if (step_order !== undefined && Number(step_order) !== oldStepOrder) {
        updates.step_order = Number(step_order);

        // If step moved earlier (lower number) and not forcing existing users,
        // waive users who already passed the new position but haven't seen this tutorial
        if (force_existing_users === false) {
          const { data: states } = await supabase
            .from("user_onboarding_state")
            .select("id, user_id, seen_onboarding");

          if (states && states.length > 0) {
            for (const state of states) {
              const seen = (state.seen_onboarding || {}) as Record<string, { status?: string }>;
              const entry = seen[tutorialId];

              // Only waive if user hasn't already seen/waived this tutorial
              if (!entry || (!entry.status)) {
                // Check if user has progressed past the new step_order
                // by checking if they've completed tutorials at or before this position
                const { data: priorTutorials } = await supabase
                  .from("onboarding_tutorials")
                  .select("id")
                  .lte("step_order", Number(step_order))
                  .neq("id", tutorialId);

                const priorIds = (priorTutorials || []).map((t: { id: string }) => t.id);
                const allPriorSeen = priorIds.length > 0 && priorIds.every((pid: string) => {
                  const priorEntry = seen[pid];
                  return priorEntry && (priorEntry.status === "completed" || priorEntry.status === "waived");
                });

                if (allPriorSeen) {
                  const updatedSeen = {
                    ...seen,
                    [tutorialId]: {
                      status: "waived",
                      seen_at: null,
                      content_updated_at_seen: null,
                      waived_at: new Date().toISOString(),
                    },
                  };

                  await supabase
                    .from("user_onboarding_state")
                    .update({ seen_onboarding: updatedSeen, updated_at: new Date().toISOString() })
                    .eq("id", state.id);

                  waived_count++;
                }
              }
            }
          }
        }
      }

      // Apply updates
      const { data: updated, error: updateErr } = await supabase
        .from("onboarding_tutorials")
        .update(updates)
        .eq("id", tutorialId)
        .select("*")
        .single();

      if (updateErr) {
        console.error("Tutorial update error:", updateErr);
        return res.status(500).json({ error: "Failed to update tutorial" });
      }

      return res.status(200).json({
        tutorial: updated,
        content_changed: contentChanged,
        waived_count,
      });
    }

    // ── DELETE: Delete a tutorial ─────────────────────────
    if (req.method === "DELETE") {
      // Delete GIF from storage if it exists
      const { data: current } = await supabase
        .from("onboarding_tutorials")
        .select("gif_url")
        .eq("id", tutorialId)
        .single();

      if (current?.gif_url && current.gif_url.includes("/onboarding-gifs/")) {
        const oldFileName = current.gif_url.split("/onboarding-gifs/").pop();
        if (oldFileName) {
          await supabase.storage.from("onboarding-gifs").remove([oldFileName]);
        }
      }

      const { error } = await supabase
        .from("onboarding_tutorials")
        .delete()
        .eq("id", tutorialId);

      if (error) {
        return res.status(500).json({ error: "Failed to delete tutorial" });
      }

      // Orphan JSON entries are left in place — harmless
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Onboarding [id] API error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
