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

  try {
    // ── GET: List all tutorials ordered by step_order ─────
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("onboarding_tutorials")
        .select("*")
        .order("step_order", { ascending: true });

      if (error) return res.status(500).json({ error: "Failed to fetch tutorials" });
      return res.status(200).json({ tutorials: data || [] });
    }

    // ── POST: Create a new tutorial ──────────────────────
    if (req.method === "POST") {
      const {
        gif_file_data,
        gif_file_name,
        explanation_text,
        attached_page,
        step_order,
        force_existing_users,
      } = req.body || {};

      if (!explanation_text || !attached_page || step_order === undefined) {
        return res.status(400).json({ error: "explanation_text, attached_page, and step_order are required" });
      }

      // Upload GIF to Supabase Storage if provided
      let gifUrl: string | null = null;
      let gifFileName: string | null = null;

      if (gif_file_data) {
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

        gifUrl = publicUrlData.publicUrl;
        gifFileName = gif_file_name || "onboarding.gif";
      }

      // Insert the tutorial
      const { data: tutorial, error: insertErr } = await supabase
        .from("onboarding_tutorials")
        .insert({
          step_order: Number(step_order),
          gif_url: gifUrl,
          gif_file_name: gifFileName,
          explanation_text,
          attached_page,
        })
        .select("*")
        .single();

      if (insertErr) {
        console.error("Tutorial insert error:", insertErr);
        return res.status(500).json({ error: "Failed to create tutorial" });
      }

      // Waiver logic: if NOT forcing existing users,
      // find users who have already progressed past this step_order
      // and waive them for this new tutorial
      let waived_count = 0;
      if (force_existing_users === false) {
        // Get all user states
        const { data: states } = await supabase
          .from("user_onboarding_state")
          .select("id, user_id, seen_onboarding");

        if (states && states.length > 0) {
          // Get all tutorials at or before this step_order (excluding the new one)
          const { data: priorTutorials } = await supabase
            .from("onboarding_tutorials")
            .select("id")
            .lte("step_order", Number(step_order))
            .neq("id", tutorial.id);

          const priorIds = new Set((priorTutorials || []).map((t: { id: string }) => t.id));

          for (const state of states) {
            const seen = (state.seen_onboarding || {}) as Record<string, unknown>;
            // Check if user has completed/waived all prior tutorials
            const allPriorSeen = priorIds.size === 0 || [...priorIds].every((pid) => {
              const entry = seen[pid] as { status?: string } | undefined;
              return entry && (entry.status === "completed" || entry.status === "waived");
            });

            if (allPriorSeen && priorIds.size > 0) {
              // This user has progressed past this point — waive them
              const updatedSeen = {
                ...seen,
                [tutorial.id]: {
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

      return res.status(201).json({ tutorial, waived_count });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Onboarding API error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
