import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

interface SeenEntry {
  status: "completed" | "waived";
  seen_at: string | null;
  content_updated_at_seen: string | null;
  waived_at: string | null;
}

interface OnboardingTutorial {
  id: string;
  step_order: number;
  gif_url: string | null;
  gif_file_name: string | null;
  explanation_text: string;
  attached_page: string;
  content_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // ── GET: Get user's onboarding state + next required tutorial ──
    if (req.method === "GET") {
      // Get or create user onboarding state
      let { data: state } = await supabase
        .from("user_onboarding_state")
        .select("*")
        .eq("user_id", authPayload.userId)
        .single();

      if (!state) {
        // Create new state with empty seen map
        const { data: newState, error: createErr } = await supabase
          .from("user_onboarding_state")
          .insert({
            user_id: authPayload.userId,
            seen_onboarding: {},
          })
          .select("*")
          .single();

        if (createErr) {
          console.error("Failed to create onboarding state:", createErr);
          return res.status(500).json({ error: "Failed to initialize onboarding state" });
        }
        state = newState;
      }

      // Get all tutorials ordered by step_order
      const { data: tutorials, error: tutErr } = await supabase
        .from("onboarding_tutorials")
        .select("*")
        .order("step_order", { ascending: true });

      if (tutErr) {
        return res.status(500).json({ error: "Failed to fetch tutorials" });
      }

      const seen = (state.seen_onboarding || {}) as Record<string, SeenEntry>;
      const allTutorials = (tutorials || []) as OnboardingTutorial[];

      // Find the first required tutorial:
      // 1. Not in seen map at all (never completed or waived)
      // 2. In seen map as "completed" but content_updated_at > content_updated_at_seen (needs rewatch)
      let nextRequired: OnboardingTutorial | null = null;
      let isRewatch = false;

      for (const tutorial of allTutorials) {
        const entry = seen[tutorial.id];

        if (!entry) {
          // Never seen — this is the next one
          nextRequired = tutorial;
          isRewatch = false;
          break;
        }

        if (entry.status === "waived") {
          // Waived — skip
          continue;
        }

        if (entry.status === "completed") {
          // Check if content was updated after user last saw it
          if (
            tutorial.content_updated_at &&
            entry.content_updated_at_seen &&
            new Date(tutorial.content_updated_at) > new Date(entry.content_updated_at_seen)
          ) {
            nextRequired = tutorial;
            isRewatch = true;
            break;
          }

          if (
            tutorial.content_updated_at &&
            !entry.content_updated_at_seen
          ) {
            // Tutorial has been updated but user saw it before updates were tracked
            nextRequired = tutorial;
            isRewatch = true;
            break;
          }

          // Completed and up to date — skip
          continue;
        }
      }

      return res.status(200).json({
        state,
        next_required: nextRequired,
        is_rewatch: isRewatch,
        total_tutorials: allTutorials.length,
        completed_count: Object.values(seen).filter(
          (e) => e.status === "completed" || e.status === "waived"
        ).length,
      });
    }

    // ── POST: Mark a tutorial as completed ────────────────
    if (req.method === "POST") {
      const { onboarding_id } = req.body || {};

      if (!onboarding_id) {
        return res.status(400).json({ error: "onboarding_id is required" });
      }

      // Get the tutorial to snapshot content_updated_at
      const { data: tutorial } = await supabase
        .from("onboarding_tutorials")
        .select("content_updated_at")
        .eq("id", onboarding_id)
        .single();

      if (!tutorial) {
        return res.status(404).json({ error: "Tutorial not found" });
      }

      // Get current state
      const { data: state } = await supabase
        .from("user_onboarding_state")
        .select("id, seen_onboarding")
        .eq("user_id", authPayload.userId)
        .single();

      if (!state) {
        return res.status(404).json({ error: "Onboarding state not found" });
      }

      const seen = (state.seen_onboarding || {}) as Record<string, SeenEntry>;
      const now = new Date().toISOString();

      const updatedSeen = {
        ...seen,
        [onboarding_id]: {
          status: "completed" as const,
          seen_at: now,
          content_updated_at_seen: tutorial.content_updated_at || now,
          waived_at: null,
        },
      };

      const { error: updateErr } = await supabase
        .from("user_onboarding_state")
        .update({
          seen_onboarding: updatedSeen,
          updated_at: now,
        })
        .eq("id", state.id);

      if (updateErr) {
        console.error("Failed to update onboarding state:", updateErr);
        return res.status(500).json({ error: "Failed to mark tutorial as completed" });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Onboarding state API error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
