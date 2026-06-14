import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

const ALL_KEYS = ["chat_rolling_enabled", "chat_rolling_window_length", "voice_chunk_length_minutes"];

async function getChatConfig() {
  const { data: rows } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ALL_KEYS);

  const cfg: Record<string, string> = {};
  for (const row of rows || []) cfg[row.key] = row.value;
  const voiceChunkLength = parseInt(cfg.voice_chunk_length_minutes ?? "5", 10);

  return {
    rollingHistoryEnabled: (cfg.chat_rolling_enabled ?? "false") === "true",
    rollingWindowLength: parseInt(cfg.chat_rolling_window_length ?? "10", 10),
    voiceChunkLengthMinutes: Number.isFinite(voiceChunkLength)
      ? Math.max(1, Math.min(10, voiceChunkLength))
      : 5,
  };
}

async function setConfig(key: string, value: string) {
  const { error } = await supabase
    .from("admin_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(`Config save failed for "${key}": ${error.message}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // GET — any authenticated user can read
    if (req.method === "GET") {
      const authPayload = await authenticateRequest(req);
      if (!authPayload) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const config = await getChatConfig();
      return res.status(200).json(config);
    }

    // PUT — admin-only
    if (req.method === "PUT") {
      const authPayload = await authenticateRequest(req);
      if (!authPayload) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { data: user } = await supabase
        .from("users")
        .select("is_global_admin")
        .eq("id", authPayload.userId)
        .single();

      if (!user?.is_global_admin) {
        return res.status(403).json({ error: "Forbidden: Admins only" });
      }

      const { rollingHistoryEnabled, rollingWindowLength, voiceChunkLengthMinutes } = req.body || {};

      if (rollingHistoryEnabled !== undefined) {
        await setConfig("chat_rolling_enabled", String(rollingHistoryEnabled));
      }

      if (rollingWindowLength !== undefined) {
        const clamped = Math.max(3, Math.min(50, parseInt(String(rollingWindowLength), 10)));
        await setConfig("chat_rolling_window_length", String(clamped));
      }

      if (voiceChunkLengthMinutes !== undefined) {
        const clamped = Math.max(1, Math.min(10, parseInt(String(voiceChunkLengthMinutes), 10)));
        await setConfig("voice_chunk_length_minutes", String(clamped));
      }

      const config = await getChatConfig();
      return res.status(200).json(config);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Chat config API error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
