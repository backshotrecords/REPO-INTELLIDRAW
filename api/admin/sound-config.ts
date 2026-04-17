import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

const ALL_KEYS = [
  "sound_volume", "sound_enabled",
  "sound_url", "sound_file_name",
  "voice_sound_url", "voice_sound_file_name",
];

async function getFullConfig() {
  const { data: rows } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ALL_KEYS);

  const cfg: Record<string, string> = {};
  for (const row of rows || []) cfg[row.key] = row.value;

  return {
    volume: parseFloat(cfg.sound_volume ?? "0.5"),
    enabled: (cfg.sound_enabled ?? "true") === "true",
    soundUrl: cfg.sound_url ?? "/intellidraw-v2.mp3",
    soundFileName: cfg.sound_file_name || null,
    voiceSoundUrl: cfg.voice_sound_url ?? "/intellisend_v2.mp3",
    voiceSoundFileName: cfg.voice_sound_file_name || null,
  };
}

async function setConfig(key: string, value: string) {
  const { error } = await supabase
    .from("admin_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(`Config save failed for "${key}": ${error.message}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth required for all methods
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // ── GET: any authenticated user can read ──────────────
    if (req.method === "GET") {
      const config = await getFullConfig();
      return res.status(200).json(config);
    }

    // ── PUT: admin-only ──────────────────────────────────
    if (req.method === "PUT") {
      const { data: user } = await supabase
        .from("users")
        .select("is_global_admin")
        .eq("id", authPayload.userId)
        .single();

      if (!user?.is_global_admin) {
        return res.status(403).json({ error: "Forbidden: Admins only" });
      }

      const { volume, enabled, resetToDefault, soundType, soundFileData, soundFileName, soundFileMime } = req.body || {};
      const isVoice = soundType === "voice";
      const urlKey = isVoice ? "voice_sound_url" : "sound_url";
      const nameKey = isVoice ? "voice_sound_file_name" : "sound_file_name";
      const defaultUrl = isVoice ? "/intellisend_v2.mp3" : "/intellidraw-v2.mp3";

      if (volume !== undefined) await setConfig("sound_volume", String(volume));
      if (enabled !== undefined) await setConfig("sound_enabled", String(enabled));

      // Handle uploaded sound file (base64 encoded) → Supabase Storage
      if (soundFileData) {
        // Delete old custom sound from Storage if it exists
        const { data: oldRow } = await supabase
          .from("admin_config")
          .select("value")
          .eq("key", urlKey)
          .single();
        const oldUrl = oldRow?.value || defaultUrl;

        if (oldUrl && oldUrl.includes("/sound-effects/")) {
          const oldFileName = oldUrl.split("/sound-effects/").pop();
          if (oldFileName) await supabase.storage.from("sound-effects").remove([oldFileName]);
        }

        const ext = soundFileName?.match(/\.[^.]+$/)?.[0] || ".mp3";
        const storagePath = `custom-${isVoice ? "voice" : "canvas"}-${Date.now()}${ext}`;
        const buffer = Buffer.from(soundFileData, "base64");

        const { error: uploadErr } = await supabase.storage
          .from("sound-effects")
          .upload(storagePath, buffer, {
            contentType: soundFileMime || "audio/mpeg",
            upsert: true,
          });

        if (uploadErr) {
          console.error("Storage upload error:", uploadErr);
          return res.status(500).json({ error: "Failed to upload sound file" });
        }

        const { data: publicUrlData } = supabase.storage
          .from("sound-effects")
          .getPublicUrl(storagePath);

        await setConfig(urlKey, publicUrlData.publicUrl);
        await setConfig(nameKey, soundFileName || "Custom Sound");
      }

      // Reset to bundled default
      if (resetToDefault === true || resetToDefault === "true") {
        const { data: oldRow } = await supabase
          .from("admin_config")
          .select("value")
          .eq("key", urlKey)
          .single();
        const oldUrl = oldRow?.value || defaultUrl;

        if (oldUrl && oldUrl.includes("/sound-effects/")) {
          const oldFileName = oldUrl.split("/sound-effects/").pop();
          if (oldFileName) await supabase.storage.from("sound-effects").remove([oldFileName]);
        }
        await setConfig(urlKey, defaultUrl);
        await setConfig(nameKey, "");
      }

      const config = await getFullConfig();
      return res.status(200).json(config);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Sound config API error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
